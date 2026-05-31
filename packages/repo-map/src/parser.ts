/**
 * AST-based symbol + reference extractor (TypeScript Compiler API).
 *
 * Hard rule from CLAUDE.md: no regex parsing of code. We use the
 * TypeScript Compiler API directly (already a workspace dep) to:
 *   - Build a SourceFile from each input .ts/.tsx/.js/.jsx/.mjs/.cjs
 *   - Walk the AST to extract Declarations (function, class, interface,
 *     type, enum, exported variable) — these become the graph nodes.
 *   - Walk the AST to collect Identifier references inside each
 *     declaration body — these become outgoing edges to other nodes by
 *     identifier name (resolved later in graph.ts).
 *
 * What this v0.1 deliberately doesn't do:
 *   - Cross-file rename resolution via TypeScript's symbol resolver
 *     (would require a tsconfig + a real Program; v0.2). We resolve by
 *     identifier text + a "same name → same symbol" heuristic, with
 *     filePath disambiguation when collisions arise. This is the same
 *     pragmatic shortcut Aider's repo-map takes for its initial ranking.
 *   - Python/Go/Rust/etc. — wrap tree-sitter in v0.2. The shape here
 *     (Symbol/Reference) is language-agnostic so adapters compose.
 */

import ts from "typescript";

export type SymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "enum"
  | "variable"
  | "method"
  | "property";

export interface ExtractedSymbol {
  /** Stable id: `${filePath}#${name}#${kind}#${line}` */
  id: string;
  name: string;
  kind: SymbolKind;
  filePath: string;
  /** 1-indexed start line. */
  line: number;
  /** Source text of the declaration (signature + body for functions; full for types). */
  text: string;
  /** Single-line signature for compact display. */
  signature: string;
  /** Whether the declaration was exported. */
  exported: boolean;
  /** Identifier names referenced inside this declaration's body. */
  references: string[];
}

const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

function inferScriptKind(filePath: string): ts.ScriptKind {
  if (filePath.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (filePath.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (filePath.endsWith(".ts")) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

export function isSupportedSource(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  for (const ext of SOURCE_EXT) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

function isExported(node: ts.Node): boolean {
  const mods = (node as ts.HasModifiers).modifiers;
  if (!mods) return false;
  return mods.some(
    (m) => m.kind === ts.SyntaxKind.ExportKeyword || m.kind === ts.SyntaxKind.DefaultKeyword
  );
}

function nameOf(node: ts.Node): string | null {
  const n = (node as ts.NamedDeclaration).name;
  if (n && ts.isIdentifier(n)) return n.text;
  if (n && ts.isStringLiteral(n)) return n.text;
  return null;
}

function signatureLineFromText(text: string): string {
  const firstLine = text.split("\n", 1)[0] ?? "";
  // Trim block opener for the signature display only — we keep `text`
  // intact for the AST traversal.
  return firstLine.replace(/\s*\{\s*$/, "").trim();
}

function collectReferencesInside(
  node: ts.Node,
  out: Set<string>,
  ownName: string | null
): void {
  ts.forEachChild(node, function visit(child) {
    if (ts.isIdentifier(child)) {
      const name = child.text;
      if (name !== ownName && /^[A-Za-z_$][\w$]*$/.test(name)) {
        out.add(name);
      }
    }
    ts.forEachChild(child, visit);
  });
}

export function extractSymbolsFromSource(
  filePath: string,
  source: string
): ExtractedSymbol[] {
  if (!isSupportedSource(filePath)) return [];
  const sf = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ true,
    inferScriptKind(filePath)
  );
  const out: ExtractedSymbol[] = [];

  const emit = (node: ts.Node, kind: SymbolKind) => {
    const name = nameOf(node);
    if (!name) return;
    const start = node.getStart(sf);
    const end = node.getEnd();
    const { line: line0 } = sf.getLineAndCharacterOfPosition(start);
    const text = source.slice(start, end);
    const refs = new Set<string>();
    collectReferencesInside(node, refs, name);
    out.push({
      id: `${filePath}#${name}#${kind}#${line0 + 1}`,
      name,
      kind,
      filePath,
      line: line0 + 1,
      text,
      signature: signatureLineFromText(text),
      exported: isExported(node),
      references: Array.from(refs),
    });
  };

  ts.forEachChild(sf, function walk(node) {
    if (ts.isFunctionDeclaration(node)) emit(node, "function");
    else if (ts.isClassDeclaration(node)) emit(node, "class");
    else if (ts.isInterfaceDeclaration(node)) emit(node, "interface");
    else if (ts.isTypeAliasDeclaration(node)) emit(node, "type");
    else if (ts.isEnumDeclaration(node)) emit(node, "enum");
    else if (ts.isVariableStatement(node)) {
      // Capture each declaration in the statement (handles `export const foo = ...`).
      const exportedStmt = isExported(node);
      for (const decl of node.declarationList.declarations) {
        if (decl.name && ts.isIdentifier(decl.name)) {
          const initText = decl.getText(sf);
          const isFn =
            !!decl.initializer &&
            (ts.isArrowFunction(decl.initializer) ||
              ts.isFunctionExpression(decl.initializer));
          const kind: SymbolKind = isFn ? "function" : "variable";
          const start = decl.getStart(sf);
          const { line: line0 } = sf.getLineAndCharacterOfPosition(start);
          const refs = new Set<string>();
          collectReferencesInside(decl, refs, decl.name.text);
          out.push({
            id: `${decl.name.text}@${filePath}:${line0 + 1}:${kind}`,
            name: decl.name.text,
            kind,
            filePath,
            line: line0 + 1,
            text: initText,
            signature: signatureLineFromText(initText),
            exported: exportedStmt,
            references: Array.from(refs),
          });
        }
      }
    }
    // Don't recurse into bodies — collectReferencesInside already does.
    if (
      ts.isModuleDeclaration(node) ||
      ts.isModuleBlock(node) ||
      node.kind === ts.SyntaxKind.SourceFile
    ) {
      ts.forEachChild(node, walk);
    }
  });

  return out;
}
