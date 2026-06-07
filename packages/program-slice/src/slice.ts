/**
 * The slicer. Pure breadth-first reachability over the dependency graph from a
 * set of seeds, producing a slice annotated with hop-distance and token cost.
 *
 * BFS guarantees each reachable symbol is recorded at its MINIMUM distance from
 * any seed, which is what the (optional) token budget uses to decide what to
 * keep: nearest dependencies are the most likely to matter, so cuts fall on the
 * farthest first — and every cut is reported, never silent. With no budget the
 * result is the full reachable closure and `sound` is true.
 */

import type {
  SliceGraphInput,
  SliceMember,
  SliceOptions,
  SliceResult,
} from "./types.js";

interface Adjacency {
  /** id → dependency ids (backward direction). */
  forwardDeps: Map<string, string[]>;
  /** id → dependent ids (forward direction). */
  reverseDeps: Map<string, string[]>;
  tokensById: Map<string, number>;
  ids: Set<string>;
}

function buildAdjacency(graph: SliceGraphInput): Adjacency {
  const forwardDeps = new Map<string, string[]>();
  const reverseDeps = new Map<string, string[]>();
  const tokensById = new Map<string, number>();
  const ids = new Set<string>();

  for (const n of graph.nodes) {
    ids.add(n.id);
    tokensById.set(n.id, Math.max(0, n.tokens ?? 0));
    if (!forwardDeps.has(n.id)) forwardDeps.set(n.id, []);
    if (!reverseDeps.has(n.id)) reverseDeps.set(n.id, []);
  }
  for (const e of graph.edges) {
    // Only connect edges whose endpoints are real nodes.
    if (!ids.has(e.from) || !ids.has(e.to)) continue;
    (forwardDeps.get(e.from) as string[]).push(e.to);
    (reverseDeps.get(e.to) as string[]).push(e.from);
  }
  return { forwardDeps, reverseDeps, tokensById, ids };
}

export function computeSlice(
  graph: SliceGraphInput,
  options: SliceOptions
): SliceResult {
  const direction = options.direction ?? "backward";
  const maxDepth = options.maxDepth ?? Number.POSITIVE_INFINITY;
  const adj = buildAdjacency(graph);
  const neighbors =
    direction === "backward" ? adj.forwardDeps : adj.reverseDeps;

  const missingSeeds: string[] = [];
  const distance = new Map<string, number>();
  const queue: string[] = [];

  for (const seed of options.seeds) {
    if (!adj.ids.has(seed)) {
      missingSeeds.push(seed);
      continue;
    }
    if (!distance.has(seed)) {
      distance.set(seed, 0);
      queue.push(seed);
    }
  }

  // BFS — records the minimum distance for each reachable node.
  let head = 0;
  while (head < queue.length) {
    const id = queue[head++];
    const d = distance.get(id) as number;
    if (d >= maxDepth) continue;
    for (const next of neighbors.get(id) ?? []) {
      if (!distance.has(next)) {
        distance.set(next, d + 1);
        queue.push(next);
      }
    }
  }

  // Order: nearest first, then by token cost ascending, then id for determinism.
  const members: SliceMember[] = [...distance.entries()].map(([id, dist]) => ({
    id,
    distance: dist,
    tokens: adj.tokensById.get(id) ?? 0,
  }));
  members.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    if (a.tokens !== b.tokens) return a.tokens - b.tokens;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  // Apply the optional token budget by keeping the prefix (nearest) under cap.
  const budget = options.tokenBudget;
  const included: SliceMember[] = [];
  const cutByBudget: SliceMember[] = [];
  if (typeof budget === "number") {
    let running = 0;
    for (const m of members) {
      if (running + m.tokens <= budget) {
        included.push(m);
        running += m.tokens;
      } else {
        cutByBudget.push(m);
      }
    }
  } else {
    included.push(...members);
  }

  const totalTokens = included.reduce((s, m) => s + m.tokens, 0);
  return {
    included,
    cutByBudget,
    totalTokens,
    seeds: [...options.seeds],
    direction,
    sound: cutByBudget.length === 0,
    missingSeeds,
  };
}
