/**
 * @prune/repo-map
 *
 * Symbol-level repository map. Productizes the Aider PageRank-over-AST
 * discipline as a reusable package any coding agent can consume via
 * MCP, CLI, or library. Pure TypeScript Compiler API for v0.1 (TS/JS);
 * tree-sitter language adapters land in v0.2.
 *
 * Reference benchmark: Aider's repo-map produces 4.2× fewer tokens than
 * Claude Code on the same 47-file task
 * (https://www.morphllm.com/comparisons/morph-vs-aider-diff). This
 * package gives any agent (Cursor, Cline, Codex CLI, Claude Code) the
 * same primitive.
 */

export {
  indexRepo,
  queryMap,
  type RepoMap,
  type IndexOptions,
  type QueryOptions,
  type RankedSymbol,
} from "./map.js";

export {
  extractSymbolsFromSource,
  isSupportedSource,
  type ExtractedSymbol,
  type SymbolKind,
} from "./parser.js";

export {
  buildGraph,
  type SymbolGraph,
  type SymbolNode,
} from "./graph.js";

export {
  pagerank,
  type PageRankOptions,
  type PageRankResult,
} from "./pagerank.js";
