/**
 * Structural (AST) equivalence for TypeScript / JavaScript.
 *
 * Two code snippets are structurally equivalent when their syntax trees match
 * after ignoring trivia (comments, whitespace, formatting) — and, optionally,
 * modulo consistent identifier renaming (alpha-equivalence). LITERAL VALUES
 * are always preserved: changing a string or number is a semantic change, so
 * `return 1` and `return 2` are never equivalent.
 *
 * IMPORTANT SCOPE NOTE. This relation is a *comparison/scoring* tool used by
 * F1 (final-output equivalence) and F4 (QpD scoring). It is NEVER the gate
 * that decides to substitute content into the agent's live context — that
 * path (F3) requires byte-equality, a strictly stronger relation. So the
 * permissive alpha-renaming mode here can never cause a semantic change to
 * ship; at worst it makes two genuinely-different outputs score as similar in
 * an offline metric.
 */

import ts from "typescript";

export type IdentifierMode = "literal" | "alpha";

export interface AstEquivalenceOptions {
  /**
   * "literal" (strict): identifiers compared by exact text — only trivia
   * differs. "alpha": identifiers consistently renamed (x↔y ok if used
   * identically). Default "alpha" since this is an offline metric.
   */
  identifierMode?: IdentifierMode;
  /** ts | tsx | js | jsx. Defaults to ts. */
  scriptKind?: "ts" | "tsx" | "js" | "jsx";
}

export interface AstEquivalenceResult {
  /** True when the two token streams are identical. */
  equivalent: boolean;
  /** Graded similarity in [0,1] (1 − normalized token-sequence distance). */
  similarity: number;
  /** False when either side failed to parse without syntax errors. */
  parsedBoth: boolean;
  detail: {
    tokensA: number;
    tokensB: number;
    syntaxErrorsA: number;
    syntaxErrorsB: number;
  };
}

/**
 * Produce a canonical token stream for a code snippet. Each emitted token is a
 * stable string; equal streams ⇒ structurally equivalent code. The walk uses
 * `ts.forEachChild`, which visits semantic children only (trivia is excluded
 * by construction).
 */
export function fingerprint(
  code: string,
  options: AstEquivalenceOptions = {}
): { tokens: string[]; syntaxErrors: number } {
  const mode = options.identifierMode ?? "alpha";
  const scriptKind = toScriptKind(options.scriptKind ?? "ts");
  const sf = ts.createSourceFile(
    "snippet" + extFor(options.scriptKind ?? "ts"),
    code,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    scriptKind
  );

  const tokens: string[] = [];
  const idMap = new Map<string, number>();
  let nextId = 0;

  const renameId = (name: string): string => {
    if (mode === "literal") return `id:${name}`;
    let idx = idMap.get(name);
    if (idx === undefined) {
      idx = nextId++;
      idMap.set(name, idx);
    }
    return `id#${idx}`;
  };

  const visit = (node: ts.Node): void => {
    const kind = ts.SyntaxKind[node.kind];
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
      tokens.push(renameId(node.text));
    } else if (ts.isStringLiteralLike(node)) {
      // Literal value is semantic — keep it verbatim.
      tokens.push(`str:${node.text}`);
    } else if (ts.isNumericLiteral(node) || ts.isBigIntLiteral(node)) {
      tokens.push(`num:${node.text}`);
    } else {
      tokens.push(kind);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);

  return { tokens, syntaxErrors: countSyntaxErrors(sf) };
}

/**
 * Compare two code snippets for structural equivalence and return a graded
 * similarity. When either side has syntax errors, `parsedBoth` is false and
 * callers should fall back to text equivalence.
 */
export function astEquivalent(
  a: string,
  b: string,
  options: AstEquivalenceOptions = {}
): AstEquivalenceResult {
  const fa = fingerprint(a, options);
  const fb = fingerprint(b, options);
  const parsedBoth = fa.syntaxErrors === 0 && fb.syntaxErrors === 0;
  const equivalent =
    parsedBoth && tokenSequenceEqual(fa.tokens, fb.tokens);
  const similarity = tokenSequenceSimilarity(fa.tokens, fb.tokens);
  return {
    equivalent,
    similarity,
    parsedBoth,
    detail: {
      tokensA: fa.tokens.length,
      tokensB: fb.tokens.length,
      syntaxErrorsA: fa.syntaxErrors,
      syntaxErrorsB: fb.syntaxErrors,
    },
  };
}

function tokenSequenceEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Graded similarity over token sequences: 1 − (token-level Levenshtein /
 * longer length). Uses the same two-row DP as text but over token arrays.
 */
export function tokenSequenceSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const dist = tokenLevenshtein(a, b);
  return 1 - dist / maxLen;
}

function tokenLevenshtein(a: string[], b: string[]): number {
  if (a.length < b.length) {
    const t = a;
    a = b;
    b = t;
  }
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[b.length];
}

function countSyntaxErrors(sf: ts.SourceFile): number {
  // The parser records recoverable diagnostics on the source file under an
  // internal property; count them as a parse-health signal.
  const diags = (sf as unknown as { parseDiagnostics?: unknown[] })
    .parseDiagnostics;
  return Array.isArray(diags) ? diags.length : 0;
}

function toScriptKind(kind: "ts" | "tsx" | "js" | "jsx"): ts.ScriptKind {
  switch (kind) {
    case "tsx":
      return ts.ScriptKind.TSX;
    case "js":
      return ts.ScriptKind.JS;
    case "jsx":
      return ts.ScriptKind.JSX;
    default:
      return ts.ScriptKind.TS;
  }
}

function extFor(kind: "ts" | "tsx" | "js" | "jsx"): string {
  return "." + kind;
}
