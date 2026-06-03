/**
 * PostgresSink — server-side PersistenceSink for team / enterprise deployments.
 *
 * Backs the same `PersistenceSink` interface as LocalSqliteSink, but writes to
 * the `persistence_*` tables in @prune/db (the lossless-mirror tables added in
 * the Phase 9.7+ block of packages/db/src/schema.ts). Those tables mirror the
 * SQLite schema byte-for-byte — caller-supplied TEXT primary keys, ISO-8601
 * TEXT timestamps, jsonb JSON fields — so a row written by LocalSqliteSink can
 * be flushed verbatim here and read back identical (lossless local -> central
 * export).
 *
 * Durability model: Postgres is durable on commit, so `flush()` is a no-op and
 * `init()` only verifies connectivity (the schema is provisioned out of band by
 * `drizzle-kit migrate`, NOT by this sink — a runtime writer must never issue
 * DDL). `close()` ends the connection pool **only if this sink created it**; an
 * injected drizzle instance is owned by the caller and left open.
 *
 * Construction:
 *   - `new PostgresSink({ connectionString })` — owns its postgres-js pool.
 *   - `new PostgresSink({ db })` — composes a caller-provided drizzle instance
 *     (e.g. the shared `@prune/db` client, or a test harness DB). The injected
 *     instance is not closed by `close()`.
 *
 * All row<->table conversion lives in ./postgres-mapping.ts as pure, exported,
 * exhaustively unit-tested functions; this file is the thin query layer that
 * composes them with the drizzle query builder.
 */

import { and, asc, desc, eq, gte, sql, drizzle, postgres } from "@prune/db/orm";
import {
  persistenceAlerts,
  persistenceBudgetCharges,
  persistenceBudgetEnvelopes,
  persistenceBudgetUsage,
  persistenceCompactions,
  persistenceEvents,
  persistenceReplayLog,
  persistenceSloDefinitions,
} from "@prune/db/schema";
import type {
  AlertRow,
  BudgetChargeRow,
  BudgetEnvelopeRow,
  BudgetUsageRow,
  CompactionEventRow,
  EventRow,
  PersistenceSink,
  ReplayLogRow,
  SloDefinitionRow,
} from "./sink.js";
import {
  fromBudgetChargeRow,
  fromBudgetEnvelopeRow,
  fromEventRow,
  fromReplayLogRow,
  fromSloDefinitionRow,
  toAlertInsert,
  toBudgetChargeInsert,
  toBudgetEnvelopeInsert,
  toBudgetUsageInsert,
  toCompactionInsert,
  toEventInsert,
  toReplayLogInsert,
  toSloDefinitionInsert,
} from "./postgres-mapping.js";

/**
 * Minimal structural type for the drizzle/postgres-js database handle this sink
 * uses. Declared structurally so an injected `@prune/db` client (or a test
 * harness DB) satisfies it without this package importing @prune/db's concrete
 * client type.
 */
export type DrizzleDb = ReturnType<typeof drizzle>;

export interface PostgresSinkOptions {
  /**
   * Postgres connection string. When provided, the sink creates and owns a
   * postgres-js pool that `close()` will end.
   */
  connectionString?: string;
  /**
   * A pre-built drizzle/postgres-js instance to compose. When provided, the
   * sink does NOT own it: `close()` leaves it open for the caller to manage.
   * Mutually exclusive with `connectionString`.
   */
  db?: DrizzleDb;
  /**
   * postgres-js pool tuning, applied only when `connectionString` is used.
   * Defaults mirror @prune/db's client.
   */
  pool?: { max?: number; idle_timeout?: number; connect_timeout?: number };
}

export class PostgresSink implements PersistenceSink {
  private readonly db: DrizzleDb;
  /** The underlying postgres-js client, set only when we created it. */
  private readonly ownedClient: ReturnType<typeof postgres> | null;

  constructor(opts: PostgresSinkOptions) {
    if (opts.db && opts.connectionString) {
      throw new Error(
        "PostgresSink: provide either `db` or `connectionString`, not both"
      );
    }
    if (opts.db) {
      this.db = opts.db;
      this.ownedClient = null;
    } else if (opts.connectionString) {
      const client = postgres(opts.connectionString, {
        max: opts.pool?.max ?? 10,
        idle_timeout: opts.pool?.idle_timeout ?? 20,
        connect_timeout: opts.pool?.connect_timeout ?? 10,
      });
      this.ownedClient = client;
      this.db = drizzle(client);
    } else {
      throw new Error(
        "PostgresSink: one of `db` or `connectionString` is required"
      );
    }
  }

  /**
   * Verify connectivity. Does NOT create tables — the persistence_* schema is
   * provisioned by `drizzle-kit migrate` (see packages/db/drizzle). A runtime
   * writer issuing DDL would race other writers and need elevated grants.
   */
  async init(): Promise<void> {
    await this.db.execute(sql`select 1`);
  }

  async recordEvent(row: EventRow): Promise<void> {
    const v = toEventInsert(row);
    await this.db
      .insert(persistenceEvents)
      .values(v)
      .onConflictDoUpdate({ target: persistenceEvents.event_id, set: v });
  }

  async recordCompaction(row: CompactionEventRow): Promise<void> {
    const v = toCompactionInsert(row);
    await this.db
      .insert(persistenceCompactions)
      .values(v)
      .onConflictDoUpdate({ target: persistenceCompactions.event_id, set: v });
  }

  async recordAlert(row: AlertRow): Promise<void> {
    const v = toAlertInsert(row);
    await this.db
      .insert(persistenceAlerts)
      .values(v)
      .onConflictDoUpdate({ target: persistenceAlerts.alert_id, set: v });
  }

  async upsertBudgetUsage(row: BudgetUsageRow): Promise<void> {
    const v = toBudgetUsageInsert(row);
    await this.db
      .insert(persistenceBudgetUsage)
      .values(v)
      .onConflictDoUpdate({
        target: [persistenceBudgetUsage.team_id, persistenceBudgetUsage.period],
        set: { spent_usd: v.spent_usd, limit_usd: v.limit_usd },
      });
  }

  async upsertBudgetEnvelope(row: BudgetEnvelopeRow): Promise<void> {
    const v = toBudgetEnvelopeInsert(row);
    await this.db
      .insert(persistenceBudgetEnvelopes)
      .values(v)
      .onConflictDoUpdate({
        target: persistenceBudgetEnvelopes.envelope_id,
        set: {
          name: v.name,
          period_kind: v.period_kind,
          period_start: v.period_start,
          period_end: v.period_end,
          limit_usd: v.limit_usd,
          soft_cap_pct: v.soft_cap_pct,
          hard_cap_pct: v.hard_cap_pct,
          parent_envelope_id: v.parent_envelope_id,
          metadata: v.metadata,
        },
      });
  }

  async recordBudgetCharge(row: BudgetChargeRow): Promise<void> {
    const v = toBudgetChargeInsert(row);
    await this.db
      .insert(persistenceBudgetCharges)
      .values(v)
      .onConflictDoUpdate({ target: persistenceBudgetCharges.charge_id, set: v });
  }

  async getBudgetEnvelope(name: string): Promise<BudgetEnvelopeRow | null> {
    const rows = await this.db
      .select()
      .from(persistenceBudgetEnvelopes)
      .where(eq(persistenceBudgetEnvelopes.name, name))
      .limit(1);
    return rows.length > 0 ? fromBudgetEnvelopeRow(rows[0]) : null;
  }

  async getBudgetEnvelopeById(
    envelopeId: string
  ): Promise<BudgetEnvelopeRow | null> {
    const rows = await this.db
      .select()
      .from(persistenceBudgetEnvelopes)
      .where(eq(persistenceBudgetEnvelopes.envelope_id, envelopeId))
      .limit(1);
    return rows.length > 0 ? fromBudgetEnvelopeRow(rows[0]) : null;
  }

  async upsertSloDefinition(row: SloDefinitionRow): Promise<void> {
    const v = toSloDefinitionInsert(row);
    await this.db
      .insert(persistenceSloDefinitions)
      .values(v)
      .onConflictDoUpdate({
        target: persistenceSloDefinitions.slo_id,
        set: {
          name: v.name,
          scope_envelope_id: v.scope_envelope_id,
          target_usd_per_task: v.target_usd_per_task,
          error_budget_usd: v.error_budget_usd,
          window_days: v.window_days,
          warning_pct: v.warning_pct,
          task_dimension: v.task_dimension,
          metadata: v.metadata,
        },
      });
  }

  async getSloDefinition(name: string): Promise<SloDefinitionRow | null> {
    const rows = await this.db
      .select()
      .from(persistenceSloDefinitions)
      .where(eq(persistenceSloDefinitions.name, name))
      .limit(1);
    return rows.length > 0 ? fromSloDefinitionRow(rows[0]) : null;
  }

  async listSloDefinitions(): Promise<SloDefinitionRow[]> {
    const rows = await this.db
      .select()
      .from(persistenceSloDefinitions)
      .orderBy(asc(persistenceSloDefinitions.name));
    return rows.map(fromSloDefinitionRow);
  }

  /**
   * Sum of cost_usd against `envelopeId` where timestamp >= `since`. Timestamps
   * are stored as ISO-8601 TEXT; ISO-8601 sorts lexicographically in
   * chronological order, so a TEXT >= comparison is correct (identical to the
   * SQLite sink). Returns 0 (not NULL) for an envelope with no matching charges.
   */
  async getBudgetSpend(envelopeId: string, since: Date): Promise<number> {
    const rows = await this.db
      .select({
        total: sql<number>`coalesce(sum(${persistenceBudgetCharges.cost_usd}), 0)`,
      })
      .from(persistenceBudgetCharges)
      .where(
        and(
          eq(persistenceBudgetCharges.envelope_id, envelopeId),
          gte(persistenceBudgetCharges.timestamp, since.toISOString())
        )
      );
    // postgres-js returns numeric SUM as a string; coerce to number.
    const total = rows[0]?.total ?? 0;
    return typeof total === "string" ? Number(total) : total;
  }

  /** Last N charges against an envelope, most recent first. */
  async getRecentBudgetCharges(
    envelopeId: string,
    limit = 100
  ): Promise<BudgetChargeRow[]> {
    const rows = await this.db
      .select()
      .from(persistenceBudgetCharges)
      .where(eq(persistenceBudgetCharges.envelope_id, envelopeId))
      .orderBy(desc(persistenceBudgetCharges.timestamp))
      .limit(limit);
    return rows.map(fromBudgetChargeRow);
  }

  /**
   * Append a replay-log row. The unique index on (session_id, sequence)
   * rejects a duplicate; we surface a clear error rather than the raw driver
   * constraint message, matching the interface contract.
   */
  async appendReplayLog(row: ReplayLogRow): Promise<void> {
    const v = toReplayLogInsert(row);
    try {
      await this.db.insert(persistenceReplayLog).values(v);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new Error(
          `PostgresSink.appendReplayLog: sequence ${row.sequence} already ` +
            `exists for session ${row.session_id} (replay vault requires ` +
            `monotonic per-session sequence)`
        );
      }
      throw err;
    }
  }

  async getReplayLogBySession(sessionId: string): Promise<ReplayLogRow[]> {
    const rows = await this.db
      .select()
      .from(persistenceReplayLog)
      .where(eq(persistenceReplayLog.session_id, sessionId))
      .orderBy(asc(persistenceReplayLog.sequence));
    return rows.map(fromReplayLogRow);
  }

  async getLatestReplayLog(sessionId: string): Promise<ReplayLogRow | null> {
    const rows = await this.db
      .select()
      .from(persistenceReplayLog)
      .where(eq(persistenceReplayLog.session_id, sessionId))
      .orderBy(desc(persistenceReplayLog.sequence))
      .limit(1);
    return rows.length > 0 ? fromReplayLogRow(rows[0]) : null;
  }

  async getRecentEvents(sessionId: string, limit = 100): Promise<EventRow[]> {
    const rows = await this.db
      .select()
      .from(persistenceEvents)
      .where(eq(persistenceEvents.session_id, sessionId))
      .orderBy(desc(persistenceEvents.timestamp))
      .limit(limit);
    return rows.map(fromEventRow);
  }

  /** No-op: Postgres is durable on commit. */
  async flush(): Promise<void> {
    // intentionally empty — see class docstring.
  }

  /** End the pool only if this sink created it; leave an injected db open. */
  async close(): Promise<void> {
    if (this.ownedClient) {
      await this.ownedClient.end();
    }
  }
}

/**
 * Detect a Postgres unique-constraint violation (SQLSTATE 23505) across the
 * shapes the postgres-js driver surfaces. Exported for testing.
 */
export function isUniqueViolation(err: unknown): boolean {
  if (err == null || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  return code === "23505";
}
