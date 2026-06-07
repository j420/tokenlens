/**
 * @prune/cache-reconcile (U3)
 *
 * Closed-loop cache reconciliation: predicted vs realized cache-read tokens,
 * flagging an under-performing (stranded) cache write. Both sides caller-fed;
 * insufficient_signal when unknown; deterministic; no regex, no model.
 */

export {
  reconcileCacheHits,
  type ReconcileInput,
  type ReconcileOptions,
  type ReconcileReport,
} from "./reconcile.js";
