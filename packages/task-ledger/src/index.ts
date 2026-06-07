/**
 * @prune/task-ledger (F11)
 *
 * Cost-per-completed-task ledger: re-aggregates caller-supplied per-request
 * spend events by TASK and divides by the accepted-outcome count, exposing the
 * retry/dead-end spend that per-request views hide. Deterministic, honest
 * pricing (null on unpriced model), PII-safe (ids + counts + an outcome enum).
 */

export {
  rollupTaskLedger,
  eventCostUsd,
  type TaskOutcome,
  type SpendEvent,
  type TaskLedgerOptions,
  type TaskRollup,
  type TaskLedgerReport,
} from "./ledger.js";
