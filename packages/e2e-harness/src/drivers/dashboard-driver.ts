/**
 * Drives the dashboard observability loop. The dashboard route handlers are, by
 * their own doc comments, thin HTTP boundaries over `@/lib/event-store`
 * (normalize → store → read) and `@/lib/feature-telemetry`
 * (aggregateFeatureTelemetry). We drive those library functions directly: it is
 * the EXACT normalization + rollup + decoder code the `/dashboard/telemetry`
 * page renders, with no Next runtime to make the run flaky. (`dashboard.test.ts`
 * additionally drives the real POST/GET route handlers to prove the HTTP
 * contract.)
 *
 * Loaded only by vitest/tsx. Dynamic import + vitest `resetModules()` gives each
 * test a fresh module-level event store, so counts are deterministic.
 */

import { LocalSqliteSink, buildFeatureEventRow, runForwardOnce } from "@prune/persistence";
import type { EventRow } from "@prune/persistence";
import type { FetchLike } from "@prune/persistence";

const EVENT_STORE = "../../../../apps/dashboard/src/lib/event-store";
const FEATURE_TEL = "../../../../apps/dashboard/src/lib/feature-telemetry";

export interface DashboardLib {
  normalizeEvent: (raw: Record<string, unknown>) => Record<string, unknown>;
  storeEvent: (e: Record<string, unknown>) => Promise<unknown>;
  readStoredEvents: (limit: number) => Promise<{ events: unknown[]; storage: string }>;
  aggregateFeatureTelemetry: (events: EventRow[]) => {
    features: Array<{
      featureId: string;
      featureName: string;
      eventCount: number;
      tokensIn: number;
      estimatedCostUsd: number;
      malformedProofCount: number;
      summary: Record<string, unknown>;
    }>;
    totalEvents: number;
    outOfScopeEventCount: number;
  };
}

/** Fresh import of the dashboard read/write libraries (fresh in-process store). */
export async function loadDashboard(): Promise<DashboardLib> {
  // `.default` fallback: under tsx the dashboard's .ts may load as CJS and expose
  // members under `default`; under vitest they're named ESM exports.
  const storeMod = (await import(EVENT_STORE)) as Record<string, unknown> & { default?: Record<string, unknown> };
  const telMod = (await import(FEATURE_TEL)) as Record<string, unknown> & { default?: Record<string, unknown> };
  const pick = <T>(m: Record<string, unknown> & { default?: Record<string, unknown> }, name: string): T =>
    ((m[name] ?? m.default?.[name]) as T);
  return {
    normalizeEvent: pick(storeMod, "normalizeEvent"),
    storeEvent: pick(storeMod, "storeEvent"),
    readStoredEvents: pick(storeMod, "readStoredEvents"),
    aggregateFeatureTelemetry: pick(telMod, "aggregateFeatureTelemetry"),
  };
}

/**
 * A FetchLike that IS the ingest path: it normalizes + stores the POSTed body
 * exactly as `POST /api/v1/events` does. `failOnEventIndex` lets a test force a
 * delivery failure on the Nth accepted POST to exercise the forwarder's
 * stop-on-failure / gapless-resume discipline.
 */
export function makeIngestFetch(
  lib: DashboardLib,
  opts: { failOnAttempt?: number } = {}
): { fetchImpl: FetchLike; attempts: () => number } {
  let attempt = 0;
  const fetchImpl: FetchLike = async (_url, init) => {
    attempt += 1;
    if (opts.failOnAttempt && attempt === opts.failOnAttempt) {
      return { ok: false, status: 503 };
    }
    const raw = JSON.parse(init.body) as Record<string, unknown>;
    const normalized = lib.normalizeEvent(raw);
    await lib.storeEvent(normalized);
    return { ok: true, status: 200 };
  };
  return { fetchImpl, attempts: () => attempt };
}

/** Seed a local sqlite sink with feature events built from real quality proofs. */
export async function seedFeatureEvents(
  dbPath: string,
  events: Array<{
    featureId: string;
    qualityProof: Record<string, unknown>;
    eventId: string;
    sessionId: string;
    tokensIn?: number;
    estimatedCostUsd?: number;
    model?: string;
    timestamp?: string;
  }>
): Promise<void> {
  const sink = new LocalSqliteSink({ path: dbPath });
  await sink.init();
  try {
    for (const e of events) {
      const row: EventRow = buildFeatureEventRow({
        featureId: e.featureId,
        qualityProof: e.qualityProof,
        eventId: e.eventId,
        sessionId: e.sessionId,
        tokensIn: e.tokensIn ?? 0,
        estimatedCostUsd: e.estimatedCostUsd ?? 0,
        model: e.model,
        timestamp: e.timestamp,
      });
      await sink.recordEvent(row);
    }
  } finally {
    await sink.close();
  }
}

/**
 * Record a PLAIN (non-feature) event into the sink — `feature_id` null. The
 * forwarder must skip it (it ships only `feature_id IS NOT NULL`), which this
 * lets a test prove.
 */
export async function seedPlainEvent(dbPath: string, eventId: string): Promise<void> {
  const sink = new LocalSqliteSink({ path: dbPath });
  await sink.init();
  try {
    const row: EventRow = {
      event_id: eventId,
      session_id: "e2e-login-bug",
      user_id: "local",
      team_id: null,
      timestamp: new Date().toISOString(),
      provider: "anthropic",
      tool: "claude-code",
      model: "claude-sonnet-4-5-20250929",
      tokens_in: 100,
      tokens_out: 50,
      tokens_cached: 0,
      latency_ms: 0,
      estimated_cost_usd: 0,
      cumulative_session_cost_usd: 0,
      tool_calls: [],
      files_referenced: [],
      compaction_triggered: false,
      context_size_before: 0,
      context_size_after: 0,
      waste_flags: [],
      classification: "productive",
      roi_score: 0,
      task_metadata: { type: "edit", repo: null, branch: null },
      feature_id: null,
      quality_proof: null,
    };
    await sink.recordEvent(row);
  } finally {
    await sink.close();
  }
}

/** Re-export the real forwarder so scenarios run the production code path. */
export { runForwardOnce };
