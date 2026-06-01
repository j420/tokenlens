import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalSqliteSink } from "@prune/persistence";
import type {
  BudgetChargeRow,
  SloDefinitionRow,
} from "@prune/persistence";

import { computeSli } from "./sli.js";
import { decideBreaker, formatBreakerMessage } from "./breaker.js";
import { SloManager, SloManagerError } from "./manager.js";

function charge(
  taskKey: string | null,
  cost: number,
  timestamp = "2026-05-15T10:00:00.000Z"
): BudgetChargeRow {
  return {
    charge_id: `c-${Math.random()}`,
    envelope_id: "e1",
    timestamp,
    agent_id: taskKey,
    model: "claude-sonnet-4",
    provider: "anthropic",
    tokens_in: 1000,
    tokens_out: 200,
    tokens_cached: 0,
    tokens_cache_creation: 0,
    cost_usd: cost,
    source: "recorded",
    metadata: {},
  };
}

function slo(over: Partial<SloDefinitionRow> = {}): SloDefinitionRow {
  return {
    slo_id: "s1",
    name: "team-slo",
    scope_envelope_id: "e1",
    target_usd_per_task: 1.0,
    error_budget_usd: 5.0,
    window_days: 7,
    warning_pct: 0.5,
    task_dimension: "agent_id",
    metadata: {},
    ...over,
  };
}

// ============================================================================
// SLI computation
// ============================================================================

describe("computeSli", () => {
  const asOf = new Date("2026-05-15T12:00:00.000Z");

  it("zero charges → zero tasks, full error budget", () => {
    const s = computeSli(slo(), [], { asOf });
    expect(s.totalTaskCount).toBe(0);
    expect(s.complianceRatio).toBe(1);
    expect(s.errorBudgetRemainingUsd).toBe(5.0);
  });

  it("counts a task per unique agent_id; aggregates cost", () => {
    const s = computeSli(
      slo(),
      [
        charge("alice", 0.30),
        charge("alice", 0.40),
        charge("bob", 0.50),
      ],
      { asOf }
    );
    expect(s.totalTaskCount).toBe(2);
    const alice = s.tasks.find((t) => t.taskKey === "alice")!;
    expect(alice.costUsd).toBeCloseTo(0.7, 6);
    expect(alice.chargeCount).toBe(2);
  });

  it("compliantTaskCount counts tasks ≤ target", () => {
    const s = computeSli(
      slo({ target_usd_per_task: 1.0 }),
      [
        charge("a", 0.5), // compliant
        charge("b", 0.9), // compliant
        charge("c", 1.5), // violating
        charge("d", 2.5), // violating
      ],
      { asOf }
    );
    expect(s.compliantTaskCount).toBe(2);
    expect(s.violatingTaskCount).toBe(2);
    expect(s.complianceRatio).toBe(0.5);
  });

  it("excessSpend sums (cost - target) for violators", () => {
    const s = computeSli(
      slo({ target_usd_per_task: 1.0 }),
      [
        charge("a", 1.5), // +0.5
        charge("b", 2.0), // +1.0
      ],
      { asOf }
    );
    expect(s.excessSpendUsd).toBeCloseTo(1.5, 6);
  });

  it("errorBudgetRemaining = budget - excess; burn pct = excess / budget", () => {
    const s = computeSli(
      slo({ target_usd_per_task: 1.0, error_budget_usd: 2.0 }),
      [charge("a", 1.5), charge("b", 2.0)], // excess 0.5 + 1.0 = 1.5
      { asOf }
    );
    expect(s.errorBudgetRemainingUsd).toBeCloseTo(0.5, 6);
    expect(s.errorBudgetBurnPct).toBeCloseTo(0.75, 6);
  });

  it("filters charges outside the window", () => {
    const s = computeSli(
      slo({ window_days: 7 }),
      [
        charge("recent", 0.5, "2026-05-14T10:00:00.000Z"),
        charge("old", 99, "2025-12-01T10:00:00.000Z"), // outside 7-day window
      ],
      { asOf }
    );
    expect(s.totalTaskCount).toBe(1);
    expect(s.tasks[0].taskKey).toBe("recent");
  });

  it("ignores charges with null task key", () => {
    const s = computeSli(slo(), [charge(null, 5.0), charge("alice", 0.5)], {
      asOf,
    });
    expect(s.totalTaskCount).toBe(1);
  });

  it("computes p50 / p95 / p99 and mean", () => {
    const s = computeSli(
      slo(),
      [
        charge("a", 0.1),
        charge("b", 0.2),
        charge("c", 0.3),
        charge("d", 0.4),
        charge("e", 1.0),
      ],
      { asOf }
    );
    expect(s.p50TaskCostUsd).toBeCloseTo(0.3, 6);
    expect(s.p95TaskCostUsd).toBeCloseTo(0.88, 1);
    expect(s.meanTaskCostUsd).toBeCloseTo(0.4, 6);
  });

  it("tasks are sorted by cost descending (top violators first)", () => {
    const s = computeSli(
      slo(),
      [charge("a", 0.1), charge("b", 5.0), charge("c", 1.0)],
      { asOf }
    );
    expect(s.tasks.map((t) => t.taskKey)).toEqual(["b", "c", "a"]);
  });

  it("supports task_dimension='model' for per-model SLOs", () => {
    const s = computeSli(
      slo({ task_dimension: "model" }),
      [
        { ...charge("a", 0.5), model: "claude-haiku-4-5" },
        { ...charge("b", 1.5), model: "claude-haiku-4-5" },
        { ...charge("c", 0.5), model: "claude-opus-4" },
      ],
      { asOf }
    );
    expect(s.totalTaskCount).toBe(2);
    const haiku = s.tasks.find((t) => t.taskKey === "claude-haiku-4-5")!;
    expect(haiku.costUsd).toBeCloseTo(2.0, 6);
  });

  it("supports task_dimension='metadata.attribution.developer'", () => {
    const c1 = charge("a", 0.5);
    c1.metadata = { "attribution.developer": "alice@x" };
    const c2 = charge("b", 0.6);
    c2.metadata = { "attribution.developer": "alice@x" };
    const c3 = charge("c", 0.4);
    c3.metadata = { "attribution.developer": "bob@x" };
    const s = computeSli(
      slo({ task_dimension: "metadata.attribution.developer" }),
      [c1, c2, c3],
      { asOf }
    );
    expect(s.totalTaskCount).toBe(2);
    const alice = s.tasks.find((t) => t.taskKey === "alice@x")!;
    expect(alice.costUsd).toBeCloseTo(1.1, 6);
  });
});

// ============================================================================
// Breaker policy
// ============================================================================

describe("decideBreaker", () => {
  const baseAsOf = new Date("2026-05-15T12:00:00.000Z");

  it("ALLOW when budget remaining > warning threshold", () => {
    const sli = computeSli(
      slo({ error_budget_usd: 10, warning_pct: 0.5, target_usd_per_task: 1 }),
      [charge("a", 0.5)], // no excess
      { asOf: baseAsOf }
    );
    const d = decideBreaker(sli);
    expect(d.verdict).toBe("allow");
    expect(d.rule).toBe("rule:headroom");
  });

  it("WARN when budget remaining ≤ warning threshold but > 0", () => {
    const sli = computeSli(
      slo({ error_budget_usd: 10, warning_pct: 0.5, target_usd_per_task: 1 }),
      [
        charge("a", 7.0), // excess 6
      ],
      { asOf: baseAsOf }
    );
    const d = decideBreaker(sli);
    expect(d.verdict).toBe("warn");
    expect(d.rule).toBe("rule:warning_threshold");
    expect(d.remediations.length).toBeGreaterThan(0);
  });

  it("BLOCK when budget exhausted", () => {
    const sli = computeSli(
      slo({ error_budget_usd: 2, warning_pct: 0.5, target_usd_per_task: 1 }),
      [
        charge("a", 5.0), // excess 4, > budget 2
      ],
      { asOf: baseAsOf }
    );
    const d = decideBreaker(sli);
    expect(d.verdict).toBe("block");
    expect(d.rule).toBe("rule:budget_exhausted");
    expect(d.rationale).toMatch(/exhausted/);
  });

  it("disabled breaker when error_budget_usd = 0", () => {
    const sli = computeSli(
      slo({ error_budget_usd: 0 }),
      [charge("a", 100)],
      { asOf: baseAsOf }
    );
    const d = decideBreaker(sli);
    expect(d.verdict).toBe("allow");
    expect(d.rule).toBe("rule:no_budget_configured");
  });

  it("formatBreakerMessage includes rationale + remediations", () => {
    const sli = computeSli(
      slo({ error_budget_usd: 2, target_usd_per_task: 1 }),
      [charge("a", 5)],
      { asOf: baseAsOf }
    );
    const d = decideBreaker(sli);
    const msg = formatBreakerMessage(d);
    expect(msg).toMatch(/⛔/);
    expect(msg).toMatch(/Remediations/);
  });
});

// ============================================================================
// SloManager — end-to-end with LocalSqliteSink
// ============================================================================

describe("SloManager — end-to-end", () => {
  let dir = "";
  let sink: LocalSqliteSink;
  let manager: SloManager;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "prune-slo-"));
    sink = new LocalSqliteSink({ path: join(dir, "s.sqlite") });
    await sink.init();
    manager = new SloManager(sink);
    // Seed an envelope for SLO scope.
    await sink.upsertBudgetEnvelope({
      envelope_id: "env-1",
      name: "team-monthly",
      period_kind: "month",
      period_start: "2026-05-01T00:00:00.000Z",
      period_end: "2026-05-31T23:59:59.999Z",
      limit_usd: 1000,
      soft_cap_pct: 0.75,
      hard_cap_pct: 1.0,
      parent_envelope_id: null,
      metadata: {},
    });
  });

  afterEach(async () => {
    await sink.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("define + get round-trips an SLO", async () => {
    await manager.define({
      name: "task-cost-slo",
      scopeEnvelopeName: "team-monthly",
      targetUsdPerTask: 1.0,
      errorBudgetUsd: 10.0,
      windowDays: 7,
    });
    const got = await manager.get("task-cost-slo");
    expect(got).not.toBeNull();
    expect(got!.target_usd_per_task).toBe(1.0);
    expect(got!.error_budget_usd).toBe(10.0);
    expect(got!.warning_pct).toBe(0.5);
    expect(got!.task_dimension).toBe("agent_id");
  });

  it("define is idempotent (upsert) on name", async () => {
    await manager.define({
      name: "x",
      scopeEnvelopeName: "team-monthly",
      targetUsdPerTask: 1.0,
      errorBudgetUsd: 10,
      windowDays: 7,
    });
    await manager.define({
      name: "x",
      scopeEnvelopeName: "team-monthly",
      targetUsdPerTask: 2.0,
      errorBudgetUsd: 20,
      windowDays: 14,
    });
    const got = await manager.get("x");
    expect(got!.target_usd_per_task).toBe(2.0);
    expect(got!.error_budget_usd).toBe(20);
    expect(got!.window_days).toBe(14);
  });

  it("define rejects unknown scope envelope", async () => {
    await expect(
      manager.define({
        name: "y",
        scopeEnvelopeName: "missing",
        targetUsdPerTask: 1,
        errorBudgetUsd: 1,
        windowDays: 1,
      })
    ).rejects.toThrow(SloManagerError);
  });

  it("define rejects invalid params", async () => {
    await expect(
      manager.define({
        name: "z",
        scopeEnvelopeName: "team-monthly",
        targetUsdPerTask: 0,
        errorBudgetUsd: 1,
        windowDays: 1,
      })
    ).rejects.toThrow();
    await expect(
      manager.define({
        name: "z",
        scopeEnvelopeName: "team-monthly",
        targetUsdPerTask: 1,
        errorBudgetUsd: -1,
        windowDays: 1,
      })
    ).rejects.toThrow();
    await expect(
      manager.define({
        name: "z",
        scopeEnvelopeName: "team-monthly",
        targetUsdPerTask: 1,
        errorBudgetUsd: 1,
        windowDays: 0,
      })
    ).rejects.toThrow();
    await expect(
      manager.define({
        name: "z",
        scopeEnvelopeName: "team-monthly",
        targetUsdPerTask: 1,
        errorBudgetUsd: 1,
        windowDays: 1,
        warningPct: 1.5,
      })
    ).rejects.toThrow();
  });

  it("sli pulls from the scope envelope and respects window_days", async () => {
    await manager.define({
      name: "task-slo",
      scopeEnvelopeName: "team-monthly",
      targetUsdPerTask: 1.0,
      errorBudgetUsd: 5,
      windowDays: 7,
    });
    const asOf = new Date("2026-05-15T12:00:00.000Z");
    // One in-window violator and one outside the window.
    await sink.recordBudgetCharge({
      ...charge("alice", 2.0, "2026-05-14T10:00:00.000Z"),
      envelope_id: "env-1",
    });
    await sink.recordBudgetCharge({
      ...charge("bob-old", 99, "2025-01-01T00:00:00.000Z"),
      envelope_id: "env-1",
    });
    const sli = await manager.sli("task-slo", asOf);
    expect(sli.totalTaskCount).toBe(1);
    expect(sli.tasks[0].taskKey).toBe("alice");
  });

  it("check returns a BreakerDecision from the same SLI", async () => {
    await manager.define({
      name: "tight",
      scopeEnvelopeName: "team-monthly",
      targetUsdPerTask: 1.0,
      errorBudgetUsd: 0.5,
      windowDays: 7,
    });
    const asOf = new Date("2026-05-15T12:00:00.000Z");
    await sink.recordBudgetCharge({
      ...charge("violator", 5.0, "2026-05-14T10:00:00.000Z"),
      envelope_id: "env-1",
    });
    const d = await manager.check("tight", asOf);
    expect(d.verdict).toBe("block");
  });
});
