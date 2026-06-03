import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { sql } from "@prune/db/orm";
import { PostgresSink, type DrizzleDb } from "./postgres.js";
import type {
  AlertRow,
  BudgetChargeRow,
  BudgetEnvelopeRow,
  BudgetUsageRow,
  CompactionEventRow,
  EventRow,
  ReplayLogRow,
  SloDefinitionRow,
} from "./sink.js";

/**
 * REAL Postgres integration test for PostgresSink.
 *
 * Unlike postgres.test.ts (which exercises the JS-side result shaping against a
 * hand-built QueryStub that ignores its arguments), this suite runs PostgresSink
 * against an in-memory **PGlite** Postgres (WASM, no server). Every query the
 * sink builds is therefore actually COMPILED TO SQL AND EXECUTED — so the
 * onConflict targets, `set:` clauses, column references, the `gte(...ISO)`
 * window comparison, jsonb insert/read behavior, and the (session_id, sequence)
 * unique index are all genuinely proven, not assumed.
 *
 * The DDL below is written by hand to match the persistence_* tables in
 * packages/db/src/schema.ts (the schema is provisioned out-of-band by
 * drizzle-kit migrate in production; PGlite has no migration history, so we
 * create the tables explicitly). If a column name / conflict target / index in
 * the sink drifts from the schema, a query here fails to compile or execute.
 */

const DDL = `
  create table persistence_events (
    event_id text primary key,
    session_id text not null,
    user_id text not null,
    team_id text,
    timestamp text not null,
    provider text not null,
    tool text not null,
    model text not null,
    tokens_in integer not null,
    tokens_out integer not null,
    tokens_cached integer not null default 0,
    latency_ms integer not null,
    estimated_cost_usd real not null,
    cumulative_session_cost_usd real not null,
    tool_calls jsonb not null default '[]',
    files_referenced jsonb not null default '[]',
    compaction_triggered boolean not null default false,
    context_size_before integer not null default 0,
    context_size_after integer not null default 0,
    waste_flags jsonb not null default '[]',
    classification text not null,
    roi_score real not null,
    task_metadata jsonb not null,
    feature_id text,
    quality_proof jsonb default null
  );

  create table persistence_compactions (
    event_id text primary key,
    session_id text not null,
    timestamp text not null,
    turn_number integer not null,
    tokens_before integer not null,
    tokens_after integer not null,
    tokens_removed integer not null,
    overhead_cost_usd real not null,
    lost_references jsonb not null default '[]',
    summary text not null
  );

  create table persistence_alerts (
    alert_id text primary key,
    session_id text not null,
    team_id text,
    timestamp text not null,
    severity text not null,
    kind text not null,
    message text not null,
    payload_json text not null
  );

  create table persistence_budget_usage (
    team_id text not null,
    period text not null,
    spent_usd real not null,
    limit_usd real not null,
    primary key (team_id, period)
  );

  create table persistence_budget_envelopes (
    envelope_id text primary key,
    name text not null unique,
    period_kind text not null,
    period_start text not null,
    period_end text not null,
    limit_usd real not null,
    soft_cap_pct real not null default 0.75,
    hard_cap_pct real not null default 1.0,
    parent_envelope_id text,
    metadata jsonb not null default '{}'
  );

  create table persistence_budget_charges (
    charge_id text primary key,
    envelope_id text not null,
    timestamp text not null,
    agent_id text,
    model text not null,
    provider text not null,
    tokens_in integer not null,
    tokens_out integer not null,
    tokens_cached integer not null default 0,
    tokens_cache_creation integer not null default 0,
    cost_usd real not null,
    source text not null,
    metadata jsonb not null default '{}'
  );

  create table persistence_slo_definitions (
    slo_id text primary key,
    name text not null unique,
    scope_envelope_id text not null,
    target_usd_per_task real not null,
    error_budget_usd real not null,
    window_days integer not null,
    warning_pct real not null default 0.5,
    task_dimension text not null default 'agent_id',
    metadata jsonb not null default '{}'
  );

  create table persistence_replay_log (
    record_id text primary key,
    session_id text not null,
    sequence integer not null,
    timestamp text not null,
    kind text not null,
    payload_canonical text not null,
    record_hash text not null,
    prev_record_hash text,
    signature text not null,
    signer_fingerprint text not null,
    metadata jsonb not null default '{}'
  );

  create unique index uq_persistence_replay_session_seq
    on persistence_replay_log (session_id, sequence);
`;

const TRUNCATE_ALL = `
  truncate table
    persistence_events,
    persistence_compactions,
    persistence_alerts,
    persistence_budget_usage,
    persistence_budget_envelopes,
    persistence_budget_charges,
    persistence_slo_definitions,
    persistence_replay_log;
`;

let client: PGlite;
let db: DrizzleDb;
let sink: PostgresSink;

/**
 * Raw read for assertions the sink has no reader for (compactions/alerts/usage)
 * or for counting rows. The drizzle pglite adapter's `execute()` returns
 * `{ rows, fields, affectedRows }` (postgres-js returns the rows directly), so
 * we normalise to the row array here. The sink's own queries use `.select()`,
 * which returns arrays on both drivers.
 */
async function rawRows(
  query: Parameters<DrizzleDb["execute"]>[0]
): Promise<Array<Record<string, unknown>>> {
  const res = (await db.execute(query)) as unknown;
  if (Array.isArray(res)) return res as Array<Record<string, unknown>>;
  return (res as { rows: Array<Record<string, unknown>> }).rows;
}

beforeAll(async () => {
  client = new PGlite();
  // The pglite adapter is structurally compatible with the postgres-js drizzle
  // type the sink declares; cast at this single boundary.
  db = drizzlePglite(client) as unknown as DrizzleDb;
  // PGlite's prepared-statement path rejects multi-statement strings, so the
  // DDL (and per-test TRUNCATE) go through the raw client's batch `exec`.
  await client.exec(DDL);
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  // Truncate between tests for isolation. Order doesn't matter (no FKs).
  await client.exec(TRUNCATE_ALL);
  sink = new PostgresSink({ db });
});

// ---------------------------------------------------------------------------
// Sample rows — fully populated, with non-trivial jsonb and a null-bearing
// variant per row type, so the round-trip proves null-normalisation too.
// ---------------------------------------------------------------------------

const sampleEvent: EventRow = {
  event_id: "ev-1",
  session_id: "sess-1",
  user_id: "user-1",
  team_id: "team-1",
  timestamp: "2026-05-15T12:00:00.000Z",
  provider: "anthropic",
  tool: "claude-code",
  model: "claude-sonnet-4",
  tokens_in: 100,
  tokens_out: 200,
  tokens_cached: 10,
  latency_ms: 1234,
  estimated_cost_usd: 0.0123,
  cumulative_session_cost_usd: 0.5,
  tool_calls: ["read", "edit"],
  files_referenced: ["a.ts", "b.ts"],
  compaction_triggered: true,
  context_size_before: 5000,
  context_size_after: 3000,
  waste_flags: ["dup_read"],
  classification: "productive",
  roi_score: 0.87,
  task_metadata: { type: "feature", repo: "tokenlens", branch: "main" },
  feature_id: "f3",
  quality_proof: { substitution_verified: true, tokens_saved: 1500 },
};

const sampleCompaction: CompactionEventRow = {
  event_id: "comp-1",
  session_id: "sess-1",
  timestamp: "2026-05-15T12:05:00.000Z",
  turn_number: 7,
  tokens_before: 8000,
  tokens_after: 2000,
  tokens_removed: 6000,
  overhead_cost_usd: 0.02,
  lost_references: [
    { item: "jwt expiry decision", category: "configuration", original_turn: 4 },
  ],
  summary: "compacted at turn 7",
};

const sampleAlert: AlertRow = {
  alert_id: "al-1",
  session_id: "sess-1",
  team_id: "team-1",
  timestamp: "2026-05-15T12:06:00.000Z",
  severity: "red",
  kind: "loop_breaker",
  message: "same edit 4x",
  payload_json: '{"attempts":4}',
};

const sampleUsage: BudgetUsageRow = {
  team_id: "team-1",
  period: "2026-05-01",
  spent_usd: 42.5,
  limit_usd: 200,
};

const sampleEnvelope: BudgetEnvelopeRow = {
  envelope_id: "env-1",
  name: "team-budget",
  period_kind: "month",
  period_start: "2026-05-01T00:00:00.000Z",
  period_end: "2026-05-31T23:59:59.999Z",
  limit_usd: 200,
  soft_cap_pct: 0.75,
  hard_cap_pct: 1.0,
  parent_envelope_id: null,
  metadata: { owner: "platform", nested: { a: 1 } },
};

const charge = (
  id: string,
  ts: string,
  overrides: Partial<BudgetChargeRow> = {}
): BudgetChargeRow => ({
  charge_id: id,
  envelope_id: "env-1",
  timestamp: ts,
  agent_id: "agent-1",
  model: "claude-sonnet-4",
  provider: "anthropic",
  tokens_in: 100,
  tokens_out: 200,
  tokens_cached: 0,
  tokens_cache_creation: 0,
  cost_usd: 1.0,
  source: "recorded",
  metadata: { task: "x" },
  ...overrides,
});

const sampleSlo: SloDefinitionRow = {
  slo_id: "slo-1",
  name: "cost-per-task",
  scope_envelope_id: "env-1",
  target_usd_per_task: 0.5,
  error_budget_usd: 10,
  window_days: 30,
  warning_pct: 0.5,
  task_dimension: "agent_id",
  metadata: { tier: "gold" },
};

const replay = (
  id: string,
  sessionId: string,
  sequence: number,
  overrides: Partial<ReplayLogRow> = {}
): ReplayLogRow => ({
  record_id: id,
  session_id: sessionId,
  sequence,
  timestamp: "2026-05-15T12:00:00.000Z",
  kind: "request",
  payload_canonical: '{"k":"v"}',
  record_hash: "hash-" + id,
  prev_record_hash: null,
  signature: "AA==",
  signer_fingerprint: "fp-1",
  metadata: { origin: "test" },
  ...overrides,
});

// ===========================================================================
// Round-trip fidelity: write via sink -> read via sink -> deep equal.
// This is the claim HIGH-2 said was unproven; it is now executed against SQL.
// ===========================================================================

describe("PostgresSink round-trip (real PGlite execution)", () => {
  it("EventRow: recordEvent -> getRecentEvents reads back identical", async () => {
    await sink.recordEvent(sampleEvent);
    const out = await sink.getRecentEvents("sess-1");
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual(sampleEvent);
  });

  it("EventRow with null team_id / feature_id / quality_proof round-trips", async () => {
    const r: EventRow = {
      ...sampleEvent,
      event_id: "ev-null",
      team_id: null,
      feature_id: null,
      quality_proof: null,
      task_metadata: { type: "chore", repo: null, branch: null },
    };
    await sink.recordEvent(r);
    const out = await sink.getRecentEvents("sess-1");
    expect(out[0]).toEqual(r);
  });

  it("CompactionEventRow round-trips (and SQL executes)", async () => {
    // No sink reader exists for compactions; verify the INSERT executes and the
    // row is materialised by reading the raw count + columns.
    await sink.recordCompaction(sampleCompaction);
    const arr = await rawRows(
      sql`select event_id, lost_references from persistence_compactions where event_id = 'comp-1'`
    );
    expect(arr).toHaveLength(1);
    expect(arr[0].lost_references).toEqual(sampleCompaction.lost_references);
  });

  it("AlertRow INSERT executes with opaque payload_json passed through", async () => {
    await sink.recordAlert(sampleAlert);
    const rows = await rawRows(
      sql`select payload_json from persistence_alerts where alert_id = 'al-1'`
    );
    expect(rows[0].payload_json).toBe('{"attempts":4}');
  });

  it("BudgetUsageRow upsert executes", async () => {
    await sink.upsertBudgetUsage(sampleUsage);
    const rows = await rawRows(
      sql`select spent_usd, limit_usd from persistence_budget_usage where team_id = 'team-1' and period = '2026-05-01'`
    );
    expect(Number(rows[0].spent_usd)).toBeCloseTo(42.5, 6);
  });

  it("BudgetEnvelopeRow: upsert -> getBudgetEnvelope / ById read back identical", async () => {
    await sink.upsertBudgetEnvelope(sampleEnvelope);
    expect(await sink.getBudgetEnvelope("team-budget")).toEqual(sampleEnvelope);
    expect(await sink.getBudgetEnvelopeById("env-1")).toEqual(sampleEnvelope);
  });

  it("BudgetChargeRow: record -> getRecentBudgetCharges reads back identical", async () => {
    const c = charge("ch-1", "2026-05-10T00:00:00.000Z");
    await sink.recordBudgetCharge(c);
    const out = await sink.getRecentBudgetCharges("env-1");
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual(c);
  });

  it("BudgetChargeRow with null agent_id round-trips", async () => {
    const c = charge("ch-null", "2026-05-10T00:00:00.000Z", {
      agent_id: null,
      source: "reserved",
    });
    await sink.recordBudgetCharge(c);
    const out = await sink.getRecentBudgetCharges("env-1");
    expect(out[0]).toEqual(c);
  });

  it("SloDefinitionRow: upsert -> getSloDefinition / list read back identical", async () => {
    await sink.upsertSloDefinition(sampleSlo);
    expect(await sink.getSloDefinition("cost-per-task")).toEqual(sampleSlo);
    expect(await sink.listSloDefinitions()).toEqual([sampleSlo]);
  });

  it("ReplayLogRow: append -> getReplayLogBySession / latest read back identical", async () => {
    const r = replay("rl-1", "sess-rt", 1);
    await sink.appendReplayLog(r);
    expect(await sink.getReplayLogBySession("sess-rt")).toEqual([r]);
    expect(await sink.getLatestReplayLog("sess-rt")).toEqual(r);
  });
});

// ===========================================================================
// Upsert conflict TARGETS actually upsert: write same PK twice -> one row,
// last write wins. A wrong conflict target would either error (no unique
// index) or produce two rows.
// ===========================================================================

describe("PostgresSink upsert conflict targets (last-wins)", () => {
  it("recordEvent on same event_id updates, not duplicates", async () => {
    await sink.recordEvent(sampleEvent);
    await sink.recordEvent({ ...sampleEvent, roi_score: 0.11, tool: "codex" });
    const out = await sink.getRecentEvents("sess-1");
    expect(out).toHaveLength(1);
    expect(out[0].roi_score).toBeCloseTo(0.11, 6);
    expect(out[0].tool).toBe("codex");
  });

  it("recordCompaction on same event_id updates, not duplicates", async () => {
    await sink.recordCompaction(sampleCompaction);
    await sink.recordCompaction({ ...sampleCompaction, summary: "v2" });
    const rows = await rawRows(
      sql`select count(*)::int as n, max(summary) as s from persistence_compactions`
    );
    expect(rows[0].n).toBe(1);
    expect(rows[0].s).toBe("v2");
  });

  it("recordAlert on same alert_id updates, not duplicates", async () => {
    await sink.recordAlert(sampleAlert);
    await sink.recordAlert({ ...sampleAlert, message: "now 5x" });
    const rows = await rawRows(
      sql`select count(*)::int as n, max(message) as m from persistence_alerts`
    );
    expect(rows[0].n).toBe(1);
    expect(rows[0].m).toBe("now 5x");
  });

  it("upsertBudgetUsage on same (team_id, period) updates the composite-PK row", async () => {
    await sink.upsertBudgetUsage(sampleUsage);
    await sink.upsertBudgetUsage({ ...sampleUsage, spent_usd: 99 });
    const rows = await rawRows(
      sql`select count(*)::int as n, max(spent_usd) as s from persistence_budget_usage`
    );
    expect(rows[0].n).toBe(1);
    expect(Number(rows[0].s)).toBeCloseTo(99, 6);
  });

  it("upsertBudgetEnvelope on same envelope_id updates the set: columns", async () => {
    await sink.upsertBudgetEnvelope(sampleEnvelope);
    await sink.upsertBudgetEnvelope({ ...sampleEnvelope, limit_usd: 500, name: "team-budget" });
    const env = await sink.getBudgetEnvelopeById("env-1");
    expect(env!.limit_usd).toBeCloseTo(500, 6);
    expect(await sink.getBudgetEnvelope("team-budget")).not.toBeNull();
  });

  it("recordBudgetCharge on same charge_id updates, not duplicates", async () => {
    await sink.recordBudgetCharge(charge("ch-1", "2026-05-10T00:00:00.000Z"));
    await sink.recordBudgetCharge(
      charge("ch-1", "2026-05-10T00:00:00.000Z", { cost_usd: 9.5 })
    );
    const out = await sink.getRecentBudgetCharges("env-1");
    expect(out).toHaveLength(1);
    expect(out[0].cost_usd).toBeCloseTo(9.5, 6);
  });

  it("upsertSloDefinition on same slo_id updates the set: columns", async () => {
    await sink.upsertSloDefinition(sampleSlo);
    await sink.upsertSloDefinition({ ...sampleSlo, error_budget_usd: 25 });
    const slo = await sink.getSloDefinition("cost-per-task");
    expect(slo!.error_budget_usd).toBeCloseTo(25, 6);
    expect(await sink.listSloDefinitions()).toHaveLength(1);
  });
});

// ===========================================================================
// getBudgetSpend window boundary + SUM coercion (real numeric SUM from SQL).
// ===========================================================================

describe("PostgresSink.getBudgetSpend (real SQL SUM + window)", () => {
  beforeEach(async () => {
    await sink.recordBudgetCharge(
      charge("c-old", "2026-04-30T23:59:59.999Z", { cost_usd: 5 })
    );
    await sink.recordBudgetCharge(
      charge("c-boundary", "2026-05-01T00:00:00.000Z", { cost_usd: 2 })
    );
    await sink.recordBudgetCharge(
      charge("c-after", "2026-05-15T00:00:00.000Z", { cost_usd: 3 })
    );
    // Different envelope — must be excluded by the envelope_id predicate.
    await sink.recordBudgetCharge(
      charge("c-other", "2026-05-15T00:00:00.000Z", {
        envelope_id: "env-2",
        cost_usd: 100,
      })
    );
  });

  it("sums only charges with timestamp >= since (boundary is inclusive)", async () => {
    const since = new Date("2026-05-01T00:00:00.000Z");
    // includes c-boundary (2) + c-after (3) = 5; excludes c-old and env-2.
    expect(await sink.getBudgetSpend("env-1", since)).toBeCloseTo(5, 6);
  });

  it("excludes a charge strictly before `since`", async () => {
    const since = new Date("2026-05-01T00:00:00.001Z");
    // now only c-after (3) qualifies.
    expect(await sink.getBudgetSpend("env-1", since)).toBeCloseTo(3, 6);
  });

  it("returns a number (not a string) and 0 for an envelope with no charges", async () => {
    const total = await sink.getBudgetSpend("env-none", new Date("2000-01-01T00:00:00Z"));
    expect(total).toBe(0);
    expect(typeof total).toBe("number");
  });

  it("the SUM is coerced from the driver's string form to a JS number", async () => {
    const total = await sink.getBudgetSpend(
      "env-1",
      new Date("2000-01-01T00:00:00Z")
    );
    expect(typeof total).toBe("number");
    expect(total).toBeCloseTo(10, 6); // 5 + 2 + 3
  });
});

// ===========================================================================
// getRecentBudgetCharges ordering (DESC by timestamp) + limit, executed.
// ===========================================================================

describe("PostgresSink.getRecentBudgetCharges (real ORDER BY / LIMIT)", () => {
  it("returns most-recent first regardless of insert order", async () => {
    await sink.recordBudgetCharge(charge("c-mid", "2026-05-10T00:00:00.000Z"));
    await sink.recordBudgetCharge(charge("c-late", "2026-05-20T00:00:00.000Z"));
    await sink.recordBudgetCharge(charge("c-early", "2026-05-01T00:00:00.000Z"));
    const out = await sink.getRecentBudgetCharges("env-1");
    expect(out.map((c) => c.charge_id)).toEqual(["c-late", "c-mid", "c-early"]);
  });

  it("honours the limit", async () => {
    await sink.recordBudgetCharge(charge("c1", "2026-05-01T00:00:00.000Z"));
    await sink.recordBudgetCharge(charge("c2", "2026-05-02T00:00:00.000Z"));
    await sink.recordBudgetCharge(charge("c3", "2026-05-03T00:00:00.000Z"));
    const out = await sink.getRecentBudgetCharges("env-1", 2);
    expect(out.map((c) => c.charge_id)).toEqual(["c3", "c2"]);
  });
});

// ===========================================================================
// getRecentEvents ordering (DESC by timestamp), executed.
// ===========================================================================

describe("PostgresSink.getRecentEvents (real ORDER BY DESC)", () => {
  it("returns most-recent first and scopes to the session", async () => {
    await sink.recordEvent({
      ...sampleEvent,
      event_id: "e-old",
      timestamp: "2026-05-01T00:00:00.000Z",
    });
    await sink.recordEvent({
      ...sampleEvent,
      event_id: "e-new",
      timestamp: "2026-05-20T00:00:00.000Z",
    });
    await sink.recordEvent({
      ...sampleEvent,
      event_id: "e-other-session",
      session_id: "sess-other",
      timestamp: "2026-05-25T00:00:00.000Z",
    });
    const out = await sink.getRecentEvents("sess-1");
    expect(out.map((e) => e.event_id)).toEqual(["e-new", "e-old"]);
  });
});

// ===========================================================================
// getReplayLogBySession ordering (ASC) + appendReplayLog duplicate rejection
// via the REAL (session_id, sequence) unique index.
// ===========================================================================

describe("PostgresSink replay log (real unique index + ordering)", () => {
  it("getReplayLogBySession returns rows in ascending sequence order", async () => {
    await sink.appendReplayLog(replay("r3", "sess-r", 3));
    await sink.appendReplayLog(replay("r1", "sess-r", 1));
    await sink.appendReplayLog(replay("r2", "sess-r", 2));
    const out = await sink.getReplayLogBySession("sess-r");
    expect(out.map((r) => r.sequence)).toEqual([1, 2, 3]);
  });

  it("getLatestReplayLog returns the highest sequence", async () => {
    await sink.appendReplayLog(replay("r1", "sess-r", 1));
    await sink.appendReplayLog(replay("r2", "sess-r", 2));
    const latest = await sink.getLatestReplayLog("sess-r");
    expect(latest!.sequence).toBe(2);
    expect(latest!.record_id).toBe("r2");
  });

  it("rejects a duplicate (session_id, sequence) with a clear sequence error", async () => {
    await sink.appendReplayLog(replay("r1", "sess-r", 5));
    await expect(
      sink.appendReplayLog(replay("r1-dup", "sess-r", 5))
    ).rejects.toThrow(/sequence 5 already exists for session sess-r/);
    // The original row is intact; the failed append did not write.
    const out = await sink.getReplayLogBySession("sess-r");
    expect(out).toHaveLength(1);
    expect(out[0].record_id).toBe("r1");
  });

  it("allows the same sequence under a DIFFERENT session (index is per-session)", async () => {
    await sink.appendReplayLog(replay("a", "sess-A", 1));
    await expect(
      sink.appendReplayLog(replay("b", "sess-B", 1))
    ).resolves.toBeUndefined();
  });
});

// ===========================================================================
// init() connectivity check executes a real `select 1`.
// ===========================================================================

describe("PostgresSink.init (real connectivity check)", () => {
  it("executes select 1 without error against a live db", async () => {
    await expect(sink.init()).resolves.toBeUndefined();
  });
});
