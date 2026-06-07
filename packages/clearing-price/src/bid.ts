/**
 * The bid rule — the one function every actuator calls. Given the quality an
 * action would buy and the tokens it would cost, decide whether it clears the
 * current price.
 *
 * Null-safety is the contract: if lambda is null (no live price) or qualityGain
 * is null/non-finite (quality can't be estimated), the decision is `abstain` and
 * the actuator must use its own default — the controller never fabricates a
 * verdict it can't justify. Quality and cost are caller-supplied measurements,
 * not invented here.
 */

import type { SpendDecision } from "./types.js";

export function shouldSpend(
  qualityGain: number | null | undefined,
  tokenCost: number,
  lambda: number | null | undefined
): SpendDecision {
  if (lambda === null || lambda === undefined || !Number.isFinite(lambda)) {
    return {
      action: "abstain",
      lambda: null,
      surplus: null,
      reason: "no live price (lambda unavailable)",
    };
  }
  if (
    qualityGain === null ||
    qualityGain === undefined ||
    !Number.isFinite(qualityGain)
  ) {
    return {
      action: "abstain",
      lambda,
      surplus: null,
      reason: "quality gain unknown",
    };
  }

  const cost = Math.max(0, tokenCost);
  const surplus = qualityGain - lambda * cost;
  return {
    action: surplus >= 0 ? "spend" : "skip",
    lambda,
    surplus,
    reason:
      surplus >= 0
        ? "quality clears the price"
        : "quality below the price; skip/cheapen",
  };
}
