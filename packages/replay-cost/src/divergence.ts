/**
 * Divergence detection — the soundness core.
 *
 * Given an original timeline and a modified one, find the first segment index
 * whose content hash differs. Everything strictly before that index is the
 * shared, byte-identical, cacheable prefix. This is a pure O(n) walk over the
 * pre-computed content hashes; no similarity, no heuristic, no model call.
 *
 * Three cases, each handled explicitly:
 *   1. A content hash differs at index k          → divergenceIndex = k
 *   2. One timeline is a strict prefix of the other → divergenceIndex = shorter length
 *      (the longer one has "extra" segments the shorter lacks; those are the tail)
 *   3. Identical length AND all hashes match        → divergenceIndex = null
 */

import type { DivergenceResult, SessionTimeline } from "./types.js";
import { GENESIS_HASH } from "./segment.js";

export function computeDivergence(
  original: SessionTimeline,
  modified: SessionTimeline
): DivergenceResult {
  const a = original.segments;
  const b = modified.segments;
  const minLen = Math.min(a.length, b.length);

  let divergenceIndex: number | null = null;
  for (let i = 0; i < minLen; i++) {
    if (a[i]!.contentHash !== b[i]!.contentHash) {
      divergenceIndex = i;
      break;
    }
  }
  if (divergenceIndex === null && a.length !== b.length) {
    // One is a strict prefix of the other — divergence is at the boundary.
    divergenceIndex = minLen;
  }

  const sharedSegmentCount = divergenceIndex === null ? a.length : divergenceIndex;

  // Shared prefix tokens come from the MODIFIED timeline (identical to original
  // over the shared region by construction, but we read from modified so the
  // figure matches what will actually be sent on replay).
  let sharedPrefixTokensIn = 0;
  for (let i = 0; i < sharedSegmentCount; i++) {
    sharedPrefixTokensIn += b[i]!.tokensIn;
  }

  // Diverged tail is everything from the divergence point onward in the
  // MODIFIED timeline — that's what must be recomputed.
  let divergedTailTokensIn = 0;
  let divergedTailTokensOut = 0;
  for (let i = sharedSegmentCount; i < b.length; i++) {
    divergedTailTokensIn += b[i]!.tokensIn;
    divergedTailTokensOut += b[i]!.tokensOut;
  }

  const sharedPrefixHash =
    sharedSegmentCount === 0
      ? GENESIS_HASH
      : b[sharedSegmentCount - 1]!.prefixHash;

  return {
    divergenceIndex,
    sharedSegmentCount,
    sharedPrefixTokensIn,
    divergedTailTokensIn,
    divergedTailTokensOut,
    sharedPrefixHash,
  };
}

/**
 * Convenience predicate: are two timelines byte-identical end to end?
 * True iff there is no divergence and the lengths match.
 */
export function timelinesIdentical(
  original: SessionTimeline,
  modified: SessionTimeline
): boolean {
  return (
    original.segments.length === modified.segments.length &&
    computeDivergence(original, modified).divergenceIndex === null
  );
}
