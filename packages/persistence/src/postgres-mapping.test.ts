import { describe, it, expect } from "vitest";
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
import {
  fromAlertRow,
  fromBudgetChargeRow,
  fromBudgetEnvelopeRow,
  fromBudgetUsageRow,
  fromCompactionRow,
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
 * The persistence_* tables store jsonb natively, so the driver returns
 * already-parsed JS values. This helper simulates the read path: a row written
 * via the insert mapper, then read back as a plain object (jsonb fields are NOT
 * re-stringified, unlike the SQLite sink's TEXT columns). It lets us assert the
 * full insert -> driver-row -> domain-row round trip without a live DB.
 */
function asDbRow(insert: Record<string, unknown>): Record<string, unknown> {
  // Deep clone to prove the mappers don't alias the caller's objects/arrays.
  return JSON.parse(JSON.stringify(insert));
}

// ===========================================================================
// EventRow
// ===========================================================================

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

describe("EventRow mapping", () => {
  it("round-trips a full event row", () => {
    expect(fromEventRow(asDbRow(toEventInsert(baseEvent)))).toEqual(baseEvent);
  });

  it("round-trips a TCRP-tagged event (feature_id + quality_proof)", () => {
    const tagged: EventRow = {
      ...baseEvent,
      feature_id: "f3",
      quality_proof: { substituted: true, tokens_saved: 1840, nested: { a: [1, 2] } },
    };
    expect(fromEventRow(asDbRow(toEventInsert(tagged)))).toEqual(tagged);
  });

  it("preserves null team_id as null", () => {
    const insert = toEventInsert({ ...baseEvent, team_id: null });
    expect(insert.team_id).toBeNull();
    expect(fromEventRow(asDbRow(insert)).team_id).toBeNull();
  });

  it("preserves a non-null team_id", () => {
    const r: EventRow = { ...baseEvent, team_id: "team-9" };
    expect(fromEventRow(asDbRow(toEventInsert(r))).team_id).toBe("team-9");
  });

  it("round-trips empty arrays for tool_calls/files_referenced/waste_flags", () => {
    const r: EventRow = {
      ...baseEvent,
      tool_calls: [],
      files_referenced: [],
      waste_flags: [],
    };
    const back = fromEventRow(asDbRow(toEventInsert(r)));
    expect(back.tool_calls).toEqual([]);
    expect(back.files_referenced).toEqual([]);
    expect(back.waste_flags).toEqual([]);
  });

  it("normalises a missing feature_id (undefined) to null on read", () => {
    const { feature_id: _omit, ...rest } = baseEvent;
    void _omit;
    // EventRow.feature_id is optional; an undefined input must become null.
    const insert = toEventInsert(rest as EventRow);
    expect(insert.feature_id).toBeNull();
    expect(fromEventRow(asDbRow(insert)).feature_id).toBeNull();
  });

  it("normalises a missing quality_proof to null on read", () => {
    const { quality_proof: _omit, ...rest } = baseEvent;
    void _omit;
    const insert = toEventInsert(rest as EventRow);
    expect(insert.quality_proof).toBeNull();
    expect(fromEventRow(asDbRow(insert)).quality_proof).toBeNull();
  });

  it("defends against null jsonb arrays coming back from the driver", () => {
    const insert = toEventInsert(baseEvent);
    const corrupted = { ...asDbRow(insert), tool_calls: null, waste_flags: null };
    const back = fromEventRow(corrupted);
    expect(back.tool_calls).toEqual([]);
    expect(back.waste_flags).toEqual([]);
  });

  it("preserves task_metadata with null repo/branch", () => {
    const r: EventRow = {
      ...baseEvent,
      task_metadata: { type: "unknown", repo: null, branch: null },
    };
    expect(fromEventRow(asDbRow(toEventInsert(r))).task_metadata).toEqual({
      type: "unknown",
      repo: null,
      branch: null,
    });
  });
});

// ===========================================================================
// CompactionEventRow
// ===========================================================================

describe("CompactionEventRow mapping", () => {
  const base: CompactionEventRow = {
    event_id: "cccccccc-1111-1111-1111-111111111111",
    session_id: "22222222-2222-2222-2222-222222222222",
    timestamp: "2026-05-30T10:30:00.000Z",
    turn_number: 12,
    tokens_before: 30000,
    tokens_after: 5000,
    tokens_removed: 25000,
    overhead_cost_usd: 0.075,
    lost_references: [
      { item: "File reference: auth.ts", category: "file_name", original_turn: 3 },
    ],
    summary: "1 reference lost",
  };

  it("round-trips a compaction row", () => {
    expect(fromCompactionRow(asDbRow(toCompactionInsert(base)))).toEqual(base);
  });

  it("round-trips empty lost_references", () => {
    const r: CompactionEventRow = { ...base, lost_references: [] };
    expect(fromCompactionRow(asDbRow(toCompactionInsert(r))).lost_references).toEqual(
      []
    );
  });

  it("defends against a null lost_references jsonb", () => {
    const corrupted = { ...asDbRow(toCompactionInsert(base)), lost_references: null };
    expect(fromCompactionRow(corrupted).lost_references).toEqual([]);
  });
});

// ===========================================================================
// AlertRow — payload_json is opaque TEXT, never re-serialized.
// ===========================================================================

describe("AlertRow mapping", () => {
  const base: AlertRow = {
    alert_id: "eeeeeeee-1111-1111-1111-111111111111",
    session_id: "22222222-2222-2222-2222-222222222222",
    team_id: null,
    timestamp: "2026-05-30T10:00:00.000Z",
    severity: "red",
    kind: "loop_breaker",
    message: "3 consecutive low-ROI turns",
    payload_json: JSON.stringify({ streak: 3 }),
  };

  it("round-trips an alert row", () => {
    expect(fromAlertRow(asDbRow(toAlertInsert(base)))).toEqual(base);
  });

  it("keeps payload_json as an opaque string (no double-parse)", () => {
    const insert = toAlertInsert(base);
    expect(typeof insert.payload_json).toBe("string");
    expect(insert.payload_json).toBe('{"streak":3}');
  });

  it("preserves null team_id and a yellow severity", () => {
    const r: AlertRow = { ...base, team_id: "t1", severity: "yellow" };
    const back = fromAlertRow(asDbRow(toAlertInsert(r)));
    expect(back.team_id).toBe("t1");
    expect(back.severity).toBe("yellow");
  });
});

// ===========================================================================
// BudgetUsageRow
// ===========================================================================

describe("BudgetUsageRow mapping", () => {
  const base: BudgetUsageRow = {
    team_id: "team-1",
    period: "2026-05",
    spent_usd: 10.5,
    limit_usd: 100,
  };

  it("round-trips a budget usage row", () => {
    expect(fromBudgetUsageRow(asDbRow(toBudgetUsageInsert(base)))).toEqual(base);
  });
});

// ===========================================================================
// BudgetEnvelopeRow
// ===========================================================================

describe("BudgetEnvelopeRow mapping", () => {
  const base: BudgetEnvelopeRow = {
    envelope_id: "11111111-1111-1111-1111-111111111111",
    name: "test",
    period_kind: "month",
    period_start: "2026-05-01T00:00:00.000Z",
    period_end: "2026-05-31T23:59:59.999Z",
    limit_usd: 200,
    soft_cap_pct: 0.75,
    hard_cap_pct: 1.0,
    parent_envelope_id: null,
    metadata: { team: "platform" },
  };

  it("round-trips an envelope row", () => {
    expect(fromBudgetEnvelopeRow(asDbRow(toBudgetEnvelopeInsert(base)))).toEqual(base);
  });

  it("round-trips a nested child envelope (parent_envelope_id set)", () => {
    const child: BudgetEnvelopeRow = {
      ...base,
      envelope_id: "child",
      name: "child",
      parent_envelope_id: base.envelope_id,
    };
    expect(fromBudgetEnvelopeRow(asDbRow(toBudgetEnvelopeInsert(child)))).toEqual(child);
  });

  it("defaults a null metadata jsonb back to {}", () => {
    const corrupted = { ...asDbRow(toBudgetEnvelopeInsert(base)), metadata: null };
    expect(fromBudgetEnvelopeRow(corrupted).metadata).toEqual({});
  });

  it("round-trips each period_kind", () => {
    for (const k of ["day", "week", "month", "custom"] as const) {
      const r: BudgetEnvelopeRow = { ...base, period_kind: k };
      expect(fromBudgetEnvelopeRow(asDbRow(toBudgetEnvelopeInsert(r))).period_kind).toBe(k);
    }
  });
});

// ===========================================================================
// BudgetChargeRow
// ===========================================================================

describe("BudgetChargeRow mapping", () => {
  const base: BudgetChargeRow = {
    charge_id: "22222222-2222-2222-2222-222222222222",
    envelope_id: "11111111-1111-1111-1111-111111111111",
    timestamp: "2026-05-15T10:00:00.000Z",
    agent_id: null,
    model: "claude-sonnet-4",
    provider: "anthropic",
    tokens_in: 1000,
    tokens_out: 200,
    tokens_cached: 0,
    tokens_cache_creation: 0,
    cost_usd: 1.25,
    source: "recorded",
    metadata: { call_id: "abc" },
  };

  it("round-trips a charge row", () => {
    expect(fromBudgetChargeRow(asDbRow(toBudgetChargeInsert(base)))).toEqual(base);
  });

  it("round-trips a reserved charge with an agent_id", () => {
    const r: BudgetChargeRow = { ...base, agent_id: "agent-7", source: "reserved" };
    expect(fromBudgetChargeRow(asDbRow(toBudgetChargeInsert(r)))).toEqual(r);
  });

  it("defaults a null metadata jsonb back to {}", () => {
    const corrupted = { ...asDbRow(toBudgetChargeInsert(base)), metadata: null };
    expect(fromBudgetChargeRow(corrupted).metadata).toEqual({});
  });
});

// ===========================================================================
// SloDefinitionRow
// ===========================================================================

describe("SloDefinitionRow mapping", () => {
  const base: SloDefinitionRow = {
    slo_id: "slo-1",
    name: "task-cost",
    scope_envelope_id: "11111111-1111-1111-1111-111111111111",
    target_usd_per_task: 1.0,
    error_budget_usd: 5.0,
    window_days: 7,
    warning_pct: 0.5,
    task_dimension: "agent_id",
    metadata: { owner: "sre" },
  };

  it("round-trips an SLO row", () => {
    expect(fromSloDefinitionRow(asDbRow(toSloDefinitionInsert(base)))).toEqual(base);
  });

  it("defaults a null metadata jsonb back to {}", () => {
    const corrupted = { ...asDbRow(toSloDefinitionInsert(base)), metadata: null };
    expect(fromSloDefinitionRow(corrupted).metadata).toEqual({});
  });
});

// ===========================================================================
// ReplayLogRow
// ===========================================================================

describe("ReplayLogRow mapping", () => {
  const base: ReplayLogRow = {
    record_id: "rec-1",
    session_id: "s1",
    sequence: 0,
    timestamp: "2026-05-30T10:00:00.000Z",
    kind: "request",
    payload_canonical: '{"q":"hi"}',
    record_hash: "abc",
    prev_record_hash: null,
    signature: "AA==",
    signer_fingerprint: "fingerprint16ch",
    metadata: {},
  };

  it("round-trips the first record (prev_record_hash null)", () => {
    expect(fromReplayLogRow(asDbRow(toReplayLogInsert(base)))).toEqual(base);
  });

  it("round-trips a chained record (prev_record_hash set)", () => {
    const r: ReplayLogRow = {
      ...base,
      record_id: "rec-2",
      sequence: 1,
      prev_record_hash: "abc",
      metadata: { actor: "ci" },
    };
    expect(fromReplayLogRow(asDbRow(toReplayLogInsert(r)))).toEqual(r);
  });

  it("preserves sequence 0 (falsy but valid)", () => {
    expect(toReplayLogInsert(base).sequence).toBe(0);
    expect(fromReplayLogRow(asDbRow(toReplayLogInsert(base))).sequence).toBe(0);
  });

  it("defaults a null metadata jsonb back to {}", () => {
    const corrupted = { ...asDbRow(toReplayLogInsert(base)), metadata: null };
    expect(fromReplayLogRow(corrupted).metadata).toEqual({});
  });
});
