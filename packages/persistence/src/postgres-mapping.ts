/**
 * Pure row <-> table mappers for PostgresSink.
 *
 * PostgresSink writes to the `persistence_*` tables in @prune/db, which mirror
 * the @prune/persistence SQLite schema **byte-for-byte** (see the Phase 9.7+
 * block in packages/db/src/schema.ts):
 *   - PRIMARY KEYs are caller-supplied TEXT (never server-generated uuids).
 *   - wall-clock fields are TEXT holding the exact ISO-8601 string the caller
 *     stored (no Date coercion -> no zone/millisecond drift).
 *   - JSON fields are jsonb. Unlike the SQLite sink (which JSON.stringify's into
 *     a TEXT column), Postgres jsonb stores native JS objects/arrays, and the
 *     drizzle/postgres-js driver (de)serializes them. So the mappers here pass
 *     objects/arrays THROUGH unchanged — double-stringifying would corrupt the
 *     round trip. The `payload_json` field on AlertRow is the one exception: it
 *     is an opaque pre-serialized string in the interface and stays TEXT here
 *     too, so it is passed through verbatim.
 *
 * These functions are deliberately framework-free (no drizzle, no driver) and
 * fully exported so the row<->table mapping can be unit-tested exhaustively
 * without a live database. PostgresSink composes them with the drizzle query
 * builder; the SQL it issues is thin enough that the only place a fidelity bug
 * can hide is here.
 *
 * Fidelity contract: for every row type R,
 *   fromXxxRow(toXxxInsert(r)) deep-equals r
 * with all optional/nullable fields normalised exactly as LocalSqliteSink
 * normalises them (e.g. `team_id ?? null`, `feature_id ?? null`,
 * `metadata ?? {}`), so a SQLite -> Postgres export is lossless.
 */

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

// ---------------------------------------------------------------------------
// Insert shapes. These match the column sets of the persistence_* tables. They
// are plain objects (not Drizzle types) so this module has zero dependency on
// @prune/db — keeping the mapping pure and unit-testable. PostgresSink hands
// these straight to drizzle's `.values(...)`, whose inferred insert type is a
// structural superset of each shape below.
// ---------------------------------------------------------------------------

export interface EventInsert {
  event_id: string;
  session_id: string;
  user_id: string;
  team_id: string | null;
  timestamp: string;
  provider: string;
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
  classification: string;
  roi_score: number;
  task_metadata: { type: string; repo: string | null; branch: string | null };
  feature_id: string | null;
  quality_proof: Record<string, unknown> | null;
}

export interface CompactionInsert {
  event_id: string;
  session_id: string;
  timestamp: string;
  turn_number: number;
  tokens_before: number;
  tokens_after: number;
  tokens_removed: number;
  overhead_cost_usd: number;
  lost_references: Array<{ item: string; category: string; original_turn: number }>;
  summary: string;
}

export interface AlertInsert {
  alert_id: string;
  session_id: string;
  team_id: string | null;
  timestamp: string;
  severity: string;
  kind: string;
  message: string;
  payload_json: string;
}

export interface BudgetUsageInsert {
  team_id: string;
  period: string;
  spent_usd: number;
  limit_usd: number;
}

export interface BudgetEnvelopeInsert {
  envelope_id: string;
  name: string;
  period_kind: string;
  period_start: string;
  period_end: string;
  limit_usd: number;
  soft_cap_pct: number;
  hard_cap_pct: number;
  parent_envelope_id: string | null;
  metadata: Record<string, unknown>;
}

export interface BudgetChargeInsert {
  charge_id: string;
  envelope_id: string;
  timestamp: string;
  agent_id: string | null;
  model: string;
  provider: string;
  tokens_in: number;
  tokens_out: number;
  tokens_cached: number;
  tokens_cache_creation: number;
  cost_usd: number;
  source: string;
  metadata: Record<string, unknown>;
}

export interface SloDefinitionInsert {
  slo_id: string;
  name: string;
  scope_envelope_id: string;
  target_usd_per_task: number;
  error_budget_usd: number;
  window_days: number;
  warning_pct: number;
  task_dimension: string;
  metadata: Record<string, unknown>;
}

export interface ReplayLogInsert {
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

/**
 * A row as read back from the driver. jsonb columns arrive as already-parsed
 * JS values; we still defensively coerce nullables the same way LocalSqliteSink
 * does so a row written by either backend reads back identically.
 */
export type DbRow = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Normalisation helpers — mirror LocalSqliteSink's discipline exactly.
// ---------------------------------------------------------------------------

/** jsonb objects round-trip natively; default to {} like the SQLite sink. */
function objOrEmpty(v: unknown): Record<string, unknown> {
  return (v as Record<string, unknown> | null | undefined) ?? {};
}

/** jsonb arrays round-trip natively; default to [] for defensiveness. */
function arrOrEmpty<T>(v: unknown): T[] {
  return (v as T[] | null | undefined) ?? [];
}

// ---------------------------------------------------------------------------
// EventRow
// ---------------------------------------------------------------------------

export function toEventInsert(r: EventRow): EventInsert {
  return {
    event_id: r.event_id,
    session_id: r.session_id,
    user_id: r.user_id,
    team_id: r.team_id ?? null,
    timestamp: r.timestamp,
    provider: r.provider,
    tool: r.tool,
    model: r.model,
    tokens_in: r.tokens_in,
    tokens_out: r.tokens_out,
    tokens_cached: r.tokens_cached,
    latency_ms: r.latency_ms,
    estimated_cost_usd: r.estimated_cost_usd,
    cumulative_session_cost_usd: r.cumulative_session_cost_usd,
    tool_calls: r.tool_calls,
    files_referenced: r.files_referenced,
    compaction_triggered: r.compaction_triggered,
    context_size_before: r.context_size_before,
    context_size_after: r.context_size_after,
    waste_flags: r.waste_flags,
    classification: r.classification,
    roi_score: r.roi_score,
    task_metadata: r.task_metadata,
    feature_id: r.feature_id ?? null,
    quality_proof: r.quality_proof ?? null,
  };
}

export function fromEventRow(r: DbRow): EventRow {
  return {
    event_id: r.event_id as string,
    session_id: r.session_id as string,
    user_id: r.user_id as string,
    team_id: (r.team_id as string | null) ?? null,
    timestamp: r.timestamp as string,
    provider: r.provider as EventRow["provider"],
    tool: r.tool as string,
    model: r.model as string,
    tokens_in: r.tokens_in as number,
    tokens_out: r.tokens_out as number,
    tokens_cached: r.tokens_cached as number,
    latency_ms: r.latency_ms as number,
    estimated_cost_usd: r.estimated_cost_usd as number,
    cumulative_session_cost_usd: r.cumulative_session_cost_usd as number,
    tool_calls: arrOrEmpty<string>(r.tool_calls),
    files_referenced: arrOrEmpty<string>(r.files_referenced),
    compaction_triggered: r.compaction_triggered as boolean,
    context_size_before: r.context_size_before as number,
    context_size_after: r.context_size_after as number,
    waste_flags: arrOrEmpty<string>(r.waste_flags),
    classification: r.classification as EventRow["classification"],
    roi_score: r.roi_score as number,
    task_metadata: r.task_metadata as EventRow["task_metadata"],
    feature_id: (r.feature_id as string | null) ?? null,
    quality_proof: (r.quality_proof as Record<string, unknown> | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// CompactionEventRow
// ---------------------------------------------------------------------------

export function toCompactionInsert(r: CompactionEventRow): CompactionInsert {
  return {
    event_id: r.event_id,
    session_id: r.session_id,
    timestamp: r.timestamp,
    turn_number: r.turn_number,
    tokens_before: r.tokens_before,
    tokens_after: r.tokens_after,
    tokens_removed: r.tokens_removed,
    overhead_cost_usd: r.overhead_cost_usd,
    lost_references: r.lost_references,
    summary: r.summary,
  };
}

export function fromCompactionRow(r: DbRow): CompactionEventRow {
  return {
    event_id: r.event_id as string,
    session_id: r.session_id as string,
    timestamp: r.timestamp as string,
    turn_number: r.turn_number as number,
    tokens_before: r.tokens_before as number,
    tokens_after: r.tokens_after as number,
    tokens_removed: r.tokens_removed as number,
    overhead_cost_usd: r.overhead_cost_usd as number,
    lost_references: arrOrEmpty<CompactionEventRow["lost_references"][number]>(
      r.lost_references
    ),
    summary: r.summary as string,
  };
}

// ---------------------------------------------------------------------------
// AlertRow — payload_json is opaque pre-serialized TEXT, passed through.
// ---------------------------------------------------------------------------

export function toAlertInsert(r: AlertRow): AlertInsert {
  return {
    alert_id: r.alert_id,
    session_id: r.session_id,
    team_id: r.team_id ?? null,
    timestamp: r.timestamp,
    severity: r.severity,
    kind: r.kind,
    message: r.message,
    payload_json: r.payload_json,
  };
}

export function fromAlertRow(r: DbRow): AlertRow {
  return {
    alert_id: r.alert_id as string,
    session_id: r.session_id as string,
    team_id: (r.team_id as string | null) ?? null,
    timestamp: r.timestamp as string,
    severity: r.severity as AlertRow["severity"],
    kind: r.kind as string,
    message: r.message as string,
    payload_json: r.payload_json as string,
  };
}

// ---------------------------------------------------------------------------
// BudgetUsageRow
// ---------------------------------------------------------------------------

export function toBudgetUsageInsert(r: BudgetUsageRow): BudgetUsageInsert {
  return {
    team_id: r.team_id,
    period: r.period,
    spent_usd: r.spent_usd,
    limit_usd: r.limit_usd,
  };
}

export function fromBudgetUsageRow(r: DbRow): BudgetUsageRow {
  return {
    team_id: r.team_id as string,
    period: r.period as string,
    spent_usd: r.spent_usd as number,
    limit_usd: r.limit_usd as number,
  };
}

// ---------------------------------------------------------------------------
// BudgetEnvelopeRow
// ---------------------------------------------------------------------------

export function toBudgetEnvelopeInsert(r: BudgetEnvelopeRow): BudgetEnvelopeInsert {
  return {
    envelope_id: r.envelope_id,
    name: r.name,
    period_kind: r.period_kind,
    period_start: r.period_start,
    period_end: r.period_end,
    limit_usd: r.limit_usd,
    soft_cap_pct: r.soft_cap_pct,
    hard_cap_pct: r.hard_cap_pct,
    parent_envelope_id: r.parent_envelope_id ?? null,
    metadata: r.metadata,
  };
}

export function fromBudgetEnvelopeRow(r: DbRow): BudgetEnvelopeRow {
  return {
    envelope_id: r.envelope_id as string,
    name: r.name as string,
    period_kind: r.period_kind as BudgetEnvelopeRow["period_kind"],
    period_start: r.period_start as string,
    period_end: r.period_end as string,
    limit_usd: r.limit_usd as number,
    soft_cap_pct: r.soft_cap_pct as number,
    hard_cap_pct: r.hard_cap_pct as number,
    parent_envelope_id: (r.parent_envelope_id as string | null) ?? null,
    metadata: objOrEmpty(r.metadata),
  };
}

// ---------------------------------------------------------------------------
// BudgetChargeRow
// ---------------------------------------------------------------------------

export function toBudgetChargeInsert(r: BudgetChargeRow): BudgetChargeInsert {
  return {
    charge_id: r.charge_id,
    envelope_id: r.envelope_id,
    timestamp: r.timestamp,
    agent_id: r.agent_id ?? null,
    model: r.model,
    provider: r.provider,
    tokens_in: r.tokens_in,
    tokens_out: r.tokens_out,
    tokens_cached: r.tokens_cached,
    tokens_cache_creation: r.tokens_cache_creation,
    cost_usd: r.cost_usd,
    source: r.source,
    metadata: r.metadata,
  };
}

export function fromBudgetChargeRow(r: DbRow): BudgetChargeRow {
  return {
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
    metadata: objOrEmpty(r.metadata),
  };
}

// ---------------------------------------------------------------------------
// SloDefinitionRow
// ---------------------------------------------------------------------------

export function toSloDefinitionInsert(r: SloDefinitionRow): SloDefinitionInsert {
  return {
    slo_id: r.slo_id,
    name: r.name,
    scope_envelope_id: r.scope_envelope_id,
    target_usd_per_task: r.target_usd_per_task,
    error_budget_usd: r.error_budget_usd,
    window_days: r.window_days,
    warning_pct: r.warning_pct,
    task_dimension: r.task_dimension,
    metadata: r.metadata,
  };
}

export function fromSloDefinitionRow(r: DbRow): SloDefinitionRow {
  return {
    slo_id: r.slo_id as string,
    name: r.name as string,
    scope_envelope_id: r.scope_envelope_id as string,
    target_usd_per_task: r.target_usd_per_task as number,
    error_budget_usd: r.error_budget_usd as number,
    window_days: r.window_days as number,
    warning_pct: r.warning_pct as number,
    task_dimension: r.task_dimension as string,
    metadata: objOrEmpty(r.metadata),
  };
}

// ---------------------------------------------------------------------------
// ReplayLogRow
// ---------------------------------------------------------------------------

export function toReplayLogInsert(r: ReplayLogRow): ReplayLogInsert {
  return {
    record_id: r.record_id,
    session_id: r.session_id,
    sequence: r.sequence,
    timestamp: r.timestamp,
    kind: r.kind,
    payload_canonical: r.payload_canonical,
    record_hash: r.record_hash,
    prev_record_hash: r.prev_record_hash ?? null,
    signature: r.signature,
    signer_fingerprint: r.signer_fingerprint,
    metadata: r.metadata,
  };
}

export function fromReplayLogRow(r: DbRow): ReplayLogRow {
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
    metadata: objOrEmpty(r.metadata),
  };
}
