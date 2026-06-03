/**
 * `quality_proof` schema for the speculative pipeline, recorded under
 * `feature_id = "f13"`.
 *
 * One row per reconcile: the outcome classification, the latency accounting, and
 * a snapshot of the rolling stats + budget health. PII-safe — keys are content
 * hashes, never the tool inputs or results.
 *
 * ── Honest latency accounting (fixes HIGH-1) ────────────────────────────────
 *
 * The pipeline can only report the GROSS speculation elapsed (the upper bound a
 * host could save). It cannot know how the host SERVED the result, so it must
 * not claim that elapsed as realized savings. The schema therefore separates:
 *
 *   • `speculativeElapsedMs` — GROSS upper bound (the speculation's own elapsed).
 *   • `realizedLatencySavedMs` — NET wall-clock the agent actually avoided. The
 *     HOST supplies this (it knows its serve mode). On the default synchronous-
 *     verify path it is ~0, because the agent awaited the shadow run. It is
 *     non-null ONLY when the host passes its measured figure; otherwise null,
 *     which is the honest "unknown to the pipeline" state — never a fabricated
 *     number.
 *
 * Dashboards MUST surface `realizedLatencySavedMs` as "latency saved" and may
 * show `speculativeElapsedMs` only as "potential". The same separation applies
 * to the rolling stats (`totalSpeculativeElapsedMs` is gross; the host tracks
 * realized net in its own ledger).
 */

import type { BudgetDecision } from "./budget.js";
import type { PipelineStats, ReconcileOutcome } from "./types.js";

export const SPECULATIVE_PIPELINE_FEATURE_ID = "f13" as const;
export const QUALITY_PROOF_SCHEMA_VERSION = 2 as const;

export interface SpeculativePipelineProof {
  schemaVersion: 2;
  featureId: "f13";
  outcome: {
    hit: boolean;
    classification: ReconcileOutcome["classification"];
    key: string | null;
    /** GROSS upper bound: the speculation's own elapsed. NOT realized savings. */
    speculativeElapsedMs: number;
    /**
     * NET wall-clock the agent actually avoided, as measured by the host's
     * serve mode. `null` when the host did not supply it (the pipeline does not
     * fabricate one). ~0 on the default synchronous-verify path.
     */
    realizedLatencySavedMs: number | null;
  };
  stats: {
    speculationsIssued: number;
    hits: number;
    misses: number;
    inFlightIncomplete: number;
    hitRate: number;
    wastedSpeculations: number;
    /** GROSS sum of speculations' elapsed across hits. NOT realized savings. */
    totalSpeculativeElapsedMs: number;
  };
  budget: {
    verdict: BudgetDecision["verdict"];
    wastedRate: number;
    freeSlots: number;
  };
}

/**
 * Build the f13 quality proof.
 *
 * @param outcome  the pipeline reconcile outcome (carries GROSS elapsed only).
 * @param stats    rolling pipeline stats (GROSS).
 * @param budget   current budget/breaker decision.
 * @param realizedLatencySavedMs  the HOST's honest NET latency saved for this
 *        resolve (e.g. `ResolveResult.latencySavedMs`). Omit/`null` if unknown
 *        to the caller — the proof will NOT fabricate one.
 */
export function buildQualityProof(
  outcome: ReconcileOutcome,
  stats: Readonly<PipelineStats>,
  budget: BudgetDecision,
  realizedLatencySavedMs: number | null = null
): SpeculativePipelineProof {
  return {
    schemaVersion: QUALITY_PROOF_SCHEMA_VERSION,
    featureId: SPECULATIVE_PIPELINE_FEATURE_ID,
    outcome: {
      hit: outcome.hit,
      classification: outcome.classification,
      key: outcome.key,
      speculativeElapsedMs: outcome.speculativeElapsedMs,
      realizedLatencySavedMs,
    },
    stats: {
      speculationsIssued: stats.speculationsIssued,
      hits: stats.hits,
      misses: stats.misses,
      inFlightIncomplete: stats.inFlightIncomplete,
      hitRate: stats.hitRate,
      wastedSpeculations: stats.wastedSpeculations,
      totalSpeculativeElapsedMs: stats.totalSpeculativeElapsedMs,
    },
    budget: {
      verdict: budget.verdict,
      wastedRate: budget.wastedRate,
      freeSlots: budget.freeSlots,
    },
  };
}
