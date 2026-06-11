import { describe, expect, it, beforeAll, afterAll } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import type { TaskManifest } from "@prune/outcome-bench";

import { applyVerdict, planThreeState, runThreeState } from "./verify.js";
import { ThreeStateVerdictSchema } from "./types.js";

// ============================================================================
// Test repo: a tiny library + a runner oracle, three commits.
//
//   C1 (base of the VALID task): lib.mjs broken, runner.mjs present, no tests
//   C2 (reference):              lib.mjs fixed + check.test.mjs (fails on broken)
//   C3 (degenerate reference):   tautology.test.mjs (passes even on broken)
//
// Oracle: `node runner.mjs` — executes every *.test.mjs in the worktree.
// At C1 there are no test files, so the oracle passes (healthy baseline).
// ============================================================================

let repo: string;
let scratch: string;
let c1 = "";
let c2 = "";
let c3 = "";

const git = (...args: string[]): string => {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const write = (rel: string, content: string): void => {
  const p = join(repo, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
};
const commitAll = (msg: string): string => {
  git("add", ".");
  git("commit", "-qm", msg);
  return git("rev-parse", "HEAD");
};

const RUNNER = `import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
let failed = 0;
for (const f of readdirSync(".")) {
  if (!f.endsWith(".test.mjs")) continue;
  const r = spawnSync(process.execPath, [f], { stdio: "inherit" });
  if (r.status !== 0) failed++;
}
process.exit(failed === 0 ? 0 : 1);
`;

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "repo-proof-verify-repo-"));
  scratch = mkdtempSync(join(tmpdir(), "repo-proof-verify-scratch-"));
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");

  write("lib.mjs", `export const VALUE = "broken";\n`);
  write("runner.mjs", RUNNER);
  c1 = commitAll("broken impl, no tests");

  write("lib.mjs", `export const VALUE = "fixed";\n`);
  write(
    "check.test.mjs",
    `import { VALUE } from "./lib.mjs";\nprocess.exit(VALUE === "fixed" ? 0 : 1);\n`
  );
  c2 = commitAll("fix with binding test");

  write(
    "tautology.test.mjs",
    `import { VALUE } from "./lib.mjs";\nprocess.exit(typeof VALUE === "string" ? 0 : 1);\n`
  );
  c3 = commitAll("tautological test (passes on broken code)");
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

function task(overrides: Partial<TaskManifest>): TaskManifest {
  return {
    taskId: "t-valid",
    track: "self",
    status: "draft",
    repoUrl: null,
    baseCommit: c1,
    testRefCommit: c2,
    hiddenTestPaths: ["check.test.mjs"],
    setupCmds: [],
    prompt: "The library exports the wrong value; make it correct.",
    oracleCmd: "node runner.mjs",
    oracleCwd: ".",
    intentClass: "debug",
    referenceCommit: c2,
    difficulty: null,
    maxTurns: 10,
    maxBudgetUsd: 1,
    cutoffSafe: true,
    ...overrides,
  };
}

// ============================================================================
// Pure planning
// ============================================================================

describe("planThreeState", () => {
  it("builds exact auditable argv plans for the three states", () => {
    const t = task({});
    const plan = planThreeState(t, repo, "/scratch");
    expect("error" in plan).toBe(false);
    if ("error" in plan) return;
    const [s1, s2, s3] = plan.states;
    expect(s1.create.commands).toEqual([
      ["git", "-C", repo, "worktree", "add", "--detach", "/scratch/t-valid-S1", c1],
    ]);
    expect(s1.applyHidden.commands).toEqual([]); // S1 never sees hidden tests
    expect(s1.expect).toBe("pass");
    expect(s2.applyHidden.commands).toEqual([
      ["git", "-C", "/scratch/t-valid-S2", "checkout", c2, "--", "check.test.mjs"],
    ]);
    expect(s2.expect).toBe("fail");
    expect(s3.create.commands[0][7]).toBe(c2); // reference commit
    expect(s3.expect).toBe("pass");
  });

  it("refuses null commit pins with a typed error, not a throw", () => {
    const plan = planThreeState(task({ baseCommit: null }), repo, "/s");
    expect(plan).toHaveProperty("error");
  });

  it("refuses tasks without hidden tests (protocol undefined)", () => {
    const plan = planThreeState(task({ hiddenTestPaths: [] }), repo, "/s");
    expect(plan).toHaveProperty("error");
  });
});

// ============================================================================
// Execution on the real temp repo
// ============================================================================

describe("runThreeState", () => {
  it("validates a genuine revert-and-refix task (pass/fail/pass) and cleans up", () => {
    const plan = planThreeState(task({}), repo, scratch);
    if ("error" in plan) throw new Error(plan.error);
    const v = runThreeState(plan);
    expect(v).toMatchObject({ s1: "pass", s2: "fail", s3: "pass", valid: true });
    expect(ThreeStateVerdictSchema.parse(v)).toBeTruthy();
    for (const s of plan.states) expect(existsSync(s.worktreeDir)).toBe(false);
  });

  it("rejects a degenerate task whose hidden test passes at base (the waterbed lesson)", () => {
    const plan = planThreeState(
      task({
        taskId: "t-tautology",
        testRefCommit: c3,
        referenceCommit: c3,
        hiddenTestPaths: ["tautology.test.mjs"],
      }),
      repo,
      scratch
    );
    if ("error" in plan) throw new Error(plan.error);
    const v = runThreeState(plan);
    expect(v.s2).toBe("pass"); // the test demands no work
    expect(v.valid).toBe(false);
    expect(v.failures.some((f) => f.state === "S2")).toBe(true);
  });

  it("treats a broken setup command as 'error', never a verdict", () => {
    const plan = planThreeState(
      task({ taskId: "t-setup-broken", setupCmds: ["exit 7"] }),
      repo,
      scratch
    );
    if ("error" in plan) throw new Error(plan.error);
    const v = runThreeState(plan);
    expect([v.s1, v.s2, v.s3]).toEqual(["error", "error", "error"]);
    expect(v.valid).toBe(false);
    expect(v.failures.every((f) => f.detail.includes("setup failed"))).toBe(true);
  });

  it("rejects an unsolvable task (reference does not make the oracle pass)", () => {
    // Reference = c1 (still broken) but hidden test from c2: S3 fails.
    const plan = planThreeState(
      task({ taskId: "t-unsolvable", referenceCommit: c1 }),
      repo,
      scratch
    );
    if ("error" in plan) throw new Error(plan.error);
    const v = runThreeState(plan);
    expect(v.s3).toBe("fail");
    expect(v.valid).toBe(false);
  });

  it("the verdict schema itself rejects an inconsistent valid flag", () => {
    expect(
      ThreeStateVerdictSchema.safeParse({
        taskId: "x",
        s1: "pass",
        s2: "pass",
        s3: "pass",
        valid: true, // lie: s2 must be "fail" for valid
        checkedAt: "2026-06-11T00:00:00Z",
        failures: [],
      }).success
    ).toBe(false);
  });
});

// ============================================================================
// Verdict application
// ============================================================================

describe("applyVerdict", () => {
  const verdict = (valid: boolean, taskId = "t-valid") => ({
    taskId,
    s1: "pass" as const,
    s2: valid ? ("fail" as const) : ("pass" as const),
    s3: "pass" as const,
    valid,
    checkedAt: "2026-06-11T00:00:00Z",
    failures: [],
  });

  it("flips draft → ready ONLY on a valid verdict", () => {
    expect(applyVerdict(task({}), verdict(true)).status).toBe("ready");
    expect(applyVerdict(task({}), verdict(false)).status).toBe("draft");
  });

  it("never silently demotes a ready task on an invalid verdict", () => {
    const ready = task({ status: "ready" });
    expect(applyVerdict(ready, verdict(false)).status).toBe("ready");
  });

  it("ignores a verdict for a different task", () => {
    expect(applyVerdict(task({}), verdict(true, "other")).status).toBe("draft");
  });
});
