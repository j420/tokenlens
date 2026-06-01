/**
 * LocalSqliteSink — durable local storage backed by sql.js (WASM SQLite).
 *
 * No native binaries (consistent with the Prune ethos). The database lives
 * in memory while open; `flush()` writes it atomically to disk (tmp file +
 * rename); `close()` flushes once and releases.
 *
 * Durability model: writes are NOT flushed on every insert by default —
 * sql.js exposes no incremental write API, so every flush re-serializes
 * the entire database, making per-event flushing O(db_size) per row and
 * the dominant cost of the ingest pipeline once the file gets non-trivial.
 * Callers that need at-most-N-events of loss tolerance should call
 * `flush()` on their own cadence (e.g. every K events, or on a timer);
 * `close()` always flushes regardless. Set `autoFlush: true` only for
 * test fixtures or very low-volume scenarios where the cost is acceptable.
 *
 * Crash safety: `flush()` writes to `${path}.tmp.${pid}` then renames over
 * `path`, so a crash mid-write leaves either the old image or the new one,
 * never a half-written file that fails to reopen. Multi-process safety:
 * `init()` acquires an exclusive lock on `${path}.lock` via proper-lockfile
 * and holds it until `close()`; a second writer trying to open the same
 * path will get a clear "already held" error rather than silently
 * clobbering the first writer's events on flush.
 *
 * Schema mirrors @prune/db (Drizzle/Postgres) so rows can be re-exported.
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { dirname } from "node:path";
import lockfile from "proper-lockfile";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
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

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  team_id TEXT,
  timestamp TEXT NOT NULL,
  provider TEXT NOT NULL,
  tool TEXT NOT NULL,
  model TEXT NOT NULL,
  tokens_in INTEGER NOT NULL,
  tokens_out INTEGER NOT NULL,
  tokens_cached INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL,
  estimated_cost_usd REAL NOT NULL,
  cumulative_session_cost_usd REAL NOT NULL,
  tool_calls TEXT NOT NULL,
  files_referenced TEXT NOT NULL,
  compaction_triggered INTEGER NOT NULL,
  context_size_before INTEGER NOT NULL,
  context_size_after INTEGER NOT NULL,
  waste_flags TEXT NOT NULL,
  classification TEXT NOT NULL,
  roi_score REAL NOT NULL,
  task_metadata TEXT NOT NULL,
  feature_id TEXT,
  quality_proof TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id, timestamp);

CREATE TABLE IF NOT EXISTS compactions (
  event_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  turn_number INTEGER NOT NULL,
  tokens_before INTEGER NOT NULL,
  tokens_after INTEGER NOT NULL,
  tokens_removed INTEGER NOT NULL,
  overhead_cost_usd REAL NOT NULL,
  lost_references TEXT NOT NULL,
  summary TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_compactions_session ON compactions(session_id, timestamp);

CREATE TABLE IF NOT EXISTS alerts (
  alert_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  team_id TEXT,
  timestamp TEXT NOT NULL,
  severity TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alerts_session ON alerts(session_id, timestamp);

CREATE TABLE IF NOT EXISTS budget_usage (
  team_id TEXT NOT NULL,
  period TEXT NOT NULL,
  spent_usd REAL NOT NULL,
  limit_usd REAL NOT NULL,
  PRIMARY KEY (team_id, period)
);

CREATE TABLE IF NOT EXISTS budget_envelopes (
  envelope_id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  period_kind TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  limit_usd REAL NOT NULL,
  soft_cap_pct REAL NOT NULL DEFAULT 0.75,
  hard_cap_pct REAL NOT NULL DEFAULT 1.0,
  parent_envelope_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_envelopes_parent ON budget_envelopes(parent_envelope_id);

CREATE TABLE IF NOT EXISTS budget_charges (
  charge_id TEXT PRIMARY KEY,
  envelope_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  agent_id TEXT,
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  tokens_in INTEGER NOT NULL,
  tokens_out INTEGER NOT NULL,
  tokens_cached INTEGER NOT NULL DEFAULT 0,
  tokens_cache_creation INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL,
  source TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_charges_envelope_time ON budget_charges(envelope_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_charges_agent_time ON budget_charges(agent_id, timestamp);

-- SLO definitions — SRE Error Budget pattern for AI cost.
-- One row per named SLO. The SLI is computed at read time from
-- budget_charges, so adjusting an SLO's targetUsdPerTask doesn't
-- rewrite history.
CREATE TABLE IF NOT EXISTS slo_definitions (
  slo_id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  scope_envelope_id TEXT NOT NULL,
  target_usd_per_task REAL NOT NULL,
  error_budget_usd REAL NOT NULL,
  window_days INTEGER NOT NULL,
  warning_pct REAL NOT NULL DEFAULT 0.5,
  task_dimension TEXT NOT NULL DEFAULT 'agent_id',
  metadata TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_slo_scope ON slo_definitions(scope_envelope_id);

-- Replay vault: hash-chained, ed25519-signed audit log per session.
-- Each row's record_hash is sha256 of the canonical JSON payload; the
-- chain links via prev_record_hash. Tampering with any row breaks the
-- chain at that point. signature is ed25519 over (prev_record_hash ||
-- record_hash) so unauthorized appends are caught even if the chain is
-- recomputed. (sequence) is per-session monotonic for cheap audits.
CREATE TABLE IF NOT EXISTS replay_log (
  record_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  timestamp TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload_canonical TEXT NOT NULL,
  record_hash TEXT NOT NULL,
  prev_record_hash TEXT,
  signature TEXT NOT NULL,
  signer_fingerprint TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  UNIQUE (session_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_replay_session_seq ON replay_log(session_id, sequence);
`;

let sqlJsPromise: Promise<SqlJsStatic> | null = null;
function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) sqlJsPromise = initSqlJs();
  return sqlJsPromise;
}

export interface LocalSqliteSinkOptions {
  /** Path to the .sqlite file. When `:memory:`, no disk persistence. */
  path: string;
  /**
   * If true, flush on every write. Default **false** — see class docstring
   * for the cost model. Callers needing durability should either call
   * `flush()` on a cadence or rely on `close()` (which always flushes).
   */
  autoFlush?: boolean;
}

export class LocalSqliteSink implements PersistenceSink {
  private db: Database | null = null;
  private readonly opts: Required<LocalSqliteSinkOptions>;
  private releaseLock: (() => Promise<void>) | null = null;

  constructor(opts: LocalSqliteSinkOptions) {
    this.opts = { autoFlush: false, ...opts };
  }

  async init(): Promise<void> {
    if (this.opts.path !== ":memory:") {
      // Exclusive single-writer lock. sql.js loads the whole DB into memory
      // and only re-serializes on flush(), so two concurrent writers would
      // each hold a stale snapshot and the second flusher's image would
      // clobber the first's writes silently. A per-method lock can't fix
      // that — only restricting init→close to one process at a time can.
      // The sentinel `${path}.lock` exists so we can lock before the DB
      // file does (proper-lockfile requires an existing target).
      const sentinel = `${this.opts.path}.lock`;
      mkdirSync(dirname(this.opts.path), { recursive: true });
      if (!existsSync(sentinel)) writeFileSync(sentinel, "");
      try {
        this.releaseLock = await lockfile.lock(sentinel, {
          retries: { retries: 5, factor: 1.5, minTimeout: 50, maxTimeout: 500 },
          stale: 30_000,
        });
      } catch (err) {
        const cause = err instanceof Error ? err.message : String(err);
        throw new Error(
          `LocalSqliteSink: another process is writing to ${this.opts.path} ` +
            `(lock held). Close the other writer or use a different path. (${cause})`
        );
      }
    }
    const SQL = await getSqlJs();
    if (this.opts.path !== ":memory:" && existsSync(this.opts.path)) {
      const buf = readFileSync(this.opts.path);
      this.db = new SQL.Database(new Uint8Array(buf));
    } else {
      this.db = new SQL.Database();
    }
    this.db.exec(SCHEMA);
    // Idempotent migrations for DB files created before a column was added.
    // sql.js throws on a duplicate column, so each ALTER is best-effort.
    for (const stmt of [
      "ALTER TABLE events ADD COLUMN feature_id TEXT",
      "ALTER TABLE events ADD COLUMN quality_proof TEXT",
    ]) {
      try {
        this.db.exec(stmt);
      } catch {
        // column already exists — fresh DB created from SCHEMA
      }
    }
  }

  private ensure(): Database {
    if (!this.db) {
      throw new Error("LocalSqliteSink.init() must be called before use");
    }
    return this.db;
  }

  async flush(): Promise<void> {
    this.flushSync();
  }

  private flushSync(): void {
    if (this.opts.path === ":memory:") return;
    const db = this.ensure();
    const buf = db.export();
    mkdirSync(dirname(this.opts.path), { recursive: true });
    // Write to a temp file then atomically rename: a crash mid-write would
    // otherwise leave a half-written .sqlite that fails to reopen. The
    // process pid keeps two concurrent flushers from clobbering the same
    // temp path; cross-process safety still requires external coordination
    // (file lock or a single writer).
    const tmp = `${this.opts.path}.tmp.${process.pid}`;
    try {
      writeFileSync(tmp, buf);
      renameSync(tmp, this.opts.path);
    } catch (err) {
      try {
        unlinkSync(tmp);
      } catch {
        // ignore — temp may not exist
      }
      throw err;
    }
  }

  async recordEvent(r: EventRow): Promise<void> {
    const db = this.ensure();
    db.run(
      `INSERT OR REPLACE INTO events VALUES (
        $event_id, $session_id, $user_id, $team_id, $timestamp,
        $provider, $tool, $model, $tokens_in, $tokens_out,
        $tokens_cached, $latency_ms, $estimated_cost_usd,
        $cumulative_session_cost_usd, $tool_calls, $files_referenced,
        $compaction_triggered, $context_size_before, $context_size_after,
        $waste_flags, $classification, $roi_score, $task_metadata,
        $feature_id, $quality_proof
      )`,
      {
        $event_id: r.event_id,
        $session_id: r.session_id,
        $user_id: r.user_id,
        $team_id: r.team_id,
        $timestamp: r.timestamp,
        $provider: r.provider,
        $tool: r.tool,
        $model: r.model,
        $tokens_in: r.tokens_in,
        $tokens_out: r.tokens_out,
        $tokens_cached: r.tokens_cached,
        $latency_ms: r.latency_ms,
        $estimated_cost_usd: r.estimated_cost_usd,
        $cumulative_session_cost_usd: r.cumulative_session_cost_usd,
        $tool_calls: JSON.stringify(r.tool_calls),
        $files_referenced: JSON.stringify(r.files_referenced),
        $compaction_triggered: r.compaction_triggered ? 1 : 0,
        $context_size_before: r.context_size_before,
        $context_size_after: r.context_size_after,
        $waste_flags: JSON.stringify(r.waste_flags),
        $classification: r.classification,
        $roi_score: r.roi_score,
        $task_metadata: JSON.stringify(r.task_metadata),
        $feature_id: r.feature_id ?? null,
        $quality_proof:
          r.quality_proof != null ? JSON.stringify(r.quality_proof) : null,
      }
    );
    if (this.opts.autoFlush) this.flushSync();
  }

  async recordCompaction(r: CompactionEventRow): Promise<void> {
    const db = this.ensure();
    db.run(
      `INSERT OR REPLACE INTO compactions VALUES (
        $event_id, $session_id, $timestamp, $turn_number,
        $tokens_before, $tokens_after, $tokens_removed,
        $overhead_cost_usd, $lost_references, $summary
      )`,
      {
        $event_id: r.event_id,
        $session_id: r.session_id,
        $timestamp: r.timestamp,
        $turn_number: r.turn_number,
        $tokens_before: r.tokens_before,
        $tokens_after: r.tokens_after,
        $tokens_removed: r.tokens_removed,
        $overhead_cost_usd: r.overhead_cost_usd,
        $lost_references: JSON.stringify(r.lost_references),
        $summary: r.summary,
      }
    );
    if (this.opts.autoFlush) this.flushSync();
  }

  async recordAlert(r: AlertRow): Promise<void> {
    const db = this.ensure();
    db.run(
      `INSERT OR REPLACE INTO alerts VALUES (
        $alert_id, $session_id, $team_id, $timestamp,
        $severity, $kind, $message, $payload_json
      )`,
      {
        $alert_id: r.alert_id,
        $session_id: r.session_id,
        $team_id: r.team_id,
        $timestamp: r.timestamp,
        $severity: r.severity,
        $kind: r.kind,
        $message: r.message,
        $payload_json: r.payload_json,
      }
    );
    if (this.opts.autoFlush) this.flushSync();
  }

  async upsertBudgetUsage(r: BudgetUsageRow): Promise<void> {
    const db = this.ensure();
    db.run(
      `INSERT INTO budget_usage VALUES ($team_id, $period, $spent_usd, $limit_usd)
       ON CONFLICT(team_id, period) DO UPDATE SET
         spent_usd = excluded.spent_usd,
         limit_usd = excluded.limit_usd`,
      {
        $team_id: r.team_id,
        $period: r.period,
        $spent_usd: r.spent_usd,
        $limit_usd: r.limit_usd,
      }
    );
    if (this.opts.autoFlush) this.flushSync();
  }

  async upsertBudgetEnvelope(r: BudgetEnvelopeRow): Promise<void> {
    const db = this.ensure();
    db.run(
      `INSERT INTO budget_envelopes VALUES (
        $envelope_id, $name, $period_kind, $period_start, $period_end,
        $limit_usd, $soft_cap_pct, $hard_cap_pct, $parent_envelope_id, $metadata
      ) ON CONFLICT(envelope_id) DO UPDATE SET
         name = excluded.name,
         period_kind = excluded.period_kind,
         period_start = excluded.period_start,
         period_end = excluded.period_end,
         limit_usd = excluded.limit_usd,
         soft_cap_pct = excluded.soft_cap_pct,
         hard_cap_pct = excluded.hard_cap_pct,
         parent_envelope_id = excluded.parent_envelope_id,
         metadata = excluded.metadata`,
      {
        $envelope_id: r.envelope_id,
        $name: r.name,
        $period_kind: r.period_kind,
        $period_start: r.period_start,
        $period_end: r.period_end,
        $limit_usd: r.limit_usd,
        $soft_cap_pct: r.soft_cap_pct,
        $hard_cap_pct: r.hard_cap_pct,
        $parent_envelope_id: r.parent_envelope_id,
        $metadata: JSON.stringify(r.metadata),
      }
    );
    if (this.opts.autoFlush) this.flushSync();
  }

  async recordBudgetCharge(r: BudgetChargeRow): Promise<void> {
    const db = this.ensure();
    db.run(
      `INSERT OR REPLACE INTO budget_charges VALUES (
        $charge_id, $envelope_id, $timestamp, $agent_id, $model, $provider,
        $tokens_in, $tokens_out, $tokens_cached, $tokens_cache_creation,
        $cost_usd, $source, $metadata
      )`,
      {
        $charge_id: r.charge_id,
        $envelope_id: r.envelope_id,
        $timestamp: r.timestamp,
        $agent_id: r.agent_id,
        $model: r.model,
        $provider: r.provider,
        $tokens_in: r.tokens_in,
        $tokens_out: r.tokens_out,
        $tokens_cached: r.tokens_cached,
        $tokens_cache_creation: r.tokens_cache_creation,
        $cost_usd: r.cost_usd,
        $source: r.source,
        $metadata: JSON.stringify(r.metadata),
      }
    );
    if (this.opts.autoFlush) this.flushSync();
  }

  async getBudgetEnvelope(name: string): Promise<BudgetEnvelopeRow | null> {
    const db = this.ensure();
    const stmt = db.prepare(`SELECT * FROM budget_envelopes WHERE name = $n`);
    stmt.bind({ $n: name });
    let row: BudgetEnvelopeRow | null = null;
    if (stmt.step()) {
      const r = stmt.getAsObject() as Record<string, unknown>;
      row = {
        envelope_id: r.envelope_id as string,
        name: r.name as string,
        period_kind: r.period_kind as BudgetEnvelopeRow["period_kind"],
        period_start: r.period_start as string,
        period_end: r.period_end as string,
        limit_usd: r.limit_usd as number,
        soft_cap_pct: r.soft_cap_pct as number,
        hard_cap_pct: r.hard_cap_pct as number,
        parent_envelope_id: (r.parent_envelope_id as string | null) ?? null,
        metadata: JSON.parse((r.metadata as string) ?? "{}"),
      };
    }
    stmt.free();
    return row;
  }

  async getBudgetEnvelopeById(
    envelopeId: string
  ): Promise<BudgetEnvelopeRow | null> {
    const db = this.ensure();
    const stmt = db.prepare(`SELECT * FROM budget_envelopes WHERE envelope_id = $id`);
    stmt.bind({ $id: envelopeId });
    let row: BudgetEnvelopeRow | null = null;
    if (stmt.step()) {
      const r = stmt.getAsObject() as Record<string, unknown>;
      row = {
        envelope_id: r.envelope_id as string,
        name: r.name as string,
        period_kind: r.period_kind as BudgetEnvelopeRow["period_kind"],
        period_start: r.period_start as string,
        period_end: r.period_end as string,
        limit_usd: r.limit_usd as number,
        soft_cap_pct: r.soft_cap_pct as number,
        hard_cap_pct: r.hard_cap_pct as number,
        parent_envelope_id: (r.parent_envelope_id as string | null) ?? null,
        metadata: JSON.parse((r.metadata as string) ?? "{}"),
      };
    }
    stmt.free();
    return row;
  }

  async getBudgetSpend(envelopeId: string, since: Date): Promise<number> {
    const db = this.ensure();
    const stmt = db.prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) AS total
       FROM budget_charges
       WHERE envelope_id = $e AND timestamp >= $s`
    );
    stmt.bind({ $e: envelopeId, $s: since.toISOString() });
    let total = 0;
    if (stmt.step()) {
      const r = stmt.getAsObject() as Record<string, unknown>;
      total = (r.total as number) ?? 0;
    }
    stmt.free();
    return total;
  }

  async getRecentBudgetCharges(
    envelopeId: string,
    limit: number = 100
  ): Promise<BudgetChargeRow[]> {
    const db = this.ensure();
    const stmt = db.prepare(
      `SELECT * FROM budget_charges WHERE envelope_id = $e
       ORDER BY timestamp DESC LIMIT $l`
    );
    stmt.bind({ $e: envelopeId, $l: limit });
    const out: BudgetChargeRow[] = [];
    while (stmt.step()) {
      const r = stmt.getAsObject() as Record<string, unknown>;
      out.push({
        charge_id: r.charge_id as string,
        envelope_id: r.envelope_id as string,
        timestamp: r.timestamp as string,
        agent_id: (r.agent_id as string | null) ?? null,
        model: r.model as string,
        provider: r.provider as BudgetChargeRow["provider"],
        tokens_in: r.tokens_in as number,
        tokens_out: r.tokens_out as number,
        tokens_cached: r.tokens_cached as number,
        tokens_cache_creation: r.tokens_cache_creation as number,
        cost_usd: r.cost_usd as number,
        source: r.source as BudgetChargeRow["source"],
        metadata: JSON.parse((r.metadata as string) ?? "{}"),
      });
    }
    stmt.free();
    return out;
  }

  async upsertSloDefinition(r: SloDefinitionRow): Promise<void> {
    const db = this.ensure();
    db.run(
      `INSERT INTO slo_definitions VALUES (
        $slo_id, $name, $scope_envelope_id, $target_usd_per_task,
        $error_budget_usd, $window_days, $warning_pct, $task_dimension, $metadata
      ) ON CONFLICT(slo_id) DO UPDATE SET
         name = excluded.name,
         scope_envelope_id = excluded.scope_envelope_id,
         target_usd_per_task = excluded.target_usd_per_task,
         error_budget_usd = excluded.error_budget_usd,
         window_days = excluded.window_days,
         warning_pct = excluded.warning_pct,
         task_dimension = excluded.task_dimension,
         metadata = excluded.metadata`,
      {
        $slo_id: r.slo_id,
        $name: r.name,
        $scope_envelope_id: r.scope_envelope_id,
        $target_usd_per_task: r.target_usd_per_task,
        $error_budget_usd: r.error_budget_usd,
        $window_days: r.window_days,
        $warning_pct: r.warning_pct,
        $task_dimension: r.task_dimension,
        $metadata: JSON.stringify(r.metadata),
      }
    );
    if (this.opts.autoFlush) this.flushSync();
  }

  private hydrateSloRow(r: Record<string, unknown>): SloDefinitionRow {
    return {
      slo_id: r.slo_id as string,
      name: r.name as string,
      scope_envelope_id: r.scope_envelope_id as string,
      target_usd_per_task: r.target_usd_per_task as number,
      error_budget_usd: r.error_budget_usd as number,
      window_days: r.window_days as number,
      warning_pct: r.warning_pct as number,
      task_dimension: r.task_dimension as string,
      metadata: JSON.parse((r.metadata as string) ?? "{}"),
    };
  }

  async getSloDefinition(name: string): Promise<SloDefinitionRow | null> {
    const db = this.ensure();
    const stmt = db.prepare(`SELECT * FROM slo_definitions WHERE name = $n`);
    stmt.bind({ $n: name });
    let row: SloDefinitionRow | null = null;
    if (stmt.step()) {
      row = this.hydrateSloRow(stmt.getAsObject() as Record<string, unknown>);
    }
    stmt.free();
    return row;
  }

  async listSloDefinitions(): Promise<SloDefinitionRow[]> {
    const db = this.ensure();
    const stmt = db.prepare(`SELECT * FROM slo_definitions ORDER BY name ASC`);
    const out: SloDefinitionRow[] = [];
    while (stmt.step()) {
      out.push(this.hydrateSloRow(stmt.getAsObject() as Record<string, unknown>));
    }
    stmt.free();
    return out;
  }

  async appendReplayLog(r: ReplayLogRow): Promise<void> {
    const db = this.ensure();
    db.run(
      `INSERT INTO replay_log VALUES (
        $record_id, $session_id, $sequence, $timestamp, $kind,
        $payload_canonical, $record_hash, $prev_record_hash,
        $signature, $signer_fingerprint, $metadata
      )`,
      {
        $record_id: r.record_id,
        $session_id: r.session_id,
        $sequence: r.sequence,
        $timestamp: r.timestamp,
        $kind: r.kind,
        $payload_canonical: r.payload_canonical,
        $record_hash: r.record_hash,
        $prev_record_hash: r.prev_record_hash,
        $signature: r.signature,
        $signer_fingerprint: r.signer_fingerprint,
        $metadata: JSON.stringify(r.metadata),
      }
    );
    if (this.opts.autoFlush) this.flushSync();
  }

  private hydrateReplayRow(r: Record<string, unknown>): ReplayLogRow {
    return {
      record_id: r.record_id as string,
      session_id: r.session_id as string,
      sequence: r.sequence as number,
      timestamp: r.timestamp as string,
      kind: r.kind as string,
      payload_canonical: r.payload_canonical as string,
      record_hash: r.record_hash as string,
      prev_record_hash: (r.prev_record_hash as string | null) ?? null,
      signature: r.signature as string,
      signer_fingerprint: r.signer_fingerprint as string,
      metadata: JSON.parse((r.metadata as string) ?? "{}"),
    };
  }

  async getReplayLogBySession(sessionId: string): Promise<ReplayLogRow[]> {
    const db = this.ensure();
    const stmt = db.prepare(
      `SELECT * FROM replay_log WHERE session_id = $s ORDER BY sequence ASC`
    );
    stmt.bind({ $s: sessionId });
    const out: ReplayLogRow[] = [];
    while (stmt.step()) {
      out.push(this.hydrateReplayRow(stmt.getAsObject() as Record<string, unknown>));
    }
    stmt.free();
    return out;
  }

  async getLatestReplayLog(sessionId: string): Promise<ReplayLogRow | null> {
    const db = this.ensure();
    const stmt = db.prepare(
      `SELECT * FROM replay_log WHERE session_id = $s ORDER BY sequence DESC LIMIT 1`
    );
    stmt.bind({ $s: sessionId });
    let row: ReplayLogRow | null = null;
    if (stmt.step()) {
      row = this.hydrateReplayRow(stmt.getAsObject() as Record<string, unknown>);
    }
    stmt.free();
    return row;
  }

  async getRecentEvents(
    sessionId: string,
    limit: number = 100
  ): Promise<EventRow[]> {
    const db = this.ensure();
    const stmt = db.prepare(
      `SELECT * FROM events WHERE session_id = $s ORDER BY timestamp DESC LIMIT $l`
    );
    stmt.bind({ $s: sessionId, $l: limit });
    const out: EventRow[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      out.push({
        event_id: row.event_id as string,
        session_id: row.session_id as string,
        user_id: row.user_id as string,
        team_id: (row.team_id as string) ?? null,
        timestamp: row.timestamp as string,
        provider: row.provider as EventRow["provider"],
        tool: row.tool as string,
        model: row.model as string,
        tokens_in: row.tokens_in as number,
        tokens_out: row.tokens_out as number,
        tokens_cached: row.tokens_cached as number,
        latency_ms: row.latency_ms as number,
        estimated_cost_usd: row.estimated_cost_usd as number,
        cumulative_session_cost_usd: row.cumulative_session_cost_usd as number,
        tool_calls: JSON.parse(row.tool_calls as string),
        files_referenced: JSON.parse(row.files_referenced as string),
        compaction_triggered: (row.compaction_triggered as number) === 1,
        context_size_before: row.context_size_before as number,
        context_size_after: row.context_size_after as number,
        waste_flags: JSON.parse(row.waste_flags as string),
        classification: row.classification as EventRow["classification"],
        roi_score: row.roi_score as number,
        task_metadata: JSON.parse(row.task_metadata as string),
        feature_id: (row.feature_id as string) ?? null,
        quality_proof:
          row.quality_proof != null
            ? JSON.parse(row.quality_proof as string)
            : null,
      });
    }
    stmt.free();
    return out;
  }

  async close(): Promise<void> {
    try {
      if (this.db) {
        if (this.opts.path !== ":memory:") this.flushSync();
        this.db.close();
        this.db = null;
      }
    } finally {
      if (this.releaseLock) {
        await this.releaseLock().catch(() => {});
        this.releaseLock = null;
      }
    }
  }
}
