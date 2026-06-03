import { describe, it, expect } from "vitest";
import { PostgresSink, isUniqueViolation, type DrizzleDb } from "./postgres.js";

/**
 * These tests exercise PostgresSink's PURE, JS-side behavior WITHOUT a live
 * database: constructor validation, the unique-violation classifier, the
 * no-op/ownership semantics of flush()/close(), and the post-query result
 * shaping (numeric-SUM string coercion, empty-result -> null/0, row mapping).
 *
 * They are NOT a DB integration test: the `db` passed in is a hand-built stub
 * that returns canned rows for the exact builder chain each method uses. A
 * live-Postgres integration test is deferred — no pg driver / in-memory pg
 * (pglite/pg-mem) is available in this workspace (see report).
 */

// ---------------------------------------------------------------------------
// A tiny thenable query stub mimicking the drizzle builder chain shape. Every
// chain method returns `this`; awaiting resolves to the canned `rows`.
// ---------------------------------------------------------------------------
class QueryStub {
  constructor(private readonly rows: unknown[]) {}
  from() {
    return this;
  }
  where() {
    return this;
  }
  orderBy() {
    return this;
  }
  limit() {
    return this;
  }
  values() {
    return this;
  }
  onConflictDoUpdate() {
    return this;
  }
  then<R1, R2>(
    onFulfilled?: ((v: unknown[]) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null
  ): Promise<R1 | R2> {
    return Promise.resolve(this.rows).then(onFulfilled, onRejected);
  }
}

interface StubCall {
  op: "select" | "insert";
}

function makeDb(opts: {
  selectRows?: unknown[];
  insertError?: unknown;
}): { db: DrizzleDb; calls: StubCall[] } {
  const calls: StubCall[] = [];
  const db = {
    execute: async () => [],
    select: () => {
      calls.push({ op: "select" });
      return new QueryStub(opts.selectRows ?? []);
    },
    insert: () => {
      calls.push({ op: "insert" });
      if (opts.insertError) {
        // The drizzle insert chain rejects when awaited; model that by
        // returning a thenable that throws on await.
        return {
          values: () => ({
            then: (_: unknown, onRejected: (e: unknown) => unknown) =>
              Promise.reject(opts.insertError).catch(onRejected),
            onConflictDoUpdate: () => Promise.resolve([]),
          }),
        };
      }
      return new QueryStub([]);
    },
  } as unknown as DrizzleDb;
  return { db, calls };
}

describe("PostgresSink construction", () => {
  it("throws when neither db nor connectionString is given", () => {
    // @ts-expect-error intentionally empty
    expect(() => new PostgresSink({})).toThrow(/one of `db` or `connectionString`/);
  });

  it("throws when both db and connectionString are given", () => {
    const { db } = makeDb({});
    expect(
      () => new PostgresSink({ db, connectionString: "postgres://x" })
    ).toThrow(/not both/);
  });

  it("accepts an injected db", () => {
    const { db } = makeDb({});
    expect(() => new PostgresSink({ db })).not.toThrow();
  });
});

describe("PostgresSink — durability / ownership semantics", () => {
  it("flush() is a no-op", async () => {
    const { db } = makeDb({});
    const sink = new PostgresSink({ db });
    await expect(sink.flush()).resolves.toBeUndefined();
  });

  it("close() does NOT end an injected (caller-owned) db", async () => {
    const { db } = makeDb({});
    const sink = new PostgresSink({ db });
    // No ownedClient -> close() resolves without touching the injected db.
    await expect(sink.close()).resolves.toBeUndefined();
  });

  it("init() issues a connectivity check", async () => {
    let executed = false;
    const db = {
      execute: async () => {
        executed = true;
        return [];
      },
    } as unknown as DrizzleDb;
    const sink = new PostgresSink({ db });
    await sink.init();
    expect(executed).toBe(true);
  });
});

describe("PostgresSink.getBudgetSpend — result shaping", () => {
  it("coerces a numeric SUM returned as a string to a number", async () => {
    const { db } = makeDb({ selectRows: [{ total: "3.75" }] });
    const sink = new PostgresSink({ db });
    const total = await sink.getBudgetSpend("env-1", new Date("2026-05-01T00:00:00Z"));
    expect(total).toBeCloseTo(3.75, 6);
    expect(typeof total).toBe("number");
  });

  it("passes a numeric SUM through unchanged", async () => {
    const { db } = makeDb({ selectRows: [{ total: 2.5 }] });
    const sink = new PostgresSink({ db });
    expect(await sink.getBudgetSpend("env-1", new Date())).toBeCloseTo(2.5, 6);
  });

  it("returns 0 when COALESCE yields 0 (no charges)", async () => {
    const { db } = makeDb({ selectRows: [{ total: 0 }] });
    const sink = new PostgresSink({ db });
    expect(await sink.getBudgetSpend("env-1", new Date())).toBe(0);
  });

  it("returns 0 when the result set is empty", async () => {
    const { db } = makeDb({ selectRows: [] });
    const sink = new PostgresSink({ db });
    expect(await sink.getBudgetSpend("env-1", new Date())).toBe(0);
  });
});

describe("PostgresSink — empty-result reads", () => {
  it("getBudgetEnvelope returns null when absent", async () => {
    const { db } = makeDb({ selectRows: [] });
    const sink = new PostgresSink({ db });
    expect(await sink.getBudgetEnvelope("nope")).toBeNull();
  });

  it("getBudgetEnvelopeById returns null when absent", async () => {
    const { db } = makeDb({ selectRows: [] });
    const sink = new PostgresSink({ db });
    expect(await sink.getBudgetEnvelopeById("nope")).toBeNull();
  });

  it("getSloDefinition returns null when absent", async () => {
    const { db } = makeDb({ selectRows: [] });
    const sink = new PostgresSink({ db });
    expect(await sink.getSloDefinition("nope")).toBeNull();
  });

  it("getLatestReplayLog returns null when absent", async () => {
    const { db } = makeDb({ selectRows: [] });
    const sink = new PostgresSink({ db });
    expect(await sink.getLatestReplayLog("s-empty")).toBeNull();
  });

  it("listSloDefinitions returns [] when none", async () => {
    const { db } = makeDb({ selectRows: [] });
    const sink = new PostgresSink({ db });
    expect(await sink.listSloDefinitions()).toEqual([]);
  });

  it("getRecentEvents returns [] when none", async () => {
    const { db } = makeDb({ selectRows: [] });
    const sink = new PostgresSink({ db });
    expect(await sink.getRecentEvents("s-empty")).toEqual([]);
  });

  it("getRecentBudgetCharges returns [] when none", async () => {
    const { db } = makeDb({ selectRows: [] });
    const sink = new PostgresSink({ db });
    expect(await sink.getRecentBudgetCharges("env-empty")).toEqual([]);
  });

  it("getReplayLogBySession returns [] when none", async () => {
    const { db } = makeDb({ selectRows: [] });
    const sink = new PostgresSink({ db });
    expect(await sink.getReplayLogBySession("s-empty")).toEqual([]);
  });
});

describe("PostgresSink — read mapping applied", () => {
  it("getBudgetEnvelope maps a driver row to a BudgetEnvelopeRow with {} metadata default", async () => {
    const { db } = makeDb({
      selectRows: [
        {
          envelope_id: "e1",
          name: "team",
          period_kind: "month",
          period_start: "2026-05-01T00:00:00.000Z",
          period_end: "2026-05-31T23:59:59.999Z",
          limit_usd: 200,
          soft_cap_pct: 0.75,
          hard_cap_pct: 1.0,
          parent_envelope_id: null,
          metadata: null, // driver returned NULL jsonb
        },
      ],
    });
    const sink = new PostgresSink({ db });
    const env = await sink.getBudgetEnvelope("team");
    expect(env).not.toBeNull();
    expect(env!.metadata).toEqual({});
    expect(env!.parent_envelope_id).toBeNull();
  });

  it("getRecentBudgetCharges maps rows in the order the driver returns them", async () => {
    const charge = (id: string, ts: string) => ({
      charge_id: id,
      envelope_id: "e1",
      timestamp: ts,
      agent_id: null,
      model: "claude-sonnet-4",
      provider: "anthropic",
      tokens_in: 1,
      tokens_out: 1,
      tokens_cached: 0,
      tokens_cache_creation: 0,
      cost_usd: 1,
      source: "recorded",
      metadata: {},
    });
    // The method ORDER BY timestamp DESC; the stub returns whatever we give,
    // so we hand it the already-desc order to confirm mapping preserves it.
    const { db } = makeDb({
      selectRows: [
        charge("late", "2026-05-20T00:00:00.000Z"),
        charge("early", "2026-05-10T00:00:00.000Z"),
      ],
    });
    const sink = new PostgresSink({ db });
    const out = await sink.getRecentBudgetCharges("e1");
    expect(out.map((c) => c.charge_id)).toEqual(["late", "early"]);
  });
});

describe("PostgresSink.appendReplayLog — duplicate sequence rejection", () => {
  it("translates a 23505 unique violation into a clear sequence error", async () => {
    const { db } = makeDb({ insertError: { code: "23505" } });
    const sink = new PostgresSink({ db });
    await expect(
      sink.appendReplayLog({
        record_id: "r1",
        session_id: "s1",
        sequence: 4,
        timestamp: "2026-05-30T10:00:00.000Z",
        kind: "request",
        payload_canonical: "{}",
        record_hash: "h",
        prev_record_hash: null,
        signature: "AA==",
        signer_fingerprint: "fp",
        metadata: {},
      })
    ).rejects.toThrow(/sequence 4 already exists for session s1/);
  });

  it("rethrows a non-unique-violation error unchanged", async () => {
    const boom = new Error("connection reset");
    const { db } = makeDb({ insertError: boom });
    const sink = new PostgresSink({ db });
    await expect(
      sink.appendReplayLog({
        record_id: "r1",
        session_id: "s1",
        sequence: 4,
        timestamp: "2026-05-30T10:00:00.000Z",
        kind: "request",
        payload_canonical: "{}",
        record_hash: "h",
        prev_record_hash: null,
        signature: "AA==",
        signer_fingerprint: "fp",
        metadata: {},
      })
    ).rejects.toThrow(/connection reset/);
  });
});

describe("isUniqueViolation", () => {
  it("detects SQLSTATE 23505", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });
  it("rejects other codes", () => {
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
  });
  it("handles non-objects safely", () => {
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false);
    expect(isUniqueViolation(new Error("x"))).toBe(false);
  });
});
