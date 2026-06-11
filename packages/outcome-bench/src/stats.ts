/**
 * Outcome analysis — the pre-registered statistical plan, executed.
 *
 * Primary endpoint: paired per-task cost reduction (Wilcoxon signed-rank,
 * one-sided, H1: naive − governed > 0). Well-powered at n≈20 task pairs for
 * the large effects under test.
 *
 * Secondary endpoint: success-rate non-inferiority of the governed arm at the
 * pre-registered screening margin, PLUS McNemar on paired per-task majority
 * outcomes. The achieved-power arithmetic is computed and REPORTED — at small
 * n the NI verdict is labeled a screening result, never "proven equal".
 *
 * Metric honesty: dollars are used only when EVERY trial was fully priced;
 * otherwise the analysis runs on raw provider-reported token totals and says
 * so. No fabricated rates, ever.
 */

import {
  mcnemarTest,
  nonInferiorityProportion,
  sampleSizeProportionNI,
  wilcoxonSignedRank,
  type TestResult,
} from "@prune/quality";
import {
  rollupTaskLedger,
  type SpendEvent,
  type TaskLedgerReport,
} from "@prune/task-ledger";
import type { ArmId, PreRegistration, TrialRecord } from "./types.js";

export type CostMetric = "usd" | "tokens";

export interface TaskPairSummary {
  taskId: string;
  naiveMeanCost: number;
  governedMeanCost: number;
  /** naive − governed in the chosen metric; positive = governed saved. */
  delta: number;
  /** delta / naiveMeanCost; null when the naive mean is 0. */
  savingsPct: number | null;
  naiveSuccesses: number;
  naiveTrials: number;
  governedSuccesses: number;
  governedTrials: number;
  naiveMajorityPass: boolean;
  governedMajorityPass: boolean;
}

export interface PowerNote {
  /** n per arm the NI test would need at the pre-registered margin; null when degenerate. */
  requiredPerArm: number | null;
  actualPerArm: number;
  adequatelyPowered: boolean | null;
}

export interface OutcomeAnalysis {
  metricUsed: CostMetric;
  preRegistration: PreRegistration;
  tasks: TaskPairSummary[];
  /** Tasks excluded because an arm had zero trials (reported, not hidden). */
  excludedTasks: string[];
  wilcoxon: TestResult;
  medianSavingsPct: number | null;
  naiveSuccessRate: number;
  governedSuccessRate: number;
  nonInferiority: TestResult;
  mcnemar: TestResult;
  discordant: { naivePassGovernedFail: number; naiveFailGovernedPass: number };
  power: PowerNote;
  /** True when ANY record came from a fixture — the report must banner this. */
  fixtureData: boolean;
  /** True when every trial was fully priced (metric "usd" possible). */
  costComplete: boolean;
  ledger: { naive: TaskLedgerReport; governed: TaskLedgerReport };
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function costOf(r: TrialRecord, metric: CostMetric): number {
  if (metric === "usd") {
    if (r.billedUsd === null) {
      throw new Error(
        `costOf: usd metric requested but trial ${r.taskId}/${r.arm}/${r.trialIndex} is unpriced`
      );
    }
    return r.billedUsd;
  }
  return r.totalTokens;
}

function toSpendEvents(records: TrialRecord[]): SpendEvent[] {
  return records.map((r) => ({
    taskId: r.taskId,
    requestId: `${r.arm}-${r.trialIndex}`,
    model: r.model ?? "unknown-model",
    inputTokens: r.usage.input,
    outputTokens: r.usage.output,
    cacheReadTokens: r.usage.cacheRead,
    cacheWriteTokens: r.usage.cacheCreate,
    outcome: r.oracle === "pass" ? ("accepted" as const) : ("rejected" as const),
  }));
}

export function analyzeOutcomes(
  records: TrialRecord[],
  preRegistration: PreRegistration
): OutcomeAnalysis {
  if (records.length === 0) {
    throw new Error("analyzeOutcomes: no trial records");
  }

  const costComplete = records.every((r) => r.costComplete);
  const metricUsed: CostMetric = costComplete ? "usd" : "tokens";

  const byTask = new Map<string, Record<ArmId, TrialRecord[]>>();
  for (const r of records) {
    const cell = byTask.get(r.taskId) ?? { naive: [], governed: [] };
    cell[r.arm].push(r);
    byTask.set(r.taskId, cell);
  }

  const tasks: TaskPairSummary[] = [];
  const excludedTasks: string[] = [];
  for (const [taskId, cell] of byTask) {
    if (cell.naive.length === 0 || cell.governed.length === 0) {
      excludedTasks.push(taskId);
      continue;
    }
    const naiveMeanCost = mean(cell.naive.map((r) => costOf(r, metricUsed)));
    const governedMeanCost = mean(
      cell.governed.map((r) => costOf(r, metricUsed))
    );
    const naiveSuccesses = cell.naive.filter((r) => r.oracle === "pass").length;
    const governedSuccesses = cell.governed.filter(
      (r) => r.oracle === "pass"
    ).length;
    const delta = naiveMeanCost - governedMeanCost;
    tasks.push({
      taskId,
      naiveMeanCost,
      governedMeanCost,
      delta,
      savingsPct: naiveMeanCost === 0 ? null : delta / naiveMeanCost,
      naiveSuccesses,
      naiveTrials: cell.naive.length,
      governedSuccesses,
      governedTrials: cell.governed.length,
      naiveMajorityPass: naiveSuccesses * 2 > cell.naive.length,
      governedMajorityPass: governedSuccesses * 2 > cell.governed.length,
    });
  }
  if (tasks.length === 0) {
    throw new Error("analyzeOutcomes: no task has trials in both arms");
  }

  // Primary endpoint: paired Wilcoxon on per-task deltas (naive − governed).
  const wilcoxon = wilcoxonSignedRank(
    tasks.map((t) => t.delta),
    "greater",
    preRegistration.alpha
  );
  const medianSavingsPct = median(
    tasks.flatMap((t) => (t.savingsPct === null ? [] : [t.savingsPct]))
  );

  // Secondary endpoint: NI on trial-level success rates.
  const naiveTrialsTotal = tasks.reduce((a, t) => a + t.naiveTrials, 0);
  const governedTrialsTotal = tasks.reduce((a, t) => a + t.governedTrials, 0);
  const naiveSuccessTotal = tasks.reduce((a, t) => a + t.naiveSuccesses, 0);
  const governedSuccessTotal = tasks.reduce(
    (a, t) => a + t.governedSuccesses,
    0
  );
  const nonInferiority = nonInferiorityProportion({
    treatmentSuccesses: governedSuccessTotal,
    treatmentN: governedTrialsTotal,
    controlSuccesses: naiveSuccessTotal,
    controlN: naiveTrialsTotal,
    margin: preRegistration.niMargin,
    alpha: preRegistration.alpha,
  });

  // McNemar on paired per-task majority outcomes.
  const b = tasks.filter(
    (t) => t.naiveMajorityPass && !t.governedMajorityPass
  ).length;
  const c = tasks.filter(
    (t) => !t.naiveMajorityPass && t.governedMajorityPass
  ).length;
  const mcnemar = mcnemarTest(b, c, preRegistration.alpha);

  // Achieved-power arithmetic, printed, never hidden.
  const pooled =
    (naiveSuccessTotal + governedSuccessTotal) /
    (naiveTrialsTotal + governedTrialsTotal);
  let power: PowerNote;
  if (pooled <= 0 || pooled >= 1) {
    power = {
      requiredPerArm: null,
      actualPerArm: Math.min(naiveTrialsTotal, governedTrialsTotal),
      adequatelyPowered: null,
    };
  } else {
    const n = sampleSizeProportionNI({
      baselineProportion: pooled,
      margin: preRegistration.niMargin,
      alpha: preRegistration.alpha,
      power: 0.8,
    });
    const actualPerArm = Math.min(naiveTrialsTotal, governedTrialsTotal);
    power = {
      requiredPerArm: n.nPerArm,
      actualPerArm,
      adequatelyPowered: actualPerArm >= n.nPerArm,
    };
  }

  return {
    metricUsed,
    preRegistration,
    tasks,
    excludedTasks,
    wilcoxon,
    medianSavingsPct,
    naiveSuccessRate: naiveSuccessTotal / naiveTrialsTotal,
    governedSuccessRate: governedSuccessTotal / governedTrialsTotal,
    nonInferiority,
    mcnemar,
    discordant: { naivePassGovernedFail: b, naiveFailGovernedPass: c },
    power,
    fixtureData: records.some((r) => r.fixture),
    costComplete,
    ledger: {
      naive: rollupTaskLedger(toSpendEvents(records.filter((r) => r.arm === "naive"))),
      governed: rollupTaskLedger(
        toSpendEvents(records.filter((r) => r.arm === "governed"))
      ),
    },
  };
}
