/**
 * Replay cost model.
 *
 * The dollar story, stated precisely so a skeptical reviewer can re-derive it:
 *
 *   A prompt-engineering loop today: edit one prompt, re-run the whole session
 *   cold. Each iteration pays FULL input price on every input token plus output
 *   price on every regenerated token. Over N iterations that's N × full cost.
 *
 *   With deterministic replay: segments before the divergence point are
 *   byte-identical to a run we already have. We re-serve them at the cache-READ
 *   tier (≈0.10–0.125× input, model-dependent — `@prune/shared` cached_input)
 *   and we DO NOT regenerate their outputs (they're known). Only the diverged
 *   tail is recomputed at full input+output price.
 *
 *   naiveCost   = Σ_all ( tokensIn·input + tokensOut·output ) / 1e6
 *   replayCost  = Σ_shared ( tokensIn·cached_input ) / 1e6
 *               + Σ_tail   ( tokensIn·input + tokensOut·output ) / 1e6
 *   saved       = naiveCost − replayCost
 *               = Σ_shared ( tokensIn·(input − cached_input) + tokensOut·output ) / 1e6
 *
 *   The saving grows with the shared-prefix size: when you change only the last
 *   prompt, nearly the whole session is shared, so saved/naive → high. That is
 *   the "~85% reduction on the experimentation surface" claim, and it falls
 *   directly out of the algebra above — no hand-tuned constant.
 *
 * Honesty rules:
 *   - When the model has NO cache-read tier in pricing, the shared prefix is
 *     billed at full input price (no prefix saving). We set
 *     `cacheReadTierAvailable = false` and the saving collapses to the skipped
 *     OUTPUT regeneration only. We never pretend a read tier exists.
 *   - When the model is entirely unpriced, every USD figure is `null`. The
 *     token-movement figures (shared/recomputed) are always populated so the
 *     caller still gets the structural picture.
 */

import { FLAT_PRICING, type ModelPricing } from "@prune/shared";

import type {
  DivergenceResult,
  ReplayCostBreakdown,
  SessionTimeline,
} from "./types.js";

/**
 * Strict pricing lookup — null for unknown models. We check FLAT_PRICING
 * membership directly rather than `getModelPricingByName`, which silently
 * substitutes DEFAULT_PRICING for unknowns. The engine must return null
 * (and surface "unpriced") rather than bill an unknown model at a fabricated
 * default rate.
 */
function strictPricing(model: string): ModelPricing | null {
  return FLAT_PRICING[model] ?? null;
}

/**
 * Compute the replay cost breakdown for a modified timeline given the
 * divergence against the original. Pure.
 *
 * `modified` supplies the canonical token movement; `divergence` supplies the
 * shared/tail split. We recompute the tail sums from `divergence` (which read
 * them from the modified timeline) so the two are always consistent.
 */
export function computeReplayCost(
  modified: SessionTimeline,
  divergence: DivergenceResult
): ReplayCostBreakdown {
  const pricing = strictPricing(modified.model);

  const sharedTokensIn = divergence.sharedPrefixTokensIn;
  const tailTokensIn = divergence.divergedTailTokensIn;
  const tailTokensOut = divergence.divergedTailTokensOut;

  // Total figures for the naive baseline = shared + tail across the whole
  // modified timeline.
  let allTokensIn = 0;
  let allTokensOut = 0;
  for (const s of modified.segments) {
    allTokensIn += s.tokensIn;
    allTokensOut += s.tokensOut;
  }

  if (pricing === null) {
    return {
      naiveCostUsd: null,
      replayCostUsd: null,
      savedUsd: null,
      savedRatio: null,
      sharedPrefixTokensIn: sharedTokensIn,
      recomputedTokensIn: tailTokensIn,
      recomputedTokensOut: tailTokensOut,
      cacheReadTierAvailable: false,
    };
  }

  const input = pricing.input;
  const output = pricing.output;
  const cacheReadTierAvailable = typeof pricing.cached_input === "number";
  // When no read tier exists, the shared prefix is billed at full input price.
  const readRate = cacheReadTierAvailable
    ? (pricing.cached_input as number)
    : input;

  const naiveCostUsd =
    (allTokensIn * input + allTokensOut * output) / 1_000_000;

  const replayCostUsd =
    (sharedTokensIn * readRate +
      tailTokensIn * input +
      tailTokensOut * output) /
    1_000_000;

  const savedUsd = naiveCostUsd - replayCostUsd;
  const savedRatio =
    naiveCostUsd > 0 ? savedUsd / naiveCostUsd : null;

  return {
    naiveCostUsd,
    replayCostUsd,
    savedUsd,
    savedRatio,
    sharedPrefixTokensIn: sharedTokensIn,
    recomputedTokensIn: tailTokensIn,
    recomputedTokensOut: tailTokensOut,
    cacheReadTierAvailable,
  };
}

/**
 * Aggregate the projected saving across a SEQUENCE of what-if iterations — the
 * realistic prompt-engineering loop where the user runs many variants, each
 * sharing the same long prefix. Returns the cumulative naive vs replay cost.
 *
 * Pure; the caller supplies one breakdown per iteration.
 */
export function aggregateIterations(
  breakdowns: readonly ReplayCostBreakdown[]
): {
  iterations: number;
  cumulativeNaiveUsd: number | null;
  cumulativeReplayUsd: number | null;
  cumulativeSavedUsd: number | null;
  cumulativeSavedRatio: number | null;
} {
  let naive = 0;
  let replay = 0;
  let anyPriced = false;
  for (const b of breakdowns) {
    if (b.naiveCostUsd === null || b.replayCostUsd === null) continue;
    anyPriced = true;
    naive += b.naiveCostUsd;
    replay += b.replayCostUsd;
  }
  if (!anyPriced) {
    return {
      iterations: breakdowns.length,
      cumulativeNaiveUsd: null,
      cumulativeReplayUsd: null,
      cumulativeSavedUsd: null,
      cumulativeSavedRatio: null,
    };
  }
  const saved = naive - replay;
  return {
    iterations: breakdowns.length,
    cumulativeNaiveUsd: naive,
    cumulativeReplayUsd: replay,
    cumulativeSavedUsd: saved,
    cumulativeSavedRatio: naive > 0 ? saved / naive : null,
  };
}
