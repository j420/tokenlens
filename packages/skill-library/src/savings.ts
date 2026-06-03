/**
 * Projected savings from skill reuse.
 *
 * A skill captures `discoveryTokens` of input the agent would otherwise re-pay
 * to rediscover the same task. Reusing it saves those input tokens at the
 * model's input rate, once per reuse. The cumulative figure multiplies by
 * `useCount` — the O(N) → O(1) story made concrete and dollar-quantified.
 *
 * Honesty: unpriced models yield null USD (never a fabricated rate); the token
 * figure is always present.
 */

import { FLAT_PRICING, type ModelPricing } from "@prune/shared";

import type { Skill, SkillSavingProjection } from "./types.js";

function strictPricing(model: string): ModelPricing | null {
  return FLAT_PRICING[model] ?? null;
}

export function projectSkillSaving(
  skill: Skill,
  model: string
): SkillSavingProjection {
  const pricing = strictPricing(model);
  if (pricing === null) {
    return {
      discoveryTokens: skill.discoveryTokens,
      savedUsdPerReuse: null,
      cumulativeSavedUsd: null,
    };
  }
  const savedUsdPerReuse = (skill.discoveryTokens * pricing.input) / 1_000_000;
  return {
    discoveryTokens: skill.discoveryTokens,
    savedUsdPerReuse,
    cumulativeSavedUsd: savedUsdPerReuse * skill.useCount,
  };
}

/**
 * Aggregate projected savings across a whole library for one model. Skips
 * unpriced skills; reports how many were skipped so the figure is honest.
 */
export function projectLibrarySaving(
  skills: readonly Skill[],
  model: string
): {
  totalDiscoveryTokens: number;
  totalCumulativeSavedUsd: number | null;
  pricedSkills: number;
  skippedUnpriced: number;
} {
  const pricing = strictPricing(model);
  let totalDiscoveryTokens = 0;
  for (const s of skills) totalDiscoveryTokens += s.discoveryTokens;
  if (pricing === null) {
    return {
      totalDiscoveryTokens,
      totalCumulativeSavedUsd: null,
      pricedSkills: 0,
      skippedUnpriced: skills.length,
    };
  }
  let total = 0;
  for (const s of skills) {
    total += (s.discoveryTokens * pricing.input * s.useCount) / 1_000_000;
  }
  return {
    totalDiscoveryTokens,
    totalCumulativeSavedUsd: total,
    pricedSkills: skills.length,
    skippedUnpriced: 0,
  };
}
