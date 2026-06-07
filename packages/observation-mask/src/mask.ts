/**
 * The masking planner. Pure: (observations, config) → MaskPlan. Three layers,
 * applied in order:
 *
 *   1. Carried — anything masked in a prior turn stays masked (monotone), so the
 *      masked prefix only grows and the prompt cache below it is never disturbed.
 *   2. Stale  — observations older than the sliding window are masked. This is
 *      the structural win: retained tokens become bounded by the window, turning
 *      O(n^2) transcript growth into O(n*window).
 *   3. Budget — if a hard token budget is set and windowed retention still
 *      exceeds it, evict additional in-window observations in Belady order until
 *      retention is under budget.
 *
 * Pinned observations are never masked. The planner never tokenizes and never
 * fabricates a number: token costs come from the caller, and the placeholder
 * cost is an explicit, overridable constant.
 */

import type {
  MaskConfig,
  MaskPlan,
  MaskReason,
  MaskedObservation,
  Observation,
} from "./types.js";
import { DEFAULT_PLACEHOLDER_TOKENS } from "./constants.js";
import { beladyEvictionOrder } from "./belady.js";
import { placeholderFor } from "./placeholder.js";

function reclaimOf(obs: Observation, placeholderTokens: number): number {
  return Math.max(0, obs.tokens - placeholderTokens);
}

export function planMask(
  observations: readonly Observation[],
  config: MaskConfig
): MaskPlan {
  const placeholderTokens =
    config.placeholderTokens ?? DEFAULT_PLACEHOLDER_TOKENS;
  const carried = new Set(config.previouslyMaskedIds ?? []);
  const totalTokens = observations.reduce((s, o) => s + Math.max(0, o.tokens), 0);

  // Reason assignment. Pinned wins over everything; carried wins over stale.
  const reasonById = new Map<string, MaskReason>();
  const live: Observation[] = []; // currently unmasked, non-pinned, in-window

  for (const obs of observations) {
    if (obs.pinned) continue;
    if (carried.has(obs.id)) {
      reasonById.set(obs.id, "carried");
      continue;
    }
    const age = config.currentTurn - obs.turn;
    if (age > config.windowTurns) {
      reasonById.set(obs.id, "stale");
      continue;
    }
    live.push(obs);
  }

  // retainedTokens = post-mask context cost = total − reclaimed-so-far.
  let reclaimed = 0;
  for (const obs of observations) {
    if (reasonById.has(obs.id)) reclaimed += reclaimOf(obs, placeholderTokens);
  }
  let retainedTokens = totalTokens - reclaimed;

  // Budget eviction over the still-live set, Belady-ordered.
  if (typeof config.tokenBudget === "number" && retainedTokens > config.tokenBudget) {
    for (const obs of beladyEvictionOrder(live, config.currentTurn)) {
      if (retainedTokens <= config.tokenBudget) break;
      reasonById.set(obs.id, "budget");
      const r = reclaimOf(obs, placeholderTokens);
      reclaimed += r;
      retainedTokens -= r;
    }
  }

  const masked: MaskedObservation[] = [];
  for (const obs of observations) {
    const reason = reasonById.get(obs.id);
    if (!reason) continue;
    masked.push({
      id: obs.id,
      reason,
      reclaimedTokens: reclaimOf(obs, placeholderTokens),
      placeholder: placeholderFor(obs),
    });
  }

  return {
    masked,
    retainedTokens,
    reclaimedTokens: reclaimed,
    totalTokens,
  };
}
