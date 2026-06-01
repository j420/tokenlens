/**
 * SLI computation — pure aggregation from BudgetCharge rows.
 *
 * SRE Error Budget pattern productized for AI cost. References:
 *   - Google SRE Workbook, "Implementing SLOs"
 *   - https://sre.google/workbook/implementing-slos/
 *
 * Definitions for the AI-cost flavor:
 *   - Task: a unit of work, keyed by `task_dimension` (default
 *     "agent_id", which corresponds to a session id). Per-task cost
 *     is the sum of charges with the same task key in the window.
 *   - Target: `target_usd_per_task` — the cost a task is "supposed to"
 *     stay under.
 *   - Error budget: `error_budget_usd` — total excess (sum of
 *     max(taskCost - target, 0)) the team can absorb before the
 *     breaker fires.
 *   - SLO compliance %: compliantTasks / totalTasks.
 *
 * Pure function: no I/O. Caller pulls charges + SLO def, passes them in.
 */

import type {
  BudgetChargeRow,
  SloDefinitionRow,
} from "@prune/persistence";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface TaskCost {
  taskKey: string;
  costUsd: number;
  chargeCount: number;
  firstSeen: string;
  lastSeen: string;
  exceedsTarget: boolean;
  excessUsd: number;
}

export interface SloSli {
  slo: SloDefinitionRow;
  windowStart: string;
  windowEnd: string;
  /** All tasks observed in the window. */
  tasks: TaskCost[];
  /** Tasks at or under target. */
  compliantTaskCount: number;
  /** Tasks above target. */
  violatingTaskCount: number;
  totalTaskCount: number;
  /** Tasks that hit the target threshold relative to total. 0..1. */
  complianceRatio: number;
  /** Sum of (taskCost - target) over violating tasks. */
  excessSpendUsd: number;
  /** errorBudget - excessSpend. May go negative. */
  errorBudgetRemainingUsd: number;
  /** Fraction of error budget consumed. 0..1+, can exceed 1. */
  errorBudgetBurnPct: number;
  /** Mean task cost in the window. */
  meanTaskCostUsd: number;
  p50TaskCostUsd: number;
  p95TaskCostUsd: number;
  p99TaskCostUsd: number;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function chargeTaskKey(c: BudgetChargeRow, dim: string): string | null {
  if (dim === "agent_id") return c.agent_id ?? null;
  if (dim === "model") return c.model;
  if (dim === "provider") return c.provider;
  if (dim === "envelope_id") return c.envelope_id;
  // attribution.* metadata key
  if (dim.startsWith("metadata.")) {
    const k = dim.slice("metadata.".length);
    const v = c.metadata[k];
    return typeof v === "string" ? v : v == null ? null : String(v);
  }
  return null;
}

export interface ComputeSliOptions {
  /** Override "now" for testability. */
  asOf?: Date;
}

export function computeSli(
  slo: SloDefinitionRow,
  charges: BudgetChargeRow[],
  opts: ComputeSliOptions = {}
): SloSli {
  const asOf = opts.asOf ?? new Date();
  const windowEnd = asOf;
  const windowStart = new Date(asOf.getTime() - slo.window_days * MS_PER_DAY);

  // Group charges by task key inside the window.
  const byTask = new Map<string, TaskCost>();
  for (const c of charges) {
    const t = Date.parse(c.timestamp);
    if (!Number.isFinite(t)) continue;
    if (t < windowStart.getTime() || t > windowEnd.getTime()) continue;
    const key = chargeTaskKey(c, slo.task_dimension);
    if (key == null) continue; // unattributed → not counted in this SLI
    const existing = byTask.get(key);
    if (existing) {
      existing.costUsd += c.cost_usd;
      existing.chargeCount += 1;
      if (c.timestamp < existing.firstSeen) existing.firstSeen = c.timestamp;
      if (c.timestamp > existing.lastSeen) existing.lastSeen = c.timestamp;
    } else {
      byTask.set(key, {
        taskKey: key,
        costUsd: c.cost_usd,
        chargeCount: 1,
        firstSeen: c.timestamp,
        lastSeen: c.timestamp,
        exceedsTarget: false,
        excessUsd: 0,
      });
    }
  }
  const tasks = Array.from(byTask.values());
  // Compute target compliance per task.
  let excessSpend = 0;
  let compliant = 0;
  for (const tk of tasks) {
    if (tk.costUsd > slo.target_usd_per_task) {
      tk.exceedsTarget = true;
      tk.excessUsd = tk.costUsd - slo.target_usd_per_task;
      excessSpend += tk.excessUsd;
    } else {
      compliant++;
    }
  }
  const totalTasks = tasks.length;
  const violating = totalTasks - compliant;
  const complianceRatio = totalTasks === 0 ? 1 : compliant / totalTasks;
  const errorBudgetRemaining = slo.error_budget_usd - excessSpend;
  const errorBudgetBurnPct =
    slo.error_budget_usd > 0 ? excessSpend / slo.error_budget_usd : 0;

  const sortedCosts = tasks.map((t) => t.costUsd).sort((a, b) => a - b);
  const mean =
    sortedCosts.length === 0
      ? 0
      : sortedCosts.reduce((s, v) => s + v, 0) / sortedCosts.length;

  // Sort tasks descending by cost for the report — biggest violators first.
  tasks.sort((a, b) => b.costUsd - a.costUsd);

  return {
    slo,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    tasks,
    compliantTaskCount: compliant,
    violatingTaskCount: violating,
    totalTaskCount: totalTasks,
    complianceRatio,
    excessSpendUsd: excessSpend,
    errorBudgetRemainingUsd: errorBudgetRemaining,
    errorBudgetBurnPct,
    meanTaskCostUsd: mean,
    p50TaskCostUsd: quantile(sortedCosts, 0.5),
    p95TaskCostUsd: quantile(sortedCosts, 0.95),
    p99TaskCostUsd: quantile(sortedCosts, 0.99),
  };
}
