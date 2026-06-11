/**
 * Prove — the paired naive-vs-governed matrix over a repository's verified
 * tasks. The ONLY stage of repo-proof that can spend money, and it is built
 * so spending is bounded, attributable, and abortable:
 *
 *  - Budget pre-flight: a pure worst-case bound (Σ task.maxBudgetUsd × K × 2
 *    arms) computed BEFORE any session spawns; no budget, no run. We use this
 *    one-shot arithmetic rather than @prune/budget-gate because that gate is
 *    a persistence-sink-backed session governor — pulling a SQLite dependency
 *    into a single pre-flight check adds failure modes and nothing else.
 *  - Stop-loss: after every trial, cumulative billed spend is re-checked. A
 *    trial with `billedUsd: null` under a USD budget ABORTS the run — an
 *    unpriced model cannot be honestly metered, and we stop rather than
 *    guess. The append-only trial log makes an abort cheap to resume.
 *  - Brief transparency: the exact context-brief bytes injected into the
 *    governed arm are persisted per task, so "what did TokenLens add to the
 *    agent's context?" is answerable with an artifact, not a description.
 *  - An aborted or partial matrix is labeled as such; analysis runs only
 *    over what actually completed, and the result carries `aborted`.
 *
 * The runner is injected: tests drive the entire pipeline with the
 * outcome-bench FixtureRunner at zero model spend; the live runner is
 * composed here but only the CLI ever constructs it with real spawn deps.
 */

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { countTokens } from "@prune/tokenizer";
import { runShellCmd } from "./verify.js";
import {
  ARMS,
  PRE_REGISTRATION,
  analyzeOutcomes,
  buildAttestation,
  buildContextBrief,
  execPlan,
  gradeWorkspace,
  loadTrialLog,
  planArmSetup,
  planCreateWorkspace,
  renderReport,
  runMatrix,
  ClaudeCliRunner,
  type MatrixConfig,
  type OutcomeAnalysis,
  type TaskManifest,
  type TrialRecord,
  type TrialRunner,
  type TrialSpec,
} from "@prune/outcome-bench";
import type { SignedAttestation } from "@prune/wastebench";
import type { ProofPaths } from "./paths.js";

// ============================================================================
// Pure budget arithmetic
// ============================================================================

export interface ProveBudgetCheck {
  ok: boolean;
  /** Σ task.maxBudgetUsd × trialsPerTask × |arms| — the spend ceiling. */
  worstCaseUsd: number;
  budgetUsd: number | null;
  reason: string;
}

export function checkProveBudget(
  tasks: TaskManifest[],
  trialsPerTask: number,
  budgetUsd: number | null
): ProveBudgetCheck {
  const perRound = tasks.reduce((sum, t) => sum + t.maxBudgetUsd, 0);
  const worstCaseUsd = perRound * trialsPerTask * ARMS.length;
  if (tasks.length === 0) {
    return { ok: false, worstCaseUsd, budgetUsd, reason: "no runnable tasks" };
  }
  if (budgetUsd === null || !Number.isFinite(budgetUsd) || budgetUsd <= 0) {
    return {
      ok: false,
      worstCaseUsd,
      budgetUsd,
      reason:
        "prove requires an explicit positive --budget; spend never happens implicitly",
    };
  }
  if (budgetUsd < worstCaseUsd) {
    return {
      ok: false,
      worstCaseUsd,
      budgetUsd,
      reason: `budget $${budgetUsd} is below the worst-case bound $${worstCaseUsd.toFixed(2)} (${tasks.length} tasks × ${trialsPerTask} trials × ${ARMS.length} arms); raise the budget or run fewer tasks`,
    };
  }
  return {
    ok: true,
    worstCaseUsd,
    budgetUsd,
    reason: `worst case $${worstCaseUsd.toFixed(2)} within budget $${budgetUsd}`,
  };
}

export interface StopLossCheck {
  ok: boolean;
  spentUsd: number;
  /** taskId/arm/trial of the first unpriced trial, when that is the cause. */
  unpricedTrial: string | null;
  reason: string;
}

export function checkStopLoss(
  records: TrialRecord[],
  budgetUsd: number
): StopLossCheck {
  let spent = 0;
  for (const r of records) {
    if (r.billedUsd === null) {
      return {
        ok: false,
        spentUsd: spent,
        unpricedTrial: `${r.taskId}/${r.arm}/${r.trialIndex}`,
        reason:
          "trial returned billedUsd: null under a USD budget — an unpriced model cannot be honestly metered; aborting rather than guessing",
      };
    }
    // Fail-CLOSED on garbage: NaN poisons every later comparison (NaN > x is
    // always false, silently disarming the wire) and a negative bill cannot
    // be honest. A spend guard that can be disarmed by bad input is not a
    // guard.
    if (!Number.isFinite(r.billedUsd) || r.billedUsd < 0) {
      return {
        ok: false,
        spentUsd: spent,
        unpricedTrial: `${r.taskId}/${r.arm}/${r.trialIndex}`,
        reason: `trial returned a non-finite or negative billedUsd (${r.billedUsd}) — the spend guard cannot meter this; aborting`,
      };
    }
    spent += r.billedUsd;
  }
  if (spent > budgetUsd) {
    return {
      ok: false,
      spentUsd: spent,
      unpricedTrial: null,
      reason: `cumulative spend $${spent.toFixed(4)} exceeds budget $${budgetUsd}`,
    };
  }
  return {
    ok: true,
    spentUsd: spent,
    unpricedTrial: null,
    reason: "within budget",
  };
}

// ============================================================================
// Stop-loss-aware matrix wrapper
// ============================================================================

class StopLossAbort extends Error {
  constructor(public readonly check: StopLossCheck) {
    super(check.reason);
  }
}

/**
 * Wraps the inner runner so cumulative spend is re-checked after EVERY
 * completed trial. The trial that trips the wire is still returned and
 * logged (it happened and was paid for); the NEXT trial never starts.
 */
class StopLossRunner implements TrialRunner {
  /** Records seen so far (prior + completed). */
  private readonly seen: TrialRecord[];
  pendingAbort: StopLossCheck | null = null;

  constructor(
    private readonly inner: TrialRunner,
    priorRecords: TrialRecord[],
    private readonly budgetUsd: number
  ) {
    this.seen = [...priorRecords];
    // Prior records from a resumed run go through the same wire immediately:
    // a log already over budget (or already poisoned) must refuse to resume.
    const prior = checkStopLoss(this.seen, budgetUsd);
    if (!prior.ok) this.pendingAbort = prior;
  }

  async runTrial(spec: TrialSpec): Promise<TrialRecord> {
    if (this.pendingAbort) {
      throw new StopLossAbort(this.pendingAbort);
    }
    const record = await this.inner.runTrial(spec);
    this.seen.push(record);
    // checkStopLoss is O(n) but re-validates EVERY record's finiteness each
    // time; n here is the trial count (≤ a few hundred), so the simplicity
    // of one auditable function beats an incremental-sum micro-optimization
    // that would skip re-validation.
    const check = checkStopLoss(this.seen, this.budgetUsd);
    if (!check.ok) {
      this.pendingAbort = check;
    }
    return record;
  }
}

// ============================================================================
// runProve
// ============================================================================

export interface ProveResult {
  records: TrialRecord[];
  /** null when no analysis was possible (e.g. aborted before any trial). */
  analysis: OutcomeAnalysis | null;
  attestation: SignedAttestation | null;
  reportMd: string | null;
  ran: number;
  skipped: number;
  /** Non-null ⇒ the matrix stopped early; the reason is the label. */
  aborted: string | null;
  /** Feature ids the governed arm actually ran (persisted for promote). */
  governedFeatureIds: string[];
}

export interface RunProveOptions {
  paths: ProofPaths;
  trialsPerTask: number;
  budgetUsd: number;
  runner: TrialRunner;
  modelPins: string[];
  /** e.g. "fixture replay (dry-run)" or "live headless Claude Code". */
  executionMode: string;
  /** Feature ids promoted in the governed arm (outcome-bench GOVERNED_FLAGS). */
  governedFeatureIds: string[];
  now?: () => string;
}

export async function runProve(
  tasks: TaskManifest[],
  opts: RunProveOptions
): Promise<ProveResult> {
  const now = opts.now ?? (() => new Date().toISOString());
  const refused = (reason: string): ProveResult => ({
    records: [],
    analysis: null,
    attestation: null,
    reportMd: null,
    ran: 0,
    skipped: 0,
    aborted: reason,
    governedFeatureIds: opts.governedFeatureIds,
  });

  const preflight = checkProveBudget(tasks, opts.trialsPerTask, opts.budgetUsd);
  if (!preflight.ok) {
    return refused(`budget pre-flight refused: ${preflight.reason}`);
  }

  const config: MatrixConfig = {
    trialsPerTask: opts.trialsPerTask,
    arms: ARMS,
    logPath: opts.paths.trialLog,
  };
  // Resumed runs count prior spend against the same budget.
  const prior = loadTrialLog(opts.paths.trialLog);
  const guarded = new StopLossRunner(opts.runner, prior, opts.budgetUsd);

  let records: TrialRecord[] = [];
  let ran = 0;
  let skipped = 0;
  let aborted: string | null = null;
  try {
    const result = await runMatrix(tasks, config, guarded);
    records = result.records;
    ran = result.ran;
    skipped = result.skipped;
    if (guarded.pendingAbort) {
      aborted = `stop-loss: ${guarded.pendingAbort.reason}`;
    }
  } catch (e) {
    if (e instanceof StopLossAbort) {
      records = loadTrialLog(opts.paths.trialLog);
      ran = records.length - prior.length;
      aborted = `stop-loss: ${e.check.reason}`;
    } else {
      throw e;
    }
  }

  if (records.length === 0) {
    return refused(aborted ?? "no trials ran");
  }

  // An abort can strand a task with trials in only one arm; the paired
  // analysis correctly refuses such data. That refusal is an honest partial
  // result, not a crash: records stay on the log for resume.
  let analysis: OutcomeAnalysis;
  try {
    analysis = analyzeOutcomes(records, PRE_REGISTRATION);
  } catch (e) {
    return {
      records,
      analysis: null,
      attestation: null,
      reportMd: null,
      ran,
      skipped,
      aborted:
        (aborted ?? "analysis impossible") +
        ` — paired analysis unavailable: ${e instanceof Error ? e.message : String(e)}`,
      governedFeatureIds: opts.governedFeatureIds,
    };
  }
  const attestation = buildAttestation(analysis, overheadByTask(records), {
    issuedAt: now(),
  });
  const reportMd = renderReport(analysis, {
    title: aborted
      ? `repo-proof — paired outcome proof (ABORTED: ${aborted})`
      : "repo-proof — paired outcome proof",
    generatedAt: now(),
    modelPins: opts.modelPins,
    executionMode: opts.executionMode,
  });

  persistAtomic(opts.paths.analysis, JSON.stringify(analysis, null, 2) + "\n");
  persistAtomic(
    opts.paths.attestation,
    JSON.stringify(attestation, null, 2) + "\n"
  );
  persistAtomic(opts.paths.report, reportMd);
  persistAtomic(
    opts.paths.proveMeta,
    JSON.stringify(
      {
        governedFeatureIds: opts.governedFeatureIds,
        aborted,
        executionMode: opts.executionMode,
        modelPins: opts.modelPins,
        finishedAt: now(),
      },
      null,
      2
    ) + "\n"
  );

  return {
    records,
    analysis,
    attestation,
    reportMd,
    ran,
    skipped,
    aborted,
    governedFeatureIds: opts.governedFeatureIds,
  };
}

function overheadByTask(records: TrialRecord[]): Map<string, number> {
  const sums = new Map<string, { total: number; n: number }>();
  for (const r of records) {
    if (r.arm !== "governed") continue;
    const cell = sums.get(r.taskId) ?? { total: 0, n: 0 };
    cell.total += r.overheadTokens;
    cell.n += 1;
    sums.set(r.taskId, cell);
  }
  const out = new Map<string, number>();
  for (const [taskId, { total, n }] of sums) out.set(taskId, total / n);
  return out;
}

/** tmp + rename: a crash mid-write can never leave a torn artifact. */
export function persistAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

// ============================================================================
// Live runner composition (constructed only by the CLI; tests never spawn it)
// ============================================================================

export interface LiveRunnerOptions {
  repoRoot: string;
  /** Directory for per-trial workspaces/state/transcripts. */
  workDir: string;
  model: string;
  /** Injected hook-settings planner (computeHooksInstall from install.mjs). */
  installHooks: (
    existingSettings: unknown,
    opts: { hooksDir: string }
  ) => { settings: unknown };
  hooksDir: string;
  paths: ProofPaths;
  timeoutMs?: number;
  claudeBin?: string;
}

export function makeLiveRunner(opts: LiveRunnerOptions): TrialRunner {
  return new ClaudeCliRunner({
    workDir: opts.workDir,
    model: opts.model,
    timeoutMs: opts.timeoutMs,
    claudeBin: opts.claudeBin,
    prepareWorkspace: async (spec, trialDir) => {
      const task = spec.task;
      if (task.baseCommit === null) {
        throw new Error(`task ${task.taskId} is not pinned (draft?)`);
      }
      const worktreeDir = join(trialDir, "workspace");
      const created = execPlan(
        planCreateWorkspace({
          repoRoot: opts.repoRoot,
          worktreeDir,
          baseCommit: task.baseCommit,
        })
      );
      if (!created.ok) {
        throw new Error(
          `workspace creation failed: ${created.failure?.command} — ${created.failure?.stderr}`
        );
      }
      for (const cmd of task.setupCmds) {
        const r = runShellCmd(cmd, worktreeDir);
        if (!r.ok) {
          throw new Error(`setup failed [${cmd}]: ${r.failure?.stderr ?? ""}`);
        }
      }
      return worktreeDir;
    },
    prepareArm: async (spec, workspaceDir, trialDir) => {
      const stateDir = join(trialDir, "state");
      mkdirSync(stateDir, { recursive: true });
      const plan = planArmSetup({
        arm: spec.arm,
        worktreeDir: workspaceDir,
        stateDir,
      });
      for (const [path, content] of Object.entries(plan.files)) {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, content);
      }
      let overheadTokens = 0;
      let prompt = spec.task.prompt;
      if (spec.arm === "governed") {
        if (plan.settingsPath !== null) {
          const { settings } = opts.installHooks({}, { hooksDir: opts.hooksDir });
          mkdirSync(dirname(plan.settingsPath), { recursive: true });
          writeFileSync(plan.settingsPath, JSON.stringify(settings, null, 2));
        }
        const brief = await buildContextBrief(workspaceDir, spec.task.prompt);
        if (brief.eligible) {
          prompt = `${brief.text}\n\n${spec.task.prompt}`;
          overheadTokens = briefOverheadTokens(brief.text);
        }
        // Verbatim transparency artifact: the exact bytes injected, or the
        // reason none were.
        persistAtomic(
          join(opts.paths.briefsDir, `${spec.task.taskId}.md`),
          brief.eligible ? brief.text : `(no brief injected: ${brief.reason})\n`
        );
      }
      return { env: plan.env, prompt, overheadTokens };
    },
    runOracle: async (spec, workspaceDir) => {
      const task = spec.task;
      if (task.testRefCommit === null) return "fail";
      const result = gradeWorkspace({
        worktreeDir: workspaceDir,
        testRefCommit: task.testRefCommit,
        hiddenTestPaths: task.hiddenTestPaths,
        oracleCmd: task.oracleCmd,
        oracleCwd: task.oracleCwd,
      });
      return result.outcome;
    },
  });
}

/**
 * Tokens the governed arm's brief injection costs, for the attestation's
 * OVERHEAD side. Counted with the local tokenizer (gpt-tokenizer BPE — a
 * labeled local count, not a provider report) and then padded by 10%:
 * provider tokenizers differ, and the overhead side must only ever err
 * AGAINST the governance layer. Four-eyes finding: the previous chars/4
 * estimate could UNDER-count (signature-dense text runs below 4 chars per
 * token), flattering the SLO gate — the one direction this system promises
 * never to err in.
 */
export function briefOverheadTokens(briefText: string): number {
  return Math.ceil(countTokens(briefText).tokens * 1.1);
}
