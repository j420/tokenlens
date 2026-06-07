/**
 * Types for Program-Slice Context Selection (F17).
 *
 * A backward static slice of a set of seed symbols is every symbol the seeds
 * transitively depend on. For context selection that is exactly the sound set:
 * to understand or modify the seeds, the model needs what they reach, and
 * nothing outside that closure. This replaces a relevance *heuristic* with a
 * reachability *guarantee* — with no token budget, the slice provably contains
 * every dependency (Weiser 1981), so it cannot drop needed context.
 *
 * The graph is generic (nodes + directed dependency edges), so the package has
 * no dependency on any particular extractor; an adapter converts a repo-map
 * symbol graph into this shape.
 */

/** A node in the dependency graph. `tokens` is a caller-measured cost. */
export interface SliceNode {
  id: string;
  tokens?: number;
}

/** A directed dependency edge: `from` depends on (references) `to`. */
export interface SliceEdge {
  from: string;
  to: string;
}

export interface SliceGraphInput {
  nodes: readonly SliceNode[];
  edges: readonly SliceEdge[];
}

/** "backward" = dependencies of the seeds; "forward" = dependents (impact). */
export type SliceDirection = "backward" | "forward";

export interface SliceOptions {
  seeds: readonly string[];
  direction?: SliceDirection;
  /** Max hops from a seed (inclusive). Infinity by default. */
  maxDepth?: number;
  /**
   * Optional token budget. When the sound slice exceeds it, the FARTHEST
   * symbols are cut first (nearest-to-seed kept) and reported separately — the
   * one and only way a needed symbol can be dropped, and always explicitly.
   */
  tokenBudget?: number | null;
}

export interface SliceMember {
  id: string;
  /** Hop distance from the nearest seed (seeds are 0). */
  distance: number;
  tokens: number;
}

export interface SliceResult {
  included: SliceMember[];
  /** Reachable symbols cut purely to satisfy the token budget. */
  cutByBudget: SliceMember[];
  totalTokens: number;
  seeds: string[];
  direction: SliceDirection;
  /**
   * True when the slice is the complete reachable set (no budget cut) — i.e. the
   * soundness guarantee holds and no dependency was dropped.
   */
  sound: boolean;
  /** Seed ids that were not present in the graph (reported, never silent). */
  missingSeeds: string[];
}
