/**
 * Eviction ordering. When a hard token budget forces dropping observations that
 * are still inside the window, which do we drop first?
 *
 * Belady's MIN algorithm (1966) is provably optimal: evict the item whose next
 * use is farthest in the future. That requires foresight. In an online agent
 * loop we usually don't have it, so we fall back to LRU — evict the least
 * recently used — which Sleator & Tarjan (1985) proved is k-competitive against
 * the clairvoyant optimum (no deterministic online policy does better). This
 * module implements both behind one comparator: true MIN when `nextUseTurn` is
 * known for the candidates, LRU otherwise.
 *
 * Pure and total. No randomness; ties broken deterministically by id.
 */

import type { Observation } from "./types.js";

/**
 * Effective "distance to next use" for ordering. A known future reference uses
 * the real distance; an item never referenced again (or unknown) is treated as
 * infinitely far — the best possible eviction candidate. When ALL candidates are
 * unknown this degrades to pure recency (older `turn` ⇒ evict first), i.e. LRU.
 */
function nextUseDistance(obs: Observation, currentTurn: number): number {
  if (typeof obs.nextUseTurn === "number" && obs.nextUseTurn > currentTurn) {
    return obs.nextUseTurn - currentTurn;
  }
  return Number.POSITIVE_INFINITY;
}

/**
 * Return the candidates ordered by eviction priority — the first element is the
 * best one to evict. Higher next-use distance evicts first (Belady); for equal
 * distance, older observations evict first (LRU tie-break); final ties broken by
 * id for determinism. Does not mutate the input.
 */
export function beladyEvictionOrder(
  candidates: readonly Observation[],
  currentTurn: number
): Observation[] {
  return [...candidates].sort((a, b) => {
    const da = nextUseDistance(a, currentTurn);
    const db = nextUseDistance(b, currentTurn);
    if (da !== db) return db - da; // farther next-use evicted first
    if (a.turn !== b.turn) return a.turn - b.turn; // older first (LRU)
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
