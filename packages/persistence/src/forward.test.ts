/**
 * Tests for the local→dashboard feature-telemetry forwarder.
 *
 * Covers the core delivery loop (in-order, stop-on-failure, no gaps, idempotent
 * resume), the cursor file I/O, the EventRow→ingest mapping, and the
 * end-to-end runForwardOnce orchestration against a real on-disk sqlite — all
 * with an injected fetch so no network is touched.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalSqliteSink } from "./local-sqlite.js";
import { buildFeatureEventRow } from "./feature-event.js";
import type { EventRow, EventCursor } from "./sink.js";
import {
  eventToIngestPayload,
  forwardFeatureEvents,
  loadCursor,
  saveCursor,
  runForwardOnce,
  type FetchLike,
  type ForwardableSource,
} from "./forward.js";

const dirs: string[] = [];
function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), "prune-forward-"));
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

// --- fakes -----------------------------------------------------------------

interface RecordedPost {
  url: string;
  body: Record<string, unknown>;
}

/**
 * A fake fetch that records each POST and accepts all of them, unless
 * `failAt` is set to a 1-based call index (that call and onward fail until the
 * index passes — we only ever need the first failure).
 */
function fakeFetch(opts: { failAt?: number; throwAt?: number } = {}): {
  fetch: FetchLike;
  posts: RecordedPost[];
} {
  const posts: RecordedPost[] = [];
  let n = 0;
  const fetch: FetchLike = async (url, init) => {
    n++;
    if (opts.throwAt && n === opts.throwAt) {
      throw new Error("simulated network error");
    }
    const body = JSON.parse(init.body) as Record<string, unknown>;
    if (opts.failAt && n >= opts.failAt) {
      return { ok: false, status: 503 };
    }
    posts.push({ url, body });
    return { ok: true, status: 200 };
  };
  return { fetch, posts };
}

/** An in-memory ForwardableSource over a fixed, pre-sorted row list. */
function memorySource(rows: EventRow[]): ForwardableSource {
  const sorted = [...rows].sort((a, b) =>
    a.timestamp === b.timestamp
      ? a.event_id.localeCompare(b.event_id)
      : a.timestamp.localeCompare(b.timestamp)
  );
  return {
    async getForwardableEvents(cursor: EventCursor | null, limit = 100) {
      const after = sorted.filter((r) =>
        !cursor
          ? true
          : r.timestamp > cursor.timestamp ||
            (r.timestamp === cursor.timestamp && r.event_id > cursor.eventId)
      );
      return after.slice(0, limit);
    },
  };
}

function featureRow(over: {
  eventId: string;
  timestamp: string;
  featureId?: string;
  proof?: Record<string, unknown>;
}): EventRow {
  return buildFeatureEventRow({
    featureId: over.featureId ?? "f10",
    qualityProof: over.proof ?? { featureId: over.featureId ?? "f10", k: 1 },
    sessionId: "sess",
    eventId: over.eventId,
    timestamp: over.timestamp,
  });
}

// --- eventToIngestPayload ---------------------------------------------------

describe("eventToIngestPayload", () => {
  it("maps the row to the ingest's snake_case shape with id = event_id", () => {
    const row = featureRow({
      eventId: "evt-1",
      timestamp: "2026-06-03T00:00:00.000Z",
      featureId: "f9",
      proof: { featureId: "f9", verdict: "warn" },
    });
    const p = eventToIngestPayload(row);
    expect(p.id).toBe("evt-1");
    expect(p.feature_id).toBe("f9");
    expect(p.quality_proof).toEqual({ featureId: "f9", verdict: "warn" });
    expect(p.tokens_in).toBe(0);
    expect(p.estimated_cost_usd).toBe(0);
    expect(p.provider).toBe("anthropic");
    expect(p).toHaveProperty("model");
  });
});

// --- forwardFeatureEvents core ---------------------------------------------

describe("forwardFeatureEvents — happy path", () => {
  it("ships every row in (timestamp, event_id) order and advances the cursor", async () => {
    const rows = [
      featureRow({ eventId: "b", timestamp: "2026-06-03T00:00:02.000Z" }),
      featureRow({ eventId: "a", timestamp: "2026-06-03T00:00:01.000Z" }),
      featureRow({ eventId: "a2", timestamp: "2026-06-03T00:00:01.000Z" }),
    ];
    const { fetch, posts } = fakeFetch();
    const res = await forwardFeatureEvents(memorySource(rows), {
      endpoint: "http://x/api/v1/events",
      fetchImpl: fetch,
    });
    expect(res.sent).toBe(3);
    expect(res.failures).toBe(0);
    expect(res.stoppedOnFailure).toBe(false);
    // Order: a (ts1), a2 (ts1, id tiebreak), b (ts2).
    expect(posts.map((p) => p.body.id)).toEqual(["a", "a2", "b"]);
    expect(res.nextCursor).toEqual({
      timestamp: "2026-06-03T00:00:02.000Z",
      eventId: "b",
    });
  });

  it("calls onCursorAdvance once per accepted event", async () => {
    const rows = [
      featureRow({ eventId: "a", timestamp: "2026-06-03T00:00:01.000Z" }),
      featureRow({ eventId: "b", timestamp: "2026-06-03T00:00:02.000Z" }),
    ];
    const advances: EventCursor[] = [];
    const { fetch } = fakeFetch();
    await forwardFeatureEvents(memorySource(rows), {
      endpoint: "http://x",
      fetchImpl: fetch,
      onCursorAdvance: (c) => {
        advances.push(c);
      },
    });
    expect(advances.map((c) => c.eventId)).toEqual(["a", "b"]);
  });

  it("resuming from a cursor forwards only newer events (idempotent re-run)", async () => {
    const rows = [
      featureRow({ eventId: "a", timestamp: "2026-06-03T00:00:01.000Z" }),
      featureRow({ eventId: "b", timestamp: "2026-06-03T00:00:02.000Z" }),
    ];
    const { fetch, posts } = fakeFetch();
    const res = await forwardFeatureEvents(memorySource(rows), {
      endpoint: "http://x",
      fetchImpl: fetch,
      cursor: { timestamp: "2026-06-03T00:00:01.000Z", eventId: "a" },
    });
    expect(res.sent).toBe(1);
    expect(posts.map((p) => p.body.id)).toEqual(["b"]);
  });

  it("a fully caught-up cursor sends nothing", async () => {
    const rows = [featureRow({ eventId: "a", timestamp: "2026-06-03T00:00:01.000Z" })];
    const { fetch, posts } = fakeFetch();
    const res = await forwardFeatureEvents(memorySource(rows), {
      endpoint: "http://x",
      fetchImpl: fetch,
      cursor: { timestamp: "2026-06-03T00:00:01.000Z", eventId: "a" },
    });
    expect(res.sent).toBe(0);
    expect(posts).toHaveLength(0);
  });
});

describe("forwardFeatureEvents — failure handling (no gaps)", () => {
  it("stops at the first non-ok status; cursor sits at the last success", async () => {
    const rows = [
      featureRow({ eventId: "a", timestamp: "2026-06-03T00:00:01.000Z" }),
      featureRow({ eventId: "b", timestamp: "2026-06-03T00:00:02.000Z" }),
      featureRow({ eventId: "c", timestamp: "2026-06-03T00:00:03.000Z" }),
    ];
    const { fetch, posts } = fakeFetch({ failAt: 2 }); // 2nd POST fails
    const res = await forwardFeatureEvents(memorySource(rows), {
      endpoint: "http://x",
      fetchImpl: fetch,
    });
    expect(res.sent).toBe(1);
    expect(res.failures).toBe(1);
    expect(res.stoppedOnFailure).toBe(true);
    expect(posts.map((p) => p.body.id)).toEqual(["a"]); // c never attempted
    expect(res.nextCursor).toEqual({
      timestamp: "2026-06-03T00:00:01.000Z",
      eventId: "a",
    });
  });

  it("a thrown fetch is contained as a failure (never propagates)", async () => {
    const rows = [featureRow({ eventId: "a", timestamp: "2026-06-03T00:00:01.000Z" })];
    const { fetch } = fakeFetch({ throwAt: 1 });
    const res = await forwardFeatureEvents(memorySource(rows), {
      endpoint: "http://x",
      fetchImpl: fetch,
    });
    expect(res.sent).toBe(0);
    expect(res.failures).toBe(1);
    expect(res.stoppedOnFailure).toBe(true);
    expect(res.nextCursor).toBeNull();
  });

  it("a source read error resolves to an empty result (no throw)", async () => {
    const badSource: ForwardableSource = {
      async getForwardableEvents() {
        throw new Error("db read blew up");
      },
    };
    const { fetch } = fakeFetch();
    const res = await forwardFeatureEvents(badSource, {
      endpoint: "http://x",
      fetchImpl: fetch,
    });
    expect(res).toMatchObject({ sent: 0, failures: 0, attempted: 0 });
  });
});

describe("forwardFeatureEvents — bounded work", () => {
  it("never ships more than maxEvents in one run", async () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      featureRow({
        eventId: `e${String(i).padStart(2, "0")}`,
        timestamp: `2026-06-03T00:00:${String(i).padStart(2, "0")}.000Z`,
      })
    );
    const { fetch, posts } = fakeFetch();
    const res = await forwardFeatureEvents(memorySource(rows), {
      endpoint: "http://x",
      fetchImpl: fetch,
      batchSize: 3,
      maxEvents: 7,
    });
    expect(res.sent).toBe(7);
    expect(posts).toHaveLength(7);
    expect(res.nextCursor?.eventId).toBe("e06");
  });
});

// --- cursor file I/O --------------------------------------------------------

describe("loadCursor / saveCursor", () => {
  it("round-trips a cursor through an atomic write", () => {
    const path = join(tmpDir(), "nested", "cursor.json");
    const c: EventCursor = { timestamp: "2026-06-03T00:00:01.000Z", eventId: "x" };
    saveCursor(path, c);
    expect(existsSync(path)).toBe(true);
    expect(loadCursor(path)).toEqual(c);
  });

  it("returns null for a missing file", () => {
    expect(loadCursor(join(tmpDir(), "nope.json"))).toBeNull();
  });

  it("returns null for a corrupt/shape-wrong file (never throws)", () => {
    const dir = tmpDir();
    const p1 = join(dir, "bad.json");
    saveCursor(join(dir, "ok.json"), { timestamp: "t", eventId: "e" });
    // Write garbage by hand.
    writeFileSync(p1, "{not json");
    expect(loadCursor(p1)).toBeNull();
    const p2 = join(dir, "wrong.json");
    writeFileSync(p2, JSON.stringify({ timestamp: 5 }));
    expect(loadCursor(p2)).toBeNull();
  });
});

// --- getForwardableEvents (real sink) + runForwardOnce ----------------------

async function seedDb(
  path: string,
  rows: EventRow[]
): Promise<void> {
  const sink = new LocalSqliteSink({ path });
  await sink.init();
  for (const r of rows) await sink.recordEvent(r);
  await sink.close(); // flushes to disk
}

describe("LocalSqliteSink.getForwardableEvents", () => {
  it("returns only feature-tagged rows, in forward order, after the cursor", async () => {
    const path = join(tmpDir(), "events.sqlite");
    // A non-feature usage row (feature_id null) must be excluded.
    const plain: EventRow = {
      ...featureRow({ eventId: "plain", timestamp: "2026-06-03T00:00:00.000Z" }),
      feature_id: null,
      quality_proof: null,
    };
    await seedDb(path, [
      plain,
      featureRow({ eventId: "a", timestamp: "2026-06-03T00:00:01.000Z", featureId: "f9" }),
      featureRow({ eventId: "b", timestamp: "2026-06-03T00:00:02.000Z", featureId: "f10" }),
    ]);

    const sink = new LocalSqliteSink({ path });
    await sink.init();
    try {
      const all = await sink.getForwardableEvents(null, 100);
      expect(all.map((r) => r.event_id)).toEqual(["a", "b"]); // plain excluded
      const after = await sink.getForwardableEvents(
        { timestamp: "2026-06-03T00:00:01.000Z", eventId: "a" },
        100
      );
      expect(after.map((r) => r.event_id)).toEqual(["b"]);
    } finally {
      await sink.close();
    }
  });
});

describe("runForwardOnce — end to end", () => {
  it("forwards seeded feature events, writes the cursor, and re-runs as a no-op", async () => {
    const dir = tmpDir();
    const dbPath = join(dir, "events.sqlite");
    const cursorPath = join(dir, "cursor.json");
    await seedDb(dbPath, [
      featureRow({ eventId: "a", timestamp: "2026-06-03T00:00:01.000Z", featureId: "f9" }),
      featureRow({ eventId: "b", timestamp: "2026-06-03T00:00:02.000Z", featureId: "f10" }),
    ]);

    const first = fakeFetch();
    const res1 = await runForwardOnce({
      dbPath,
      endpoint: "http://x/api/v1/events",
      cursorPath,
      fetchImpl: first.fetch,
    });
    expect(res1.sent).toBe(2);
    expect(first.posts.map((p) => p.body.id)).toEqual(["a", "b"]);
    expect(loadCursor(cursorPath)).toEqual({
      timestamp: "2026-06-03T00:00:02.000Z",
      eventId: "b",
    });

    // Second run: cursor is caught up ⇒ nothing forwarded.
    const second = fakeFetch();
    const res2 = await runForwardOnce({
      dbPath,
      endpoint: "http://x/api/v1/events",
      cursorPath,
      fetchImpl: second.fetch,
    });
    expect(res2.sent).toBe(0);
    expect(second.posts).toHaveLength(0);
  });

  it("a new event after a successful run is the only thing forwarded next time", async () => {
    const dir = tmpDir();
    const dbPath = join(dir, "events.sqlite");
    const cursorPath = join(dir, "cursor.json");
    await seedDb(dbPath, [
      featureRow({ eventId: "a", timestamp: "2026-06-03T00:00:01.000Z", featureId: "f9" }),
    ]);
    const r1 = fakeFetch();
    await runForwardOnce({ dbPath, endpoint: "http://x", cursorPath, fetchImpl: r1.fetch });
    expect(r1.posts.map((p) => p.body.id)).toEqual(["a"]);

    // Append a newer event, then forward again.
    await seedDb(dbPath, [
      featureRow({ eventId: "b", timestamp: "2026-06-03T00:00:05.000Z", featureId: "f10" }),
    ]);
    const r2 = fakeFetch();
    const res = await runForwardOnce({ dbPath, endpoint: "http://x", cursorPath, fetchImpl: r2.fetch });
    expect(res.sent).toBe(1);
    expect(r2.posts.map((p) => p.body.id)).toEqual(["b"]);
  });

  it("a missing DB is an empty no-op (not an error)", async () => {
    const dir = tmpDir();
    const res = await runForwardOnce({
      dbPath: join(dir, "absent.sqlite"),
      endpoint: "http://x",
      cursorPath: join(dir, "cursor.json"),
      fetchImpl: fakeFetch().fetch,
    });
    expect(res).toMatchObject({ sent: 0, attempted: 0, failures: 0 });
  });

  it("a held write-lock makes the run a best-effort skip (no throw)", async () => {
    const dir = tmpDir();
    const dbPath = join(dir, "events.sqlite");
    const cursorPath = join(dir, "cursor.json");
    await seedDb(dbPath, [
      featureRow({ eventId: "a", timestamp: "2026-06-03T00:00:01.000Z", featureId: "f9" }),
    ]);
    // Hold the lock with a live sink, then attempt to forward concurrently.
    const holder = new LocalSqliteSink({ path: dbPath });
    await holder.init();
    try {
      const res = await runForwardOnce({
        dbPath,
        endpoint: "http://x",
        cursorPath,
        fetchImpl: fakeFetch().fetch,
      });
      expect(res.sent).toBe(0); // skipped, did not throw
    } finally {
      await holder.close();
    }
  });
});
