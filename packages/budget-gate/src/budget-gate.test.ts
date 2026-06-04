import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalSqliteSink } from "@prune/persistence";

import { BudgetGate, BudgetGateError } from "./gate.js";
import { summarizeEnvelope } from "./envelope.js";
import { decide } from "./decision.js";
import {
  computeRecordedCost,
  estimateUpcomingCost,
} from "./accountant.js";

let dir = "";
let sink: LocalSqliteSink;
let gate: BudgetGate;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "prune-bg-"));
  sink = new LocalSqliteSink({ path: join(dir, "p.sqlite") });
  await sink.init();
  gate = new BudgetGate(sink);
});

afterEach(async () => {
  await sink.close();
  rmSync(dir, { recursive: true, force: true });
});

// ============================================================================
// Accountant (pure pricing)
// ============================================================================

describe("accountant", () => {
  it("computeRecordedCost — exact path, marks source 'exact'", () => {
    const r = computeRecordedCost({
      model: "claude-sonnet-4",
      tokensIn: 1_000_000,
      tokensOut: 500_000,
    });
    expect(r.source).toBe("exact");
    expect(r.provider).toBe("anthropic");
    expect(r.costUsd).toBeGreaterThan(0);
  });

  it("estimateUpcomingCost — without explicit output, source is 'estimated'", () => {
    const r = estimateUpcomingCost({
      model: "claude-sonnet-4",
      estimatedTokensIn: 10_000,
    });
    expect(r.source).toBe("estimated");
    // Default heuristic: max(500, 10000 * 0.3) = 3000.
    expect(r.tokensOut).toBe(3000);
  });

  it("estimateUpcomingCost — with explicit output, source is 'exact'", () => {
    const r = estimateUpcomingCost({
      model: "claude-sonnet-4",
      estimatedTokensIn: 10_000,
      estimatedTokensOut: 1_000,
    });
    expect(r.source).toBe("exact");
    expect(r.tokensOut).toBe(1_000);
  });

  it("output floor of 500 fires on tiny inputs", () => {
    const r = estimateUpcomingCost({
      model: "claude-sonnet-4",
      estimatedTokensIn: 100,
    });
    expect(r.tokensOut).toBe(500);
  });

  // --- pricing confidence (honesty: never present a fallback rate as fact) ---

  it("computeRecordedCost — a genuinely-priced model is pricedExact, no note", () => {
    const r = computeRecordedCost({
      model: "gpt-4o", // in OPENAI_PRICING
      provider: "openai",
      tokensIn: 1_000_000,
      tokensOut: 500_000,
    });
    expect(r.pricedExact).toBe(true);
    expect(r.pricingNote).toBeUndefined();
    expect(r.costUsd).toBeGreaterThan(0);
  });

  it("computeRecordedCost — an UNKNOWN model is flagged, cost still recorded from fallback", () => {
    const r = computeRecordedCost({
      model: "totally-made-up-model-x",
      provider: "openai",
      tokensIn: 1_000_000,
      tokensOut: 500_000,
    });
    expect(r.pricedExact).toBe(false);
    expect(r.pricingNote).toBe("default fallback rate; model not in price table");
    // The NON-NULL cost column still gets a real number from DEFAULT_PRICING.
    expect(typeof r.costUsd).toBe("number");
    expect(Number.isFinite(r.costUsd)).toBe(true);
    expect(r.costUsd).toBeGreaterThan(0);
  });

  it("estimateUpcomingCost — unknown model is flagged; priced model is not", () => {
    const unknown = estimateUpcomingCost({
      model: "no-such-model",
      provider: "openai",
      estimatedTokensIn: 10_000,
    });
    expect(unknown.pricedExact).toBe(false);
    expect(unknown.pricingNote).toMatch(/fallback rate/);

    const priced = estimateUpcomingCost({
      model: "gpt-4o",
      provider: "openai",
      estimatedTokensIn: 10_000,
    });
    expect(priced.pricedExact).toBe(true);
    expect(priced.pricingNote).toBeUndefined();
  });

  it("pricedExact is about RATE, independent of source (token-count) certainty", () => {
    // estimated source + priced rate
    const r = estimateUpcomingCost({
      model: "gpt-4o",
      provider: "openai",
      estimatedTokensIn: 10_000,
    });
    expect(r.source).toBe("estimated");
    expect(r.pricedExact).toBe(true);
  });

  it("a charge for an unknown model carries pricedExact:false + note in its metadata", async () => {
    await gate.createEnvelope({
      name: "pricing-conf",
      periodKind: "month",
      limitUsd: 100,
    });
    await gate.record({
      envelopeName: "pricing-conf",
      usage: {
        model: "totally-made-up-model-x",
        provider: "openai",
        tokensIn: 1000,
        tokensOut: 500,
      },
      skipAttribution: true,
    });
    const env = await gate.getEnvelope("pricing-conf");
    const charges = await sink.getRecentBudgetCharges(env!.envelope_id, 10);
    expect(charges).toHaveLength(1);
    expect(charges[0].metadata.pricedExact).toBe(false);
    expect(charges[0].metadata.pricingNote).toBe(
      "default fallback rate; model not in price table"
    );
    expect(charges[0].cost_usd).toBeGreaterThan(0);
  });

  it("a charge for a priced model is pricedExact:true with no note", async () => {
    await gate.createEnvelope({
      name: "pricing-conf-2",
      periodKind: "month",
      limitUsd: 100,
    });
    await gate.record({
      envelopeName: "pricing-conf-2",
      usage: {
        model: "gpt-4o",
        provider: "openai",
        tokensIn: 1000,
        tokensOut: 500,
      },
      skipAttribution: true,
    });
    const env = await gate.getEnvelope("pricing-conf-2");
    const charges = await sink.getRecentBudgetCharges(env!.envelope_id, 10);
    expect(charges[0].metadata.pricedExact).toBe(true);
    expect(charges[0].metadata.pricingNote).toBeUndefined();
  });
});

// ============================================================================
// Envelope (pure projection math)
// ============================================================================

describe("envelope.summarizeEnvelope", () => {
  const envelope = {
    envelope_id: "env-1",
    name: "test",
    period_kind: "custom" as const,
    period_start: "2026-05-01T00:00:00.000Z",
    period_end: "2026-05-31T23:59:59.999Z",
    limit_usd: 200,
    soft_cap_pct: 0.75,
    hard_cap_pct: 1.0,
    parent_envelope_id: null,
    metadata: {},
  };

  it("zero charges → zero spend, zero burn, full remaining", () => {
    const s = summarizeEnvelope(envelope, [], {
      asOf: new Date("2026-05-15T12:00:00.000Z"),
    });
    expect(s.spentUsd).toBe(0);
    expect(s.remainingUsd).toBe(200);
    expect(s.pctSpent).toBe(0);
    expect(s.burnRatePerDay).toBe(0);
    expect(s.projectedExhaustionAt).toBeNull();
  });

  it("midway through period, half spent → 50% pct", () => {
    const s = summarizeEnvelope(envelope, [
      {
        charge_id: "c1",
        envelope_id: "env-1",
        timestamp: "2026-05-15T10:00:00.000Z",
        agent_id: null,
        model: "claude-sonnet-4",
        provider: "anthropic",
        tokens_in: 0,
        tokens_out: 0,
        tokens_cached: 0,
        tokens_cache_creation: 0,
        cost_usd: 100,
        source: "recorded",
        metadata: {},
      },
    ], { asOf: new Date("2026-05-15T12:00:00.000Z") });
    expect(s.spentUsd).toBe(100);
    expect(s.pctSpent).toBe(0.5);
    expect(s.remainingUsd).toBe(100);
  });

  it("burn-rate projects exhaustion inside the period when burn is fast enough", () => {
    // $100 spent in the 24h window → $100/day burn. Limit $200, spent $100 → 1 day to exhaust.
    const asOf = new Date("2026-05-15T12:00:00.000Z");
    const recent = new Date(asOf.getTime() - 12 * 60 * 60 * 1000).toISOString();
    const s = summarizeEnvelope(envelope, [
      {
        charge_id: "c1",
        envelope_id: "env-1",
        timestamp: recent,
        agent_id: null,
        model: "claude-sonnet-4",
        provider: "anthropic",
        tokens_in: 0,
        tokens_out: 0,
        tokens_cached: 0,
        tokens_cache_creation: 0,
        cost_usd: 50,
        source: "recorded",
        metadata: {},
      },
      {
        charge_id: "c2",
        envelope_id: "env-1",
        timestamp: asOf.toISOString(),
        agent_id: null,
        model: "claude-sonnet-4",
        provider: "anthropic",
        tokens_in: 0,
        tokens_out: 0,
        tokens_cached: 0,
        tokens_cache_creation: 0,
        cost_usd: 50,
        source: "recorded",
        metadata: {},
      },
    ], { asOf, burnRateWindow: { hours: 24 } });
    expect(s.spentUsd).toBe(100);
    expect(s.burnRatePerDay).toBeGreaterThan(0);
    expect(s.projectedExhaustionAt).not.toBeNull();
    expect(s.projectedExhaustionAt!.getTime()).toBeLessThan(
      new Date(envelope.period_end).getTime()
    );
  });

  it("expired period → isExpired true, daysLeft 0", () => {
    const s = summarizeEnvelope(envelope, [], {
      asOf: new Date("2026-06-15T00:00:00.000Z"),
    });
    expect(s.isExpired).toBe(true);
    expect(s.daysLeftInPeriod).toBe(0);
  });
});

// ============================================================================
// Decision (pure policy)
// ============================================================================

describe("decision.decide", () => {
  const baseEnvelope = {
    envelope_id: "env-1",
    name: "test",
    period_kind: "custom" as const,
    period_start: "2026-05-01T00:00:00.000Z",
    period_end: "2026-05-31T23:59:59.999Z",
    limit_usd: 100,
    soft_cap_pct: 0.75,
    hard_cap_pct: 1.0,
    parent_envelope_id: null,
    metadata: {},
  };

  it("allow when projected total stays under soft cap", () => {
    const state = summarizeEnvelope(baseEnvelope, [], {
      asOf: new Date("2026-05-15T12:00:00.000Z"),
    });
    const d = decide({ state, estimatedCostUsd: 10, estimateIsApproximate: false });
    expect(d.verdict).toBe("allow");
    expect(d.warnings).toHaveLength(0);
  });

  it("warn when projected total crosses soft cap but stays under hard cap", () => {
    const state = summarizeEnvelope(
      baseEnvelope,
      [
        {
          charge_id: "c1",
          envelope_id: "env-1",
          timestamp: "2026-05-15T10:00:00.000Z",
          agent_id: null,
          model: "claude-sonnet-4",
          provider: "anthropic",
          tokens_in: 0,
          tokens_out: 0,
          tokens_cached: 0,
          tokens_cache_creation: 0,
          cost_usd: 70,
          source: "recorded",
          metadata: {},
        },
      ],
      { asOf: new Date("2026-05-15T12:00:00.000Z") }
    );
    const d = decide({ state, estimatedCostUsd: 10, estimateIsApproximate: false });
    expect(d.verdict).toBe("warn");
    expect(d.warnings.some((w) => w.rule === "soft_cap")).toBe(true);
  });

  it("block when projected total exceeds hard cap; reason mentions amounts", () => {
    const state = summarizeEnvelope(
      baseEnvelope,
      [
        {
          charge_id: "c1",
          envelope_id: "env-1",
          timestamp: "2026-05-15T10:00:00.000Z",
          agent_id: null,
          model: "claude-sonnet-4",
          provider: "anthropic",
          tokens_in: 0,
          tokens_out: 0,
          tokens_cached: 0,
          tokens_cache_creation: 0,
          cost_usd: 95,
          source: "recorded",
          metadata: {},
        },
      ],
      { asOf: new Date("2026-05-15T12:00:00.000Z") }
    );
    const d = decide({ state, estimatedCostUsd: 10, estimateIsApproximate: false });
    expect(d.verdict).toBe("block");
    expect(d.reason).toMatch(/hard cap/i);
    expect(d.reason).toMatch(/\$10/); // estimated cost surfaces
  });

  it("block when envelope is expired regardless of remaining limit", () => {
    const state = summarizeEnvelope(baseEnvelope, [], {
      asOf: new Date("2026-06-15T00:00:00.000Z"),
    });
    const d = decide({ state, estimatedCostUsd: 1, estimateIsApproximate: false });
    expect(d.verdict).toBe("block");
    expect(d.reason).toMatch(/expired/i);
  });

  it("estimated_only warning surfaces when accountant returned 'estimated'", () => {
    const state = summarizeEnvelope(baseEnvelope, [], {
      asOf: new Date("2026-05-15T12:00:00.000Z"),
    });
    const d = decide({ state, estimatedCostUsd: 1, estimateIsApproximate: true });
    expect(d.warnings.some((w) => w.rule === "estimated_only")).toBe(true);
  });
});

// ============================================================================
// BudgetGate (integration with sink)
// ============================================================================

describe("BudgetGate — end-to-end with LocalSqliteSink", () => {
  it("createEnvelope persists and round-trips via getEnvelope", async () => {
    await gate.createEnvelope({
      name: "monthly",
      limitUsd: 200,
      periodKind: "month",
    });
    const env = await gate.getEnvelope("monthly");
    expect(env).not.toBeNull();
    expect(env!.limit_usd).toBe(200);
    expect(env!.soft_cap_pct).toBe(0.75);
    expect(env!.hard_cap_pct).toBe(1.0);
  });

  it("createEnvelope rejects invalid caps", async () => {
    await expect(
      gate.createEnvelope({
        name: "bad",
        limitUsd: 100,
        periodKind: "month",
        softCapPct: 0.9,
        hardCapPct: 0.5,
      })
    ).rejects.toThrow(BudgetGateError);
  });

  it("createEnvelope rejects non-positive limit", async () => {
    await expect(
      gate.createEnvelope({ name: "zero", limitUsd: 0, periodKind: "month" })
    ).rejects.toThrow(BudgetGateError);
  });

  it("check on non-existent envelope throws BudgetGateError", async () => {
    await expect(
      gate.check({
        envelopeName: "missing",
        model: "claude-sonnet-4",
        estimatedTokensIn: 100,
      })
    ).rejects.toThrow(BudgetGateError);
  });

  it("record updates state; subsequent check sees the new spend", async () => {
    await gate.createEnvelope({
      name: "monthly",
      limitUsd: 1,
      periodKind: "month",
    });
    // Record a charge that uses ~half the envelope.
    await gate.record({
      envelopeName: "monthly",
      usage: {
        model: "claude-sonnet-4",
        tokensIn: 100_000,
        tokensOut: 20_000,
      },
    });
    const state = await gate.getState("monthly");
    expect(state.spentUsd).toBeGreaterThan(0);
    expect(state.remainingUsd).toBeLessThan(1);
  });

  it("parent envelope receives rolled-up charges from child", async () => {
    await gate.createEnvelope({
      name: "team",
      limitUsd: 1000,
      periodKind: "month",
    });
    await gate.createEnvelope({
      name: "alice",
      limitUsd: 200,
      periodKind: "month",
      parentEnvelopeName: "team",
    });

    await gate.record({
      envelopeName: "alice",
      usage: {
        model: "claude-sonnet-4",
        tokensIn: 1_000_000,
        tokensOut: 100_000,
      },
    });

    const aliceState = await gate.getState("alice");
    const teamState = await gate.getState("team");
    // Both should reflect the same dollar amount (within rounding).
    expect(aliceState.spentUsd).toBeGreaterThan(0);
    expect(teamState.spentUsd).toBeCloseTo(aliceState.spentUsd, 6);
  });

  it("hard cap blocks check when projected total exceeds limit", async () => {
    await gate.createEnvelope({
      name: "tiny",
      limitUsd: 0.01,
      periodKind: "month",
    });
    const decision = await gate.check({
      envelopeName: "tiny",
      model: "claude-opus-4",
      estimatedTokensIn: 1_000_000,
      estimatedTokensOut: 100_000,
    });
    expect(decision.verdict).toBe("block");
    expect(decision.reason).toMatch(/hard cap/i);
  });

  it("month period bounds set first-of-month..last-of-month UTC", async () => {
    const env = await gate.createEnvelope(
      { name: "monthly", limitUsd: 100, periodKind: "month" },
      new Date("2026-05-15T10:00:00.000Z")
    );
    expect(env.period_start.slice(0, 10)).toBe("2026-05-01");
    expect(env.period_end.slice(0, 10)).toBe("2026-05-31");
  });

  it("custom period requires both bounds", async () => {
    await expect(
      gate.createEnvelope({
        name: "custom",
        limitUsd: 100,
        periodKind: "custom",
      })
    ).rejects.toThrow(BudgetGateError);
  });

  it("record with a stable chargeId is idempotent on re-fire", async () => {
    await gate.createEnvelope({
      name: "monthly",
      limitUsd: 100,
      periodKind: "month",
    });
    const chargeId = "deterministic-id-1";
    const usage = {
      model: "claude-sonnet-4",
      tokensIn: 100_000,
      tokensOut: 10_000,
    };
    await gate.record({ envelopeName: "monthly", chargeId, usage });
    await gate.record({ envelopeName: "monthly", chargeId, usage });
    const s = await gate.getState("monthly");
    // Two record() calls with the same chargeId → still only one charge.
    const charges = await sink.getRecentBudgetCharges(s.envelope.envelope_id);
    expect(charges.length).toBe(1);
  });

  it("parent rollup is also idempotent under repeated chargeIds", async () => {
    await gate.createEnvelope({
      name: "team-x",
      limitUsd: 1000,
      periodKind: "month",
    });
    await gate.createEnvelope({
      name: "dev-x",
      limitUsd: 100,
      periodKind: "month",
      parentEnvelopeName: "team-x",
    });
    const chargeId = "stable-1";
    const usage = { model: "claude-sonnet-4", tokensIn: 100_000, tokensOut: 1_000 };
    await gate.record({ envelopeName: "dev-x", chargeId, usage });
    await gate.record({ envelopeName: "dev-x", chargeId, usage });

    const devState = await gate.getState("dev-x");
    const teamState = await gate.getState("team-x");
    const devCharges = await sink.getRecentBudgetCharges(devState.envelope.envelope_id);
    const teamCharges = await sink.getRecentBudgetCharges(teamState.envelope.envelope_id);
    expect(devCharges.length).toBe(1);
    expect(teamCharges.length).toBe(1);
    expect(teamState.spentUsd).toBeCloseTo(devState.spentUsd, 6);
  });

  it("metadata round-trips through persistence", async () => {
    await gate.createEnvelope({
      name: "tagged",
      limitUsd: 100,
      periodKind: "month",
      metadata: { team: "platform", owner: "alice@example.com" },
    });
    const env = await gate.getEnvelope("tagged");
    expect(env!.metadata).toEqual({
      team: "platform",
      owner: "alice@example.com",
    });
  });
});
