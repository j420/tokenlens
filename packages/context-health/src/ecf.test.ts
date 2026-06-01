import { describe, expect, it } from "vitest";
import {
  aggregateSource,
  computeEcf,
  computeEcfSeries,
  dominantModel,
} from "./ecf.js";
import { DEFAULT_CONFIG } from "./constants.js";
import { makeTurn } from "./test-helpers.js";

describe("computeEcf — basic math", () => {
  it("computes ecf = (input + output) / window when no cache is involved", () => {
    const turn = makeTurn({
      turnNumber: 1,
      model: "claude-sonnet-4-5-20250929",
      inputTokens: 50_000,
      outputTokens: 10_000,
    });
    const sample = computeEcf(turn, { alpha: DEFAULT_CONFIG.alpha });
    // window for that model is 200,000 (pricing.ts)
    expect(sample.contextWindow).toBe(200_000);
    expect(sample.attendedInput).toBe(50_000);
    expect(sample.committedOutput).toBe(10_000);
    expect(sample.discountedCacheRead).toBe(0);
    // (50,000 + 10,000) / 200,000 = 0.30
    expect(sample.ecf).toBeCloseTo(0.3, 6);
    expect(sample.source).toBe("exact");
  });

  it("discounts cache reads by α", () => {
    const turn = makeTurn({
      turnNumber: 1,
      model: "claude-sonnet-4-5-20250929",
      inputTokens: 0,
      cacheReadTokens: 100_000, // 50% of window
      outputTokens: 0,
    });
    const sample = computeEcf(turn, { alpha: 0.5 });
    // discounted = 0.5 * 100,000 = 50,000; ecf = 50,000 / 200,000 = 0.25
    expect(sample.discountedCacheRead).toBe(50_000);
    expect(sample.ecf).toBeCloseTo(0.25, 6);
  });

  it("counts cache_creation as fresh attendedInput", () => {
    const turn = makeTurn({
      turnNumber: 1,
      model: "claude-sonnet-4-5-20250929",
      inputTokens: 0,
      cacheCreateTokens: 100_000,
    });
    const sample = computeEcf(turn, { alpha: 0.5 });
    expect(sample.attendedInput).toBe(100_000);
    // ecf = 100,000 / 200,000 = 0.5
    expect(sample.ecf).toBeCloseTo(0.5, 6);
  });

  it("α = 1 treats cache reads as fully attended", () => {
    const turn = makeTurn({
      turnNumber: 1,
      model: "claude-sonnet-4-5-20250929",
      cacheReadTokens: 100_000,
    });
    const sample = computeEcf(turn, { alpha: 1.0 });
    expect(sample.discountedCacheRead).toBe(100_000);
    expect(sample.ecf).toBeCloseTo(0.5, 6);
  });

  it("α = 0 ignores cache reads entirely", () => {
    const turn = makeTurn({
      turnNumber: 1,
      model: "claude-sonnet-4-5-20250929",
      cacheReadTokens: 200_000,
    });
    const sample = computeEcf(turn, { alpha: 0 });
    expect(sample.discountedCacheRead).toBe(0);
    expect(sample.ecf).toBeCloseTo(0, 6);
  });
});

describe("computeEcf — boundary and clamping", () => {
  it("clamps to 1.0 when numerator > window", () => {
    const turn = makeTurn({
      turnNumber: 1,
      model: "claude-sonnet-4-5-20250929",
      inputTokens: 400_000, // 2× the window
    });
    const sample = computeEcf(turn, { alpha: 0.5 });
    expect(sample.ecf).toBe(1);
  });

  it("returns 0 ecf and unknown_window when model is missing from pricing", () => {
    const turn = makeTurn({
      turnNumber: 1,
      model: "unknown-future-model-99",
      inputTokens: 50_000,
    });
    const sample = computeEcf(turn, { alpha: 0.5 });
    expect(sample.source).toBe("unknown_window");
    expect(sample.ecf).toBe(0);
    expect(sample.contextWindow).toBe(0);
  });

  it("uses contextWindowOverride when supplied (tests can pin)", () => {
    const turn = makeTurn({
      turnNumber: 1,
      model: "unknown-future-model-99",
      inputTokens: 50_000,
    });
    const sample = computeEcf(turn, {
      alpha: 0.5,
      contextWindowOverride: 100_000,
    });
    expect(sample.source).toBe("exact");
    expect(sample.contextWindow).toBe(100_000);
    expect(sample.ecf).toBeCloseTo(0.5, 6);
  });

  it("treats negative tokens as 0 (sanitizer)", () => {
    const turn = makeTurn({
      turnNumber: 1,
      model: "claude-sonnet-4-5-20250929",
      inputTokens: -100, // garbage
      outputTokens: 50_000,
    });
    const sample = computeEcf(turn, { alpha: 0.5 });
    expect(sample.attendedInput).toBe(0);
    expect(sample.committedOutput).toBe(50_000);
    expect(sample.ecf).toBeCloseTo(0.25, 6);
  });

  it("treats non-finite tokens as 0 (sanitizer)", () => {
    const turn = makeTurn({
      turnNumber: 1,
      model: "claude-sonnet-4-5-20250929",
      inputTokens: Number.POSITIVE_INFINITY,
      outputTokens: 50_000,
    });
    const sample = computeEcf(turn, { alpha: 0.5 });
    expect(sample.attendedInput).toBe(0);
    expect(sample.ecf).toBeCloseTo(0.25, 6);
  });

  it("model: null + override + valid window still produces exact ecf", () => {
    const turn = makeTurn({
      turnNumber: 1,
      model: undefined,
      inputTokens: 25_000,
    });
    const sample = computeEcf(turn, {
      alpha: 0.5,
      model: null,
      contextWindowOverride: 100_000,
    });
    expect(sample.source).toBe("exact");
    expect(sample.ecf).toBeCloseTo(0.25, 6);
  });
});

describe("computeEcfSeries", () => {
  it("returns one sample per turn, preserving order", () => {
    const turns = [
      makeTurn({ turnNumber: 1, inputTokens: 20_000 }),
      makeTurn({ turnNumber: 2, inputTokens: 60_000 }),
      makeTurn({ turnNumber: 3, inputTokens: 100_000 }),
    ];
    const series = computeEcfSeries(turns, { alpha: 0.5 });
    expect(series).toHaveLength(3);
    expect(series.map((s) => s.turnNumber)).toEqual([1, 2, 3]);
    expect(series[0]!.ecf).toBeLessThan(series[1]!.ecf);
    expect(series[1]!.ecf).toBeLessThan(series[2]!.ecf);
  });

  it("returns [] for empty turn array", () => {
    expect(computeEcfSeries([], { alpha: 0.5 })).toEqual([]);
  });
});

describe("aggregateSource", () => {
  it("returns insufficient_data for <2 samples", () => {
    expect(aggregateSource([])).toBe("insufficient_data");
    expect(
      aggregateSource([
        {
          turnNumber: 1,
          attendedInput: 0,
          discountedCacheRead: 0,
          committedOutput: 0,
          contextWindow: 200_000,
          ecf: 0,
          source: "exact",
        },
      ])
    ).toBe("insufficient_data");
  });

  it("returns unknown_window when every sample is unknown_window", () => {
    const turns = [
      makeTurn({ turnNumber: 1, model: "unknown-x" }),
      makeTurn({ turnNumber: 2, model: "unknown-y" }),
    ];
    const series = computeEcfSeries(turns, { alpha: 0.5 });
    expect(aggregateSource(series)).toBe("unknown_window");
  });

  it("returns exact when at least 2 samples are exact (mixed stream)", () => {
    const turns = [
      makeTurn({ turnNumber: 1, model: "claude-sonnet-4-5-20250929", inputTokens: 1000 }),
      makeTurn({ turnNumber: 2, model: "claude-sonnet-4-5-20250929", inputTokens: 2000 }),
      makeTurn({ turnNumber: 3, model: "totally-unknown" }),
    ];
    const series = computeEcfSeries(turns, { alpha: 0.5 });
    expect(aggregateSource(series)).toBe("exact");
  });
});

describe("dominantModel", () => {
  it("picks the most-frequent model", () => {
    const turns = [
      makeTurn({ turnNumber: 1, model: "claude-sonnet-4-5-20250929" }),
      makeTurn({ turnNumber: 2, model: "claude-sonnet-4-5-20250929" }),
      makeTurn({ turnNumber: 3, model: "claude-opus-4-5-20251101" }),
    ];
    expect(dominantModel(turns)).toBe("claude-sonnet-4-5-20250929");
  });

  it("breaks ties by first-occurrence order (deterministic)", () => {
    const turns = [
      makeTurn({ turnNumber: 1, model: "claude-sonnet-4-5-20250929" }),
      makeTurn({ turnNumber: 2, model: "claude-opus-4-5-20251101" }),
    ];
    expect(dominantModel(turns)).toBe("claude-sonnet-4-5-20250929");
  });

  it("returns null when no turn carries a model", () => {
    const turns = [
      makeTurn({ turnNumber: 1, model: undefined }),
      makeTurn({ turnNumber: 2, model: undefined }),
    ];
    // both default to claude-sonnet — so override:
    turns[0]!.model = undefined;
    turns[1]!.model = undefined;
    expect(dominantModel(turns)).toBe(null);
  });
});
