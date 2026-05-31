/**
 * @prune/budget-gate
 *
 * Active budget tracking and enforcement for AI coding-agent spend.
 *
 * Designed for the post-June-15-2026 world where Claude Agent SDK / `claude -p`
 * / GitHub Actions / third-party agents are metered against a separate
 * monthly credit pool at full API list prices (12×–175× effective price
 * increase per the canonical analysis). Indie devs need surprise
 * prevention; teams need per-agent sub-budgets; enterprise needs
 * rolled-up attribution. All three sit on the same primitives in here.
 *
 * Local-first by design: state lives in any `PersistenceSink`
 * (`LocalSqliteSink` by default — atomic flush + multi-process lock).
 * No code leaves the machine.
 */

export {
  BudgetGate,
  BudgetGateError,
  type EnvelopeSpec,
  type CheckRequest,
  type RecordRequest,
} from "./gate.js";

export {
  summarizeEnvelope,
  type BudgetState,
  type SummarizeOptions,
} from "./envelope.js";

export {
  decide,
  type BudgetDecision,
  type BudgetVerdict,
  type BudgetWarning,
  type DecideInput,
} from "./decision.js";

export {
  computeRecordedCost,
  estimateUpcomingCost,
  type RecordedUsage,
  type CostEstimateRequest,
  type CostResult,
} from "./accountant.js";
