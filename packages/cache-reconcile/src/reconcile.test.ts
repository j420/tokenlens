import { describe, it, expect } from "vitest";
import { reconcileCacheHits } from "./reconcile.js";

describe("reconcileCacheHits", () => {
  it("is on-target when realized is within tolerance of predicted", () => {
    const r = reconcileCacheHits({ predictedCacheReadTokens: 10000, realizedCacheReadTokens: 9000 });
    expect(r.verdict).toBe("on-target");
    expect(r.hitRatio).toBeCloseTo(0.9);
    expect(r.driftTokens).toBe(-1000);
  });

  it("flags under-performance and the stranded write when realized falls short", () => {
    const r = reconcileCacheHits({
      predictedCacheReadTokens: 10000,
      realizedCacheReadTokens: 2000, // 20% hit
      cacheWriteTokens: 5000,
    });
    expect(r.verdict).toBe("underperforming");
    expect(r.hitRatio).toBeCloseTo(0.2);
    // stranded = write * (1 - 0.2) = 4000
    expect(r.strandedWriteTokens).toBe(4000);
  });

  it("reports zero stranded write when none is supplied", () => {
    const r = reconcileCacheHits({ predictedCacheReadTokens: 10000, realizedCacheReadTokens: 1000 });
    expect(r.verdict).toBe("underperforming");
    expect(r.strandedWriteTokens).toBe(0);
  });

  it("flags over-performance when realized materially exceeds predicted", () => {
    const r = reconcileCacheHits({ predictedCacheReadTokens: 1000, realizedCacheReadTokens: 5000 });
    expect(r.verdict).toBe("over-performing");
    expect(r.hitRatio).toBe(5);
  });

  it("respects a custom tolerance", () => {
    // realized 0.85 of predicted; tolerance 0.1 → underperforming (below 0.9)
    expect(
      reconcileCacheHits({ predictedCacheReadTokens: 1000, realizedCacheReadTokens: 850 }, { tolerance: 0.1 }).verdict
    ).toBe("underperforming");
    // same numbers, tolerance 0.2 → on-target
    expect(
      reconcileCacheHits({ predictedCacheReadTokens: 1000, realizedCacheReadTokens: 850 }, { tolerance: 0.2 }).verdict
    ).toBe("on-target");
  });

  it("returns insufficient_signal when predicted or realized is unknown, or predicted is 0", () => {
    expect(reconcileCacheHits({ predictedCacheReadTokens: null, realizedCacheReadTokens: 100 }).verdict).toBe(
      "insufficient_signal"
    );
    expect(reconcileCacheHits({ predictedCacheReadTokens: 100, realizedCacheReadTokens: null }).verdict).toBe(
      "insufficient_signal"
    );
    expect(reconcileCacheHits({ predictedCacheReadTokens: 0, realizedCacheReadTokens: 0 }).verdict).toBe(
      "insufficient_signal"
    );
  });

  it("never fabricates a stranded write on insufficient signal", () => {
    const r = reconcileCacheHits({ predictedCacheReadTokens: null, realizedCacheReadTokens: null, cacheWriteTokens: 9999 });
    expect(r.strandedWriteTokens).toBe(0);
    expect(r.hitRatio).toBeNull();
  });

  it("is total on garbage and deterministic", () => {
    expect(reconcileCacheHits(null).verdict).toBe("insufficient_signal");
    const input = { predictedCacheReadTokens: 1000, realizedCacheReadTokens: 200, cacheWriteTokens: 500 };
    expect(reconcileCacheHits(input)).toEqual(reconcileCacheHits(input));
  });
});
