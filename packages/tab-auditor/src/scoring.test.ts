import { describe, it, expect } from "vitest";
import {
  DEFAULT_WEIGHTS,
  blend,
  clamp01,
  sizeKeepSignal,
  type SignalSet,
} from "./scoring.js";

describe("clamp01", () => {
  it("clamps and rejects non-finite", () => {
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(Infinity)).toBe(0);
  });
});

describe("DEFAULT_WEIGHTS", () => {
  it("sums to 1", () => {
    const sum =
      DEFAULT_WEIGHTS.activeAdjacency +
      DEFAULT_WEIGHTS.recency +
      DEFAULT_WEIGHTS.taskMatch +
      DEFAULT_WEIGHTS.sizePenalty;
    expect(sum).toBeCloseTo(1, 10);
  });
});

describe("blend renormalization", () => {
  it("with all signals present equals the weighted sum", () => {
    const signals: SignalSet = {
      activeAdjacency: 1,
      recency: 0,
      taskMatch: 1,
      sizePenalty: 0,
    };
    const { score } = blend(signals);
    const expected =
      DEFAULT_WEIGHTS.activeAdjacency * 1 + DEFAULT_WEIGHTS.taskMatch * 1;
    expect(score).toBeCloseTo(expected, 10);
  });

  it("omitting a signal renormalizes the remaining weights to sum to 1", () => {
    // Only adjacency present, value 0.8 → score must equal 0.8 (weight→1).
    const signals: SignalSet = {
      activeAdjacency: 0.8,
      recency: null,
      taskMatch: null,
      sizePenalty: null,
    };
    const { score, effectiveWeights } = blend(signals);
    expect(score).toBeCloseTo(0.8, 10);
    expect(effectiveWeights.activeAdjacency).toBeCloseTo(1, 10);
  });

  it("effective weights always sum to 1 across present signals", () => {
    const signals: SignalSet = {
      activeAdjacency: 0.5,
      recency: 0.5,
      taskMatch: null,
      sizePenalty: 0.5,
    };
    const { effectiveWeights } = blend(signals);
    const sum = Object.values(effectiveWeights).reduce((a, b) => a + (b ?? 0), 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it("no present signals → score 0", () => {
    const signals: SignalSet = {
      activeAdjacency: null,
      recency: null,
      taskMatch: null,
      sizePenalty: null,
    };
    expect(blend(signals).score).toBe(0);
  });
});

describe("sizeKeepSignal", () => {
  it("decreases monotonically with token count", () => {
    expect(sizeKeepSignal(0)).toBe(1);
    expect(sizeKeepSignal(2000)).toBeCloseTo(0.5, 10); // midpoint
    const small = sizeKeepSignal(100) as number;
    const big = sizeKeepSignal(50000) as number;
    expect(small).toBeGreaterThan(big);
    expect(big).toBeGreaterThan(0);
  });

  it("returns null for unknown/invalid counts (signal omitted, never fabricated)", () => {
    expect(sizeKeepSignal(null)).toBeNull();
    expect(sizeKeepSignal(undefined)).toBeNull();
    expect(sizeKeepSignal(Number.NaN)).toBeNull();
    expect(sizeKeepSignal(-5)).toBeNull();
  });
});
