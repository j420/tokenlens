/**
 * `quality_proof` schema for the speculative pipeline, recorded under
 * `feature_id = "f11"`.
 *
 * One row per reconcile: the outcome classification, the latency saved, and a
 * snapshot of the rolling stats + budget health. PII-safe — keys are content
 * hashes, never the tool inputs or results.
 */

import type { BudgetDecision } from "./budget.js";
import type { PipelineStats, ReconcileOutcome } from "./types.js";

export const SPECULATIVE_PIPELINE_FEATURE_ID = "f11" as const;
export const QUALITY_PROOF_SCHEMA_VERSION = 1 as const;

export interface SpeculativePipelineProof {
  schemaVersion: 1;
  featureId: "f11";
  outcome: {
    hit: boolean;
    classification: ReconcileOutcome["classification"];
    key: string | null;
    latencySavedMs: number;
  };
  stats: {
    speculationsIssued: number;
    hits: number;
    misses: number;
    inFlightIncomplete: number;
    hitRate: number;
    wastedSpeculations: number;
    totalLatencySavedMs: number;
  };
  budget: {
    verdict: BudgetDecision["verdict"];
    wastedRate: number;
    freeSlots: number;
  };
}

export function buildQualityProof(
  outcome: ReconcileOutcome,
  stats: Readonly<PipelineStats>,
  budget: BudgetDecision
): SpeculativePipelineProof {
  return {
    schemaVersion: QUALITY_PROOF_SCHEMA_VERSION,
    featureId: SPECULATIVE_PIPELINE_FEATURE_ID,
    outcome: {
      hit: outcome.hit,
      classification: outcome.classification,
      key: outcome.key,
      latencySavedMs: outcome.latencySavedMs,
    },
    stats: {
      speculationsIssued: stats.speculationsIssued,
      hits: stats.hits,
      misses: stats.misses,
      inFlightIncomplete: stats.inFlightIncomplete,
      hitRate: stats.hitRate,
      wastedSpeculations: stats.wastedSpeculations,
      totalLatencySavedMs: stats.totalLatencySavedMs,
    },
    budget: {
      verdict: budget.verdict,
      wastedRate: budget.wastedRate,
      freeSlots: budget.freeSlots,
    },
  };
}
