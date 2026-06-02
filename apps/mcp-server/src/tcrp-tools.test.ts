/**
 * MCP wiring tests for the TCRP tools (F2 tool_audit, F4 qpd_report).
 *
 * These assert that the safety guarantees of the underlying cores survive the
 * MCP boundary: protected tools are never recommended for removal, and a
 * quality-failing model is never recommended for a switch. They also pin the
 * JSON response shape clients depend on.
 */

import { describe, expect, it } from "vitest";
import {
  handleToolAudit,
  handleQpdReport,
  handleContextHealthReport,
  handleTrajectoryReplay,
} from "./tcrp-tools.js";
import type { ModelAggregate } from "@prune/qpd-bench";
import type { F1ShadowEvent } from "@prune/trajectory-diet";

describe("tool_audit MCP handler (F2)", () => {
  it("returns a parseable report and flags an idle bloated MCP tool", () => {
    const json = handleToolAudit({
      tools: [
        { name: "github_pr", server: "github", definitionTokens: 500 },
        { name: "jira_create", server: "jira", definitionTokens: 900 },
      ],
      usage: {
        windowDays: 30,
        sessionsInWindow: 60,
        invocations: { github_pr: 40 },
        lastUsedAgeDays: { github_pr: 0.5, jira_create: Infinity },
        sessionsLoadingTool: { github_pr: 60, jira_create: 60 },
      },
    });
    const r = JSON.parse(json);
    const jira = r.entries.find((e: { name: string }) => e.name === "jira_create");
    const gh = r.entries.find((e: { name: string }) => e.name === "github_pr");
    expect(jira.recommendRemoval).toBe(true);
    expect(gh.recommendRemoval).toBe(false);
    expect(r.recoverableTokensPerWeek).toBeGreaterThan(0);
    expect(r.recommendationCount).toBe(1);
  });

  it("NEVER recommends removing a critical-allowlist tool across the boundary", () => {
    const json = handleToolAudit({
      tools: [{ name: "Read", server: "builtin", definitionTokens: 400 }],
      usage: {
        windowDays: 30,
        sessionsInWindow: 60,
        invocations: {},
        lastUsedAgeDays: { Read: Infinity },
        sessionsLoadingTool: { Read: 60 },
      },
    });
    const r = JSON.parse(json);
    expect(r.entries[0].recommendRemoval).toBe(false);
    expect(r.entries[0].utility).toBe("critical");
  });

  it("respects a custom critical_allowlist", () => {
    const json = handleToolAudit({
      tools: [{ name: "deploy", server: "ci", definitionTokens: 700 }],
      usage: {
        windowDays: 30,
        sessionsInWindow: 60,
        invocations: {},
        lastUsedAgeDays: { deploy: Infinity },
        sessionsLoadingTool: { deploy: 60 },
      },
      critical_allowlist: ["deploy"],
    });
    const r = JSON.parse(json);
    expect(r.entries[0].recommendRemoval).toBe(false);
  });

  it("returns an error object for malformed input", () => {
    const r = JSON.parse(handleToolAudit({ tools: undefined as never, usage: undefined as never }));
    expect(r.error).toBeTruthy();
  });
});

describe("qpd_report MCP handler (F4)", () => {
  function agg(
    model: string,
    n: number,
    ar: number,
    cost: number,
    tpr: number | null = null
  ): ModelAggregate {
    return {
      model,
      clusterId: "refactor-ts",
      n,
      acceptedCount: Math.round(n * ar),
      acceptanceRate: ar,
      testPassRate: tpr,
      testN: tpr === null ? 0 : n,
      testPassedCount: tpr === null ? 0 : Math.round(n * tpr),
      meanCost: cost,
      totalCost: cost * n,
      qpdRaw: cost > 0 ? ar / cost : Infinity,
    };
  }

  it("recommends a cheaper, quality-equivalent model and reports the frontier", () => {
    const json = handleQpdReport({
      baseline: agg("opus", 500, 0.92, 0.1),
      candidates: [agg("sonnet", 500, 0.9, 0.02), agg("haiku", 500, 0.71, 0.004)],
    });
    const r = JSON.parse(json);
    expect(r.best.model).toBe("sonnet");
    expect(r.best.projectedSavingsPct).toBeGreaterThan(70);
    expect(r.paretoFrontier).toContain("haiku"); // cheapest, on frontier
  });

  it("NEVER recommends a quality-failing model across the boundary", () => {
    const json = handleQpdReport({
      baseline: agg("opus", 500, 0.92, 0.1),
      candidates: [agg("haiku", 500, 0.71, 0.004)], // 21pp AR drop
    });
    const r = JSON.parse(json);
    expect(r.best).toBeNull(); // stay on baseline
    const haiku = r.recommendations.find((x: { model: string }) => x.model === "haiku");
    expect(haiku.recommended).toBe(false);
    expect(haiku.gates.ar).toBe(false);
  });

  it("exposes per-gate pass/fail for the trust UX", () => {
    const json = handleQpdReport({
      baseline: agg("opus", 500, 0.92, 0.1),
      candidates: [agg("sonnet", 500, 0.9, 0.02)],
    });
    const r = JSON.parse(json);
    const s = r.recommendations[0];
    expect(s.gates).toHaveProperty("ar");
    expect(s.gates).toHaveProperty("tpr");
    expect(s.gates).toHaveProperty("cost");
    expect(s.gates).toHaveProperty("sampleSize");
  });

  it("returns an error object for malformed input", () => {
    const r = JSON.parse(
      handleQpdReport({ baseline: undefined as never, candidates: undefined as never })
    );
    expect(r.error).toBeTruthy();
  });
});

describe("context_health_report MCP handler (F6)", () => {
  const FIXTURE_PATH =
    "/home/user/tokenlens/packages/telemetry/test/fixtures/session-basic.jsonl";

  it("returns a parseable report pinned to the canonical fixture", async () => {
    const json = await handleContextHealthReport({
      transcript_path: FIXTURE_PATH,
    });
    const r = JSON.parse(json);
    expect(r.regime).toBe("healthy");
    expect(r.source).toBe("exact");
    expect(r.totalTurns).toBe(2);
    expect(r.observedTurns).toBe(2);
    expect(r.skippedTurns).toBe(0);
    expect(r.model).toBe("claude-sonnet-4-5-20250929");
    expect(r.modelWindow).toBe(200_000);
    expect(r.ecfSeries.length).toBe(2);
    expect(r.primaryCause).toBeNull();
    expect(r.cusum.regime).toBe("healthy");
  });

  it("respects window_turns by trimming to the last N", async () => {
    const json = await handleContextHealthReport({
      transcript_path: FIXTURE_PATH,
      window_turns: 1,
    });
    const r = JSON.parse(json);
    // window=1 leaves only one turn → insufficient_data
    expect(r.regime).toBe("insufficient_data");
    expect(r.ecfSeries.length).toBe(1);
  });

  it("silently clamps non-finite window_turns", async () => {
    const json = await handleContextHealthReport({
      transcript_path: FIXTURE_PATH,
      window_turns: Number.NaN,
    });
    const r = JSON.parse(json);
    expect(r.totalTurns).toBe(2);
  });

  it("returns an error object for missing transcript_path", async () => {
    const json = await handleContextHealthReport({
      transcript_path: "" as never,
    });
    const r = JSON.parse(json);
    expect(r.error).toBeTruthy();
  });

  it("never throws on a non-existent transcript path (returns insufficient_data)", async () => {
    const json = await handleContextHealthReport({
      transcript_path: "/tmp/does-not-exist-prune-context-health.jsonl",
    });
    const r = JSON.parse(json);
    expect(r.regime).toBe("insufficient_data");
  });
});

describe("trajectory_replay_report MCP handler (F1 v2)", () => {
  function ev(
    sessionId: string,
    predicted: number,
    realized: number
  ): F1ShadowEvent {
    return {
      sessionId,
      stepIndex: 0,
      predictedInfluence: predicted,
      realizedInfluence: realized,
      decision: "kept",
      stepTokenCost: 100,
    };
  }

  it("returns a parseable report with calibration metrics", () => {
    const json = handleTrajectoryReplay({
      events: [ev("s1", 0.1, 0), ev("s2", 0.9, 1), ev("s3", 0.2, 0)],
    });
    const r = JSON.parse(json);
    expect(r.eligibleEvents).toBe(3);
    expect(r.malformedEvents).toBe(0);
    expect(r.calibration.brierScore).toBeLessThan(0.05);
    expect(r.qualityGate).toBeNull(); // no pairs
  });

  it("returns an error object when events is missing", () => {
    const json = handleTrajectoryReplay({} as never);
    expect(JSON.parse(json).error).toBeTruthy();
  });

  it("returns an error object when events is not an array", () => {
    const json = handleTrajectoryReplay({ events: "not-an-array" } as never);
    expect(JSON.parse(json).error).toBeTruthy();
  });

  it("respects custom num_bins", () => {
    const json = handleTrajectoryReplay({
      events: [ev("s1", 0.1, 0), ev("s2", 0.9, 1)],
      num_bins: 25,
    });
    const r = JSON.parse(json);
    expect(r.calibration.numBins).toBe(25);
  });

  it("partial margins are filled in with defaults", () => {
    const json = handleTrajectoryReplay({
      events: [ev("s1", 0.5, 0)],
      margins: { acceptanceRate: 0.02 },
    });
    expect(() => JSON.parse(json)).not.toThrow();
  });
});

describe("semantic_cache_probe MCP handler (F7)", () => {
  it("empty cache → miss verdicts", async () => {
    const { handleSemanticCacheProbe } = await import("./tcrp-tools.js");
    const json = handleSemanticCacheProbe({
      probes: [{ query: "hello", freshness_parts: ["a"] }],
    });
    const r = JSON.parse(json);
    expect(r.cacheSize).toBe(0);
    expect(r.verdicts[0].decision.kind).toBe("miss");
  });

  it("hydrated cache returns a hit when query matches", async () => {
    const { SemanticCache, contentShaFreshness } = await import(
      "@prune/semantic-cache"
    );
    const cache = new SemanticCache();
    cache.store("k1", "the quick brown fox", "RESPONSE", contentShaFreshness("a"));
    const state = cache.toJSON();
    const { handleSemanticCacheProbe } = await import("./tcrp-tools.js");
    const json = handleSemanticCacheProbe({
      state,
      probes: [{ query: "the quick brown fox", freshness_parts: ["a"] }],
    });
    const r = JSON.parse(json);
    expect(r.cacheSize).toBe(1);
    expect(r.verdicts[0].decision.kind).toBe("hit");
  });

  it("freshness mismatch surfaces miss(freshness_mismatch)", async () => {
    const { SemanticCache, contentShaFreshness } = await import(
      "@prune/semantic-cache"
    );
    const cache = new SemanticCache();
    cache.store("k1", "alpha alpha alpha", "x", contentShaFreshness("workspace-A"));
    const { handleSemanticCacheProbe } = await import("./tcrp-tools.js");
    const json = handleSemanticCacheProbe({
      state: cache.toJSON(),
      probes: [{ query: "alpha alpha alpha", freshness_parts: ["workspace-B"] }],
    });
    const r = JSON.parse(json);
    expect(r.verdicts[0].decision.kind).toBe("miss");
    expect(r.verdicts[0].decision.reason).toBe("freshness_mismatch");
  });

  it("returns an error object for missing probes", async () => {
    const { handleSemanticCacheProbe } = await import("./tcrp-tools.js");
    const json = handleSemanticCacheProbe({} as never);
    expect(JSON.parse(json).error).toBeTruthy();
  });

  it("each malformed probe is annotated, others continue", async () => {
    const { handleSemanticCacheProbe } = await import("./tcrp-tools.js");
    const json = handleSemanticCacheProbe({
      probes: [
        { query: "good", freshness_parts: ["a"] },
        { query: null as never, freshness_parts: ["a"] },
      ],
    });
    const r = JSON.parse(json);
    expect(r.verdicts[0].decision).toBeDefined();
    expect(r.verdicts[1].error).toBeDefined();
  });
});
