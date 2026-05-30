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

export interface PersistenceSink {
  init(): Promise<void>;
  recordEvent(row: EventRow): Promise<void>;
  recordCompaction(row: CompactionEventRow): Promise<void>;
  recordAlert(row: AlertRow): Promise<void>;
  upsertBudgetUsage(row: BudgetUsageRow): Promise<void>;
  getRecentEvents(sessionId: string, limit?: number): Promise<EventRow[]>;
  close(): Promise<void>;
}
