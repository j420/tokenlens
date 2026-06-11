/**
 * Types for f20 repo-proof — evidence-gated, repo-local outcome proof.
 *
 * Every type here exists to make a specific dishonesty UNREPRESENTABLE:
 *
 *  - `CandidateCommit` is deliberately NOT a TaskManifest: it has no `prompt`
 *    field, so a machine-fabricated task prompt cannot exist. Mining emits
 *    candidates; a human writes the issue-style prompt.
 *  - `ThreeStateVerdict` separates "fail" (the oracle ran and said no) from
 *    "error" (infrastructure broke). An `error` in any state invalidates the
 *    task — a broken setup can never be laundered into a verdict.
 *  - `PromotionRecord` persists the gate decision on PASS and on FAIL, so an
 *    honest no-op leaves the same audit trail as a promotion.
 */

import { z } from "zod";

// ============================================================================
// Mining candidates (curation raw material — never runnable as-is)
// ============================================================================

/**
 * A commit proposed by mining as task raw material. `subject`/`body` are the
 * original commit message, attached so the human curator can write an
 * issue-style prompt from the real history — the schema cannot hold a prompt.
 */
export const CandidateCommitSchema = z
  .object({
    /** The reference commit C (full SHA) — the known-achievable solution. */
    commit: z.string().min(7),
    /** C~1 (full SHA), resolved by mining — the broken state a task starts at. */
    suggestedBaseCommit: z.string().min(7),
    /** Author date of C, ISO `YYYY-MM-DD`. */
    date: z.string().min(1),
    subject: z.string(),
    body: z.string(),
    /** Directory group the impl+tests share (e.g. "packages/foo" or "src"). */
    group: z.string().min(1),
    implFiles: z.array(z.string()).min(1),
    testFiles: z.array(z.string()).min(1),
    /** Workspace-relative oracle cwd suggestion (the group dir). */
    suggestedOracleCwd: z.string().min(1),
    /**
     * Oracle command suggestion — present ONLY when the caller supplied an
     * oracle template. null means "we do not know this repo's test runner and
     * will not guess"; the curator supplies it.
     */
    suggestedOracleCmd: z.string().nullable(),
  })
  .strict();
export type CandidateCommit = z.infer<typeof CandidateCommitSchema>;

/** Per-directory-group mining coverage: where the repo can (and cannot) prove. */
export const CoverageRowSchema = z
  .object({
    group: z.string().min(1),
    /** Non-merge commits in the scan window that touched this group. */
    commitsScanned: z.number().int().nonnegative(),
    /** Commits that qualified as candidates (impl+tests in the same group). */
    candidates: z.number().int().nonnegative(),
  })
  .strict();
export type CoverageRow = z.infer<typeof CoverageRowSchema>;

// ============================================================================
// Three-state verification
// ============================================================================

/**
 * Outcome of one verification state. "error" is an infrastructure failure
 * (worktree/setup broke before the oracle could speak) and is never coerced
 * into a pass/fail verdict.
 */
export const StateOutcomeSchema = z.enum(["pass", "fail", "error"]);
export type StateOutcome = z.infer<typeof StateOutcomeSchema>;

/**
 * The three-state protocol result for one task:
 *   S1 — base commit, untouched: oracle must PASS (healthy PASS_TO_PASS
 *        baseline; the agent starts from green).
 *   S2 — base + hidden tests:    oracle must FAIL (FAIL_TO_PASS is real work).
 *   S3 — reference + hidden:     oracle must PASS (the solution is achievable).
 *
 * `valid` is definitional: s1==="pass" && s2==="fail" && s3==="pass".
 * Anything else — including any "error" — is invalid, and invalid tasks are
 * dropped, never patched into passing.
 */
export const ThreeStateVerdictSchema = z
  .object({
    taskId: z.string().min(1),
    s1: StateOutcomeSchema,
    s2: StateOutcomeSchema,
    s3: StateOutcomeSchema,
    valid: z.boolean(),
    checkedAt: z.string().min(1),
    /** Human-readable detail for every state that did not meet expectation. */
    failures: z.array(
      z
        .object({
          state: z.enum(["S1", "S2", "S3"]),
          detail: z.string(),
        })
        .strict()
    ),
  })
  .strict()
  .superRefine((v, ctx) => {
    const expected = v.s1 === "pass" && v.s2 === "fail" && v.s3 === "pass";
    if (v.valid !== expected) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["valid"],
        message: `valid must equal (s1=pass ∧ s2=fail ∧ s3=pass); got s1=${v.s1} s2=${v.s2} s3=${v.s3}`,
      });
    }
  });
export type ThreeStateVerdict = z.infer<typeof ThreeStateVerdictSchema>;

// ============================================================================
// Promotion gate
// ============================================================================

export const GateCheckIdSchema = z.enum([
  "realData",
  "savingsSignificant",
  "niScreeningPass",
  "attestationValid",
  "overheadSloPass",
]);
export type GateCheckId = z.infer<typeof GateCheckIdSchema>;

export const GateCheckSchema = z
  .object({
    id: GateCheckIdSchema,
    pass: z.boolean(),
    detail: z.string(),
  })
  .strict();
export type GateCheck = z.infer<typeof GateCheckSchema>;

/**
 * The full gate decision. All five checks are ALWAYS present — the gate never
 * short-circuits, so a failed promotion reports the complete picture.
 */
export const PromoteGateDecisionSchema = z
  .object({
    pass: z.boolean(),
    checks: z.array(GateCheckSchema).length(5),
    /** sha256 (hex) over the attestation's exact signed canonical bytes. */
    attestationSha256: z.string().length(64),
    medianSavingsPct: z.number().nullable(),
    decidedAt: z.string().min(1),
  })
  .strict()
  .superRefine((d, ctx) => {
    const allPass = d.checks.every((c) => c.pass);
    if (d.pass !== allPass) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pass"],
        message: "pass must equal the conjunction of all checks",
      });
    }
  });
export type PromoteGateDecision = z.infer<typeof PromoteGateDecisionSchema>;

/**
 * Persisted to promotion.json on EVERY promote invocation — pass or fail —
 * so the audit trail includes honest no-ops.
 */
export const PromotionRecordSchema = z
  .object({
    decision: PromoteGateDecisionSchema,
    /** Feature ids promoted (empty when the gate failed). */
    flagsPromoted: z.array(z.string()),
    /** Files actually written (empty when the gate failed except this record). */
    filesWritten: z.array(z.string()),
  })
  .strict();
export type PromotionRecord = z.infer<typeof PromotionRecordSchema>;
