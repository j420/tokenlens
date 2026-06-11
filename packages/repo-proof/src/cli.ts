#!/usr/bin/env node
/**
 * prune-proof — the operator CLI for f20 repo-proof.
 *
 *   prune-proof mine    --repo <path> [--limit N] [--group-prefix P]...
 *                       [--oracle-template T]
 *   prune-proof verify  --repo <path> [--task <id>] [--scratch <dir>]
 *   prune-proof prove   --repo <path> --budget <usd> [--model M] [--trials K]
 *                       [--hooks-dir D] [--work-dir D]
 *   prune-proof promote --repo <path> [--hooks-dir D]
 *   prune-proof status  --repo <path> [--json]
 *
 * Conventions (matching flags.mjs / install.mjs):
 *  - pure parseArgs (manual scan, zero dependencies); unknown flags error;
 *  - `run(argv, io)` returns an exit code and takes injectable seams, so the
 *    whole CLI is testable end-to-end with zero model spend;
 *  - exit 0 = the command did its honest job (including "gates not met —
 *    no-op"); exit 1 = usage or infrastructure error;
 *  - `prove` without --budget is a PARSE error: spend never happens
 *    implicitly.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  GOVERNED_FLAGS,
  PRE_REGISTRATION,
  loadManifestDir,
  runnableTasks,
  type TaskManifest,
  type TrialRunner,
} from "@prune/outcome-bench";
import { proofPaths } from "./paths.js";
import {
  defaultGitRunner,
  mineCandidates,
  type GitRunner,
  type MineOptions,
} from "./mine.js";
import { applyVerdict, planThreeState, runThreeState } from "./verify.js";
import { makeLiveRunner, persistAtomic, runProve } from "./prove.js";
import { buildRepoMapArtifact } from "./map.js";
import {
  evaluatePromoteGate,
  executePromotion,
  parseGateInputs,
  planPromotion,
} from "./promote.js";
import { readJsonSafe, readProofState, renderStatusMd } from "./status.js";

// ============================================================================
// Pure argument parsing
// ============================================================================

export type Command =
  | { kind: "mine"; repo: string; limit: number; groupPrefixes: string[]; oracleTemplate: string | null }
  | { kind: "map"; repo: string; tokenBudget: number; query: string | null; out: string | null }
  | { kind: "verify"; repo: string; task: string | null; scratch: string | null }
  | { kind: "prove"; repo: string; budgetUsd: number; model: string; trials: number; hooksDir: string | null; workDir: string | null }
  | { kind: "promote"; repo: string; hooksDir: string | null }
  | { kind: "status"; repo: string; json: boolean };

export interface ParseError {
  error: string;
}

const USAGE = `Usage:
  prune-proof mine    --repo <path> [--limit N] [--group-prefix P]... [--oracle-template T]
  prune-proof map     --repo <path> [--map-tokens N] [--query TEXT] [--out FILE]
  prune-proof verify  --repo <path> [--task <id>] [--scratch <dir>]
  prune-proof prove   --repo <path> --budget <usd> [--model M] [--trials K] [--hooks-dir D] [--work-dir D]
  prune-proof promote --repo <path> [--hooks-dir D]
  prune-proof status  --repo <path> [--json]

Exit codes: 0 done · 1 usage/infrastructure error · 2 honest refusal/abort
(budget pre-flight refused, stop-loss tripped) — chain with && safely.`;

export function parseArgs(argv: string[]): Command | ParseError {
  const [kind, ...rest] = argv;
  if (!kind) return { error: `missing command\n${USAGE}` };

  const flags = new Map<string, string[]>();
  const bare: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--")) {
      if (a === "--json") {
        flags.set(a, [...(flags.get(a) ?? []), "true"]);
        continue;
      }
      const value = rest[i + 1];
      if (value === undefined || value === "" || value.startsWith("--")) {
        // "" guards the unset-shell-variable case: --repo "$VAR" with VAR
        // empty must error, not silently resolve to the current directory.
        return { error: `flag ${a} requires a non-empty value` };
      }
      flags.set(a, [...(flags.get(a) ?? []), value]);
      i++;
    } else {
      bare.push(a);
    }
  }
  if (bare.length > 0) {
    return { error: `unexpected argument: ${bare[0]}\n${USAGE}` };
  }
  const one = (name: string): string | null => {
    const v = flags.get(name);
    return v === undefined ? null : v[v.length - 1];
  };
  const known = (names: string[]): ParseError | null => {
    for (const key of flags.keys()) {
      if (!names.includes(key)) return { error: `unknown flag ${key} for "${kind}"\n${USAGE}` };
    }
    return null;
  };

  const repo = one("--repo");
  if (repo === null) return { error: `--repo is required\n${USAGE}` };

  switch (kind) {
    case "mine": {
      const bad = known(["--repo", "--limit", "--group-prefix", "--oracle-template"]);
      if (bad) return bad;
      const limitRaw = one("--limit") ?? "400";
      const limit = Number(limitRaw);
      if (!Number.isInteger(limit) || limit <= 0) {
        return { error: `--limit must be a positive integer, got "${limitRaw}"` };
      }
      return {
        kind: "mine",
        repo,
        limit,
        groupPrefixes: flags.get("--group-prefix") ?? [],
        oracleTemplate: one("--oracle-template"),
      };
    }
    case "map": {
      const bad = known(["--repo", "--map-tokens", "--query", "--out"]);
      if (bad) return bad;
      const budgetRaw = one("--map-tokens") ?? "1024";
      const tokenBudget = Number(budgetRaw);
      if (!Number.isInteger(tokenBudget) || tokenBudget <= 0) {
        return { error: `--map-tokens must be a positive integer, got "${budgetRaw}"` };
      }
      return {
        kind: "map",
        repo,
        tokenBudget,
        query: one("--query"),
        out: one("--out"),
      };
    }
    case "verify": {
      const bad = known(["--repo", "--task", "--scratch"]);
      if (bad) return bad;
      return { kind: "verify", repo, task: one("--task"), scratch: one("--scratch") };
    }
    case "prove": {
      const bad = known(["--repo", "--budget", "--model", "--trials", "--hooks-dir", "--work-dir"]);
      if (bad) return bad;
      const budgetRaw = one("--budget");
      if (budgetRaw === null) {
        return {
          error: "prove requires --budget <usd>: spend never happens implicitly",
        };
      }
      const budgetUsd = Number(budgetRaw);
      if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) {
        return { error: `--budget must be a positive number, got "${budgetRaw}"` };
      }
      const trialsRaw = one("--trials") ?? String(PRE_REGISTRATION.trialsPerTask);
      const trials = Number(trialsRaw);
      if (!Number.isInteger(trials) || trials <= 0) {
        return { error: `--trials must be a positive integer, got "${trialsRaw}"` };
      }
      return {
        kind: "prove",
        repo,
        budgetUsd,
        model: one("--model") ?? "claude-sonnet-4-6",
        trials,
        hooksDir: one("--hooks-dir"),
        workDir: one("--work-dir"),
      };
    }
    case "promote": {
      const bad = known(["--repo", "--hooks-dir"]);
      if (bad) return bad;
      return { kind: "promote", repo, hooksDir: one("--hooks-dir") };
    }
    case "status": {
      const bad = known(["--repo", "--json"]);
      if (bad) return bad;
      return { kind: "status", repo, json: flags.has("--json") };
    }
    default:
      return { error: `unknown command "${kind}"\n${USAGE}` };
  }
}

// ============================================================================
// Injectable runtime seams
// ============================================================================

export interface CliDeps {
  git?: GitRunner;
  /** Test seam: replaces the live runner (FixtureRunner in tests). */
  makeRunner?: (tasks: TaskManifest[], cmd: Extract<Command, { kind: "prove" }>) => TrialRunner;
  /** Test seam: replaces the dynamic install.mjs import. */
  loadInstallHooks?: (
    hooksDir: string
  ) => Promise<(existing: unknown, o: { hooksDir: string }) => { settings: unknown }>;
  now?: () => string;
}

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

async function defaultLoadInstallHooks(
  hooksDir: string
): Promise<(existing: unknown, o: { hooksDir: string }) => { settings: unknown }> {
  const installPath = join(hooksDir, "install.mjs");
  if (!existsSync(installPath)) {
    throw new Error(
      `hook installer not found at ${installPath}; pass --hooks-dir pointing at the Prune hooks directory`
    );
  }
  const mod = (await import(pathToFileURL(installPath).href)) as {
    computeHooksInstall?: (existing: unknown, o: { hooksDir: string }) => { settings: unknown };
  };
  if (typeof mod.computeHooksInstall !== "function") {
    throw new Error(`${installPath} does not export computeHooksInstall`);
  }
  return mod.computeHooksInstall;
}

// ============================================================================
// Command implementations
// ============================================================================

function loadReadyTasks(tasksDir: string, io: CliIo): TaskManifest[] | null {
  if (!existsSync(tasksDir)) {
    io.err(`no task manifests at ${tasksDir}; run mine, then curate prompts`);
    return null;
  }
  const loaded = loadManifestDir(tasksDir);
  for (const e of loaded.errors) {
    io.err(`invalid manifest ${e.file}: ${e.reason}`);
  }
  if (loaded.errors.length > 0) return null;
  return runnableTasks(loaded.tasks);
}

async function cmdMine(
  cmd: Extract<Command, { kind: "mine" }>,
  io: CliIo,
  deps: CliDeps
): Promise<number> {
  const paths = proofPaths(cmd.repo);
  const opts: MineOptions = {
    limit: cmd.limit,
    groupPrefixes: cmd.groupPrefixes.length > 0 ? cmd.groupPrefixes : undefined,
    oracleTemplate: cmd.oracleTemplate,
  };
  const result = mineCandidates(cmd.repo, opts, deps.git ?? defaultGitRunner);
  if ("error" in result) {
    io.err(result.error);
    return 1;
  }
  persistAtomic(
    paths.candidates,
    result.candidates.map((c) => JSON.stringify(c)).join("\n") + (result.candidates.length > 0 ? "\n" : "")
  );
  persistAtomic(paths.coverage, JSON.stringify(result.coverage, null, 2) + "\n");

  io.out(`mined → ${result.candidates.length} candidates`);
  io.out("");
  io.out("  group                          commits  candidates");
  for (const row of result.coverage) {
    const marker = row.candidates === 0 ? "   ← unprovable in window" : "";
    io.out(
      `  ${row.group.padEnd(30)} ${String(row.commitsScanned).padStart(7)}  ${String(row.candidates).padStart(10)}${marker}`
    );
  }
  for (const note of result.notes) io.out(`  note: ${note}`);
  io.out("");
  io.out(`wrote ${paths.candidates}`);
  io.out(`wrote ${paths.coverage}`);
  io.out(
    "next: write an issue-style prompt per task (tasks/<id>.json, status \"draft\") — prompts are never auto-generated" +
      (cmd.oracleTemplate === null
        ? "; suggestedOracleCmd is null (unknown test runner — supply it during curation)"
        : "")
  );
  return 0;
}

async function cmdMap(
  cmd: Extract<Command, { kind: "map" }>,
  io: CliIo
): Promise<number> {
  const paths = proofPaths(cmd.repo);
  const artifact = await buildRepoMapArtifact(paths.repoRoot, {
    tokenBudget: cmd.tokenBudget,
    query: cmd.query ?? undefined,
  });
  // The map IS the screen output; the file is the durable copy.
  io.out(artifact.text);
  const outPath = cmd.out ?? paths.repoMap;
  persistAtomic(outPath, artifact.text + "\n");
  io.out("");
  io.out(`wrote ${outPath}`);
  if (!artifact.hasSymbols) {
    io.out(
      "note: no symbols indexed — see the artifact for the language-coverage limitation"
    );
  }
  return 0;
}

async function cmdVerify(
  cmd: Extract<Command, { kind: "verify" }>,
  io: CliIo
): Promise<number> {
  const paths = proofPaths(cmd.repo);
  if (!existsSync(paths.tasksDir)) {
    io.err(`no task manifests at ${paths.tasksDir}`);
    return 1;
  }
  const loaded = loadManifestDir(paths.tasksDir);
  for (const e of loaded.errors) io.err(`invalid manifest ${e.file}: ${e.reason}`);
  let tasks = loaded.tasks;
  if (cmd.task !== null) {
    tasks = tasks.filter((t) => t.taskId === cmd.task);
    if (tasks.length === 0) {
      io.err(`task "${cmd.task}" not found in ${paths.tasksDir}`);
      return 1;
    }
  }

  const scratch =
    cmd.scratch ?? mkdtempSync(join(tmpdir(), "repo-proof-verify-"));
  let readyCount = 0;
  let invalidCount = 0;
  let errorCount = 0;
  for (const task of tasks) {
    const plan = planThreeState(task, paths.repoRoot, scratch);
    if ("error" in plan) {
      io.out(`${task.taskId}: SKIP — ${plan.error}`);
      continue;
    }
    const verdict = runThreeState(plan);
    persistAtomic(
      join(paths.verifyDir, `${task.taskId}.json`),
      JSON.stringify(verdict, null, 2) + "\n"
    );
    const after = applyVerdict(task, verdict);
    if (after.status !== task.status) {
      persistAtomic(
        join(paths.tasksDir, `${task.taskId}.json`),
        JSON.stringify(after, null, 2) + "\n"
      );
    }
    const flipped = after.status !== task.status ? " → ready" : "";
    if (verdict.valid) readyCount++;
    else if (verdict.s1 === "error" || verdict.s2 === "error" || verdict.s3 === "error")
      errorCount++;
    else invalidCount++;
    io.out(
      `${task.taskId}: S1=${verdict.s1} S2=${verdict.s2} S3=${verdict.s3} ${verdict.valid ? `VALID${flipped}` : "INVALID (stays draft, never patched)"}`
    );
    for (const f of verdict.failures) io.out(`    ${f.state}: ${f.detail}`);
  }
  if (cmd.scratch === null) rmSync(scratch, { recursive: true, force: true });
  io.out("");
  io.out(`verified: ${readyCount} valid · ${invalidCount} invalid · ${errorCount} infra-error`);
  return 0;
}

async function cmdProve(
  cmd: Extract<Command, { kind: "prove" }>,
  io: CliIo,
  deps: CliDeps
): Promise<number> {
  const paths = proofPaths(cmd.repo);
  const tasks = loadReadyTasks(paths.tasksDir, io);
  if (tasks === null) return 1;

  let runner: TrialRunner;
  if (deps.makeRunner) {
    runner = deps.makeRunner(tasks, cmd);
  } else {
    if (cmd.hooksDir === null) {
      io.err("prove (live) requires --hooks-dir pointing at the Prune hooks directory");
      return 1;
    }
    const loadInstall = deps.loadInstallHooks ?? defaultLoadInstallHooks;
    const installHooks = await loadInstall(cmd.hooksDir);
    const workDir =
      cmd.workDir ?? mkdtempSync(join(tmpdir(), "repo-proof-prove-"));
    mkdirSync(workDir, { recursive: true });
    runner = makeLiveRunner({
      repoRoot: paths.repoRoot,
      workDir,
      model: cmd.model,
      installHooks,
      hooksDir: cmd.hooksDir,
      paths,
    });
  }

  const governedFeatureIds = Object.keys(GOVERNED_FLAGS);
  const result = await runProve(tasks, {
    paths,
    trialsPerTask: cmd.trials,
    budgetUsd: cmd.budgetUsd,
    runner,
    modelPins: [cmd.model],
    executionMode: deps.makeRunner
      ? "injected runner"
      : "live headless Claude Code",
    governedFeatureIds,
    now: deps.now,
  });

  io.out(`matrix: ran ${result.ran}, skipped ${result.skipped} (resume)`);
  if (result.aborted !== null) io.out(`ABORTED: ${result.aborted}`);
  if (result.analysis !== null) {
    const a = result.analysis;
    io.out(
      `primary: median savings ${a.medianSavingsPct === null ? "n/a" : (a.medianSavingsPct * 100).toFixed(1) + "%"} (${a.metricUsed}), Wilcoxon p=${a.wilcoxon.pValue.toExponential(2)} ${a.wilcoxon.reject ? "✓" : "✗"}`
    );
    io.out(
      `secondary: success naive ${(a.naiveSuccessRate * 100).toFixed(0)}% vs governed ${(a.governedSuccessRate * 100).toFixed(0)}%, NI ${a.nonInferiority.reject ? "concluded ✓" : "NOT concluded ✗"}`
    );
    io.out(`wrote ${paths.analysis}`);
    io.out(`wrote ${paths.attestation}`);
    io.out(`wrote ${paths.report}`);
  }
  // Exit-code contract (four-eyes finding): an honest refusal/abort is exit
  // 2, NOT 0 — `prove && promote` in a script must stop on a refused prove
  // instead of promoting whatever artifacts a PRIOR run left behind. Exit 1
  // stays reserved for usage/infrastructure errors (the run() catch).
  return result.aborted === null ? 0 : 2;
}

async function cmdPromote(
  cmd: Extract<Command, { kind: "promote" }>,
  io: CliIo,
  deps: CliDeps
): Promise<number> {
  const paths = proofPaths(cmd.repo);
  const analysisRaw = readJsonSafe(paths.analysis);
  const attestationRaw = readJsonSafe(paths.attestation);
  if (analysisRaw === null || attestationRaw === null) {
    io.err("no proof artifacts (analysis.json / attestation.json); run prove first");
    return 1;
  }
  // Disk artifacts are structurally validated before the gate touches them:
  // a corrupt/hand-edited file is a typed refusal, not a TypeError.
  const inputs = parseGateInputs(analysisRaw, attestationRaw);
  if ("error" in inputs) {
    io.err(inputs.error);
    return 1;
  }
  const metaRaw = readJsonSafe(paths.proveMeta);
  const governedFeatureIds =
    metaRaw !== null &&
    typeof metaRaw === "object" &&
    Array.isArray((metaRaw as Record<string, unknown>).governedFeatureIds)
      ? ((metaRaw as Record<string, unknown>).governedFeatureIds as string[])
      : null;
  if (governedFeatureIds === null) {
    io.err(
      "prove-meta.json missing or lacks governedFeatureIds — cannot determine which features the proof actually measured; re-run prove"
    );
    return 1;
  }

  const decision = evaluatePromoteGate(inputs.analysis, inputs.attestation, {
    now: deps.now,
  });

  io.out("gate check:");
  for (const c of decision.checks) {
    io.out(`  ${c.pass ? "✓" : "✗"} ${c.id.padEnd(20)} ${c.detail}`);
  }

  let settingsAfterHooks: unknown = readJsonSafe(paths.settingsFile) ?? {};
  if (decision.pass) {
    if (cmd.hooksDir === null) {
      io.err("promote requires --hooks-dir to wire the project hook settings");
      return 1;
    }
    const loadInstall = deps.loadInstallHooks ?? defaultLoadInstallHooks;
    const installHooks = await loadInstall(cmd.hooksDir);
    settingsAfterHooks = installHooks(settingsAfterHooks, {
      hooksDir: cmd.hooksDir,
    }).settings;
  }

  const plan = planPromotion(
    decision,
    governedFeatureIds,
    readJsonSafe(paths.flagsFile),
    settingsAfterHooks,
    paths
  );
  const { written } = executePromotion(plan);

  io.out("");
  if (decision.pass) {
    io.out(
      `PROMOTED for this repo: ${plan.flagsPromoted.join(", ")} → mode "general"`
    );
    io.out(`reason: attestation sha256:${decision.attestationSha256}`);
  } else {
    io.out("gates not met — honest no-op (decision recorded)");
  }
  for (const w of written) io.out(`wrote ${w}`);
  return 0;
}

async function cmdStatus(
  cmd: Extract<Command, { kind: "status" }>,
  io: CliIo
): Promise<number> {
  const state = readProofState(cmd.repo);
  if (cmd.json) {
    io.out(JSON.stringify(state, null, 2));
    return 0;
  }
  const paths = proofPaths(cmd.repo);
  const reportMd = existsSync(paths.report)
    ? readFileSync(paths.report, "utf8")
    : null;
  io.out(renderStatusMd(state, reportMd));
  return 0;
}

// ============================================================================
// Entry
// ============================================================================

export async function run(
  argv: string[],
  io: CliIo,
  deps: CliDeps = {}
): Promise<number> {
  const cmd = parseArgs(argv);
  if ("error" in cmd) {
    io.err(cmd.error);
    return 1;
  }
  try {
    switch (cmd.kind) {
      case "mine":
        return await cmdMine(cmd, io, deps);
      case "map":
        return await cmdMap(cmd, io);
      case "verify":
        return await cmdVerify(cmd, io);
      case "prove":
        return await cmdProve(cmd, io, deps);
      case "promote":
        return await cmdPromote(cmd, io, deps);
      case "status":
        return await cmdStatus(cmd, io);
    }
  } catch (e) {
    io.err(`error: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

// npm bin shims are SYMLINKS to dist/cli.js: argv[1] must be realpath'd
// before comparing against import.meta.url, or the guard never fires when
// invoked as `npx prune-proof`.
const invokedDirectly = (() => {
  if (typeof process === "undefined" || process.argv[1] === undefined) {
    return false;
  }
  try {
    return (
      import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
    );
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  run(process.argv.slice(2), {
    out: (l) => console.log(l),
    err: (l) => console.error(l),
  }).then((code) => {
    process.exitCode = code;
  });
}
