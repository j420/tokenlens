/**
 * Trial workspaces: fresh git worktree at the broken commit, with the
 * reference commit's TEST files applied on top (revert-and-refix).
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
  testRefCommit: string;
  /** Repo-relative test files applied from `testRefCommit`. */
  testPaths: string[];
}

export interface CommandPlan {
  /** argv arrays, executed in order; any failure aborts the trial as `fail`. */
  commands: string[][];
}

export function planCreateWorkspace(input: WorkspacePlanInput): CommandPlan {
  const { repoRoot, worktreeDir, baseCommit, testRefCommit, testPaths } = input;
  const commands: string[][] = [
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
  ];
  if (testPaths.length > 0) {
    commands.push([
      "git",
      "-C",
      worktreeDir,
      "checkout",
      testRefCommit,
      "--",
      ...testPaths,
    ]);
  }
  return { commands };
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
