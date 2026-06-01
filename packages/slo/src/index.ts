/**
 * @prune/slo
 *
 * Cost SLO + circuit-breaker. SRE Error Budget pattern productized for
 * AI cost. Local-first; the SLI is computed at read time from the
 * BudgetCharge log so adjusting an SLO's target doesn't rewrite history.
 *
 * Reference: Google SRE Workbook, "Implementing SLOs" (https://sre.google/workbook/implementing-slos/).
 * Decisions are explainable: every breaker verdict carries a rule id,
 * a rationale, and a remediations list the user can act on.
 */

export {
  computeSli,
  type SloSli,
  type TaskCost,
  type ComputeSliOptions,
} from "./sli.js";

export {
  decideBreaker,
  formatBreakerMessage,
  type BreakerDecision,
  type BreakerVerdict,
} from "./breaker.js";

export {
  SloManager,
  SloManagerError,
  type DefineSloInput,
} from "./manager.js";
