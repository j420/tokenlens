/**
 * Three-state task verification — the protocol that earns the right to call a
 * task "real". Each state runs in its own clean worktree:
 *
 *   S1  baseCommit, untouched           → oracle must PASS
 *       (healthy PASS_TO_PASS baseline: the agent starts from green, so any
 *        regression it introduces is attributable to the agent)
 *   S2  baseCommit + hidden tests       → oracle must FAIL
 *       (the FAIL_TO_PASS patch demands real work; a task that is already
 *        green measures nothing — this state caught a real curation bug:
 *        a reference regression test that passed on the broken code)
 *   S3  referenceCommit + hidden tests  → oracle must PASS
 *       (the reference solution is achievable; failure here means the task
 *        is unsolvable as specified, not that agents are bad)
 *
 * `valid` requires exactly pass/fail/pass. An infrastructure "error" in any
 * state (worktree creation, setup command) invalidates the task — a broken
 * setup is never coerced into a verdict, and an invalid task is dropped,
 * never patched into passing.
 *
 * Pure planner (`planThreeState`) + thin executor (`runThreeState`) with
 * injectable exec/oracle, mirroring the outcome-bench workspace style.
 */

import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  execPlan,
  planApplyHiddenTests,
  planCreateWorkspace,
  planRemoveWorkspace,
  runOracle,
  type CommandPlan,
  type ExecResult,
  type OracleResult,
  type TaskManifest,
} from "@prune/outcome-bench";
import type { StateOutcome, ThreeStateVerdict } from "./types.js";

// ============================================================================
// Pure planning
// ============================================================================

export type StateName = "S1" | "S2" | "S3";

export interface StatePlan {
  state: StateName;
  worktreeDir: string;
  create: CommandPlan;
  /** Manifest setup commands, run with cwd = worktreeDir, in order. */
  setupCmds: string[];
  /** Hidden-test application; empty plan for S1. */
  applyHidden: CommandPlan;
  oracleCmd: string;
  /** Absolute oracle cwd inside this state's worktree. */
  oracleCwd: string;
  /** What the oracle must return for the task to be valid. */
  expect: "pass" | "fail";
  remove: CommandPlan;
}

export interface ThreeStatePlan {
  taskId: string;
  repoRoot: string;
  states: [StatePlan, StatePlan, StatePlan];
}

function oracleCwdIn(worktreeDir: string, oracleCwd: string): string {
  return oracleCwd === "." || oracleCwd === ""
    ? worktreeDir
    : join(worktreeDir, oracleCwd);
}

/**
 * Build the three state plans. Returns a typed error (not a throw) for
 * manifests that cannot be verified: drafts with null SHAs stay drafts.
 */
export function planThreeState(
  task: TaskManifest,
  repoRoot: string,
  scratchDir: string
): ThreeStatePlan | { error: string } {
  const { baseCommit, testRefCommit, referenceCommit } = task;
  if (baseCommit === null || testRefCommit === null || referenceCommit === null) {
    return {
      error: `task ${task.taskId}: cannot verify with null commit pins (baseCommit=${baseCommit}, testRefCommit=${testRefCommit}, referenceCommit=${referenceCommit})`,
    };
  }
  if (task.hiddenTestPaths.length === 0) {
    return {
      error: `task ${task.taskId}: no hiddenTestPaths — the three-state protocol is only defined for oracle-graded code tasks`,
    };
  }

  const mkState = (
    state: StateName,
    commit: string,
    applyHidden: boolean,
    expect: "pass" | "fail"
  ): StatePlan => {
    const worktreeDir = join(scratchDir, `${task.taskId}-${state}`);
    return {
      state,
      worktreeDir,
      create: planCreateWorkspace({ repoRoot, worktreeDir, baseCommit: commit }),
      setupCmds: task.setupCmds,
      applyHidden: applyHidden
        ? planApplyHiddenTests(worktreeDir, testRefCommit, task.hiddenTestPaths)
        : { commands: [] },
      oracleCmd: task.oracleCmd,
      oracleCwd: oracleCwdIn(worktreeDir, task.oracleCwd),
      expect,
      remove: planRemoveWorkspace(repoRoot, worktreeDir),
    };
  };

  return {
    taskId: task.taskId,
    repoRoot,
    states: [
      mkState("S1", baseCommit, false, "pass"),
      mkState("S2", baseCommit, true, "fail"),
      mkState("S3", referenceCommit, true, "pass"),
    ],
  };
}

// ============================================================================
// Thin executor
// ============================================================================

export interface RunThreeStateDeps {
  exec?: (plan: CommandPlan) => ExecResult;
  oracle?: (cmd: string, cwd: string, timeoutMs?: number) => OracleResult;
  /** Setup commands run via shell with this timeout (default 15 min each). */
  setupTimeoutMs?: number;
  oracleTimeoutMs?: number;
  now?: () => string;
}

/**
 * Run one shell command (setup steps from a task manifest). Shared by the
 * three-state verifier and the live prove runner so spawn semantics
 * (timeout, buffer cap, stderr truncation) can never drift between them.
 */
export function runShellCmd(
  cmd: string,
  cwd: string,
  timeoutMs = 15 * 60 * 1000
): ExecResult {
  const r = spawnSync(cmd, {
    shell: true,
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error || r.status !== 0) {
    return {
      ok: false,
      failure: {
        command: cmd,
        stderr: r.error ? String(r.error.message) : (r.stderr ?? "").slice(-2000),
        exitCode: r.status ?? null,
      },
    };
  }
  return { ok: true };
}

/**
 * Execute a three-state plan. Worktrees are removed even when a state fails;
 * a leftover from a previous hard kill is force-removed before creation.
 */
export function runThreeState(
  plan: ThreeStatePlan,
  deps: RunThreeStateDeps = {}
): ThreeStateVerdict {
  const exec = deps.exec ?? execPlan;
  const oracle = deps.oracle ?? runOracle;
  const setupTimeoutMs = deps.setupTimeoutMs ?? 15 * 60 * 1000;
  const now = deps.now ?? (() => new Date().toISOString());

  const outcomes: Record<StateName, StateOutcome> = {
    S1: "error",
    S2: "error",
    S3: "error",
  };
  const failures: ThreeStateVerdict["failures"] = [];

  for (const state of plan.states) {
    // Defensive: a hard-killed earlier run can leave a registered worktree at
    // this path; removal is idempotent and failure to remove is non-fatal.
    exec(state.remove);
    try {
      const created = exec(state.create);
      if (!created.ok) {
        failures.push({
          state: state.state,
          detail: `worktree creation failed: ${created.failure?.command ?? ""} — ${created.failure?.stderr ?? ""}`.trim(),
        });
        continue; // outcome stays "error"
      }
      let setupOk = true;
      for (const cmd of state.setupCmds) {
        const r = runShellCmd(cmd, state.worktreeDir, setupTimeoutMs);
        if (!r.ok) {
          failures.push({
            state: state.state,
            detail: `setup failed [${cmd}]: ${r.failure?.stderr ?? ""}`.trim(),
          });
          setupOk = false;
          break;
        }
      }
      if (!setupOk) continue; // outcome stays "error"

      const applied = exec(state.applyHidden);
      if (!applied.ok) {
        failures.push({
          state: state.state,
          detail: `hidden-test apply failed: ${applied.failure?.stderr ?? ""}`.trim(),
        });
        continue; // outcome stays "error"
      }

      const result = oracle(state.oracleCmd, state.oracleCwd, deps.oracleTimeoutMs);
      outcomes[state.state] = result.outcome;
      if (result.outcome !== state.expect) {
        failures.push({
          state: state.state,
          detail: `oracle ${result.outcome} (exit ${result.exitCode}), expected ${state.expect}`,
        });
      }
    } finally {
      exec(state.remove);
    }
  }

  const valid =
    outcomes.S1 === "pass" && outcomes.S2 === "fail" && outcomes.S3 === "pass";
  return {
    taskId: plan.taskId,
    s1: outcomes.S1,
    s2: outcomes.S2,
    s3: outcomes.S3,
    valid,
    checkedAt: now(),
    failures,
  };
}

// ============================================================================
// Verdict application
// ============================================================================

/**
 * The ONLY place a task flips draft → ready: a valid verdict on a draft.
 * Everything else returns the task unchanged — in particular, an invalid
 * verdict never demotes an already-ready task silently (that is a curation
 * decision a human makes with the verdict in hand).
 */
export function applyVerdict(
  task: TaskManifest,
  verdict: ThreeStateVerdict
): TaskManifest {
  if (verdict.taskId !== task.taskId) return task;
  if (verdict.valid && task.status === "draft") {
    return { ...task, status: "ready" };
  }
  return task;
}
