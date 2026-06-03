/**
 * @prune/replay-cost — typed surface.
 *
 * The engine models a session as an ORDERED list of segments. A segment is the
 * smallest unit that can be byte-identical (or not) between two runs: a system
 * block, a user prompt, an assistant turn, or a tool exchange. The provider's
 * prompt cache keys on a byte-identical PREFIX, so the unit of reuse is "the
 * longest run of leading segments whose bytes match the original."
 *
 * Discipline (carried from the program mandate):
 *   - No regex anywhere.
 *   - No model call in the planner. Divergence + cost are pure functions of the
 *     caller-supplied token counts and canonical payloads. The actual tail
 *     re-execution is the CALLER's job (a model invoker), exactly mirroring the
 *     agent-sdk-adapter `ModelInvoker` boundary.
 *   - Token counts are caller-supplied (tokenizer-of-record). The engine never
 *     estimates a token count; when one is missing it is treated as 0 and the
 *     audit records it, but a number is never fabricated.
 *   - Deterministic: same timeline + mutation ⇒ same plan ⇒ same hash.
 */

import type { Provider } from "@prune/shared";

/** Role of a segment in the session. Drives whether output tokens apply. */
export type SegmentRole = "system" | "user" | "assistant" | "tool";

/**
 * A raw (un-hashed) segment as the caller assembles it from a transcript. The
 * `payload` is any JSON-canonicalizable value that fully determines the
 * segment's bytes on the wire — typically `{ role, content }` or a tool
 * exchange. Two segments are "the same" iff their canonical payloads are
 * byte-identical.
 */
export interface ReplaySegment {
  /** Stable position in the session, 0-based, ascending, contiguous. */
  index: number;
  role: SegmentRole;
  /** JSON-canonicalizable bytes-defining payload. */
  payload: unknown;
  /**
   * Input tokens attributable to this segment as it sits in the prefix.
   * Caller-tokenized. For an assistant segment this is the tokens its text
   * occupies when re-fed as context on the next turn.
   */
  tokensIn: number;
  /**
   * Output tokens this segment GENERATED. Non-zero only for assistant
   * segments (the tokens the model produced). 0 for system/user/tool.
   */
  tokensOut: number;
}

/**
 * A segment with its content hash and cumulative prefix hash computed. The
 * prefix hash chains over all prior segments so two timelines can be compared
 * in O(n) by walking the chain until the first content-hash mismatch.
 */
export interface HashedSegment extends ReplaySegment {
  /** SHA-256 hex over the RFC-8785 canonical form of `payload`. */
  contentHash: string;
  /**
   * SHA-256 hex over (prevPrefixHash || contentHash). The genesis segment's
   * prefix hash chains over the empty string. Equal prefix hashes at index i
   * prove segments 0..i are byte-identical between two timelines.
   */
  prefixHash: string;
}

/** A fully hashed, comparable session. */
export interface SessionTimeline {
  model: string;
  provider: Provider;
  segments: HashedSegment[];
  /** Convenience: the final segment's prefixHash, or the genesis hash if empty. */
  rootHash: string;
}

/**
 * A single-segment mutation — the atomic "what-if": change one prompt and
 * replay. The engine handles exactly this shape; multi-segment edits are
 * modeled as the EARLIEST changed index (everything downstream re-generates
 * regardless, so a single divergence point captures the cost).
 */
export interface SegmentMutation {
  /** Index of the segment being changed. Must be in range. */
  atIndex: number;
  /** The replacement payload. */
  newPayload: unknown;
  /**
   * New input-token count for the mutated segment. When omitted, the engine
   * reuses the original segment's `tokensIn` (documented in the audit as
   * `reusedOriginalTokens: true`) rather than fabricate a count.
   */
  newTokensIn?: number;
}

/** Result of comparing two timelines: where they first diverge. */
export interface DivergenceResult {
  /**
   * First segment index whose content hash differs. When the two timelines
   * are identical AND the same length, this is `null` (no divergence). When
   * one is a strict prefix of the other, it equals the shorter length.
   */
  divergenceIndex: number | null;
  /** Number of leading byte-identical segments (the shared cacheable prefix). */
  sharedSegmentCount: number;
  /** Sum of `tokensIn` over the shared prefix segments. */
  sharedPrefixTokensIn: number;
  /** Sum of `tokensIn` over the diverged tail (modified timeline). */
  divergedTailTokensIn: number;
  /** Sum of `tokensOut` over the diverged tail (modified timeline). */
  divergedTailTokensOut: number;
  /** The prefix hash at the last shared segment, "genesis" when none shared. */
  sharedPrefixHash: string;
}

/**
 * Cost breakdown for one what-if replay. All figures in USD. The pricing
 * basis is `@prune/shared` per-model rates; when the model is unpriced the
 * engine returns nulls rather than a fabricated number.
 */
export interface ReplayCostBreakdown {
  /** Cold re-run of the ENTIRE modified timeline at full input+output price. */
  naiveCostUsd: number | null;
  /**
   * Replay cost: shared prefix re-served at the cache-READ tier (input only,
   * no re-generation of its outputs) + diverged tail recomputed at full
   * input+output price.
   */
  replayCostUsd: number | null;
  /** naiveCostUsd − replayCostUsd. Null when either is null. */
  savedUsd: number | null;
  /** savedUsd / naiveCostUsd in [0,1]. Null when naive is null or zero. */
  savedRatio: number | null;
  /** Tokens served from cache (shared prefix input). */
  sharedPrefixTokensIn: number;
  /** Tokens recomputed (diverged tail input). */
  recomputedTokensIn: number;
  /** Tokens regenerated (diverged tail output). */
  recomputedTokensOut: number;
  /** Whether the model had a cache-read price tier; false ⇒ no prefix saving. */
  cacheReadTierAvailable: boolean;
}

/** The full plan produced for one mutation. */
export interface ReplayPlan {
  /** The modified timeline (shared prefix + mutated segment + original tail). */
  modified: SessionTimeline;
  divergence: DivergenceResult;
  cost: ReplayCostBreakdown;
  /** True when the mutation reused the original segment's token count. */
  reusedOriginalTokens: boolean;
}

/** Verdict from comparing original vs replayed final output. */
export type ChangeVerdict = "no_change" | "changed";

export interface OutputComparison {
  verdict: ChangeVerdict;
  /** True when @prune/equivalence judged the outputs equivalent. */
  equivalent: boolean;
  /** Graded similarity in [0,1]. */
  similarity: number;
  /** Which equivalence strategy fired (ast/text/coverage/byte). */
  strategy: string;
}
