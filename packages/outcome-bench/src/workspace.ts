/**
 * Trial workspaces and SWE-bench-style grading.
 *
 * The agent's workspace is a fresh git worktree at the BROKEN commit, with no
 * trace of the reference tests — exactly what SWE-bench gives a model (the
 * issue text plus the repo before the fix). The FAIL_TO_PASS test patch is
 * applied only at grading time, overwriting any agent edits to those paths,
 * and the oracle then runs the involved packages' full suites so pre-existing
 * tests double as PASS_TO_PASS regression checks.
 *
 * Planning is PURE (argv arrays in, no side effects) so the exact commands a
 * trial will run are testable and auditable; `execPlan` is the thin impure
 * executor. A fresh worktree per trial guarantees no state leaks between
 * trials or arms.
 */

import { spawnSync } from "node:child_process";

export interface WorkspacePlanInput {
  /** Root of the source repository (where `.git` lives). */
  repoRoot: string;
  /** Absolute path the worktree will be created at. */
  worktreeDir: string;
  baseCommit: string;
}

export interface CommandPlan {
  /** argv arrays, executed in order; any failure aborts the trial as `fail`. */
  commands: string[][];
}

/**
 * The agent-visible workspace: the broken commit, nothing else. Hidden test
 * files are deliberately NOT applied here.
 */
export function planCreateWorkspace(input: WorkspacePlanInput): CommandPlan {
  const { repoRoot, worktreeDir, baseCommit } = input;
  return {
    commands: [
      [
        "git",
        "-C",
        repoRoot,
        "worktree",
        "add",
        "--detach",
        worktreeDir,
        baseCommit,
      ],
    ],
  };
}

/**
 * Grading-time application of the hidden FAIL_TO_PASS tests. `git checkout`
 * overwrites the working-tree paths unconditionally, so an agent that edited
 * or tautologized a file at one of these paths is silently reset — the
 * reference tests, not the agent, decide the outcome.
 */
export function planApplyHiddenTests(
  worktreeDir: string,
  testRefCommit: string,
  hiddenTestPaths: string[]
): CommandPlan {
  if (hiddenTestPaths.length === 0) return { commands: [] };
  return {
    commands: [
      [
        "git",
        "-C",
        worktreeDir,
        "checkout",
        testRefCommit,
        "--",
        ...hiddenTestPaths,
      ],
    ],
  };
}

export function planRemoveWorkspace(
  repoRoot: string,
  worktreeDir: string
): CommandPlan {
  return {
    commands: [
      ["git", "-C", repoRoot, "worktree", "remove", "--force", worktreeDir],
    ],
  };
}

export interface ExecResult {
  ok: boolean;
  /** First failing command (argv joined) and its stderr, when not ok. */
  failure?: { command: string; stderr: string; exitCode: number | null };
}

export function execPlan(plan: CommandPlan): ExecResult {
  for (const argv of plan.commands) {
    const [cmd, ...args] = argv;
    const r = spawnSync(cmd, args, { encoding: "utf8" });
    if (r.error || r.status !== 0) {
      return {
        ok: false,
        failure: {
          command: argv.join(" "),
          stderr: r.error ? String(r.error.message) : (r.stderr ?? ""),
          exitCode: r.status ?? null,
        },
      };
    }
  }
  return { ok: true };
}

export interface OracleResult {
  outcome: "pass" | "fail";
  exitCode: number | null;
}

/**
 * Run the task's oracle command in the workspace. The oracle is the ONLY
 * grader: exit 0 = pass, anything else (including spawn failure or timeout)
 * = fail. Executed via the shell because manifests pin full command lines.
 */
export function runOracle(
  oracleCmd: string,
  cwd: string,
  timeoutMs = 10 * 60 * 1000
): OracleResult {
  const r = spawnSync(oracleCmd, {
    shell: true,
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
  });
  if (r.error || r.status !== 0) {
    return { outcome: "fail", exitCode: r.status ?? null };
  }
  return { outcome: "pass", exitCode: 0 };
}

export interface GradeInput {
  worktreeDir: string;
  testRefCommit: string;
  hiddenTestPaths: string[];
  oracleCmd: string;
  /** Workspace-relative cwd for the oracle. */
  oracleCwd: string;
  timeoutMs?: number;
}

/**
 * Full grading sequence: pin the hidden tests, then run the oracle. A failure
 * to apply the test patch grades as `fail` (never silently passes).
 */
export function gradeWorkspace(input: GradeInput): OracleResult {
  const applied = execPlan(
    planApplyHiddenTests(
      input.worktreeDir,
      input.testRefCommit,
      input.hiddenTestPaths
    )
  );
  if (!applied.ok) return { outcome: "fail", exitCode: null };
  const cwd =
    input.oracleCwd === "." || input.oracleCwd === ""
      ? input.worktreeDir
      : `${input.worktreeDir}/${input.oracleCwd}`;
  return runOracle(input.oracleCmd, cwd, input.timeoutMs);
}
