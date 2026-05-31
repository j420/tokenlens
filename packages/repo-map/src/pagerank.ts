/**
 * Pure PageRank — iterative power-method impl.
 *
 * Standard formulation:
 *   PR(p) = (1-d)/N + d * sum( PR(q) / outDegree(q) for q in inNeighbors(p) )
 *
 * with damping factor d (default 0.85, the Page & Brin original) and N
 * the number of nodes. Sinks (nodes with no out-edges) redistribute
 * their PR uniformly to all nodes to preserve the probability mass.
 *
 * Spec sanity-check anchors:
 *   - Page, Brin et al. 1998 (the original PageRank paper) — d = 0.85.
 *   - Convergence: practitioners commonly stop at L1 delta < 1e-6.
 *   - For ~10k nodes, 30 iterations are typically enough.
 *
 * No dependencies. Easy for a reviewer to audit.
 */

import type { SymbolGraph } from "./graph.js";

export interface PageRankOptions {
  /** Damping factor 0..1. Default 0.85. */
  damping?: number;
  /** Hard iteration cap. Default 50. */
  maxIterations?: number;
  /** Stop when L1 delta between iterations falls below this. Default 1e-6. */
  tolerance?: number;
  /**
   * Optional bias vector — id → relative weight (will be normalized).
   * When provided, replaces the uniform teleport (1-d)/N with a
   * "personalized PageRank" toward the bias nodes. Use for
   * intent-conditioned ranking (e.g. "weight symbols near the error
   * location higher").
   */
  bias?: Map<string, number>;
}

export interface PageRankResult {
  scores: Map<string, number>;
  iterations: number;
  finalDelta: number;
}

export function pagerank(
  graph: SymbolGraph,
  opts: PageRankOptions = {}
): PageRankResult {
  const damping = opts.damping ?? 0.85;
  const maxIter = opts.maxIterations ?? 50;
  const tol = opts.tolerance ?? 1e-6;

  const ids = Array.from(graph.nodes.keys());
  const N = ids.length;
  if (N === 0) {
    return { scores: new Map(), iterations: 0, finalDelta: 0 };
  }

  // Normalize bias vector if present.
  let teleport: Map<string, number>;
  if (opts.bias && opts.bias.size > 0) {
    let s = 0;
    for (const v of opts.bias.values()) s += v;
    if (s > 0) {
      teleport = new Map();
      for (const [k, v] of opts.bias) teleport.set(k, v / s);
    } else {
      teleport = new Map(ids.map((id) => [id, 1 / N]));
    }
  } else {
    teleport = new Map(ids.map((id) => [id, 1 / N]));
  }

  let scores = new Map(ids.map((id) => [id, 1 / N]));
  let iterations = 0;
  let delta = Number.POSITIVE_INFINITY;
  let lastDelta = delta;

  for (let i = 0; i < maxIter; i++) {
    iterations++;
    const next = new Map<string, number>();
    // Sink mass — PR that would be lost (no out-edges).
    let sinkMass = 0;
    for (const id of ids) {
      const n = graph.nodes.get(id)!;
      if (n.outNeighbors.length === 0) {
        sinkMass += scores.get(id) ?? 0;
      }
    }
    for (const id of ids) {
      const teleportPart = (1 - damping) * (teleport.get(id) ?? 0);
      let inPart = 0;
      const node = graph.nodes.get(id)!;
      for (const inId of node.inNeighbors) {
        const inNode = graph.nodes.get(inId)!;
        const inScore = scores.get(inId) ?? 0;
        const outDeg = inNode.outNeighbors.length;
        if (outDeg > 0) inPart += inScore / outDeg;
      }
      const sinkPart = damping * sinkMass * (teleport.get(id) ?? 0);
      next.set(id, teleportPart + damping * inPart + sinkPart);
    }
    // L1 delta vs previous iteration.
    delta = 0;
    for (const id of ids) {
      delta += Math.abs((next.get(id) ?? 0) - (scores.get(id) ?? 0));
    }
    scores = next;
    if (delta < tol) break;
    lastDelta = delta;
  }

  return { scores, iterations, finalDelta: delta < Number.POSITIVE_INFINITY ? delta : lastDelta };
}
