/**
 * Adapter from a repo-map symbol graph to the generic slice graph. Kept
 * dependency-free by accepting a STRUCTURAL type (the subset of
 * @prune/repo-map's SymbolGraph this needs), so the slicer never pulls in the
 * extractor. In a repo-map graph an edge A→B (A's `outNeighbors`) means "A
 * references B" — i.e. A depends on B — which is exactly a backward dependency
 * edge { from: A, to: B }.
 */

import type { SliceGraphInput, SliceNode, SliceEdge } from "./types.js";

/** Minimal structural view of a repo-map node. */
export interface RepoMapNodeLike {
  id: string;
  outNeighbors: string[];
  /** Declaration source text, used only to estimate token cost when no measurer. */
  text?: string;
}

/** Minimal structural view of a repo-map graph. */
export interface RepoMapGraphLike {
  nodes: Map<string, RepoMapNodeLike>;
}

/**
 * Convert a repo-map graph into a slice graph. `tokensFor` supplies a measured
 * token cost per node; when omitted, a conservative char/4 estimate of the
 * declaration text is used (clearly an estimate, never reported as an exact
 * model count).
 */
export function fromSymbolGraph(
  graph: RepoMapGraphLike,
  tokensFor?: (node: RepoMapNodeLike) => number
): SliceGraphInput {
  const nodes: SliceNode[] = [];
  const edges: SliceEdge[] = [];
  for (const node of graph.nodes.values()) {
    nodes.push({
      id: node.id,
      tokens: tokensFor
        ? Math.max(0, tokensFor(node))
        : estimateTokens(node.text),
    });
    for (const dep of node.outNeighbors) {
      edges.push({ from: node.id, to: dep });
    }
  }
  return { nodes, edges };
}

function estimateTokens(text: string | undefined): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
