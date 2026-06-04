import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle, postgres, sql } from "@prune/db/orm";
import { PostgresSink, type DrizzleDb } from "./postgres.js";
import type {
  BudgetChargeRow,
  EventRow,
  ReplayLogRow,
} from "./sink.js";

/**
 * LIVE-SERVER integration test for PostgresSink (pending action 1.1).
 *
 * postgres.integration.test.ts proves the sink's SQL against in-memory PGlite
 * (WASM). PGlite is single-threaded and is not byte-identical to a production
 * server, so three things stayed unproven: real postgres-js driver result
 * shaping, real-server numeric/jsonb coercion, and genuine concurrency. This
 * suite closes that gap against a REAL Postgres server.
 *
 * GATED: it only runs when PRUNE_PG_TEST_URL points at a throwaway Postgres
 * (e.g. postgres://postgres@127.0.0.1:5433/prunetest). With no URL the whole
 * suite is skipped, so normal CI without a database stays green. Run it with:
 *
 *   PRUNE_PG_TEST_URL=postgres://postgres@127.0.0.1:5433/prunetest \
 *     npx vitest run packages/persistence/src/postgres.live.integration.test.ts
 *
 * The schema DDL below mirrors the persistence_* tables in @prune/db
 * src/schema.ts (the migration source). In production those tables are
 * provisioned out-of-band by `drizzle-kit migrate`; here we create them on the
 * throwaway DB so the suite is self-contained and needs only a connection URL.
 */

const PG_URL = process.env.PRUNE_PG_TEST_URL;
const live = PG_URL ? describe : describe.skip;

const DDL = `
  create table if not exists persistence_events (
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
  create table if not exists persistence_budget_envelopes (
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
  create table if not exists persistence_budget_charges (
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
  create table if not exists persistence_replay_log (
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
  create unique index if not exists uq_persistence_replay_session_seq
    on persistence_replay_log (session_id, sequence);
`;

// Only the tables this suite touches (the full set is exercised by the PGlite
// integration test; here we target the driver / numeric / jsonb / concurrency
// behaviors PGlite cannot prove).
const TABLES = [
  "persistence_events",
  "persistence_budget_charges",
  "persistence_budget_envelopes",
  "persistence_replay_log",
];

let client: ReturnType<typeof postgres>;
let db: DrizzleDb;
let sink: PostgresSink;

const baseEvent: EventRow = {
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
  roi_score: 0.875,
  task_metadata: { type: "feature", repo: "tokenlens", branch: "main" },
  feature_id: "f3",
  quality_proof: { substitution_verified: true, tokens_saved: 1500 },
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

const replay = (
  id: string,
  sessionId: string,
  sequence: number
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
  metadata: { origin: "live-test" },
});

live("PostgresSink against a LIVE Postgres server", () => {
  beforeAll(async () => {
    // A pool (max > 1) so the concurrency tests get real parallel connections.
    client = postgres(PG_URL as string, { max: 5, onnotice: () => {} });
    db = drizzle(client) as unknown as DrizzleDb;
    await client.unsafe(DDL);
  });

  afterAll(async () => {
    if (client) {
      try {
        await client.unsafe(`drop table if exists ${TABLES.join(", ")} cascade;`);
      } finally {
        await client.end({ timeout: 5 });
      }
    }
  });

  beforeEach(async () => {
    await client.unsafe(`truncate table ${TABLES.join(", ")};`);
    sink = new PostgresSink({ db });
  });

  it("init() runs a real connectivity check (select 1)", async () => {
    await expect(sink.init()).resolves.toBeUndefined();
  });

  it("EventRow round-trips through the real postgres-js driver (jsonb parsed, booleans, nulls)", async () => {
    await sink.recordEvent(baseEvent);
    const withNulls: EventRow = {
      ...baseEvent,
      event_id: "ev-null",
      team_id: null,
      feature_id: null,
      quality_proof: null,
      task_metadata: { type: "chore", repo: null, branch: null },
    };
    await sink.recordEvent(withNulls);
    const out = await sink.getRecentEvents("sess-1");
    const byId = Object.fromEntries(out.map((e) => [e.event_id, e]));
    expect(byId["ev-1"]).toEqual(baseEvent);
    expect(byId["ev-null"]).toEqual(withNulls);
    // jsonb came back as a parsed object/array, not a string.
    expect(typeof byId["ev-1"].quality_proof).toBe("object");
    expect(Array.isArray(byId["ev-1"].tool_calls)).toBe(true);
  });

  it("deeply-nested + unicode jsonb survives a real-server round-trip", async () => {
    const proof = {
      nested: { a: [1, 2, { b: "café ☕ — naïve" }], z: null },
      flag: true,
      n: 0.5,
    };
    await sink.recordEvent({ ...baseEvent, event_id: "ev-json", quality_proof: proof });
    const out = await sink.getRecentEvents("sess-1");
    expect(out.find((e) => e.event_id === "ev-json")!.quality_proof).toEqual(proof);
  });

  it("getBudgetSpend returns a real JS number from the server-side SUM (driver result shaping)", async () => {
    // Honest scope: the cost_usd column is `real`, which postgres-js already
    // returns as a JS number — so this proves the driver returns a usable number
    // (not a Buffer/string) and the SUM/window math is correct on a real server.
    // It does NOT exercise getBudgetSpend's string→number branch (that path is
    // for a `numeric` column, which this schema doesn't use).
    await sink.recordBudgetCharge(charge("c1", "2026-05-10T00:00:00.000Z", { cost_usd: 2.5 }));
    await sink.recordBudgetCharge(charge("c2", "2026-05-11T00:00:00.000Z", { cost_usd: 3.25 }));
    const total = await sink.getBudgetSpend("env-1", new Date("2026-05-01T00:00:00Z"));
    expect(typeof total).toBe("number");
    expect(total).toBeCloseTo(5.75, 4);
  });

  it("recordEvent upsert on the same PK updates rather than duplicating (real ON CONFLICT)", async () => {
    await sink.recordEvent(baseEvent);
    await sink.recordEvent({ ...baseEvent, tool: "codex", roi_score: 0.11 });
    const out = await sink.getRecentEvents("sess-1");
    expect(out).toHaveLength(1);
    expect(out[0].tool).toBe("codex");
    expect(out[0].roi_score).toBeCloseTo(0.11, 5);
  });

  // -- the genuinely server-only behaviors PGlite (single-threaded) can't prove --

  it("parallel charge writes over a pooled connection all land (load smoke — the unique-index race below is the real concurrency-correctness proof)", async () => {
    // Honest scope: each charge is an independent autocommit INSERT on a distinct
    // PK with no row contention, so this would also pass on a serialized pool.
    // It proves the pooled driver handles many in-flight writes without dropping
    // any (a load smoke test), NOT a concurrency-correctness property — that is
    // the (session_id, sequence) UNIQUE-INDEX RACE test immediately below, which
    // genuinely requires two writers colliding on one constraint.
    const N = 25;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        sink.recordBudgetCharge(
          charge(`cc-${i}`, `2026-05-10T00:00:${String(i).padStart(2, "0")}.000Z`, { cost_usd: 1 })
        )
      )
    );
    const total = await sink.getBudgetSpend("env-1", new Date("2026-05-01T00:00:00Z"));
    expect(total).toBeCloseTo(N, 4);
    const recent = await sink.getRecentBudgetCharges("env-1", 1000);
    expect(recent).toHaveLength(N);
  });

  it("UNIQUE-INDEX RACE: parallel appends of the same (session, sequence) — exactly one wins", async () => {
    const results = await Promise.allSettled([
      sink.appendReplayLog(replay("r-a", "sess-race", 1)),
      sink.appendReplayLog(replay("r-b", "sess-race", 1)),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // Exactly one row persisted under the real unique constraint.
    const rows = await sink.getReplayLogBySession("sess-race");
    expect(rows).toHaveLength(1);
    expect(rows[0].sequence).toBe(1);
  });
});
