/**
 * Segment hashing + timeline construction.
 *
 * Reuses the exact canonicalization + digest primitives the compliance vault
 * already ships (`@prune/replay-vault`): RFC-8785 JCS canonical JSON and
 * SHA-256. That guarantees a segment hashed here matches a segment the vault
 * sealed for the same logical payload — the two engines agree on "same bytes."
 *
 * The prefix-hash chain is the load-bearing structure: equal prefix hashes at
 * index i is a SOUND proof that segments 0..i are byte-identical between two
 * timelines, which is exactly the condition the provider's prompt cache
 * requires for a cache hit. We never approximate this with a similarity score.
 */

import { canonicalize, sha256Hex } from "@prune/replay-vault";

import type {
  HashedSegment,
  ReplaySegment,
  SessionTimeline,
} from "./types.js";
import type { Provider } from "@prune/shared";

/** Genesis prefix hash — SHA-256 of the empty string. Stable, well-known. */
export const GENESIS_HASH = sha256Hex("");

/** Content hash of a single segment's canonical payload. Pure. */
export function segmentContentHash(payload: unknown): string {
  return sha256Hex(canonicalize(payload));
}

/**
 * Chain step: prefixHash_i = SHA-256(prefixHash_{i-1} || contentHash_i).
 * The genesis predecessor is GENESIS_HASH so an empty timeline has a defined
 * root and a one-segment timeline's prefix hash is reproducible.
 */
export function chainPrefixHash(prevPrefixHash: string, contentHash: string): string {
  return sha256Hex(prevPrefixHash + contentHash);
}

export interface BuildTimelineInput {
  model: string;
  provider: Provider;
  segments: ReplaySegment[];
}

/**
 * Build a fully hashed, comparable timeline from raw segments. Validates that
 * indices are contiguous and ascending from 0 — a gap or reorder would make
 * the prefix-chain comparison meaningless, so we fail loudly rather than
 * silently produce a misleading divergence.
 */
export function buildTimeline(input: BuildTimelineInput): SessionTimeline {
  const hashed: HashedSegment[] = [];
  let prev = GENESIS_HASH;
  for (let i = 0; i < input.segments.length; i++) {
    const seg = input.segments[i]!;
    if (seg.index !== i) {
      throw new Error(
        `replay-cost: non-contiguous segment index at position ${i} ` +
          `(segment declares index ${seg.index}). Segments must be 0-based, ` +
          `ascending, and contiguous.`
      );
    }
    if (!Number.isFinite(seg.tokensIn) || seg.tokensIn < 0) {
      throw new Error(
        `replay-cost: segment ${i} has invalid tokensIn ${seg.tokensIn}. ` +
          `Token counts must be finite and non-negative (caller-tokenized).`
      );
    }
    if (!Number.isFinite(seg.tokensOut) || seg.tokensOut < 0) {
      throw new Error(
        `replay-cost: segment ${i} has invalid tokensOut ${seg.tokensOut}.`
      );
    }
    const contentHash = segmentContentHash(seg.payload);
    const prefixHash = chainPrefixHash(prev, contentHash);
    hashed.push({ ...seg, contentHash, prefixHash });
    prev = prefixHash;
  }
  return {
    model: input.model,
    provider: input.provider,
    segments: hashed,
    rootHash: prev,
  };
}

/**
 * Re-hash a timeline after a structural change (used internally by
 * applyMutation). Drops the existing hashes and recomputes the chain so a
 * mutated tail can never carry a stale hash.
 */
export function rehash(timeline: SessionTimeline): SessionTimeline {
  return buildTimeline({
    model: timeline.model,
    provider: timeline.provider,
    segments: timeline.segments.map((s) => ({
      index: s.index,
      role: s.role,
      payload: s.payload,
      tokensIn: s.tokensIn,
      tokensOut: s.tokensOut,
    })),
  });
}
