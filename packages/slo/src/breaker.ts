/**
 * Cost SLO breaker — the SRE Error Budget pattern's enforcement gate.
 *
 * Policy:
 *   - ALLOW  when error budget remaining > warning_pct of total budget.
 *   - WARN   when remaining ∈ (0, warning_pct * total].
 *   - BLOCK  when remaining ≤ 0 (budget exhausted).
 *
 * Equivalent to Google SRE Workbook's three-tier alerting: "you have
 * headroom" → "you're burning faster than expected" → "you're out of
 * budget; stop until next window."
 *
 * Every decision carries a rule id + rationale that names the numbers
 * that fired. The hook can surface this verbatim to the user.
 */

import type { SloSli } from "./sli.js";

export type BreakerVerdict = "allow" | "warn" | "block";

export interface BreakerDecision {
  verdict: BreakerVerdict;
  rule: string;
  rationale: string;
  /** When verdict ≠ "allow", what specific actions the user can take. */
  remediations: string[];
  /** Snapshot the decision was made against (echoed for audit). */
  sli: SloSli;
}

export function decideBreaker(sli: SloSli): BreakerDecision {
  const totalBudget = sli.slo.error_budget_usd;
  const remaining = sli.errorBudgetRemainingUsd;
  const warningPct = sli.slo.warning_pct;
  const warningThreshold = totalBudget * warningPct;

  if (totalBudget <= 0) {
    return {
      verdict: "allow",
      rule: "rule:no_budget_configured",
      rationale: "SLO has zero error budget — breaker is effectively disabled.",
      remediations: [],
      sli,
    };
  }

  if (remaining <= 0) {
    return {
      verdict: "block",
      rule: "rule:budget_exhausted",
      rationale:
        `Error budget exhausted: excess spend $${sli.excessSpendUsd.toFixed(2)} ` +
        `meets/exceeds the $${totalBudget.toFixed(2)} budget over the ` +
        `${sli.slo.window_days}-day window. ` +
        `${sli.violatingTaskCount} of ${sli.totalTaskCount} tasks ` +
        `exceeded the $${sli.slo.target_usd_per_task.toFixed(2)}/task target.`,
      remediations: [
        "Wait until the next SLO window for budget to reset.",
        `Investigate the top violators (look at sli.tasks — first entries are largest).`,
        "If this is expected for a high-priority push, temporarily raise " +
          "error_budget_usd via slo_define.",
      ],
      sli,
    };
  }

  if (remaining <= warningThreshold) {
    return {
      verdict: "warn",
      rule: "rule:warning_threshold",
      rationale:
        `Error budget remaining $${remaining.toFixed(2)} of $${totalBudget.toFixed(2)} ` +
        `(${((remaining / totalBudget) * 100).toFixed(0)}%) is at or below ` +
        `the ${(warningPct * 100).toFixed(0)}% warning threshold. ` +
        `${sli.violatingTaskCount} of ${sli.totalTaskCount} tasks have exceeded ` +
        `the $${sli.slo.target_usd_per_task.toFixed(2)}/task target.`,
      remediations: [
        "Reduce per-task cost — route trivial work through router's FAST tier.",
        "Consider deferring non-urgent work until next window.",
        "Audit the top violating tasks in sli.tasks; they likely have a " +
          "fixable cause (subagent runaway, low cache hit rate, oversized context).",
      ],
      sli,
    };
  }

  return {
    verdict: "allow",
    rule: "rule:headroom",
    rationale:
      `Error budget remaining $${remaining.toFixed(2)} of $${totalBudget.toFixed(2)} ` +
      `(${((remaining / totalBudget) * 100).toFixed(0)}%) is above the warning threshold.`,
    remediations: [],
    sli,
  };
}

export function formatBreakerMessage(d: BreakerDecision): string {
  const head = d.verdict === "allow"
    ? "✓ Cost SLO healthy"
    : d.verdict === "warn"
      ? "⚠ Cost SLO at warning threshold"
      : "⛔ Cost SLO error budget exhausted";
  const lines = [head, "", d.rationale];
  if (d.remediations.length > 0) {
    lines.push("", "Remediations:");
    for (const r of d.remediations) lines.push("  • " + r);
  }
  return lines.join("\n");
}
