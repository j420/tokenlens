/**
 * @prune/equivalence
 *
 * Output-equivalence relations used by the TCRP cost-reduction features to
 * verify that a transform (cached substitution, dieted trajectory, cheaper
 * model) produced an equivalent result.
 *
 *   - textEquivalent   prose / non-code, normalized Levenshtein
 *   - astEquivalent    TS/JS, structural fingerprint modulo alpha-renaming
 *   - symbolCoverage   mixed output, directional named-entity coverage
 *   - equivalent       dispatcher that picks the right strategy
 *
 * Hard rule (mirrors the program mandate): equivalence here is a comparison /
 * scoring instrument. The only path that substitutes content into the agent's
 * live context (F3) uses byte-equality, never this. So a permissive match can
 * never cause a semantic change to ship — at worst it mis-scores an offline
 * metric.
 */

import { astEquivalent, type AstEquivalenceOptions } from "./ast.js";
import { symbolCoverage } from "./coverage.js";
import { textEquivalent } from "./text.js";

export * from "./text.js";
export * from "./ast.js";
export * from "./coverage.js";

export type EquivalenceStrategy = "ast" | "text" | "coverage" | "byte";

export interface EquivalenceOptions {
  /** Treat inputs as code (try AST first). Default: auto-detect. */
  asCode?: boolean;
  astOptions?: AstEquivalenceOptions;
  /** Max normalized text distance to count as equivalent. Default 0.05. */
  textMaxDistance?: number;
  /** Symbol-coverage threshold for the mixed/fallback path. Default 0.97. */
  coverageThreshold?: number;
}

export interface EquivalenceResult {
  equivalent: boolean;
  strategy: EquivalenceStrategy;
  /** Graded similarity in [0,1] for ranking/scoring callers (e.g. F4). */
  similarity: number;
  detail: Record<string, unknown>;
}

/**
 * Byte-equality — the strictest relation. This is what F3 uses before it will
 * ever substitute a cached tool result into the agent's context.
 */
export function byteEqual(a: string, b: string): EquivalenceResult {
  const equal = a === b;
  return {
    equivalent: equal,
    strategy: "byte",
    similarity: equal ? 1 : 0,
    detail: { lengthA: a.length, lengthB: b.length },
  };
}

/**
 * Dispatcher. If the content looks like code (or `asCode` is set) and both
 * sides parse, use AST structural equivalence. Otherwise fall back to text
 * equivalence; if text is far apart, report symbol coverage as the graded
 * signal so callers still get a meaningful similarity.
 */
export function equivalent(
  a: string,
  b: string,
  options: EquivalenceOptions = {}
): EquivalenceResult {
  if (a === b) {
    return { equivalent: true, strategy: "byte", similarity: 1, detail: {} };
  }

  const wantCode = options.asCode ?? looksLikeCode(a) ?? looksLikeCode(b);
  if (wantCode) {
    const ast = astEquivalent(a, b, options.astOptions);
    if (ast.parsedBoth) {
      return {
        equivalent: ast.equivalent,
        strategy: "ast",
        similarity: ast.similarity,
        detail: ast.detail,
      };
    }
    // Parsing failed on at least one side — fall through to text.
  }

  const text = textEquivalent(a, b, options.textMaxDistance);
  if (text.equivalent) {
    return {
      equivalent: true,
      strategy: "text",
      similarity: text.similarity,
      detail: { distance: text.distance },
    };
  }

  // Not text-equivalent: report coverage as the graded signal.
  const cov = symbolCoverage(a, b, options.coverageThreshold);
  // Final equivalence verdict is the union of the text and coverage gates —
  // text already said "no", so this is coverage's call.
  return {
    equivalent: cov.equivalent,
    strategy: "coverage",
    // Blend so callers ranking on similarity see both signals.
    similarity: Math.max(text.similarity, cov.coverage),
    detail: {
      textDistance: text.distance,
      coverage: cov.coverage,
      missing: cov.missing.slice(0, 20),
    },
  };
}

/**
 * Cheap heuristic: does this string look like source code? Returns undefined
 * when ambiguous so the dispatcher can consult the other operand.
 */
export function looksLikeCode(s: string): boolean | undefined {
  const trimmed = s.trim();
  if (trimmed.length === 0) return undefined;
  const codeSignals = [
    /\bfunction\b/,
    /\bconst\b|\blet\b|\bvar\b/,
    /\bclass\b/,
    /\bimport\b|\bexport\b/,
    /=>/,
    /[;{}]\s*$/m,
    /\breturn\b/,
    /\binterface\b|\btype\b\s+\w+\s*=/,
  ];
  const hits = codeSignals.reduce((n, re) => n + (re.test(trimmed) ? 1 : 0), 0);
  if (hits >= 2) return true;
  if (hits === 0) return false;
  return undefined;
}
