import { NextRequest, NextResponse } from "next/server";
import type { EventRow } from "@prune/persistence";
import {
  aggregateFeatureTelemetry,
  type FeatureTelemetryReport,
} from "@/lib/feature-telemetry";

/**
 * GET /api/v1/features — read-side rollup of the f9–f13 feature-telemetry
 * stream.
 *
 * Honest data-source note: the canonical f9–f13 telemetry is written by the
 * extension/MCP hooks into `@prune/persistence` `LocalSqliteSink` on the
 * developer's machine (one `EventRow` per advisory, tagged with `feature_id`
 * + a `quality_proof` blob). The hosted dashboard does NOT have direct access
 * to that local sqlite file. What it CAN see is the event stream pushed to its
 * own store (Vercel KV, or in-memory in dev) via `POST /api/v1/events`.
 *
 * This route therefore reads whatever events are in that store, treats each as
 * an (untrusted-shape) `EventRow`, and folds them with the pure aggregator. If
 * the pushed events carry `feature_id`/`quality_proof` the rollup is populated;
 * if they don't (the current proxy-event shape doesn't), every feature
 * honestly reports zero telemetry. We never fabricate rows to fill the cards.
 *
 * Error handling mirrors the sibling routes: a fetch/store failure returns 200
 * with an empty-but-well-formed report and a `_meta.storage: "error"` marker,
 * so the page renders an honest empty state rather than crashing.
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

/**
 * Read raw events from the dashboard's own store. Returns rows shaped loosely
 * as EventRow — the aggregator decodes them defensively, so a missing
 * feature_id/quality_proof is fine.
 */
async function readEvents(
  origin: string,
  limit: number
): Promise<{ events: EventRow[]; storage: "kv" | "memory" }> {
  const res = await fetch(`${origin}/api/v1/events?limit=${limit}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`events fetch failed: ${res.status}`);
  const body = (await res.json()) as {
    events?: unknown;
    storage?: string;
  };
  const events = Array.isArray(body.events)
    ? (body.events as EventRow[])
    : [];
  const storage = body.storage === "kv" ? "kv" : "memory";
  return { events, storage };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limitParam = parseInt(searchParams.get("limit") || "500", 10);
  // Clamp to a sane window. Negative/NaN falls back to the default.
  const limit =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(limitParam, 1000)
      : 500;

  try {
    const origin = new URL(request.url).origin;
    const { events, storage } = await readEvents(origin, limit);
    const report = aggregateFeatureTelemetry(events);

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
