import { describe, expect, it, beforeEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FixtureRunner,
  loadTrialLog,
  writeFixtureSuite,
  type TaskManifest,
  type TrialRunner,
  type TrialSpec,
} from "@prune/outcome-bench";
import { verifyAttestation } from "@prune/wastebench";

import { proofPaths, type ProofPaths } from "./paths.js";
import { checkProveBudget, checkStopLoss, runProve } from "./prove.js";
import { syntheticTrial } from "./synthetic-records.js";

let repoDir: string;
let paths: ProofPaths;

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "repo-proof-prove-"));
  paths = proofPaths(repoDir);
});

// ============================================================================
// Pure budget arithmetic
// ============================================================================

describe("checkProveBudget", () => {
  const tasks = (n: number, maxBudgetUsd: number): TaskManifest[] =>
    Array.from({ length: n }, (_, i) => ({
      taskId: `t${i}`,
      track: "self" as const,
      status: "ready" as const,
      repoUrl: null,
      baseCommit: "a".repeat(40),
      testRefCommit: "b".repeat(40),
      hiddenTestPaths: ["x.test.ts"],
      setupCmds: [],
      prompt: "p",
      oracleCmd: "true",
      oracleCwd: ".",
      intentClass: "debug" as const,
      referenceCommit: "b".repeat(40),
      difficulty: null,
      maxTurns: 10,
      maxBudgetUsd,
      cutoffSafe: true,
    }));

  it("computes the exact worst-case bound: Σ maxBudgetUsd × K × 2 arms", () => {
    const c = checkProveBudget(tasks(3, 2), 3, 100);
    expect(c.worstCaseUsd).toBe(3 * 2 * 3 * 2); // 36
    expect(c.ok).toBe(true);
  });

  it("refuses a null/zero/NaN budget — spend never happens implicitly", () => {
    expect(checkProveBudget(tasks(1, 1), 1, null).ok).toBe(false);
    expect(checkProveBudget(tasks(1, 1), 1, 0).ok).toBe(false);
    expect(checkProveBudget(tasks(1, 1), 1, Number.NaN).ok).toBe(false);
  });

  it("refuses a budget below the worst case, naming both numbers", () => {
    const c = checkProveBudget(tasks(3, 2), 3, 35.99);
    expect(c.ok).toBe(false);
    expect(c.reason).toContain("36.00");
    expect(c.reason).toContain("35.99");
  });

  it("refuses an empty task list", () => {
    expect(checkProveBudget([], 3, 100).ok).toBe(false);
  });
});

describe("checkStopLoss", () => {
  const rec = (billedUsd: number | null) =>
    syntheticTrial({
      taskId: "t",
      arm: "naive",
      trialIndex: 0,
      inputTokens: 1000,
      oracle: "pass",
      billedUsd,
    });

  it("passes under budget, trips over it", () => {
    expect(checkStopLoss([rec(0.4), rec(0.4)], 1).ok).toBe(true);
    const tripped = checkStopLoss([rec(0.6), rec(0.6)], 1);
    expect(tripped.ok).toBe(false);
    expect(tripped.spentUsd).toBeCloseTo(1.2, 10);
  });

  it("aborts on ANY unpriced trial under a USD budget — never meters blind", () => {
    const c = checkStopLoss([rec(0.1), rec(null)], 100);
    expect(c.ok).toBe(false);
    expect(c.unpricedTrial).toBe("t/naive/0");
    expect(c.reason).toContain("unpriced");
  });

  it("fails CLOSED on non-finite or negative billedUsd (NaN would disarm the wire forever)", () => {
    // NaN poisons every later `spent > budget` comparison to false; without
    // this guard a single garbage record silently disables the stop-loss.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -0.01]) {
      const c = checkStopLoss([rec(0.1), rec(bad)], 100);
      expect(c.ok).toBe(false);
      expect(c.reason).toContain("non-finite or negative");
    }
  });
});

// ============================================================================
// runProve — fixture pipeline (zero model spend)
// ============================================================================

describe("runProve (FixtureRunner)", () => {
  it("runs the matrix, persists analysis/attestation/report/meta, and resumes idempotently", async () => {
    const suite = writeFixtureSuite(join(repoDir, "fixtures"));
    const runner = new FixtureRunner(suite.cells);
    const opts = {
      paths,
      trialsPerTask: 2,
      budgetUsd: 100,
      runner,
      modelPins: ["claude-sonnet-4-5-20250929"],
      executionMode: "fixture replay (dry-run)",
      governedFeatureIds: ["f15", "f16"],
    };
    const r1 = await runProve(suite.tasks, opts);
    expect(r1.aborted).toBeNull();
    expect(r1.ran).toBe(12); // 3 tasks × 2 arms × K=2
    expect(r1.analysis?.fixtureData).toBe(true);
    expect(r1.analysis?.metricUsed).toBe("usd");
    // Attestation verifies; report banners the fixture data.
    expect(verifyAttestation(r1.attestation!).valid).toBe(true);
    expect(r1.reportMd).toContain("DRY-RUN — FIXTURE DATA");
    for (const p of [paths.analysis, paths.attestation, paths.report]) {
      expect(existsSync(p)).toBe(true);
    }
    const meta = JSON.parse(
      readFileSync(join(paths.root, "prove-meta.json"), "utf8")
    );
    expect(meta.governedFeatureIds).toEqual(["f15", "f16"]);

    // Re-run: every cell already on the log — nothing re-spends.
    const r2 = await runProve(suite.tasks, opts);
    expect(r2.ran).toBe(0);
    expect(r2.skipped).toBe(12);
  });

  it("refuses to start on a failed budget pre-flight (no files written)", async () => {
    const suite = writeFixtureSuite(join(repoDir, "fixtures"));
    const r = await runProve(suite.tasks, {
      paths,
      trialsPerTask: 2,
      budgetUsd: 1, // worst case is 3 tasks × $2 × 2 × 2 = $24
      runner: new FixtureRunner(suite.cells),
      modelPins: ["m"],
      executionMode: "fixture replay (dry-run)",
      governedFeatureIds: ["f15"],
    });
    expect(r.aborted).toContain("budget pre-flight refused");
    expect(r.records).toHaveLength(0);
    expect(existsSync(paths.analysis)).toBe(false);
  });

  it("stop-loss aborts mid-run on overspend; completed trials survive on the log", async () => {
    // One expensive synthetic runner: each trial bills $5; budget $6 passes
    // pre-flight (task maxBudgetUsd tuned) but trips after the first trial.
    const task: TaskManifest = {
      taskId: "expensive",
      track: "self",
      status: "ready",
      repoUrl: null,
      baseCommit: "a".repeat(40),
      testRefCommit: "b".repeat(40),
      hiddenTestPaths: ["x.test.ts"],
      setupCmds: [],
      prompt: "p",
      oracleCmd: "true",
      oracleCwd: ".",
      intentClass: "debug",
      referenceCommit: "b".repeat(40),
      difficulty: null,
      maxTurns: 10,
      maxBudgetUsd: 1.5, // worst case 1.5 × 1 × 2 = 3 ≤ budget 6
      cutoffSafe: true,
    };
    const runner: TrialRunner = {
      runTrial: async (spec: TrialSpec) =>
        syntheticTrial({
          taskId: spec.task.taskId,
          arm: spec.arm,
          trialIndex: spec.trialIndex,
          inputTokens: 1000,
          oracle: "pass",
          billedUsd: 5,
        }),
    };
    const r = await runProve([task], {
      paths,
      trialsPerTask: 1,
      budgetUsd: 6,
      runner,
      modelPins: ["m"],
      executionMode: "synthetic",
      governedFeatureIds: ["f15"],
    });
    // Trial 1 billed $5 < $6 → ok; trial 2 billed $10 total > $6 → tripped
    // after completing, so both are logged and the abort label is set.
    expect(r.aborted).toContain("stop-loss");
    expect(loadTrialLog(paths.trialLog)).toHaveLength(2);
  });

  it("aborts on an unpriced trial and labels the partial result honestly", async () => {
    const task: TaskManifest = {
      taskId: "unpriced",
      track: "self",
      status: "ready",
      repoUrl: null,
      baseCommit: "a".repeat(40),
      testRefCommit: "b".repeat(40),
      hiddenTestPaths: ["x.test.ts"],
      setupCmds: [],
      prompt: "p",
      oracleCmd: "true",
      oracleCwd: ".",
      intentClass: "debug",
      referenceCommit: "b".repeat(40),
      difficulty: null,
      maxTurns: 10,
      maxBudgetUsd: 0.5,
      cutoffSafe: true,
    };
    const runner: TrialRunner = {
      runTrial: async (spec: TrialSpec) =>
        syntheticTrial({
          taskId: spec.task.taskId,
          arm: spec.arm,
          trialIndex: spec.trialIndex,
          inputTokens: 1000,
          oracle: "pass",
          billedUsd: null, // unpriced model
        }),
    };
    const r = await runProve([task], {
      paths,
      trialsPerTask: 1,
      budgetUsd: 10,
      runner,
      modelPins: ["m"],
      executionMode: "synthetic",
      governedFeatureIds: ["f15"],
    });
    expect(r.aborted).toContain("unpriced");
    // One arm only → the paired analysis is honestly unavailable.
    expect(r.analysis).toBeNull();
    expect(r.aborted).toContain("paired analysis unavailable");
  });
});
