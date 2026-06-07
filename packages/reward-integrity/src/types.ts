/**
 * Shared types for the Reward-Integrity Interlock (F14).
 *
 * The interlock answers one question about a proposed file write: *does this
 * edit weaken the success signal the agent is being graded against?* It never
 * judges whether the code is correct — only whether the test/grader surface is
 * being degraded in a way that would let a failing change report success.
 */

/**
 * Verdict severity. `inconclusive` is the fail-safe value: returned whenever we
 * cannot parse the code or cannot reason structurally about it. It is NEVER an
 * accusation — callers treat it exactly like `ok` for gating, and only surface
 * it in diagnostics. The one error this interlock must never make is a false
 * `violation`, so every uncertain path collapses to `inconclusive`.
 */
export type Severity = "ok" | "suspicious" | "violation" | "inconclusive";

/** Script flavour, derived deterministically from the file extension. */
export type ScriptKind = "ts" | "tsx" | "js" | "jsx";

/**
 * A structural census of the assertion surface of a single source file. Counts
 * are produced by a consistent AST walk, so the same rule applied to the
 * before/after of an edit yields comparable deltas (the absolute count need not
 * equal a human's intuitive "number of assertions" — only the rule's
 * self-consistency matters for the verdict).
 */
export interface AssertionInventory {
  /** False when the source had syntax errors; callers must not trust deltas. */
  parsed: boolean;
  /** Matcher/assert call expressions (`expect(x).toBe(y)`, `assert.equal(...)`). */
  assertions: number;
  /** Tests disabled via `.skip` / `xit` / `xdescribe` / `it.skip` etc. */
  skippedTests: number;
  /** Tests narrowed via `.only` / `fit` / `fdescribe` (hides sibling failures). */
  focusedTests: number;
  /**
   * Assertions that are structurally tautological — provably true regardless of
   * the code under test (`expect(true).toBe(true)`, `expect(1).toBe(1)`,
   * `assert(true)`). Only clear, sound tautologies are counted.
   */
  tautologies: number;
  /** Expectations that a call throws / rejects (`toThrow`, `rejects`, `assert.throws`). */
  throwExpectations: number;
}

/** A single, named reason contributing to a verdict. */
export interface IntegrityFinding {
  /** Stable machine code, e.g. `assertions_removed`, `test_disabled`. */
  code: string;
  severity: Severity;
  /** Human-readable explanation with the concrete delta. */
  message: string;
}

/** The result of comparing the assertion surface before and after an edit. */
export interface IntegrityVerdict {
  severity: Severity;
  findings: IntegrityFinding[];
  /** Null when there was no prior content (file creation). */
  before: AssertionInventory | null;
  after: AssertionInventory;
}

/**
 * A proposed write as a Claude Code hook would describe it. `before` is the
 * on-disk content (null on create); `after` is the proposed content (null on
 * delete). The interlock derives everything else from these two strings plus
 * the path — it never reads the filesystem itself.
 */
export interface ProposedWrite {
  path: string;
  before: string | null;
  after: string | null;
}

/**
 * Caller-supplied policy. `graderPaths` is an explicit allowlist of files the
 * agent must never write (a grader, an oracle, a frozen golden file). Matching
 * is deterministic path-suffix matching — NOT regex. `extraTestSuffixes` lets a
 * repo declare non-standard test file conventions.
 */
export interface RewardIntegrityConfig {
  graderPaths?: readonly string[];
  extraTestSuffixes?: readonly string[];
}

/** Top-level report for one proposed write. */
export interface RewardIntegrityReport {
  path: string;
  isTestFile: boolean;
  isGrader: boolean;
  /** Null when the path is neither a test file nor a grader (nothing to judge). */
  verdict: IntegrityVerdict | null;
  /** The rolled-up severity across the verdict and the grader-write check. */
  severity: Severity;
  findings: IntegrityFinding[];
}
