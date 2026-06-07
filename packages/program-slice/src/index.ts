/**
 * @prune/program-slice — F17, Program-Slice Context Selection.
 *
 * Public surface:
 *   - computeSlice(graph, options) → the backward/forward static slice
 *   - fromSymbolGraph(repoMapGraph) → adapt a repo-map graph to slice input
 *
 * Pure graph traversal. With no token budget the slice is the complete
 * reachable closure (`sound: true`) — no dependency is ever silently dropped.
 * No regex, no model, no fabricated tokens.
 */

export * from "./types.js";
export { computeSlice } from "./slice.js";
export {
  fromSymbolGraph,
  type RepoMapGraphLike,
  type RepoMapNodeLike,
} from "./adapter.js";
