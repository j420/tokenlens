/**
 * @prune/lsp-graph (F10)
 *
 * LSP symbol-graph substitution: builds a compact, injectable signatures+edges
 * payload from the language server's authoritative index, budget-selected by
 * reference in-degree, so the model never re-derives the graph from raw bodies.
 * Deterministic; equivalence is by construction (the LSP index is canonical).
 */

export {
  buildLspGraphPayload,
  type SymbolKind,
  type LspSymbol,
  type LspReference,
  type LspIndex,
  type LspGraphOptions,
  type IncludedSymbol,
  type LspGraphPayload,
} from "./lsp-graph.js";
