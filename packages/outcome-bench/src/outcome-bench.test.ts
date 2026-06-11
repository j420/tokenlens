import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { verifyAttestation } from "@prune/wastebench";

import {
  TaskManifestSchema,
  PRE_REGISTRATION,
  type TrialRecord,
} from "./types.js";
import { loadManifestDir, runnableTasks } from "./manifest.js";
import { priceUsage, readTrialUsage, totalOf } from "./accounting.js";
import {
  planCreateWorkspace,
  planApplyHiddenTests,
  planRemoveWorkspace,
  execPlan,
  gradeWorkspace,
} from "./workspace.js";
import { planArmSetup, GOVERNED_FLAGS } from "./arm-setup.js";
import { briefEligibility, renderBrief } from "./brief.js";
import { analyzeCiteback } from "./citeback.js";
import {
  FixtureRunner,
  loadTrialLog,
  runMatrix,
  trialKey,
} from "./runner.js";
import { analyzeOutcomes } from "./stats.js";
import { buildAttestation, renderReport, savingsRecordsFrom } from "./report.js";
import {
  writeFixtureSuite,
  writeUnpricedFixture,
  fixtureTask,
  FIXTURE_PRICED_MODEL,
} from "./fixtures.js";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "outcome-bench-test-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

// ============================================================================
// Manifest schema
// ============================================================================

describe("TaskManifestSchema", () => {
  const ready = fixtureTask("t1", "fix it");

  it("accepts a fully-pinned ready task", () => {
    expect(TaskManifestSchema.parse(ready).taskId).toBe("t1");
  });

  it("rejects a ready task with a null commit (no fabricated SHAs)", () => {
    const bad = { ...ready, baseCommit: null };
    expect(TaskManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("accepts a draft task with null commits", () => {
    const draft = {
      ...ready,
      status: "draft",
      baseCommit: null,
      testRefCommit: null,
      referenceCommit: null,
    };
    expect(TaskManifestSchema.safeParse(draft).success).toBe(true);
  });

  it("loadManifestDir reports invalid files and duplicate ids", () => {
    const mdir = join(dir, "manifests");
    mkdirSync(mdir, { recursive: true });
    writeFileSync(join(mdir, "a.json"), JSON.stringify(ready));
    writeFileSync(join(mdir, "b.json"), JSON.stringify(ready)); // duplicate id
    writeFileSync(join(mdir, "c.json"), "{ not json");
    const r = loadManifestDir(mdir);
    expect(r.tasks).toHaveLength(2);
    expect(r.errors.length).toBe(2); // parse error + duplicate id
  });

  it("runnableTasks excludes drafts", () => {
    const draft = {
      ...ready,
      taskId: "t2",
      status: "draft" as const,
      baseCommit: null,
      testRefCommit: null,
      referenceCommit: null,
    };
    expect(runnableTasks([ready, TaskManifestSchema.parse(draft)])).toHaveLength(1);
  });
});

// ============================================================================
// Accounting (provider-reported, null-honest USD)
// ============================================================================

describe("accounting", () => {
  it("totals provider-reported usage from a fixture transcript", async () => {
    const fdir = join(dir, "acc");
    const suite = writeFixtureSuite(fdir);
    const cell = suite.cells.get(trialKey("fx-cache-rule", "naive", 0))!;
    const usage = await readTrialUsage(cell.transcriptPath);
    // naiveSteps: input 12000+14000+16000, output 900+1100+1300,
    // cacheRead 8000+9000, cacheCreate 2000.
    expect(usage.usage).toEqual({
      input: 42_000,
      output: 3_300,
      cacheRead: 17_000,
      cacheCreate: 2_000,
    });
    expect(usage.totalTokens).toBe(totalOf(usage.usage));
    expect(usage.model).toBe(FIXTURE_PRICED_MODEL);
    expect(usage.parseErrors).toBe(0);
    // Sonnet 4.5: in 3, out 15, cached 0.375 per 1M.
    const expectedUsd =
      ((42_000 + 2_000) * 3 + 17_000 * 0.375 + 3_300 * 15) / 1_000_000;
    expect(usage.billedUsd).toBeCloseTo(expectedUsd, 10);
    expect(usage.costComplete).toBe(true);
  });

  it("prices null for an unknown model (never fabricates)", () => {
    const r = priceUsage(
      { input: 100, output: 10, cacheRead: 0, cacheCreate: 0 },
      "some-future-model"
    );
    expect(r.billedUsd).toBeNull();
    expect(r.costComplete).toBe(false);
  });

  it("prices null when cache reads exist but the cached rate is unknown", () => {
    // gpt-4-turbo has no cached_input rate in the table.
    const r = priceUsage(
      { input: 100, output: 10, cacheRead: 50, cacheCreate: 0 },
      "gpt-4-turbo"
    );
    expect(r.billedUsd).toBeNull();
  });
});

// ============================================================================
// Workspace planning + execution (real temp git repo, no network)
// ============================================================================

describe("workspace", () => {
  it("plans an agent workspace with NO trace of the hidden tests", () => {
    const plan = planCreateWorkspace({
      repoRoot: "/repo",
      worktreeDir: "/tmp/wt",
      baseCommit: "abc",
    });
    expect(plan.commands).toEqual([
      ["git", "-C", "/repo", "worktree", "add", "--detach", "/tmp/wt", "abc"],
    ]);
  });

  it("plans hidden-test application as an auditable argv array", () => {
    const plan = planApplyHiddenTests("/tmp/wt", "def", ["pkg/src/x.test.ts"]);
    expect(plan.commands).toEqual([
      ["git", "-C", "/tmp/wt", "checkout", "def", "--", "pkg/src/x.test.ts"],
    ]);
    expect(planApplyHiddenTests("/tmp/wt", "def", []).commands).toEqual([]);
  });

  it("hides the tests from the agent and grades SWE-bench-style on a real temp repo", () => {
    const repo = join(dir, "mini-repo");
    mkdirSync(repo, { recursive: true });
    const git = (...args: string[]) => {
      const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
      expect(r.status).toBe(0);
      return r.stdout.trim();
    };
    git("init", "-q");
    git("config", "user.email", "t@t");
    git("config", "user.name", "t");
    // Some environments force commit signing globally; the throwaway repo
    // must not depend on a signing setup.
    git("config", "commit.gpgsign", "false");
    // C~1: broken impl, no test file.
    writeFileSync(join(repo, "impl.txt"), "broken\n");
    git("add", ".");
    git("commit", "-qm", "broken");
    const base = git("rev-parse", "HEAD");
    // C: fixed impl + a test file.
    writeFileSync(join(repo, "impl.txt"), "fixed\n");
    writeFileSync(join(repo, "check.test.txt"), "expects fixed\n");
    git("add", ".");
    git("commit", "-qm", "fix with test");
    const ref = git("rev-parse", "HEAD");

    const wt = join(dir, "mini-wt");
    const created = execPlan(
      planCreateWorkspace({ repoRoot: repo, worktreeDir: wt, baseCommit: base })
    );
    expect(created.ok).toBe(true);
    // The agent sees the BROKEN impl and NO reference test (SWE-bench parity).
    expect(existsSync(join(wt, "check.test.txt"))).toBe(false);
    const impl = spawnSync("cat", [join(wt, "impl.txt")], { encoding: "utf8" });
    expect(impl.stdout).toBe("broken\n");

    // Grading applies the hidden test, then runs the oracle: the unfixed
    // workspace fails (FAIL_TO_PASS is real)…
    const grade = (oracleCmd: string) =>
      gradeWorkspace({
        worktreeDir: wt,
        testRefCommit: ref,
        hiddenTestPaths: ["check.test.txt"],
        oracleCmd,
        oracleCwd: ".",
      });
    expect(grade("grep -q fixed impl.txt").outcome).toBe("fail");
    expect(existsSync(join(wt, "check.test.txt"))).toBe(true);

    // …an agent tampering with the hidden-test path is overwritten at the
    // next grading (the reference tests decide, not the agent)…
    writeFileSync(join(wt, "check.test.txt"), "tautology\n");
    grade("true");
    const pinned = spawnSync("cat", [join(wt, "check.test.txt")], {
      encoding: "utf8",
    });
    expect(pinned.stdout).toBe("expects fixed\n");

    // …and the "agent" fixing the impl makes the same oracle pass.
    writeFileSync(join(wt, "impl.txt"), "fixed\n");
    expect(grade("grep -q fixed impl.txt").outcome).toBe("pass");

    expect(execPlan(planRemoveWorkspace(repo, wt)).ok).toBe(true);
  });

  it("reports the failing command on a bad plan", () => {
    const r = execPlan({ commands: [["git", "definitely-not-a-command"]] });
    expect(r.ok).toBe(false);
    expect(r.failure?.command).toContain("definitely-not-a-command");
  });
});

// ============================================================================
// Arm setup
// ============================================================================

describe("planArmSetup", () => {
  it("naive arm: hermetic env, NO flags file, no settings", () => {
    const p = planArmSetup({ arm: "naive", worktreeDir: "/wt", stateDir: "/st" });
    expect(p.files).toEqual({});
    expect(p.settingsPath).toBeNull();
    expect(p.env.HOME).toBe("/st");
    expect(p.env.PRUNE_EVENTS_SQLITE).toContain("/st");
  });

  it("governed arm: flags file promotes f15/f16 to general + project settings path", () => {
    const p = planArmSetup({
      arm: "governed",
      worktreeDir: "/wt",
      stateDir: "/st",
    });
    expect(p.settingsPath).toBe(join("/wt", ".claude", "settings.json"));
    const flagsPath = p.env.PRUNE_FLAGS_PATH;
    const flags = JSON.parse(p.files[flagsPath]);
    for (const id of Object.keys(GOVERNED_FLAGS)) {
      expect(flags.features[id]).toEqual({ enabled: true, mode: "general" });
    }
    // Identical hermetic env shape across arms (the ONLY diff is governance).
    const naive = planArmSetup({ arm: "naive", worktreeDir: "/wt", stateDir: "/st" });
    expect(Object.keys(p.env).sort()).toEqual(Object.keys(naive.env).sort());
  });
});

// ============================================================================
// Brief eligibility (L4-20) + rendering
// ============================================================================

describe("brief", () => {
  it("drops a brief with too few symbols", () => {
    const e = briefEligibility("short", 2);
    expect(e.eligible).toBe(false);
    expect(e.reason).toContain("relevant symbols");
  });

  it("drops a brief over the char cap", () => {
    const e = briefEligibility("x".repeat(9000), 10);
    expect(e.eligible).toBe(false);
    expect(e.reason).toContain("cap");
  });

  it("admits a brief within budget and renders grouped signatures", () => {
    const syms = [
      { id: "a", name: "alpha", kind: "function", filePath: "src/a.ts", line: 1, signature: "function alpha(): void", score: 1, inDegree: 0, outDegree: 0 },
      { id: "b", name: "beta", kind: "function", filePath: "src/a.ts", line: 9, signature: "function beta(n: number): number", score: 0.9, inDegree: 0, outDegree: 0 },
      { id: "c", name: "Gamma", kind: "class", filePath: "src/b.ts", line: 3, signature: "class Gamma", score: 0.8, inDegree: 0, outDegree: 0 },
    ];
    const text = renderBrief(syms);
    expect(briefEligibility(text, syms.length).eligible).toBe(true);
    expect(text).toContain("// src/a.ts");
    expect(text).toContain("function beta(n: number): number");
    expect(text).toContain("class Gamma");
  });
});

// ============================================================================
// Citeback (L4-38)
// ============================================================================

describe("analyzeCiteback", () => {
  it("flags files read but never referenced afterwards", () => {
    const messages = [
      { role: "user" as const, content: "fix the bug" },
      {
        role: "assistant" as const,
        content: [
          { type: "tool_use", id: "1", name: "Read", input: { file_path: "src/used.ts" } },
          { type: "tool_use", id: "2", name: "Read", input: { file_path: "src/wasted.ts" } },
        ],
      },
      {
        role: "assistant" as const,
        content: [{ type: "text", text: "The bug is in used.ts — patching it." }],
      },
    ];
    const r = analyzeCiteback(messages);
    expect(r.filesRead.sort()).toEqual(["src/used.ts", "src/wasted.ts"]);
    expect(r.neverCited).toEqual(["src/wasted.ts"]);
    expect(r.wasteRatio).toBeCloseTo(0.5);
  });

  it("returns null ratio when nothing was read", () => {
    expect(analyzeCiteback([]).wasteRatio).toBeNull();
  });
});

// ============================================================================
// End-to-end dry run: fixtures → matrix → stats → report → attestation
// ============================================================================

describe("dry-run pipeline (zero model spend)", () => {
  it("runs the fixture matrix, resumes idempotently, and produces honest analysis", async () => {
    const fdir = join(dir, "e2e");
    const suite = writeFixtureSuite(fdir);
    const logPath = join(fdir, "trials.jsonl");
    const config = {
      trialsPerTask: 2,
      arms: ["naive", "governed"] as const,
      logPath,
    };
    const runner = new FixtureRunner(suite.cells);

    const first = await runMatrix(suite.tasks, config, runner);
    expect(first.ran).toBe(12); // 3 tasks × 2 arms × K=2
    expect(first.skipped).toBe(0);

    // Resume: nothing re-runs (and therefore nothing would re-spend).
    const second = await runMatrix(suite.tasks, config, runner);
    expect(second.ran).toBe(0);
    expect(second.skipped).toBe(12);
    expect(loadTrialLog(logPath)).toHaveLength(12);

    const analysis = analyzeOutcomes(second.records, PRE_REGISTRATION);
    expect(analysis.metricUsed).toBe("usd"); // every fixture trial is priced
    expect(analysis.fixtureData).toBe(true);
    expect(analysis.tasks).toHaveLength(3);

    // Governed arm is cheaper on every task in the fixture shapes.
    for (const t of analysis.tasks) {
      expect(t.governedMeanCost).toBeLessThan(t.naiveMeanCost);
      expect(t.savingsPct).toBeGreaterThan(0.5);
    }
    // Success rates: naive 4/6 (task 2 fails twice), governed 5/6.
    expect(analysis.naiveSuccessRate).toBeCloseTo(4 / 6);
    expect(analysis.governedSuccessRate).toBeCloseTo(5 / 6);
    // Discordant pairs (majority-of-K): fx-cusum-drift is naive-pass/governed-
    // fail (1/2 is not a K=2 majority); fx-ledger-null is naive-fail/governed-pass.
    expect(analysis.discordant).toEqual({
      naivePassGovernedFail: 1,
      naiveFailGovernedPass: 1,
    });
    // 6 trials/arm is nowhere near the NI requirement — power must say so.
    expect(analysis.power.requiredPerArm).toBeGreaterThan(6);
    expect(analysis.power.adequatelyPowered).toBe(false);

    // Report: bannered as fixture data, with the power caveat.
    const report = renderReport(analysis, {
      title: "Outcome Benchmark (dry run)",
      generatedAt: "2026-06-11T00:00:00Z",
      modelPins: [FIXTURE_PRICED_MODEL],
      executionMode: "fixture replay (dry-run)",
    });
    expect(report).toContain("DRY-RUN — FIXTURE DATA");
    expect(report).toContain("underpowered");
    expect(report).toContain("fx-cache-rule");

    // Attestation: overhead on the books, signature verifies.
    const overhead = new Map(analysis.tasks.map((t) => [t.taskId, 450]));
    const att = buildAttestation(analysis, overhead, {
      issuedAt: "2026-06-11T00:00:00Z",
    });
    expect(att.manifest.rollup.overhead).toBe(450 * 3);
    expect(att.manifest.rollup.netSaved).toBeGreaterThan(0);
    expect(verifyAttestation(att).valid).toBe(true);

    // Tampering is detected.
    const tampered = {
      ...att,
      manifest: {
        ...att.manifest,
        rollup: { ...att.manifest.rollup, netSaved: 999_999_999 },
      },
    };
    expect(verifyAttestation(tampered).valid).toBe(false);
  });

  it("falls back to the token metric when any trial is unpriced", async () => {
    const fdir = join(dir, "unpriced");
    const suite = writeUnpricedFixture(fdir);
    const result = await runMatrix(
      suite.tasks,
      {
        trialsPerTask: 1,
        arms: ["naive", "governed"] as const,
        logPath: join(fdir, "trials.jsonl"),
      },
      new FixtureRunner(suite.cells)
    );
    const analysis = analyzeOutcomes(result.records, PRE_REGISTRATION);
    expect(analysis.metricUsed).toBe("tokens");
    expect(analysis.costComplete).toBe(false);
    // Ledger refuses dollars too (null, never fabricated).
    expect(analysis.ledger.naive.costUsd).toBeNull();
    const report = renderReport(analysis, {
      title: "t",
      generatedAt: "2026-06-11T00:00:00Z",
      modelPins: ["fixture-unpriced-model"],
      executionMode: "fixture replay (dry-run)",
    });
    expect(report).toContain("no dollars are claimed");
  });

  it("savings records use tokens even when the analysis metric is USD", async () => {
    const fdir = join(dir, "att-tokens");
    const suite = writeFixtureSuite(fdir);
    const result = await runMatrix(
      suite.tasks,
      {
        trialsPerTask: 2,
        arms: ["naive", "governed"] as const,
        logPath: join(fdir, "trials.jsonl"),
      },
      new FixtureRunner(suite.cells)
    );
    const analysis = analyzeOutcomes(result.records, PRE_REGISTRATION);
    expect(analysis.metricUsed).toBe("usd");
    const records = savingsRecordsFrom(analysis, new Map());
    // Naive per-trial tokens: 42000+3300+17000+2000 = 64300.
    // Governed per-trial tokens: 9000+1600+3000+1200 = 14800.
    for (const r of records) {
      expect(r.baselineTokens).toBe(64_300);
      expect(r.optimizedTokens).toBe(14_800);
    }
  });
});

// ============================================================================
// Trial record durability
// ============================================================================

describe("trial log", () => {
  it("ignores a torn trailing line (interrupted run) without losing prior records", async () => {
    const fdir = join(dir, "torn");
    const suite = writeFixtureSuite(fdir);
    const logPath = join(fdir, "trials.jsonl");
    const result = await runMatrix(
      suite.tasks,
      { trialsPerTask: 1, arms: ["naive"] as const, logPath },
      new FixtureRunner(suite.cells)
    );
    expect(result.ran).toBe(3);
    // Simulate an interrupted append.
    const torn = '{"taskId":"fx-cache-rule","arm":"gov';
    writeFileSync(logPath, (await import("node:fs")).readFileSync(logPath, "utf8") + torn);
    expect(loadTrialLog(logPath)).toHaveLength(3);
  });
});
