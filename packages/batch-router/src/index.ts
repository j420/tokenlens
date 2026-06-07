/**
 * @prune/batch-router (List1 batch-tier-router)
 *
 * Mechanical per-request batch-vs-interactive classifier over caller-declared
 * signals; quotes the caller-supplied Batch discount. Deterministic; null cost
 * on an unpriced request; no regex, no model.
 */

export {
  routeRequest,
  type BatchRequest,
  type RouterOptions,
  type Lane,
  type RouteDecision,
} from "./router.js";
