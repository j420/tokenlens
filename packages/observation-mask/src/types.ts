/**
 * Types for the Observation-Masking planner (F15).
 *
 * The planner consumes a transcript's observation buffer (the tool-result
 * blocks that accumulate over a long agent session) and returns a deterministic
 * plan for which to replace with a short placeholder. It never mutates the
 * transcript itself — it produces a plan a control plane (or the agent, via the
 * MCP tool) applies. The win is structural: retained observation tokens become
 * bounded by the window instead of growing with the whole trajectory.
 */

/**
 * One observation in the buffer. `tokens` is a measured count supplied by the
 * caller (this package never tokenizes, so it never fabricates a number).
 * `contentHash` makes masking reversible and lets the plan be idempotent across
 * turns. `nextUseTurn` is optional foresight (known only in offline replay);
 * when present it enables true Belady eviction, otherwise the planner falls
 * back to recency (LRU).
 */
export interface Observation {
  id: string;
  /** The turn index at which this observation entered the context. */
  turn: number;
  /** Measured token cost of the observation's content (>= 0). */
  tokens: number;
  /** Stable content hash, used for reversibility and idempotent re-planning. */
  contentHash: string;
  /** When true, never mask (a pinned decision, the active diff, etc.). */
  pinned?: boolean;
  /**
   * The next turn at which this observation is referenced again, if known.
   * Only available offline (replay). null/undefined ⇒ unknown ⇒ LRU fallback.
   */
  nextUseTurn?: number | null;
}

export interface MaskConfig {
  /** The current (latest) turn number. */
  currentTurn: number;
  /** Keep observations within this many turns of `currentTurn` unmasked. */
  windowTurns: number;
  /**
   * Token cost of the placeholder string itself. Subtracted from an
   * observation's tokens to get the reclaimed amount. Defaults to a conservative
   * constant; pass a tokenizer-measured value for exactness.
   */
  placeholderTokens?: number;
  /**
   * Optional hard cap on total retained (unmasked) observation tokens. When the
   * windowed retention still exceeds this, the planner evicts additional
   * observations in Belady order until retention is under budget.
   */
  tokenBudget?: number | null;
  /**
   * Ids already masked in a prior turn. They stay masked (monotone masking),
   * which keeps the masked prefix stable so the prompt cache below it survives.
   */
  previouslyMaskedIds?: readonly string[];
}

export type MaskReason = "stale" | "budget" | "carried";

export interface MaskedObservation {
  id: string;
  reason: MaskReason;
  /** max(0, tokens - placeholderTokens). */
  reclaimedTokens: number;
  /** The deterministic placeholder that replaces the observation's content. */
  placeholder: string;
}

export interface MaskPlan {
  masked: MaskedObservation[];
  /** Sum of tokens for observations that remain unmasked. */
  retainedTokens: number;
  /** Sum of reclaimedTokens across the masked set. */
  reclaimedTokens: number;
  /** Total observation tokens before masking (retained + original-of-masked). */
  totalTokens: number;
}
