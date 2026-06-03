/**
 * N2 — Delta Cache-Resend analysis.
 *
 * Across two turns, the cacheable prefix (system blocks then tool schemas) can
 * change by a single early block — a timestamp baked into the system prompt, a
 * tool appended to the catalog. A naive layout lets that one change BUST the
 * whole prefix: every downstream byte re-writes at the cache-write multiplier.
 * But the provider's cache matches the longest byte-identical LEADING run, so a
 * better layout salvages everything up to the first real change.
 *
 * This module computes, from the previous and next prefix block lists:
 *   - the SURVIVING leading run (longest common prefix by content hash) — the
 *     part that re-serves at the 0.10× read tier instead of re-writing;
 *   - the cost of delta-resend (surviving read + diverged-tail write) vs a full
 *     bust (whole prefix re-written), and the realizable saving;
 *   - a POISON diagnosis: when a small in-place change at index k strands a
 *     large stable run AFTER it (blocks that are byte-identical to last turn but
 *     can't be cached because the change in front of them moved the match
 *     boundary), it recommends moving the volatile block past the breakpoint so
 *     the stranded run rejoins the cacheable prefix.
 *
 * Honesty rules:
 *   - The surviving run only earns the read tier if it clears the model's
 *     minimum cacheable prefix. Below that, there is no realizable saving and
 *     `savedUsd` is 0 (the surviving run rewrites too); we never report a
 *     saving the provider wouldn't grant.
 *   - Token counts and content hashes are CALLER-supplied (tokenizer + a stable
 *     hash such as SHA-256 or the FNV `prefixFingerprint`). Nothing is sniffed.
 *   - Block alignment is positional: the diagnosis compares next[i] to
 *     previous[i]. An in-place edit (the case this targets) keeps positions; an
 *     insert/delete shifts them, under which stranded detection UNDER-reports
 *     rather than over-claims. Documented, conservative.
 *   - Unpriced model ⇒ null USD, but the full token movement is always present.
 *
 * Pure logic; no I/O, no model call.
 */

import { FLAT_PRICING, type ModelPricing } from "@prune/shared";

import { minCacheableForModel } from "./cache-planner.js";
import {
  READ_MULTIPLIER,
  WRITE_MULTIPLIER_1H,
  WRITE_MULTIPLIER_5M,
} from "./ttl-amortization.js";

/**
 * One block of the cacheable prefix. `contentHash` is the caller's stable hash
 * of the block's bytes — two blocks are "the same" iff their hashes match.
 */
export interface PrefixBlock {
  segment: "system" | "tools";
  /** Index within its segment (informational; alignment uses array position). */
  blockIndex: number;
  contentHash: string;
  tokens: number;
}

export interface DeltaResendInput {
  model: string;
  ttl: "5m" | "1h";
  /** Previous turn's ordered prefix blocks (system… then tools…). */
  previous: readonly PrefixBlock[];
  /** This turn's ordered prefix blocks, same ordering convention. */
  next: readonly PrefixBlock[];
}

export interface PoisonDiagnosis {
  /** A small in-place change strands a downstream stable run. */
  detected: boolean;
  /** Tokens of stable content stranded after the first in-place divergence. */
  strandedStableTokens: number;
  /** Number of stranded stable blocks. */
  strandedStableBlocks: number;
  /** Caller-actionable remediation, or null when nothing is stranded. */
  suggestion: string | null;
}

export interface DeltaResendResult {
  /** Blocks in the surviving (byte-identical) leading run of the NEXT prefix. */
  survivingBlockCount: number;
  /** Tokens in the surviving run (read-tier eligible if cacheable). */
  survivingTokens: number;
  /** Blocks of the NEXT prefix that must re-write. */
  rewrittenBlockCount: number;
  /** Tokens that must re-write at the cache-write multiplier. */
  rewrittenTokens: number;
  /**
   * Index of the first diverging block. `null` when the next prefix is a
   * (possibly equal-length) prefix of the previous one — nothing diverged.
   * Equals the overlap length when the only change is appended blocks.
   */
  firstDivergedIndex: number | null;
  /** The model's minimum cacheable prefix in tokens. */
  minCacheableTokens: number;
  /** Does the surviving run clear the minimum cacheable prefix? */
  survivingPrefixIsCacheable: boolean;
  /** Cost to re-write the ENTIRE next prefix (the naive bust). Null if unpriced. */
  fullBustCostUsd: number | null;
  /** Cost of delta-resend (surviving read + diverged write), or the bust cost
   *  when the surviving run is too small to cache. Null if unpriced. */
  deltaResendCostUsd: number | null;
  /** Realizable saving: fullBust − deltaResend. 0 when not cacheable. Null if unpriced. */
  savedUsd: number | null;
  /** savedUsd / fullBustCostUsd in [0,1]. Null when unpriced or full bust is 0. */
  savedRatio: number | null;
  poison: PoisonDiagnosis;
}

function writeMultiplier(ttl: "5m" | "1h"): number {
  return ttl === "1h" ? WRITE_MULTIPLIER_1H : WRITE_MULTIPLIER_5M;
}

function strictPricing(model: string): ModelPricing | null {
  return FLAT_PRICING[model] ?? null;
}

function sumTokens(blocks: readonly PrefixBlock[], from: number, to: number): number {
  let t = 0;
  for (let i = from; i < to; i++) t += Math.max(0, blocks[i]!.tokens);
  return t;
}

export function analyzeDeltaResend(input: DeltaResendInput): DeltaResendResult {
  const prev = input.previous;
  const next = input.next;
  const minLen = Math.min(prev.length, next.length);

  // First positional divergence over the overlap.
  let firstDiverged = -1;
  for (let i = 0; i < minLen; i++) {
    if (prev[i]!.contentHash !== next[i]!.contentHash) {
      firstDiverged = i;
      break;
    }
  }

  // Resolve firstDivergedIndex per the documented cases.
  let firstDivergedIndex: number | null;
  if (firstDiverged !== -1) {
    firstDivergedIndex = firstDiverged; // in-place change
  } else if (next.length > prev.length) {
    firstDivergedIndex = prev.length; // identical overlap + appended blocks
  } else {
    firstDivergedIndex = null; // next is a (≤-length) prefix of previous
  }

  const survivingBlockCount =
    firstDivergedIndex === null ? next.length : firstDivergedIndex;
  const survivingTokens = sumTokens(next, 0, survivingBlockCount);
  const rewrittenBlockCount = next.length - survivingBlockCount;
  const rewrittenTokens = sumTokens(next, survivingBlockCount, next.length);

  const minCacheableTokens = minCacheableForModel(input.model);
  const survivingPrefixIsCacheable = survivingTokens >= minCacheableTokens;

  // Poison diagnosis: only meaningful for an IN-PLACE divergence (not a pure
  // append). Count later blocks that stayed byte-identical at the same index.
  let strandedStableTokens = 0;
  let strandedStableBlocks = 0;
  if (firstDiverged !== -1) {
    for (let i = firstDiverged + 1; i < minLen; i++) {
      if (prev[i]!.contentHash === next[i]!.contentHash) {
        strandedStableTokens += Math.max(0, next[i]!.tokens);
        strandedStableBlocks++;
      }
    }
  }
  const poison: PoisonDiagnosis = buildPoison(
    firstDiverged,
    next,
    strandedStableBlocks,
    strandedStableTokens,
    survivingTokens,
    minCacheableTokens
  );

  // Economics.
  const pricing = strictPricing(input.model);
  let fullBustCostUsd: number | null = null;
  let deltaResendCostUsd: number | null = null;
  let savedUsd: number | null = null;
  let savedRatio: number | null = null;

  if (pricing && typeof pricing.input === "number") {
    const w = writeMultiplier(input.ttl);
    const unit = pricing.input / 1_000_000;
    const totalPrefixTokens = survivingTokens + rewrittenTokens;
    fullBustCostUsd = totalPrefixTokens * w * unit;
    if (survivingPrefixIsCacheable) {
      deltaResendCostUsd =
        survivingTokens * READ_MULTIPLIER * unit + rewrittenTokens * w * unit;
      savedUsd = survivingTokens * (w - READ_MULTIPLIER) * unit;
    } else {
      // Surviving run too small to anchor a breakpoint → it rewrites too.
      deltaResendCostUsd = fullBustCostUsd;
      savedUsd = 0;
    }
    savedRatio = fullBustCostUsd > 0 ? savedUsd / fullBustCostUsd : null;
  }

  return {
    survivingBlockCount,
    survivingTokens,
    rewrittenBlockCount,
    rewrittenTokens,
    firstDivergedIndex,
    minCacheableTokens,
    survivingPrefixIsCacheable,
    fullBustCostUsd,
    deltaResendCostUsd,
    savedUsd,
    savedRatio,
    poison,
  };
}

function buildPoison(
  firstDiverged: number,
  next: readonly PrefixBlock[],
  strandedStableBlocks: number,
  strandedStableTokens: number,
  survivingTokens: number,
  minCacheableTokens: number
): PoisonDiagnosis {
  if (firstDiverged === -1 || strandedStableTokens === 0) {
    return {
      detected: false,
      strandedStableTokens: 0,
      strandedStableBlocks: 0,
      suggestion: null,
    };
  }
  const changed = next[firstDiverged]!;
  const rejoined = survivingTokens + strandedStableTokens;
  const clears = rejoined >= minCacheableTokens ? "clears" : "still below";
  const suggestion =
    `The ${changed.segment} block at position ${firstDiverged} ` +
    `(blockIndex ${changed.blockIndex}, ${changed.tokens} tokens) changed in place, ` +
    `stranding ${strandedStableBlocks} later stable block(s) (${strandedStableTokens} tokens) ` +
    `that are byte-identical to last turn. Move the volatile block after the cache ` +
    `breakpoint (into the volatile region) so the ${rejoined}-token stable run rejoins one ` +
    `cacheable prefix — which ${clears} the ${minCacheableTokens}-token minimum.`;
  return {
    detected: true,
    strandedStableTokens,
    strandedStableBlocks,
    suggestion,
  };
}
