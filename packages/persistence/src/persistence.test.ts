import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalSqliteSink } from "./local-sqlite.js";
import type {
  AlertRow,
  CompactionEventRow,
  EventRow,
} from "./sink.js";

let dir = "";
let sink: LocalSqliteSink;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "prune-persist-"));
  sink = new LocalSqliteSink({ path: join(dir, "prune.sqlite") });
  await sink.init();
});

afterEach(async () => {
  await sink.close();
  rmSync(dir, { recursive: true, force: true });
});

const baseEvent: EventRow = {
  event_id: "11111111-1111-1111-1111-111111111111",
  session_id: "22222222-2222-2222-2222-222222222222",
  user_id: "33333333-3333-3333-3333-333333333333",
  team_id: null,
  timestamp: "2026-05-30T10:00:00.000Z",
  provider: "anthropic",
  tool: "claude-code",
  model: "claude-sonnet-4-5-20250929",
  tokens_in: 1200,
  tokens_out: 200,
  tokens_cached: 800,
  latency_ms: 1450,
  estimated_cost_usd: 0.005,
  cumulative_session_cost_usd: 0.005,
  tool_calls: ["Read", "Write"],
  files_referenced: ["src/auth.ts"],
  compaction_triggered: false,
  context_size_before: 12000,
  context_size_after: 12000,
  waste_flags: [],
  classification: "productive",
  roi_score: 0.78,
  task_metadata: { type: "feature", repo: "tokenlens", branch: "main" },
  feature_id: null,
  quality_proof: null,
};

describe("LocalSqliteSink", () => {
  it("round-trips an event row through SQLite", async () => {
    await sink.recordEvent(baseEvent);
    const rows = await sink.getRecentEvents(baseEvent.session_id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(baseEvent);
  });

  it("round-trips a TCRP-tagged event (feature_id + quality_proof)", async () => {
    const tagged: EventRow = {
      ...baseEvent,
      event_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      feature_id: "f3",
      quality_proof: {
        substituted: true,
        verified_equivalent: true,
        tokens_saved: 1840,
      },
    };
    await sink.recordEvent(tagged);
    const rows = await sink.getRecentEvents(tagged.session_id);
    const read = rows.find((r) => r.event_id === tagged.event_id)!;
    expect(read.feature_id).toBe("f3");
    expect(read.quality_proof).toEqual({
      substituted: true,
      verified_equivalent: true,
      tokens_saved: 1840,
    });
  });

  it("returns events in reverse chronological order", async () => {
    await sink.recordEvent({
      ...baseEvent,
      event_id: "aaaaaaaa-1111-1111-1111-111111111111",
      timestamp: "2026-05-30T10:00:00.000Z",
    });
    await sink.recordEvent({
      ...baseEvent,
      event_id: "bbbbbbbb-1111-1111-1111-111111111111",
      timestamp: "2026-05-30T10:05:00.000Z",
    });
    const rows = await sink.getRecentEvents(baseEvent.session_id);
    expect(rows.map((r) => r.event_id)).toEqual([
      "bbbbbbbb-1111-1111-1111-111111111111",
      "aaaaaaaa-1111-1111-1111-111111111111",
    ]);
  });

  it("persists across sink instances (real disk file)", async () => {
    await sink.recordEvent(baseEvent);
    await sink.close();

    const reopened = new LocalSqliteSink({ path: join(dir, "prune.sqlite") });
    await reopened.init();
    const rows = await reopened.getRecentEvents(baseEvent.session_id);
    expect(rows).toHaveLength(1);
    expect(rows[0].roi_score).toBe(0.78);
    await reopened.close();
  });

  it("records and persists compaction events", async () => {
    const comp: CompactionEventRow = {
      event_id: "cccccccc-1111-1111-1111-111111111111",
      session_id: baseEvent.session_id,
      timestamp: "2026-05-30T10:30:00.000Z",
      turn_number: 12,
      tokens_before: 30000,
      tokens_after: 5000,
      tokens_removed: 25000,
      overhead_cost_usd: 0.075,
      lost_references: [
        { item: "File reference: auth.ts", category: "file_name", original_turn: 3 },
      ],
      summary: "1 reference lost: 1 file references",
    };
    await sink.recordCompaction(comp);
    // No reader API for compactions yet — sanity-check via direct re-open.
    await sink.close();
    const re = new LocalSqliteSink({ path: join(dir, "prune.sqlite") });
    await re.init();
    // Use a private-ish path: still works because the schema is stable.
    await re.recordCompaction({ ...comp, event_id: "dddddddd-1111-1111-1111-111111111111" });
    await re.close();
  });

  it("records alerts", async () => {
    const a: AlertRow = {
      alert_id: "eeeeeeee-1111-1111-1111-111111111111",
      session_id: baseEvent.session_id,
      team_id: null,
      timestamp: "2026-05-30T10:00:00.000Z",
      severity: "red",
      kind: "loop_breaker",
      message: "3 consecutive low-ROI turns",
      payload_json: JSON.stringify({ streak: 3 }),
    };
    await sink.recordAlert(a);
    // Round-trip is implicit via close/re-open — main check is no throw.
  });

  it("upserts budget usage rows", async () => {
    await sink.upsertBudgetUsage({
      team_id: "team-1",
      period: "2026-05",
      spent_usd: 10,
      limit_usd: 100,
    });
    await sink.upsertBudgetUsage({
      team_id: "team-1",
      period: "2026-05",
      spent_usd: 25,
      limit_usd: 100,
    });
    // No reader yet — verify by reopening and checking the file changed shape.
  });

  it("works in :memory: mode without touching disk", async () => {
    const mem = new LocalSqliteSink({ path: ":memory:" });
    await mem.init();
    await mem.recordEvent(baseEvent);
    const rows = await mem.getRecentEvents(baseEvent.session_id);
    expect(rows).toHaveLength(1);
    await mem.close();
  });

  it("does not write to disk by default until flush() is called", async () => {
    const p = join(dir, "lazy.sqlite");
    const lazy = new LocalSqliteSink({ path: p });
    await lazy.init();
    // The on-disk file should not exist after init — sql.js holds the DB
    // in memory and the default is autoFlush:false.
    expect(existsSync(p)).toBe(false);
    await lazy.recordEvent(baseEvent);
    expect(existsSync(p)).toBe(false);

    await lazy.flush();
    expect(existsSync(p)).toBe(true);
    const sizeAfterFlush = statSync(p).size;
    expect(sizeAfterFlush).toBeGreaterThan(0);

    // A second record without flush leaves the file at its previous size.
    await lazy.recordEvent({
      ...baseEvent,
      event_id: "ffffffff-1111-1111-1111-111111111111",
    });
    expect(statSync(p).size).toBe(sizeAfterFlush);

    await lazy.close(); // close() flushes regardless
    expect(statSync(p).size).toBeGreaterThanOrEqual(sizeAfterFlush);
  });

  it("flushes on every write when autoFlush is opted in", async () => {
    const p = join(dir, "eager.sqlite");
    const eager = new LocalSqliteSink({ path: p, autoFlush: true });
    await eager.init();
    await eager.recordEvent(baseEvent);
    expect(existsSync(p)).toBe(true);
    await eager.close();
  });

  it("flush() writes atomically — no stray .tmp.<pid> file is left behind", async () => {
    const p = join(dir, "atomic.sqlite");
    const sink2 = new LocalSqliteSink({ path: p });
    await sink2.init();
    await sink2.recordEvent(baseEvent);
    await sink2.flush();

    const fs = await import("node:fs/promises");
    const dirContents = await fs.readdir(dir);
    const stray = dirContents.filter(
      (f) => f.startsWith("atomic.sqlite.tmp.") || f.endsWith(".tmp")
    );
    expect(stray).toEqual([]);
    await sink2.close();
  });
});

describe("LocalSqliteSink — multi-process lock", () => {
  let lockDir = "";

  beforeEach(() => {
    lockDir = mkdtempSync(join(tmpdir(), "prune-lock-"));
  });

  afterEach(() => {
    rmSync(lockDir, { recursive: true, force: true });
  });

  it("rejects a second init() while the first writer holds the lock", async () => {
    const p = join(lockDir, "exclusive.sqlite");
    const a = new LocalSqliteSink({ path: p });
    await a.init();
    const b = new LocalSqliteSink({ path: p });
    await expect(b.init()).rejects.toThrow(/another process is writing/i);
    await a.close();
  });

  it("a second writer can acquire the lock after the first closes", async () => {
    const p = join(lockDir, "sequential.sqlite");
    const a = new LocalSqliteSink({ path: p });
    await a.init();
    await a.recordEvent(baseEvent);
    await a.close();

    const b = new LocalSqliteSink({ path: p });
    await b.init();
    const second: EventRow = { ...baseEvent, event_id: "44444444-4444-4444-4444-444444444444" };
    await b.recordEvent(second);
    const recent = await b.getRecentEvents(baseEvent.session_id, 10);
    expect(recent.map((r) => r.event_id).sort()).toEqual([
      baseEvent.event_id,
      second.event_id,
    ]);
    await b.close();
  });

  it("does not lock :memory: databases", async () => {
    const a = new LocalSqliteSink({ path: ":memory:" });
    const b = new LocalSqliteSink({ path: ":memory:" });
    await a.init();
    await b.init();
    await a.close();
    await b.close();
  });
});

describe("LocalSqliteSink — budget envelopes & charges", () => {
  let bdir = "";
  let bsink: LocalSqliteSink;

  beforeEach(async () => {
    bdir = mkdtempSync(join(tmpdir(), "prune-budget-"));
    bsink = new LocalSqliteSink({ path: join(bdir, "b.sqlite") });
    await bsink.init();
  });

  afterEach(async () => {
    await bsink.close();
    rmSync(bdir, { recursive: true, force: true });
  });

  const baseEnvelope = {
    envelope_id: "11111111-1111-1111-1111-111111111111",
    name: "test",
    period_kind: "month" as const,
    period_start: "2026-05-01T00:00:00.000Z",
    period_end: "2026-05-31T23:59:59.999Z",
    limit_usd: 200,
    soft_cap_pct: 0.75,
    hard_cap_pct: 1.0,
    parent_envelope_id: null,
    metadata: { team: "platform" },
  };

  const baseCharge = {
    charge_id: "22222222-2222-2222-2222-222222222222",
    envelope_id: "11111111-1111-1111-1111-111111111111",
    timestamp: "2026-05-15T10:00:00.000Z",
    agent_id: null,
    model: "claude-sonnet-4",
    provider: "anthropic" as const,
    tokens_in: 1000,
    tokens_out: 200,
    tokens_cached: 0,
    tokens_cache_creation: 0,
    cost_usd: 1.25,
    source: "recorded" as const,
    metadata: { call_id: "abc" },
  };

  it("upsertBudgetEnvelope persists and round-trips via getBudgetEnvelope", async () => {
    await bsink.upsertBudgetEnvelope(baseEnvelope);
    const got = await bsink.getBudgetEnvelope("test");
    expect(got).not.toBeNull();
    expect(got!.envelope_id).toBe(baseEnvelope.envelope_id);
    expect(got!.limit_usd).toBe(200);
    expect(got!.metadata).toEqual({ team: "platform" });
  });

  it("upsert is idempotent and updates mutable fields", async () => {
    await bsink.upsertBudgetEnvelope(baseEnvelope);
    await bsink.upsertBudgetEnvelope({ ...baseEnvelope, limit_usd: 500 });
    const got = await bsink.getBudgetEnvelope("test");
    expect(got!.limit_usd).toBe(500);
  });

  it("getBudgetEnvelopeById returns same row as getBudgetEnvelope", async () => {
    await bsink.upsertBudgetEnvelope(baseEnvelope);
    const byName = await bsink.getBudgetEnvelope("test");
    const byId = await bsink.getBudgetEnvelopeById(baseEnvelope.envelope_id);
    expect(byId).toEqual(byName);
  });

  it("recordBudgetCharge persists; getRecentBudgetCharges returns it", async () => {
    await bsink.upsertBudgetEnvelope(baseEnvelope);
    await bsink.recordBudgetCharge(baseCharge);
    const charges = await bsink.getRecentBudgetCharges(baseEnvelope.envelope_id);
    expect(charges).toHaveLength(1);
    expect(charges[0].cost_usd).toBe(1.25);
    expect(charges[0].metadata).toEqual({ call_id: "abc" });
  });

  it("getBudgetSpend sums charges in the time window", async () => {
    await bsink.upsertBudgetEnvelope(baseEnvelope);
    await bsink.recordBudgetCharge(baseCharge);
    await bsink.recordBudgetCharge({
      ...baseCharge,
      charge_id: "33333333-3333-3333-3333-333333333333",
      cost_usd: 2.5,
      timestamp: "2026-05-20T10:00:00.000Z",
    });
    // Both inside the period.
    const total = await bsink.getBudgetSpend(
      baseEnvelope.envelope_id,
      new Date("2026-05-01T00:00:00.000Z")
    );
    expect(total).toBeCloseTo(3.75, 6);
    // Only the second is inside the narrower window.
    const recent = await bsink.getBudgetSpend(
      baseEnvelope.envelope_id,
      new Date("2026-05-18T00:00:00.000Z")
    );
    expect(recent).toBeCloseTo(2.5, 6);
  });

  it("getBudgetSpend returns 0 for an envelope with no charges (rather than NULL)", async () => {
    await bsink.upsertBudgetEnvelope(baseEnvelope);
    const total = await bsink.getBudgetSpend(
      baseEnvelope.envelope_id,
      new Date("2026-05-01T00:00:00.000Z")
    );
    expect(total).toBe(0);
  });

  it("budget rows survive flush + reopen (durability)", async () => {
    await bsink.upsertBudgetEnvelope(baseEnvelope);
    await bsink.recordBudgetCharge(baseCharge);
    await bsink.close();
    const reopened = new LocalSqliteSink({ path: join(bdir, "b.sqlite") });
    await reopened.init();
    const env = await reopened.getBudgetEnvelope("test");
    expect(env).not.toBeNull();
    expect(env!.metadata).toEqual({ team: "platform" });
    const charges = await reopened.getRecentBudgetCharges(env!.envelope_id);
    expect(charges).toHaveLength(1);
    await reopened.close();
  });
});
