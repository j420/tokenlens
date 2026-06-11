/**
 * Synthetic TrialRecord builder — TEST SUPPORT ONLY.
 *
 * Used by this package's test suite (and nothing in the production paths) to
 * exercise the statistics, stop-loss, and promotion gate against precisely
 * shaped data. Records default to `fixture: true`; a test that needs
 * `fixture: false` (to exercise the realData gate's PASS branch) must say so
 * explicitly — the same explicitness the gate demands of real data.
 */

import type { ArmId, TrialRecord, UsageBreakdown } from "@prune/outcome-bench";

export interface SyntheticTrialOpts {
  taskId: string;
  arm: ArmId;
  trialIndex: number;
  /** Total input tokens; output fixed at 10% of input for simplicity. */
  inputTokens: number;
  oracle: "pass" | "fail";
  /** USD; null models an unpriced trial (costComplete false). */
  billedUsd: number | null;
  fixture?: boolean;
  overheadTokens?: number;
}

export function syntheticTrial(opts: SyntheticTrialOpts): TrialRecord {
  const usage: UsageBreakdown = {
    input: opts.inputTokens,
    output: Math.round(opts.inputTokens / 10),
    cacheRead: 0,
    cacheCreate: 0,
  };
  return {
    taskId: opts.taskId,
    arm: opts.arm,
    trialIndex: opts.trialIndex,
    model: "synthetic-test-model",
    usage,
    totalTokens: usage.input + usage.output + usage.cacheRead + usage.cacheCreate,
    billedUsd: opts.billedUsd,
    costComplete: opts.billedUsd !== null,
    turns: 5,
    wallTimeMs: 1000,
    oracle: opts.oracle,
    overheadTokens: opts.overheadTokens ?? 0,
    transcriptPath: `/synthetic/${opts.taskId}-${opts.arm}-${opts.trialIndex}.jsonl`,
    startedAt: "2026-06-11T00:00:00.000Z",
    finishedAt: "2026-06-11T00:01:00.000Z",
    fixture: opts.fixture ?? true,
  };
}

/**
 * A balanced matrix of synthetic records shaped to PASS the promotion gate
 * when built with `fixture: false`:
 *  - `tasks` × 2 arms × `trialsPerTask`, governed at half the naive cost
 *    (every per-task delta positive → Wilcoxon rejects from n≥5 tasks);
 *  - one naive and one governed failure on DIFFERENT tasks (success rates
 *    equal, non-degenerate → NI concludes at the 10pp margin given enough
 *    trials).
 */
export function syntheticMatrix(opts: {
  tasks: number;
  trialsPerTask: number;
  fixture: boolean;
  /** When true, governed costs MORE than naive (savings gate must fail). */
  governedWorse?: boolean;
  /** Override governed pass count per task index (for NI-failure shaping). */
  governedFailTaskRatio?: number;
}): TrialRecord[] {
  const records: TrialRecord[] = [];
  for (let t = 0; t < opts.tasks; t++) {
    const taskId = `syn-task-${t}`;
    for (let k = 0; k < opts.trialsPerTask; k++) {
      const naiveFails = t === 0 && k === 0;
      const governedFails =
        opts.governedFailTaskRatio !== undefined
          ? k < Math.round(opts.trialsPerTask * opts.governedFailTaskRatio)
          : t === 1 && k === 0;
      records.push(
        syntheticTrial({
          taskId,
          arm: "naive",
          trialIndex: k,
          inputTokens: 100_000 + t * 1000,
          oracle: naiveFails ? "fail" : "pass",
          billedUsd: 0.3,
          fixture: opts.fixture,
        })
      );
      records.push(
        syntheticTrial({
          taskId,
          arm: "governed",
          trialIndex: k,
          inputTokens: opts.governedWorse
            ? 200_000 + t * 1000
            : 50_000 + t * 1000,
          oracle: governedFails ? "fail" : "pass",
          billedUsd: opts.governedWorse ? 0.6 : 0.15,
          fixture: opts.fixture,
          overheadTokens: 500,
        })
      );
    }
  }
  return records;
}
