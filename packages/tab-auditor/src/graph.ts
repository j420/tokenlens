/**
 * Adjacency proximity to the active file.
 *
 * Two regimes:
 *   1. Import-graph BFS — when the caller supplies importEdges, the closest
 *      structural relationship to the active file wins. Distance is in hops;
 *      we convert hop distance to a proximity score in [0,1] with exponential
 *      decay so direct neighbours score high and far nodes decay toward 0.
 *   2. Path-distance fallback — when no edges are supplied (or a node is
 *      unreachable in the graph), proximity is derived from how many leading
 *      path components a tab shares with the active file.
 *
 * The graph is treated as UNDIRECTED for proximity: a file that the active
 * file imports and a file that imports the active file are both "adjacent".
 */

import { pathComponents } from "./tokenize.js";

export interface ImportEdge {
  from: string;
  to: string;
}

/**
 * Build an undirected adjacency map from edges. Self-loops are ignored.
 * Determinism: neighbour insertion order does not affect BFS hop distance,
 * which is all we read out.
 */
export function buildAdjacency(
  edges: ReadonlyArray<ImportEdge> | undefined,
): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  if (!Array.isArray(edges)) return adj;
  for (const e of edges) {
    if (!e || typeof e.from !== "string" || typeof e.to !== "string") continue;
    if (e.from === e.to) continue;
    if (!adj.has(e.from)) adj.set(e.from, new Set());
    if (!adj.has(e.to)) adj.set(e.to, new Set());
    adj.get(e.from)!.add(e.to);
    adj.get(e.to)!.add(e.from);
  }
  return adj;
}

/**
 * BFS hop distances from `source` over the undirected adjacency map.
 * Returns a map node→distance. Source has distance 0. Unreachable nodes are
 * absent. Bounded by the graph size; never throws.
 */
export function bfsDistances(
  adj: Map<string, Set<string>>,
  source: string,
): Map<string, number> {
  const dist = new Map<string, number>();
  if (!adj.has(source)) return dist; // source not in graph → no reachable info
  dist.set(source, 0);
  let frontier: string[] = [source];
  let depth = 0;
  while (frontier.length > 0) {
    depth++;
    const next: string[] = [];
    for (const node of frontier) {
      const neighbours = adj.get(node);
      if (!neighbours) continue;
      for (const nb of neighbours) {
        if (!dist.has(nb)) {
          dist.set(nb, depth);
          next.push(nb);
        }
      }
    }
    frontier = next;
  }
  return dist;
}

/**
 * Convert a BFS hop distance to a proximity score in (0,1].
 *
 * proximity = DECAY^distance with DECAY = 0.6:
 *   distance 0 (self)      ⇒ 1.00
 *   distance 1 (direct)    ⇒ 0.60
 *   distance 2             ⇒ 0.36
 *   distance 3             ⇒ 0.216 ...
 *
 * The decay base is chosen deliberately so that a DIRECT import edge (hop 1 →
 * 0.6) outranks a merely coincidental shared top-level directory under the
 * path-distance fallback (which tops out around 0.5 for a single shared
 * component). A real graph edge is stronger evidence of relevance than two
 * files happening to live beneath the same folder. Monotonic, bounded.
 */
const HOP_DECAY = 0.6;
export function hopProximity(distance: number): number {
  if (!Number.isFinite(distance) || distance < 0) return 0;
  return Math.pow(HOP_DECAY, distance);
}

/**
 * Path-distance proximity in [0,1] based on shared leading path components
 * relative to the active file. Same directory ⇒ high; deeper shared prefix ⇒
 * higher. Score = sharedPrefixLen / max(componentsActive, componentsTab),
 * which is 1.0 only for an identical directory chain and degrades smoothly.
 *
 * We compare DIRECTORY chains (all components except the final filename) so
 * that two files in the same folder score as fully adjacent regardless of
 * their differing file names.
 */
export function pathProximity(activeFile: string, tabPath: string): number {
  const aAll = pathComponents(activeFile);
  const tAll = pathComponents(tabPath);
  // Directory chain = everything but the last component (the filename).
  const aDir = aAll.slice(0, Math.max(0, aAll.length - 1));
  const tDir = tAll.slice(0, Math.max(0, tAll.length - 1));
  if (aDir.length === 0 && tDir.length === 0) {
    // Both at root (e.g. "a.ts" vs "b.ts") → same directory.
    return 1;
  }
  let shared = 0;
  const min = Math.min(aDir.length, tDir.length);
  for (let i = 0; i < min; i++) {
    if (aDir[i] === tDir[i]) shared++;
    else break;
  }
  const denom = Math.max(aDir.length, tDir.length);
  if (denom === 0) return 1;
  return shared / denom;
}
