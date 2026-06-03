import { describe, it, expect } from "vitest";
import type { EventRow } from "@prune/persistence";
import {
  aggregateFeatureTelemetry,
  TELEMETRY_FEATURE_IDS,
  type FeatureRollup,
} from "./feature-telemetry.js";

// ---------------------------------------------------------------------------
// Fixture helper: a minimal-but-valid EventRow with overridable fields. The
// aggregator only reads feature_id, tokens_in, estimated_cost_usd, and
// quality_proof, but we populate the rest so the fixture is a real EventRow.
// ---------------------------------------------------------------------------

function makeRow(over: Partial<EventRow>): EventRow {
  return {
    event_id: "e",
    session_id: "s",
    user_id: "u",
    team_id: null,
    timestamp: "2026-06-03T00:00:00.000Z",
    provider: "anthropic",
    tool: "prune",
    model: "claude-sonnet-4",
    tokens_in: 0,
    tokens_out: 0,
    tokens_cached: 0,
    latency_ms: 0,
    estimated_cost_usd: 0,
    cumulative_session_cost_usd: 0,
    tool_calls: [],
    files_referenced: [],
    compaction_triggered: false,
    context_size_before: 0,
    context_size_after: 0,
    waste_flags: [],
    classification: "unknown",
    roi_score: 0,
    task_metadata: { type: "feature", repo: null, branch: null },
    feature_id: null,
    quality_proof: null,
    ...over,
  };
}

function byId(report: ReturnType<typeof aggregateFeatureTelemetry>, id: string): FeatureRollup {
  const r = report.features.find((f) => f.featureId === id);
  if (!r) throw new Error(`no rollup for ${id}`);
  return r;
}

describe("aggregateFeatureTelemetry — structure & determinism", () => {
  it("emits exactly f9..f13 in deterministic order for empty input", () => {
    const report = aggregateFeatureTelemetry([]);
    expect(report.features.map((f) => f.featureId)).toEqual([
      "f9",
      "f10",
      "f11",
      "f12",
      "f13",
    ]);
    expect(report.totalEvents).toBe(0);
    expect(report.outOfScopeEventCount).toBe(0);
  });

  it("populates featureName from TCRP_FEATURE_NAMES", () => {
    const report = aggregateFeatureTelemetry([]);
    expect(byId(report, "f9").featureName).toBe("cacheHabits");
    expect(byId(report, "f10").featureName).toBe("mcpProxy");
    expect(byId(report, "f11").featureName).toBe("replayCost");
    expect(byId(report, "f12").featureName).toBe("skillLibrary");
    expect(byId(report, "f13").featureName).toBe("speculativePipeline");
  });

  it("ordering is independent of input order", () => {
    const a = aggregateFeatureTelemetry([
      makeRow({ feature_id: "f13" }),
      makeRow({ feature_id: "f9" }),
    ]);
    expect(a.features.map((f) => f.featureId)).toEqual([...TELEMETRY_FEATURE_IDS]);
  });

  it("an empty feature shows honest zero sums (not null) and null summaries", () => {
    const report = aggregateFeatureTelemetry([]);
    const f11 = byId(report, "f11");
    expect(f11.eventCount).toBe(0);
    expect(f11.tokensIn).toBe(0);
    expect(f11.estimatedCostUsd).toBe(0);
    expect(f11.summary.kind).toBe("f11");
    if (f11.summary.kind === "f11") {
      expect(f11.summary.data.savedUsd).toBeNull();
      expect(f11.summary.data.naiveCostUsd).toBeNull();
      expect(f11.summary.data.replayCostUsd).toBeNull();
    }
  });
});

describe("aggregateFeatureTelemetry — generic column sums", () => {
  it("sums tokens_in and estimated_cost_usd per feature", () => {
    const report = aggregateFeatureTelemetry([
      makeRow({ feature_id: "f10", tokens_in: 100, estimated_cost_usd: 0.01 }),
      makeRow({ feature_id: "f10", tokens_in: 50, estimated_cost_usd: 0.02 }),
      makeRow({ feature_id: "f11", tokens_in: 7, estimated_cost_usd: 0.5 }),
    ]);
    const f10 = byId(report, "f10");
    expect(f10.eventCount).toBe(2);
    expect(f10.tokensIn).toBe(150);
    expect(f10.estimatedCostUsd).toBeCloseTo(0.03);
    expect(byId(report, "f11").tokensIn).toBe(7);
  });

  it("treats negative / NaN token & cost columns as 0 (never fabricates)", () => {
    const report = aggregateFeatureTelemetry([
      makeRow({
        feature_id: "f9",
        tokens_in: -10 as unknown as number,
        estimated_cost_usd: Number.NaN as unknown as number,
      }),
    ]);
    const f9 = byId(report, "f9");
    expect(f9.tokensIn).toBe(0);
    expect(f9.estimatedCostUsd).toBe(0);
  });
});

describe("aggregateFeatureTelemetry — f9 cacheHabits decoding", () => {
  it("counts verdicts and sums totals", () => {
    const report = aggregateFeatureTelemetry([
      makeRow({
        feature_id: "f9",
        quality_proof: {
          verdict: "warn",
          totals: { findingCount: 2, estimatedWasteUsd: 0.1, estimatedWasteTokens: 500 },
        },
      }),
      makeRow({
        feature_id: "f9",
        quality_proof: {
          verdict: "warn",
          totals: { findingCount: 1, estimatedWasteUsd: 0.05, estimatedWasteTokens: 250 },
        },
      }),
      makeRow({
        feature_id: "f9",
        quality_proof: { verdict: "info", totals: { findingCount: 0 } },
      }),
    ]);
    const f9 = byId(report, "f9");
    if (f9.summary.kind !== "f9") throw new Error("wrong kind");
    expect(f9.summary.data.verdictCounts).toEqual({ warn: 2, info: 1 });
    expect(f9.summary.data.totalFindings).toBe(3);
    expect(f9.summary.data.estimatedWasteUsd).toBeCloseTo(0.15);
    expect(f9.summary.data.estimatedWasteTokens).toBe(750);
  });
});

describe("aggregateFeatureTelemetry — f10 mcpProxy decoding", () => {
  it("sums audit savedTokens / fullCatalogTokens / shippedTokens", () => {
    const report = aggregateFeatureTelemetry([
      makeRow({
        feature_id: "f10",
        quality_proof: {
          audit: { savedTokens: 900, fullCatalogTokens: 1000, shippedTokens: 100 },
        },
      }),
      makeRow({
        feature_id: "f10",
        quality_proof: {
          audit: { savedTokens: 50, fullCatalogTokens: 60, shippedTokens: 10 },
        },
      }),
    ]);
    const f10 = byId(report, "f10");
    if (f10.summary.kind !== "f10") throw new Error("wrong kind");
    expect(f10.summary.data.savedTokens).toBe(950);
    expect(f10.summary.data.fullCatalogTokens).toBe(1060);
    expect(f10.summary.data.shippedTokens).toBe(110);
  });
});

describe("aggregateFeatureTelemetry — f11 replayCost decoding", () => {
  it("sums cost figures and leaves null fields null", () => {
    const report = aggregateFeatureTelemetry([
      makeRow({
        feature_id: "f11",
        quality_proof: {
          cost: { savedUsd: 1.25, naiveCostUsd: 2.0, replayCostUsd: 0.75 },
        },
      }),
      makeRow({
        feature_id: "f11",
        // savedUsd is honestly null in this proof — must NOT be summed as 0.
        quality_proof: {
          cost: { savedUsd: null, naiveCostUsd: 1.0, replayCostUsd: null },
        },
      }),
    ]);
    const f11 = byId(report, "f11");
    if (f11.summary.kind !== "f11") throw new Error("wrong kind");
    expect(f11.summary.data.savedUsd).toBeCloseTo(1.25);
    expect(f11.summary.data.naiveCostUsd).toBeCloseTo(3.0);
    expect(f11.summary.data.replayCostUsd).toBeCloseTo(0.75);
  });
});

describe("aggregateFeatureTelemetry — f12 skillLibrary decoding", () => {
  it("counts capture vs replay and sums discoveryTokens from captures", () => {
    const report = aggregateFeatureTelemetry([
      makeRow({
        feature_id: "f12",
        quality_proof: { event: "capture", discoveryTokens: 1200 },
      }),
      makeRow({
        feature_id: "f12",
        quality_proof: { event: "capture", discoveryTokens: 800 },
      }),
      makeRow({
        feature_id: "f12",
        quality_proof: { event: "replay", savedUsdPerReuse: 0.4 },
      }),
    ]);
    const f12 = byId(report, "f12");
    if (f12.summary.kind !== "f12") throw new Error("wrong kind");
    expect(f12.summary.data.captureCount).toBe(2);
    expect(f12.summary.data.replayCount).toBe(1);
    expect(f12.summary.data.discoveryTokens).toBe(2000);
  });

  it("an unknown event value contributes to neither capture nor replay", () => {
    const report = aggregateFeatureTelemetry([
      makeRow({ feature_id: "f12", quality_proof: { event: "weird" } }),
    ]);
    const f12 = byId(report, "f12");
    if (f12.summary.kind !== "f12") throw new Error("wrong kind");
    expect(f12.summary.data.captureCount).toBe(0);
    expect(f12.summary.data.replayCount).toBe(0);
    expect(f12.summary.data.discoveryTokens).toBeNull();
    expect(f12.eventCount).toBe(1); // still counted as an event
  });
});

describe("aggregateFeatureTelemetry — f13 speculativePipeline decoding", () => {
  it("counts hits/misses, sums latency, and takes the most-recent hitRate", () => {
    const report = aggregateFeatureTelemetry([
      // First row = most recent (getRecentEvents returns newest-first).
      makeRow({
        feature_id: "f13",
        quality_proof: {
          outcome: { hit: true, latencySavedMs: 120 },
          stats: { hitRate: 0.66 },
        },
      }),
      makeRow({
        feature_id: "f13",
        quality_proof: {
          outcome: { hit: false, latencySavedMs: 0 },
          stats: { hitRate: 0.5 },
        },
      }),
    ]);
    const f13 = byId(report, "f13");
    if (f13.summary.kind !== "f13") throw new Error("wrong kind");
    expect(f13.summary.data.hits).toBe(1);
    expect(f13.summary.data.misses).toBe(1);
    expect(f13.summary.data.latencySavedMs).toBe(120);
    expect(f13.summary.data.latestHitRate).toBeCloseTo(0.66);
  });

  it("latestHitRate is null when no row carries a readable hitRate", () => {
    const report = aggregateFeatureTelemetry([
      makeRow({
        feature_id: "f13",
        quality_proof: { outcome: { hit: true, latencySavedMs: 10 } },
      }),
    ]);
    const f13 = byId(report, "f13");
    if (f13.summary.kind !== "f13") throw new Error("wrong kind");
    expect(f13.summary.data.latestHitRate).toBeNull();
    expect(f13.summary.data.latencySavedMs).toBe(10);
  });
});

describe("aggregateFeatureTelemetry — adversarial / defensive cases", () => {
  it("missing quality_proof counts the row but records a malformed proof", () => {
    const report = aggregateFeatureTelemetry([
      makeRow({ feature_id: "f11", quality_proof: null }),
    ]);
    const f11 = byId(report, "f11");
    expect(f11.eventCount).toBe(1);
    expect(f11.malformedProofCount).toBe(1);
    if (f11.summary.kind !== "f11") throw new Error("wrong kind");
    expect(f11.summary.data.savedUsd).toBeNull();
  });

  it("quality_proof of wrong type (array/string/number) is treated as malformed", () => {
    const report = aggregateFeatureTelemetry([
      makeRow({ feature_id: "f9", quality_proof: [] as unknown as Record<string, unknown> }),
      makeRow({ feature_id: "f9", quality_proof: "nope" as unknown as Record<string, unknown> }),
      makeRow({ feature_id: "f9", quality_proof: 42 as unknown as Record<string, unknown> }),
    ]);
    const f9 = byId(report, "f9");
    expect(f9.eventCount).toBe(3);
    expect(f9.malformedProofCount).toBe(3);
    if (f9.summary.kind !== "f9") throw new Error("wrong kind");
    expect(f9.summary.data.verdictCounts).toEqual({});
    expect(f9.summary.data.totalFindings).toBeNull();
  });

  it("proof present but feature-specific fields wrong-typed → fields stay null, not malformed", () => {
    // The proof IS an object, so it isn't "malformed"; the inner numbers are
    // just unreadable, so summary figures must be null (never a guessed 0).
    const report = aggregateFeatureTelemetry([
      makeRow({
        feature_id: "f10",
        quality_proof: {
          audit: { savedTokens: "lots", fullCatalogTokens: null, shippedTokens: {} },
        },
      }),
    ]);
    const f10 = byId(report, "f10");
    expect(f10.malformedProofCount).toBe(0);
    if (f10.summary.kind !== "f10") throw new Error("wrong kind");
    expect(f10.summary.data.savedTokens).toBeNull();
    expect(f10.summary.data.fullCatalogTokens).toBeNull();
    expect(f10.summary.data.shippedTokens).toBeNull();
  });

  it("mixed feature ids land in their own buckets", () => {
    const report = aggregateFeatureTelemetry([
      makeRow({ feature_id: "f9" }),
      makeRow({ feature_id: "f10" }),
      makeRow({ feature_id: "f11" }),
      makeRow({ feature_id: "f12", quality_proof: { event: "capture", discoveryTokens: 1 } }),
      makeRow({ feature_id: "f13", quality_proof: { outcome: { hit: true, latencySavedMs: 1 } } }),
    ]);
    for (const id of TELEMETRY_FEATURE_IDS) {
      expect(byId(report, id).eventCount).toBe(1);
    }
    expect(report.totalEvents).toBe(5);
    expect(report.outOfScopeEventCount).toBe(0);
  });

  it("feature ids outside f9–f13 are counted as out-of-scope, not bucketed", () => {
    const report = aggregateFeatureTelemetry([
      makeRow({ feature_id: "f1" }),
      makeRow({ feature_id: "f5" }),
      makeRow({ feature_id: "f99" }),
      makeRow({ feature_id: null }),
      makeRow({ feature_id: undefined }),
      makeRow({ feature_id: 13 as unknown as string }),
      makeRow({ feature_id: "f10" }), // one in-scope to prove the split
    ]);
    expect(report.totalEvents).toBe(7);
    expect(report.outOfScopeEventCount).toBe(6);
    expect(byId(report, "f10").eventCount).toBe(1);
    // None of the f9..f13 buckets absorbed an out-of-scope row.
    const inScope = report.features.reduce((n, f) => n + f.eventCount, 0);
    expect(inScope).toBe(1);
  });

  it("never throws on a pile of garbage rows", () => {
    const garbage = [
      null,
      undefined,
      42,
      "string",
      {},
      { feature_id: "f9" },
      { feature_id: "f12", quality_proof: { event: "capture" } }, // no discoveryTokens
    ] as unknown as EventRow[];
    expect(() => aggregateFeatureTelemetry(garbage)).not.toThrow();
    const report = aggregateFeatureTelemetry(garbage);
    // The three non-object entries (null/undefined) are skipped before counting;
    // 42 and "string" are typeof !== object too. {} has no feature_id.
    expect(report.features.map((f) => f.featureId)).toEqual([...TELEMETRY_FEATURE_IDS]);
  });

  it("discoveryTokens from a non-capture event is ignored", () => {
    const report = aggregateFeatureTelemetry([
      makeRow({
        feature_id: "f12",
        quality_proof: { event: "replay", discoveryTokens: 999 },
      }),
    ]);
    const f12 = byId(report, "f12");
    if (f12.summary.kind !== "f12") throw new Error("wrong kind");
    expect(f12.summary.data.discoveryTokens).toBeNull();
    expect(f12.summary.data.replayCount).toBe(1);
  });
});
