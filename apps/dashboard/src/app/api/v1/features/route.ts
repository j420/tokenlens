import { NextRequest, NextResponse } from "next/server";
import type { EventRow } from "@prune/persistence";
import {
  aggregateFeatureTelemetry,
  type FeatureTelemetryReport,
} from "@/lib/feature-telemetry";
import { readStoredEvents } from "@/lib/event-store";

/**
 * GET /api/v1/features — read-side rollup of the f9–f13 feature-telemetry
 * stream.
 *
 * Data source: the dashboard's own event store (Vercel KV in prod, in-memory
 * in dev), populated via `POST /api/v1/events`. We read that store IN-PROCESS
 * through the shared `readStoredEvents` helper — no HTTP self-fetch, so the
 * rollup is robust to base-URL resolution and is unit-testable end to end.
 *
 * Each stored event is a canonical superset object that carries the snake_case
 * fields the aggregator needs (`feature_id`, `quality_proof`, `tokens_in`,
 * `estimated_cost_usd`). When a feature-tagged event has been ingested, its
 * card is populated; when no tagged events exist, every feature honestly
 * reports zero. We never fabricate rows to fill the cards.
 *
 * Remaining gap (stated honestly, not papered over): the canonical f9–f13
 * stream is recorded by the extension/MCP hooks into a LOCAL sqlite sink on the
 * developer's machine. The hosted dashboard cannot read that local file; it
 * only sees what is POSTed to this ingest API. The end-to-end loop here is
 * proven, but a hook that forwards local telemetry to `POST /api/v1/events`
 * must still be wired for production data to flow on its own.
 *
 * Error handling mirrors the sibling routes: a store failure returns 200 with
 * an empty-but-well-formed report and `_meta.storage: "error"`, so the page
 * renders an honest empty state rather than crashing.
 */

interface FeaturesResponse extends FeatureTelemetryReport {
  _meta: {
    storage: "kv" | "memory" | "error";
    /** True when at least one row carried an f9–f13 feature_id. */
    hasFeatureTelemetry: boolean;
    /** Total rows scanned from the store. */
    scannedEvents: number;
    error?: string;
  };
}

const EMPTY_REPORT: FeatureTelemetryReport = aggregateFeatureTelemetry([]);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limitParam = parseInt(searchParams.get("limit") || "500", 10);
  // Clamp to a sane window. Negative/NaN falls back to the default.
  const limit =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(limitParam, 1000)
      : 500;

  try {
    const { events, storage } = await readStoredEvents(limit);
    // Stored events are a superset of EventRow's relevant fields; the
    // aggregator decodes defensively, so any shape is safe to fold.
    const report = aggregateFeatureTelemetry(events as unknown as EventRow[]);

    const hasFeatureTelemetry =
      report.totalEvents - report.outOfScopeEventCount > 0;

    const payload: FeaturesResponse = {
      ...report,
      _meta: {
        storage,
        hasFeatureTelemetry,
        scannedEvents: events.length,
      },
    };
    return NextResponse.json(payload);
  } catch (error) {
    console.error("Failed to build feature telemetry rollup:", error);
    const payload: FeaturesResponse = {
      ...EMPTY_REPORT,
      _meta: {
        storage: "error",
        hasFeatureTelemetry: false,
        scannedEvents: 0,
        error: "Failed to read feature telemetry",
      },
    };
    return NextResponse.json(payload);
  }
}
