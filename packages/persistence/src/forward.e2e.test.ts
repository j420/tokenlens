/**
 * End-to-end forwarding integration test (#2) — proves the observability loop
 * works whole, in-process, with no network and no deploy.
 *
 * The loop under test:
 *   1. A recording hook / MCP server writes feature telemetry to the developer's
 *      local events.sqlite (here: a real on-disk LocalSqliteSink seeded via
 *      recordFeatureEvent — the SAME path production uses).
 *   2. The Stop-hook forwarder (`runForwardOnce`, which opens its own sink by
 *      path, reads the FORWARDABLE subset, POSTs each in order, and advances a
 *      persisted cursor) ships them to the dashboard ingest.
 *   3. The dashboard ingest normalizes each payload into its canonical
 *      StoredEvent and the f9–f13 aggregator reads it.
 *
 * We inject a fetch that CAPTURES every payload (no network), then assert:
 *   - the exact feature rows were delivered, in (timestamp, event_id) order;
 *   - non-forwardable rows (a real usage turn with feature_id NULL) are NOT sent;
 *   - the cursor file advanced to the last delivered row;
 *   - a second run is a NO-OP (nothing re-sent) — the at-least-once guarantee
 *     doesn't degrade into duplicate delivery on the happy path;
 *   - each captured payload survives the dashboard's normalizeEvent boundary
 *     with its feature_id / quality_proof intact (the bug that made every
 *     feature card render zero).
 *
 * normalizeEvent is COPIED here (minimal shape) rather than imported across the
 * app boundary — the test must not depend on the dashboard package, and we must
 * not edit it.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalSqliteSink } from "./local-sqlite.js";
import { recordFeatureEvent } from "./feature-event.js";
import type { EventRow } from "./sink.js";
import { runForwardOnce, type FetchLike } from "./forward.js";

const dirs: string[] = [];
function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), "prune-fwd-e2e-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

// --- capturing fetch (no network) ------------------------------------------

interface Captured {
  url: string;
  body: Record<string, unknown>;
}

function capturingFetch(): { fetch: FetchLike; captured: Captured[] } {
  const captured: Captured[] = [];
  const fetch: FetchLike = async (url, init) => {
    captured.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
    return { ok: true, status: 200 };
  };
  return { fetch, captured };
}

// --- minimal COPY of the dashboard's normalizeEvent ------------------------
// Mirrors apps/dashboard/src/lib/event-store.ts:normalizeEvent for the fields
// the forwarder delivers. We do NOT import across the app boundary.

interface StoredEventLite {
  id: string;
  timestamp: string;
  model: string;
  tokensIn: number;
  costUsd: number;
  feature_id: string | null;
  quality_proof: Record<string, unknown> | null;
}

function firstNum(fallback: number, ...candidates: unknown[]): number {
  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c)) return c;
  }
  return fallback;
}
function asString(v: unknown, fallback: string): string {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

function normalizeEvent(raw: Record<string, unknown>): StoredEventLite {
  const tokensIn = firstNum(0, raw.tokensIn, raw.tokens_in);
  const costUsd = firstNum(0, raw.costUsd, raw.estimated_cost_usd);
  const featureId =
    typeof raw.feature_id === "string" && raw.feature_id.length > 0
      ? raw.feature_id
      : null;
  const qualityProof =
    raw.quality_proof !== null &&
    typeof raw.quality_proof === "object" &&
    !Array.isArray(raw.quality_proof)
      ? (raw.quality_proof as Record<string, unknown>)
      : null;
  return {
    id: asString(raw.id, "fallback"),
    timestamp: asString(raw.timestamp, new Date().toISOString()),
    model: asString(raw.model, "unknown"),
    tokensIn,
    costUsd,
    feature_id: featureId,
    quality_proof: qualityProof,
  };
}

// ---------------------------------------------------------------------------

describe("forwarding e2e — seed real sink → runForwardOnce → capture", () => {
  it("delivers exactly the feature rows, advances the cursor, and re-run is a no-op", async () => {
    const dir = tmpDir();
    const dbPath = join(dir, "events.sqlite");
    const cursorPath = join(dir, "forward-cursor.json");
    const endpoint = "http://dashboard.local/api/v1/events";

    // 1. Seed a REAL on-disk sink the way a recording hook would. Three feature
    //    events plus one normal usage turn (feature_id NULL ⇒ NOT forwardable).
    const seedSink = new LocalSqliteSink({ path: dbPath });
    await seedSink.init();
    await recordFeatureEvent(seedSink, {
      featureId: "f9",
      qualityProof: { schemaVersion: 1, featureId: "f9", verdict: "warn" },
      sessionId: "sess-1",
      eventId: "evt-b",
      timestamp: "2026-06-03T00:00:02.000Z",
    });
    await recordFeatureEvent(seedSink, {
      featureId: "f10",
      qualityProof: { schemaVersion: 1, featureId: "f10", savedTokens: 1234 },
      sessionId: "sess-1",
      eventId: "evt-a",
      timestamp: "2026-06-03T00:00:01.000Z",
    });
    await recordFeatureEvent(seedSink, {
      featureId: "f11",
      qualityProof: { schemaVersion: 1, featureId: "f11" },
      sessionId: "sess-1",
      eventId: "evt-c",
      timestamp: "2026-06-03T00:00:03.000Z",
    });
    // A real usage turn — must NOT be forwarded.
    const usage: EventRow = {
      event_id: "usage-1",
      session_id: "sess-1",
      user_id: "local",
      team_id: null,
      timestamp: "2026-06-03T00:00:04.000Z",
      provider: "anthropic",
      tool: "claude-code",
      model: "claude-sonnet-4-5-20250929",
      tokens_in: 5000,
      tokens_out: 800,
      tokens_cached: 0,
      latency_ms: 900,
      estimated_cost_usd: 0.05,
      cumulative_session_cost_usd: 0.05,
      tool_calls: [],
      files_referenced: ["src/secret.ts"],
      compaction_triggered: false,
      context_size_before: 0,
      context_size_after: 0,
      waste_flags: [],
      classification: "productive",
      roi_score: 0.7,
      task_metadata: { type: "edit", repo: null, branch: null },
      feature_id: null,
      quality_proof: null,
    };
    await seedSink.recordEvent(usage);
    await seedSink.close(); // flushes to disk + releases the single-writer lock

    // 2. Run the forwarder against the on-disk DB with a capturing fetch.
    const { fetch, captured } = capturingFetch();
    const res = await runForwardOnce({ dbPath, endpoint, cursorPath, fetchImpl: fetch });

    expect(res.sent).toBe(3);
    expect(res.attempted).toBe(3);
    expect(res.failures).toBe(0);
    expect(res.stoppedOnFailure).toBe(false);

    // Exact rows, in (timestamp, event_id) order — usage-1 absent.
    expect(captured.map((c) => c.body.id)).toEqual(["evt-a", "evt-b", "evt-c"]);
    expect(captured.every((c) => c.url === endpoint)).toBe(true);
    // The non-forwardable usage turn's file path never left the machine.
    const allBodies = JSON.stringify(captured);
    expect(allBodies).not.toContain("usage-1");
    expect(allBodies).not.toContain("src/secret.ts");

    // 3. The cursor file advanced to the last delivered row.
    expect(existsSync(cursorPath)).toBe(true);
    const cursor = JSON.parse(readFileSync(cursorPath, "utf8"));
    expect(cursor).toEqual({
      timestamp: "2026-06-03T00:00:03.000Z",
      eventId: "evt-c",
    });
    expect(res.nextCursor).toEqual(cursor);

    // 4. Each delivered payload survives the dashboard's normalizeEvent boundary
    //    with its feature tag + proof intact.
    const normalized = captured.map((c) => normalizeEvent(c.body));
    expect(normalized.map((n) => n.feature_id)).toEqual(["f10", "f9", "f11"]);
    const f10 = normalized.find((n) => n.id === "evt-a");
    expect(f10?.quality_proof).toEqual({
      schemaVersion: 1,
      featureId: "f10",
      savedTokens: 1234,
    });
    // Feature telemetry carries no usage cost — honest zeros survive too.
    expect(normalized.every((n) => n.tokensIn === 0 && n.costUsd === 0)).toBe(true);

    // 5. A SECOND run from the persisted cursor is a no-op (no re-delivery).
    const { fetch: fetch2, captured: captured2 } = capturingFetch();
    const res2 = await runForwardOnce({
      dbPath,
      endpoint,
      cursorPath,
      fetchImpl: fetch2,
    });
    expect(res2.sent).toBe(0);
    expect(res2.attempted).toBe(0);
    expect(captured2).toHaveLength(0);
  });

  it("a missing DB is a clean no-op (fail-safe, nothing captured)", async () => {
    const dir = tmpDir();
    const { fetch, captured } = capturingFetch();
    const res = await runForwardOnce({
      dbPath: join(dir, "does-not-exist.sqlite"),
      endpoint: "http://x/api/v1/events",
      cursorPath: join(dir, "cursor.json"),
      fetchImpl: fetch,
    });
    expect(res).toEqual({
      attempted: 0,
      sent: 0,
      failures: 0,
      nextCursor: null,
      stoppedOnFailure: false,
    });
    expect(captured).toHaveLength(0);
  });
});
