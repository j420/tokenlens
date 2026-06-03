/**
 * Feature-telemetry EventRow builder.
 *
 * The `events` table (and EventRow) is shaped for real model-usage turns:
 * tokens in/out, latency, ROI classification, cost. A TCRP/Phase-9.7 feature
 * (f9–f13) wants to record a much smaller fact — "this advisory fired with this
 * quality_proof" — but it must land in the SAME table so the dashboard, the
 * Postgres export, and the shadow-vs-realized analysis all see one event
 * stream keyed by `feature_id`.
 *
 * This helper is the single, tested place that maps a feature's
 * `quality_proof` (plus whatever usage context it observed) onto a complete,
 * valid EventRow. Without it every hook would hand-build ~24 fields and drift.
 *
 * Discipline:
 *   - The usage-centric fields a feature DOESN'T have (latency, ROI, context
 *     sizes) default to neutral zeros and `classification: "unknown"` — we
 *     never fabricate a productive/recursive label or a cost a feature didn't
 *     actually observe.
 *   - `feature_id`, `session_id`, `event_id`, and `quality_proof` are REQUIRED;
 *     a missing one is a caller bug and throws (the hook layer guards and treats
 *     recording as best-effort, so a throw here never reaches the user).
 *   - `event_id` is the idempotency key: LocalSqliteSink uses INSERT OR REPLACE,
 *     so a deterministic id (e.g. hash of the feature inputs) makes re-firing a
 *     hook upsert rather than duplicate.
 */

import type { Provider } from "@prune/shared";

import type { EventRow, PersistenceSink } from "./sink.js";

export interface FeatureEventParams {
  /** TCRP feature tag, e.g. "f9".."f13". Required, non-empty. */
  featureId: string;
  /** The feature's quality_proof bundle. Required. */
  qualityProof: Record<string, unknown>;
  /** Session this telemetry belongs to. Required, non-empty. */
  sessionId: string;
  /**
   * Stable, deterministic event id (idempotency key). Required, non-empty.
   * Re-firing a hook with the same id upserts the row instead of duplicating.
   */
  eventId: string;

  /** ISO 8601 timestamp. Default: now. */
  timestamp?: string;
  /** Model in context, when known. Default "unknown". */
  model?: string;
  /** Provider. Default "anthropic". */
  provider?: Provider;
  /** User id. Default "local". */
  userId?: string;
  /** Team id. Default null. */
  teamId?: string | null;
  /** Tool/source label. Default "prune-<featureId>". */
  tool?: string;

  /** Usage context the feature observed (all default 0; never fabricated). */
  tokensIn?: number;
  tokensOut?: number;
  tokensCached?: number;
  estimatedCostUsd?: number;
  latencyMs?: number;

  /** Optional waste flags surfaced by the feature. Default []. */
  wasteFlags?: string[];
  /** Optional task metadata. Default { type: "feature:<id>", repo/branch null }. */
  taskMetadata?: { type: string; repo: string | null; branch: string | null };
}

function nonNegFinite(n: number | undefined, fallback = 0): number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Build a complete, valid EventRow for feature telemetry. Pure. Throws only on
 * a missing required field (a caller bug).
 */
export function buildFeatureEventRow(params: FeatureEventParams): EventRow {
  if (!params.featureId) throw new Error("buildFeatureEventRow: featureId is required");
  if (!params.sessionId) throw new Error("buildFeatureEventRow: sessionId is required");
  if (!params.eventId) throw new Error("buildFeatureEventRow: eventId is required");
  if (!params.qualityProof || typeof params.qualityProof !== "object") {
    throw new Error("buildFeatureEventRow: qualityProof must be an object");
  }

  const estimatedCost = nonNegFinite(params.estimatedCostUsd);

  return {
    event_id: params.eventId,
    session_id: params.sessionId,
    user_id: params.userId ?? "local",
    team_id: params.teamId ?? null,
    timestamp: params.timestamp ?? new Date().toISOString(),
    provider: params.provider ?? "anthropic",
    tool: params.tool ?? `prune-${params.featureId}`,
    model: params.model ?? "unknown",
    tokens_in: nonNegFinite(params.tokensIn),
    tokens_out: nonNegFinite(params.tokensOut),
    tokens_cached: nonNegFinite(params.tokensCached),
    latency_ms: nonNegFinite(params.latencyMs),
    estimated_cost_usd: estimatedCost,
    // A feature event isn't part of the session's spend roll-up; mirror its own
    // (usually zero) cost rather than invent a cumulative figure.
    cumulative_session_cost_usd: estimatedCost,
    tool_calls: [],
    files_referenced: [],
    compaction_triggered: false,
    context_size_before: 0,
    context_size_after: 0,
    waste_flags: params.wasteFlags ?? [],
    // Honest: a feature-telemetry row is not a productive/recursive usage turn.
    classification: "unknown",
    roi_score: 0,
    task_metadata:
      params.taskMetadata ?? { type: `feature:${params.featureId}`, repo: null, branch: null },
    feature_id: params.featureId,
    quality_proof: params.qualityProof,
  };
}

/**
 * Build + record a feature event against a sink. Convenience for callers that
 * already hold an initialized sink. Returns the row that was written so the
 * caller can log/inspect it.
 */
export async function recordFeatureEvent(
  sink: PersistenceSink,
  params: FeatureEventParams
): Promise<EventRow> {
  const row = buildFeatureEventRow(params);
  await sink.recordEvent(row);
  return row;
}
