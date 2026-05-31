/**
 * Pre-call decision policy: given a `BudgetState` and an estimated
 * upcoming charge, return allow / warn / block + structured rationale.
 *
 * Decisions are explainable: every `block` carries a `reason` that
 * names the policy that fired (hard_cap_pct, period_expired) and the
 * numbers that triggered it. Every `warn` carries the same structure.
 * Hard rule from CLAUDE.md: "every decision must be explainable to a
 * skeptical platform engineer."
 */

import type { BudgetState } from "./envelope.js";

export type BudgetVerdict = "allow" | "warn" | "block";

export interface BudgetWarning {
  /** Stable id of the rule that fired. */
  rule: "soft_cap" | "burn_rate" | "period_near_end" | "estimated_only";
  message: string;
}

export interface BudgetDecision {
  verdict: BudgetVerdict;
  /** Filled when verdict is "block". */
  reason: string | null;
  /** Always filled (may be empty). Warnings do not block. */
  warnings: BudgetWarning[];
  /** The estimated additional charge that prompted this decision, in USD. */
  estimatedCostUsd: number;
  /** Snapshot the decision was made against. */
  state: BudgetState;
  /** What spent would be if this call were charged at its estimate. */
  projectedSpentAfter: number;
}

export interface DecideInput {
  state: BudgetState;
  estimatedCostUsd: number;
  /** When the cost was estimated, not exact, surface a warning. */
  estimateIsApproximate: boolean;
}

export function decide(input: DecideInput): BudgetDecision {
  const { state, estimatedCostUsd, estimateIsApproximate } = input;
  const { envelope } = state;
  const warnings: BudgetWarning[] = [];

  const projectedSpentAfter = state.spentUsd + estimatedCostUsd;
  const hardCapUsd = envelope.limit_usd * envelope.hard_cap_pct;
  const softCapUsd = envelope.limit_usd * envelope.soft_cap_pct;

  // Block #1: period expired.
  if (state.isExpired) {
    return {
      verdict: "block",
      reason: `Budget envelope "${envelope.name}" expired at ${envelope.period_end}. Create or roll a new period before more calls.`,
      warnings,
      estimatedCostUsd,
      state,
      projectedSpentAfter,
    };
  }

  // Block #2: this call would breach hard cap.
  if (projectedSpentAfter > hardCapUsd) {
    return {
      verdict: "block",
      reason:
        `This call's estimated cost ($${estimatedCostUsd.toFixed(4)}) would push envelope "${envelope.name}" ` +
        `to $${projectedSpentAfter.toFixed(4)}, exceeding the hard cap of $${hardCapUsd.toFixed(4)} ` +
        `(${(envelope.hard_cap_pct * 100).toFixed(0)}% of $${envelope.limit_usd}). ` +
        `Spent so far: $${state.spentUsd.toFixed(4)}.`,
      warnings,
      estimatedCostUsd,
      state,
      projectedSpentAfter,
    };
  }

  // Warnings (do not block).
  if (projectedSpentAfter > softCapUsd) {
    warnings.push({
      rule: "soft_cap",
      message:
        `Soft cap (${(envelope.soft_cap_pct * 100).toFixed(0)}% = $${softCapUsd.toFixed(2)}) ` +
        `would be exceeded after this call (projected $${projectedSpentAfter.toFixed(2)} of $${envelope.limit_usd}).`,
    });
  }

  if (
    state.projectedExhaustionAt !== null &&
    state.projectedExhaustionAt.getTime() < new Date(envelope.period_end).getTime()
  ) {
    warnings.push({
      rule: "burn_rate",
      message:
        `At current burn rate of $${state.burnRatePerDay.toFixed(2)}/day, envelope will exhaust on ` +
        `${state.projectedExhaustionAt.toISOString().slice(0, 10)}, before period ends on ${envelope.period_end.slice(0, 10)}.`,
    });
  }

  if (estimateIsApproximate) {
    warnings.push({
      rule: "estimated_only",
      message:
        "Cost is estimated (output tokens not supplied by caller). Decision uses a conservative " +
        "max(500, in*0.3) output heuristic; actual charge may differ.",
    });
  }

  return {
    verdict: warnings.length > 0 ? "warn" : "allow",
    reason: null,
    warnings,
    estimatedCostUsd,
    state,
    projectedSpentAfter,
  };
}
