/**
 * PersistenceSink — the interface every Prune storage backend implements.
 *
 * Rows mirror the canonical event schema from @prune/shared/schemas/event.ts
 * so a record stored in LocalSqlite can be flushed verbatim to Postgres
 * later by CompositeSink.
 */

import type { Provider } from "@prune/shared";

export interface EventRow {
  event_id: string;
  session_id: string;
  user_id: string;
  team_id: string | null;
  timestamp: string; // ISO 8601
  provider: Provider;
  tool: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  tokens_cached: number;
  latency_ms: number;
  estimated_cost_usd: number;
  cumulative_session_cost_usd: number;
  tool_calls: string[];
  files_referenced: string[];
  compaction_triggered: boolean;
  context_size_before: number;
  context_size_after: number;
  waste_flags: string[];
  classification: "productive" | "recursive" | "unknown";
  roi_score: number;
  task_metadata: { type: string; repo: string | null; branch: string | null };
}

export interface CompactionEventRow {
  event_id: string;
  session_id: string;
  timestamp: string;
  turn_number: number;
  tokens_before: number;
  tokens_after: number;
  tokens_removed: number;
  overhead_cost_usd: number;
  lost_references: Array<{
    item: string;
    category: string;
    original_turn: number;
  }>;
  summary: string;
}

export interface AlertRow {
  alert_id: string;
  session_id: string;
  team_id: string | null;
  timestamp: string;
  severity: "yellow" | "red";
  kind: string; // e.g. "loop_breaker", "compaction_loss", "cache_bust"
  message: string;
  payload_json: string;
}

export interface BudgetUsageRow {
  team_id: string;
  period: string; // ISO date for the rolling-window start
  spent_usd: number;
  limit_usd: number;
}

/**
 * A named budget envelope. Tracks a fixed-period spend cap. A parent
 * envelope id allows nesting (per-team → per-project → per-agent
 * sub-budgets) where a child's spend rolls up to the parent.
 *
 * Designed to map cleanly onto Anthropic's June 15 2026 Agent SDK
 * separate-credit-pool model: the user's `$200` Max-20x envelope is one
 * `budget_envelopes` row; per-agent sub-budgets are children.
 */
export interface BudgetEnvelopeRow {
  envelope_id: string;
  name: string;                // unique; user-facing label
  period_kind: "day" | "week" | "month" | "custom";
  period_start: string;        // ISO 8601
  period_end: string;          // ISO 8601 (inclusive)
  limit_usd: number;
  soft_cap_pct: number;        // 0..1, warn threshold (default 0.75)
  hard_cap_pct: number;        // 0..1, block threshold (default 1.0)
  parent_envelope_id: string | null;
  metadata: Record<string, unknown>;
}

/**
 * A single charge against an envelope. May come from either a recorded
 * post-call usage report (`source: "recorded"`) or a pre-flight reserve
 * (`source: "reserved"`) that is later replaced when the real call lands.
 */
export interface BudgetChargeRow {
  charge_id: string;
  envelope_id: string;
  timestamp: string;
  agent_id: string | null;
  model: string;
  provider: Provider;
  tokens_in: number;
  tokens_out: number;
  tokens_cached: number;
  tokens_cache_creation: number;
  cost_usd: number;
  source: "reserved" | "recorded";
  metadata: Record<string, unknown>;
}

/**
 * SLO (Service Level Objective) — SRE Error Budget pattern for AI cost.
 * One row per named SLO. The SLI is computed at read time from
 * budget_charges, so adjusting an SLO's targetUsdPerTask doesn't rewrite
 * history.
 */
export interface SloDefinitionRow {
  slo_id: string;
  name: string;
  scope_envelope_id: string;
  target_usd_per_task: number;
  error_budget_usd: number;
  window_days: number;
  warning_pct: number;
  /** Which charge field defines a "task". Default "agent_id". */
  task_dimension: string;
  metadata: Record<string, unknown>;
}

/**
 * Replay vault row — one tamper-evident audit record per (session, sequence).
 * Hash chain + ed25519 signature provided by @prune/replay-vault.
 */
export interface ReplayLogRow {
  record_id: string;
  session_id: string;
  sequence: number;
  timestamp: string;
  kind: string;
  payload_canonical: string;
  record_hash: string;
  prev_record_hash: string | null;
  signature: string;
  signer_fingerprint: string;
  metadata: Record<string, unknown>;
}

export interface PersistenceSink {
  init(): Promise<void>;
  recordEvent(row: EventRow): Promise<void>;
  recordCompaction(row: CompactionEventRow): Promise<void>;
  recordAlert(row: AlertRow): Promise<void>;
  upsertBudgetUsage(row: BudgetUsageRow): Promise<void>;
  /** Insert a new envelope or update existing limits/caps. */
  upsertBudgetEnvelope(row: BudgetEnvelopeRow): Promise<void>;
  /** Append a charge against an envelope. */
  recordBudgetCharge(row: BudgetChargeRow): Promise<void>;
  /** Lookup by unique name; returns null if absent. */
  getBudgetEnvelope(name: string): Promise<BudgetEnvelopeRow | null>;
  /** Lookup by primary key; null if absent. Used for parent rollups. */
  getBudgetEnvelopeById(envelopeId: string): Promise<BudgetEnvelopeRow | null>;
  /** Insert or update an SLO definition (idempotent on `name`). */
  upsertSloDefinition(row: SloDefinitionRow): Promise<void>;
  /** Read an SLO by name; null if absent. */
  getSloDefinition(name: string): Promise<SloDefinitionRow | null>;
  /** List all SLOs configured. */
  listSloDefinitions(): Promise<SloDefinitionRow[]>;
  /** Sum of cost_usd against envelope_id in [since, now]. Excludes envelopes that have no charges (returns 0). */
  getBudgetSpend(envelopeId: string, since: Date): Promise<number>;
  /** Last N charges against an envelope (most recent first). For burn-rate computation and audit. */
  getRecentBudgetCharges(envelopeId: string, limit?: number): Promise<BudgetChargeRow[]>;
  /**
   * Append a row to the replay log. Throws if the (session_id, sequence)
   * is already taken — the vault expects monotonic sequence per session.
   */
  appendReplayLog(row: ReplayLogRow): Promise<void>;
  /** Read all rows for a session, ordered by sequence ascending. */
  getReplayLogBySession(sessionId: string): Promise<ReplayLogRow[]>;
  /** Read the most recent row for a session — used to chain the next append. */
  getLatestReplayLog(sessionId: string): Promise<ReplayLogRow | null>;
  getRecentEvents(sessionId: string, limit?: number): Promise<EventRow[]>;
  /**
   * Commit pending writes to durable storage. Implementations are free to
   * no-op if the underlying store is already durable (e.g. a server-side
   * database). For file-backed sinks, callers that want at-most-N-events
   * of loss tolerance should call this on their own cadence; `close()`
   * always flushes regardless.
   */
  flush(): Promise<void>;
  close(): Promise<void>;
}
