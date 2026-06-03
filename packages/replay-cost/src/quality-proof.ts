/**
 * `quality_proof` schema for replay-cost.
 *
 * One row per planned (and optionally executed) what-if replay, recorded under
 * `feature_id = "f11"`. The post-hoc auditor can re-run `planReplay` against the
 * recorded baseline + mutation and assert the same divergence index, shared
 * prefix hash, and cost breakdown — the plan is fully deterministic, so the
 * audit is a byte-for-byte re-derivation.
 *
 * PII hygiene: the proof records HASHES and TOKEN COUNTS, never the segment
 * payloads or the output text. A reviewer can verify the structure and the
 * economics without ever seeing the user's prompts.
 */

import type {
  OutputComparison,
  ReplayPlan,
} from "./types.js";

export const REPLAY_COST_FEATURE_ID = "f11" as const;
export const QUALITY_PROOF_SCHEMA_VERSION = 1 as const;

export interface ReplayCostQualityProof {
  schemaVersion: 1;
  featureId: "f11";
  /** Baseline + modified root hashes — prove which timelines were compared. */
  baselineRootHash: string;
  modifiedRootHash: string;
  divergence: {
    divergenceIndex: number | null;
    sharedSegmentCount: number;
    sharedPrefixHash: string;
    sharedPrefixTokensIn: number;
    divergedTailTokensIn: number;
    divergedTailTokensOut: number;
  };
  cost: {
    naiveCostUsd: number | null;
    replayCostUsd: number | null;
    savedUsd: number | null;
    savedRatio: number | null;
    cacheReadTierAvailable: boolean;
  };
  reusedOriginalTokens: boolean;
  /** Present only when the replay was executed and outputs compared. */
  comparison: {
    verdict: OutputComparison["verdict"];
    equivalent: boolean;
    similarity: number;
    strategy: string;
  } | null;
}

export function buildQualityProof(
  baselineRootHash: string,
  plan: ReplayPlan,
  comparison: OutputComparison | null = null
): ReplayCostQualityProof {
  return {
    schemaVersion: QUALITY_PROOF_SCHEMA_VERSION,
    featureId: REPLAY_COST_FEATURE_ID,
    baselineRootHash,
    modifiedRootHash: plan.modified.rootHash,
    divergence: {
      divergenceIndex: plan.divergence.divergenceIndex,
      sharedSegmentCount: plan.divergence.sharedSegmentCount,
      sharedPrefixHash: plan.divergence.sharedPrefixHash,
      sharedPrefixTokensIn: plan.divergence.sharedPrefixTokensIn,
      divergedTailTokensIn: plan.divergence.divergedTailTokensIn,
      divergedTailTokensOut: plan.divergence.divergedTailTokensOut,
    },
    cost: {
      naiveCostUsd: plan.cost.naiveCostUsd,
      replayCostUsd: plan.cost.replayCostUsd,
      savedUsd: plan.cost.savedUsd,
      savedRatio: plan.cost.savedRatio,
      cacheReadTierAvailable: plan.cost.cacheReadTierAvailable,
    },
    reusedOriginalTokens: plan.reusedOriginalTokens,
    comparison: comparison
      ? {
          verdict: comparison.verdict,
          equivalent: comparison.equivalent,
          similarity: comparison.similarity,
          strategy: comparison.strategy,
        }
      : null,
  };
}
