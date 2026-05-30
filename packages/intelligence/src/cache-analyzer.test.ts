import { describe, it, expect } from "vitest";
import {
  computeCacheMetrics,
  diagnoseCacheBust,
  type CacheTurnInput,
} from "./cache-analyzer.js";

const sonnet = "claude-sonnet-4-5-20250929";

function turn(
  input: number,
  output: number,
  cacheRead = 0,
  cacheCreate = 0,
  model = sonnet
): CacheTurnInput {
  return { model, usage: { input, output, cacheRead, cacheCreate } };
}

describe("computeCacheMetrics", () => {
  it("computes hit rate, write amplification, and cost deltas", () => {
    // Turn 1: cold — pay full input + create. 2000 input, 200 output, create 2000.
    // Turn 2: hot — 100 new input, 200 output, read 2000.
    const turns = [turn(2000, 200, 0, 2000), turn(100, 200, 2000, 0)];
    const m = computeCacheMetrics(turns, "5m");

    // total_input = (2000+0+2000) + (100+2000+0) = 6100
    expect(m.totalInputTokens).toBe(6100);
    expect(m.cacheReadTokens).toBe(2000);
    expect(m.cacheCreationTokens).toBe(2000);
    expect(m.uncachedInputTokens).toBe(2100);
    expect(m.outputTokens).toBe(400);
    expect(m.hitRate).toBeCloseTo(2000 / 6100, 6);
    expect(m.writeAmplification).toBe(1);

    // Sonnet pricing: input 3/M, cached_input 0.375/M, output 15/M, write 5m = 1.25× input = 3.75/M
    // actual = (2000 * 3 + 100 * 3 + 2000 * 0.375 + 2000 * 3.75 + 400 * 15)/1e6
    //        = (6000 + 300 + 750 + 7500 + 6000)/1e6 = 20550/1e6 = 0.02055
    expect(m.cost.actual).toBeCloseTo(0.02055, 6);

    // ifNoCache: total_input * 3/M + output * 15/M = (6100*3 + 400*15)/1e6 = 24300/1e6
    expect(m.cost.ifNoCache).toBeCloseTo(0.0243, 6);
    expect(m.cost.savedVsNoCache).toBeCloseTo(0.0243 - 0.02055, 6);

    // ifAllCached: total_input * cached_rate + output * output_rate
    expect(m.cost.ifAllCached).toBeCloseTo(
      (6100 * 0.375 + 400 * 15) / 1_000_000,
      6
    );
  });

  it("returns zeroed metrics for an empty window", () => {
    const m = computeCacheMetrics([]);
    expect(m.windowTurns).toBe(0);
    expect(m.hitRate).toBe(0);
    expect(m.cost.actual).toBe(0);
    expect(m.cost.ifNoCache).toBe(0);
    expect(m.cost.savedVsNoCache).toBe(0);
  });

  it("uses 1h write multiplier when requested", () => {
    const turns = [turn(0, 0, 0, 1000)];
    const m5 = computeCacheMetrics(turns, "5m");
    const m1h = computeCacheMetrics(turns, "1h");
    // 1h write should be ~1.6× the 5m write cost (2.0 / 1.25).
    expect(m1h.cost.actual / m5.cost.actual).toBeCloseTo(2.0 / 1.25, 4);
  });
});

describe("diagnoseCacheBust", () => {
  it("flags timestamps embedded in system prompts", () => {
    const result = diagnoseCacheBust({
      systemPrompt: "You are a helpful assistant. Today is 2026-05-30T10:00:00Z.",
      turns: [turn(2000, 100, 0, 2000), turn(2000, 100, 0, 2000)],
    });
    const sig = result.find((d) => d.signal === "timestamp_in_system");
    expect(sig).toBeDefined();
    expect(sig?.evidence).toContain("2026-05-30T10:00:00");
  });

  it("flags MCP tool drift across turns", () => {
    const result = diagnoseCacheBust({
      toolListsByTurn: [
        ["Read", "Write", "Bash"],
        ["Read", "Write"], // Bash dropped — busts cache
      ],
      turns: [turn(2000, 100, 0, 2000), turn(2000, 100, 0, 2000)],
    });
    const sig = result.find((d) => d.signal === "mcp_tool_drift");
    expect(sig).toBeDefined();
    expect(sig?.evidence).toContain("Bash");
  });

  it("flags low hit rate over a meaningful window", () => {
    // Two turns, each 2000 input, no cache reads at all.
    const result = diagnoseCacheBust({
      turns: [turn(2000, 100, 0, 0), turn(2000, 100, 0, 0)],
    });
    expect(result.some((d) => d.signal === "low_hit_rate")).toBe(true);
  });

  it("flags high write amplification", () => {
    // Lots of cache_create relative to cache_read.
    const result = diagnoseCacheBust({
      turns: [turn(0, 100, 200, 1000), turn(0, 100, 200, 1000)],
    });
    expect(
      result.some((d) => d.signal === "high_write_amplification")
    ).toBe(true);
  });

  it("returns no diagnoses on a healthy session", () => {
    const result = diagnoseCacheBust({
      turns: [turn(2000, 200, 0, 2000), turn(100, 200, 1900, 0)],
    });
    // hit rate ≈ 1900 / (2000+100+1900+2000) = 1900/6000 ≈ 31% — above the 20% floor.
    expect(result).toEqual([]);
  });
});
