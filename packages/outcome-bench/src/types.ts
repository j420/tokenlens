/**
 * Types for Benchmark v2 — Outcomes, Not Tokens.
 *
 * The claim under test: an agent completes the same coding tasks at the same
 * success rate with TokenLens governance, at materially lower provider-billed
 * token cost. Every type here exists to keep that claim honest:
 *
 *  - Task manifests are committed BEFORE any trial runs (pre-registration);
 *    oracles are machine-checkable commands, never human or LLM judgment.
 *  - Trial records carry provider-reported usage only — no tokenizer
 *    estimates — and `billedUsd` is null whenever pricing is unknown or
 *    incomplete (the repo-wide null-honesty discipline).
 *  - Records produced from canned fixtures are permanently marked
 *    `fixture: true` so dry-run output can never masquerade as real data.
 */

import { z } from "zod";

// ============================================================================
// Task manifests (pre-registered, one JSON file per task)
// ============================================================================

export const IntentClassSchema = z.enum([
  "debug",
  "generate",
  "refactor",
  "navigate",
]);
export type IntentClass = z.infer<typeof IntentClassSchema>;

/**
 * SWE-bench-style difficulty annotation: estimated time for an experienced
 * developer (SWE-bench Verified buckets). null = not yet annotated.
 */
export const DifficultySchema = z.enum([
  "<15min",
  "15min-1hr",
  "1-4hr",
  ">4hr",
]);
export type Difficulty = z.infer<typeof DifficultySchema>;

/**
 * A ready task pins every input needed to reproduce a trial. A draft task
 * (external corpus awaiting curation) may leave commits null — drafts are
 * never runnable and never fabricate a SHA.
 *
 * SWE-bench parity: the agent sees only `prompt` (issue-style symptom
 * description) and the workspace at `baseCommit`. `hiddenTestPaths` is the
 * FAIL_TO_PASS test patch — applied at GRADING time, never present while the
 * agent works. `oracleCmd` runs the involved packages' FULL suites, so the
 * pre-existing tests double as PASS_TO_PASS regression checks.
 */
export const TaskManifestSchema = z
  .object({
    taskId: z.string().min(1),
    track: z.enum(["self", "external"]),
    status: z.enum(["ready", "draft"]),
    /** null ⇒ this repository itself. */
    repoUrl: z.string().nullable(),
    /** Commit the workspace is created at (the broken state, typically C~1). */
    baseCommit: z.string().nullable(),
    /** Commit whose TEST files are applied at grading time (typically C). */
    testRefCommit: z.string().nullable(),
    /**
     * Repo-relative FAIL_TO_PASS test files from `testRefCommit`. Hidden from
     * the agent: applied (overwriting any agent edits to those paths) only
     * when the oracle is run.
     */
    hiddenTestPaths: z.array(z.string()),
    /** Commands run once in the fresh workspace before the agent starts. */
    setupCmds: z.array(z.string()),
    /**
     * The natural-language ask given to the agent, written like a GitHub
     * issue: observable symptoms / required behavior, never "make the
     * failing tests pass" and never the fix itself.
     */
    prompt: z.string().min(1),
    /** Machine-checkable success oracle, run with cwd = `oracleCwd`. */
    oracleCmd: z.string().min(1),
    /** Workspace-relative cwd for the oracle (e.g. the package dir). */
    oracleCwd: z.string().default("."),
    intentClass: IntentClassSchema,
    /** The known-achievable reference solution (commit C). */
    referenceCommit: z.string().nullable(),
    difficulty: DifficultySchema.nullable(),
    maxTurns: z.number().int().positive(),
    maxBudgetUsd: z.number().positive(),
    /**
     * True when the reference commit post-dates the pinned model's training
     * cutoff (contamination control; required for external tasks).
     */
    cutoffSafe: z.boolean(),
    notes: z.string().optional(),
  })
  .strict()
  .superRefine((m, ctx) => {
    if (m.status === "ready") {
      for (const field of [
        "baseCommit",
        "testRefCommit",
        "referenceCommit",
      ] as const) {
        if (m[field] === null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `ready task must pin ${field}`,
          });
        }
      }
    }
  });
export type TaskManifest = z.infer<typeof TaskManifestSchema>;

// ============================================================================
// Arms & trials
// ============================================================================

/** "naive" = agent alone; "governed" = agent + TokenLens hooks + context brief. */
export type ArmId = "naive" | "governed";
export const ARMS: readonly ArmId[] = ["naive", "governed"];

/** Provider-reported usage categories (Anthropic Messages API shape). */
export interface UsageBreakdown {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
}

export interface TrialSpec {
  task: TaskManifest;
  arm: ArmId;
  /** 0-based trial index within the task×arm cell. */
  trialIndex: number;
}

export interface TrialRecord {
  taskId: string;
  arm: ArmId;
  trialIndex: number;
  /** Model id from the transcript; null when the transcript carried none. */
  model: string | null;
  usage: UsageBreakdown;
  /** Sum of all four usage categories (always available, never estimated). */
  totalTokens: number;
  /**
   * USD at strict pricing. null when the model is unpriced, or cache reads
   * occurred without a known cached-input rate — never a fabricated rate.
   */
  billedUsd: number | null;
  /** True iff every component of `billedUsd` was actually priced. */
  costComplete: boolean;
  turns: number;
  wallTimeMs: number | null;
  oracle: "pass" | "fail";
  /**
   * Tokens the governance layer itself injected (advisory text, brief, hook
   * output). The overhead side of the WasteBench ledger; 0 for the naive arm.
   */
  overheadTokens: number;
  transcriptPath: string;
  startedAt: string;
  finishedAt: string;
  /** Permanently marks records replayed from canned fixtures (dry-run). */
  fixture: boolean;
}

// ============================================================================
// Matrix configuration
// ============================================================================

export interface MatrixConfig {
  /** K — trials per task per arm. Pre-registered default: 3. */
  trialsPerTask: number;
  arms: readonly ArmId[];
  /** Append-only JSONL trial log; completed trials are skipped on re-run. */
  logPath: string;
}

/** Pre-registered analysis parameters (committed before any real trial). */
export interface PreRegistration {
  /** NI screening margin on success-rate difference (absolute). */
  niMargin: number;
  alpha: number;
  trialsPerTask: number;
  /** Description of the primary endpoint. */
  primaryEndpoint: string;
  secondaryEndpoint: string;
}

export const PRE_REGISTRATION: PreRegistration = {
  niMargin: 0.1,
  alpha: 0.05,
  trialsPerTask: 3,
  primaryEndpoint:
    "paired per-task token-cost reduction (Wilcoxon signed-rank, one-sided, naive − governed > 0)",
  secondaryEndpoint:
    "success-rate non-inferiority of the governed arm at a 10pp screening margin, plus McNemar on paired per-task majority outcomes",
};
