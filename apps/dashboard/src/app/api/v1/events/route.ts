import { NextRequest, NextResponse } from "next/server";
import {
  normalizeEvent,
  storeEvent,
  readStoredEvents,
  readMemoryStore,
  type RawEventInput,
} from "@/lib/event-store";

/**
 * Ingest + read-back for the dashboard's own event store.
 *
 * The canonical stored shape and all store I/O live in `@/lib/event-store`
 * (Next.js forbids non-handler exports from a `route.ts`). This file is just
 * the HTTP boundary: parse → normalize → store, and read → summarize.
 *
 * The ingest path now ACCEPTS and STORES `feature_id` + `quality_proof` and
 * reconciles camelCase↔snake_case, so feature-tagged events reach the f9–f13
 * aggregator instead of being silently dropped (reviewer finding HIGH-3).
 */

// POST - Store a new event
export async function POST(request: NextRequest) {
  try {
    const raw = (await request.json()) as RawEventInput;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return NextResponse.json(
        { success: false, error: "Event body must be an object" },
        { status: 400 }
      );
    }
    const event = normalizeEvent(raw);
    await storeEvent(event);

    return NextResponse.json({
      success: true,
      stored: true,
      // Echo whether this event carried feature telemetry, so a client/test
      // can confirm the tags were accepted rather than silently dropped.
      featureId: event.feature_id ?? null,
    });
  } catch (error) {
    console.error("Failed to store event:", error);
    return NextResponse.json(
      { success: false, error: "Failed to store event" },
      { status: 500 }
    );
  }
}

// GET - Retrieve events
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get("limit") || "100", 10);

  try {
    const { events, storage } = await readStoredEvents(limit);

    // Calculate summary stats
    const today = new Date().toISOString().split("T")[0];
    const todayEvents = events.filter((e) => e.timestamp.startsWith(today));
    const totalCost = todayEvents.reduce((sum, e) => sum + e.costUsd, 0);
    const totalTokens = todayEvents.reduce(
      (sum, e) => sum + e.tokensIn + e.tokensOut,
      0
    );

    return NextResponse.json({
      events,
      summary: {
        totalEvents: events.length,
        todayEvents: todayEvents.length,
        todayCost: totalCost,
        todayTokens: totalTokens,
      },
      storage,
    });
  } catch (error) {
    console.error("Failed to get events:", error);
    return NextResponse.json({
      events: readMemoryStore(limit),
      storage: "memory-fallback",
    });
  }
}
