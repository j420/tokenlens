/**
 * @prune/fleet-cache (F7)
 *
 * Team-scoped resolved-context cache, gated by dependency content-SHA freshness:
 * a hit is served only when every dep SHA is unchanged; drift evicts. Stores
 * SHAs + an answer ref, not content. Deterministic; no model call, no regex.
 */

export {
  emptyFleetCache,
  putResolved,
  getResolved,
  type ResolvedEntry,
  type FleetCache,
  type GetReason,
  type GetResult,
} from "./cache.js";
