import { describe, expect, it } from "vitest";
import {
  calibrateMaxTokens,
  type CalibrationResult,
} from "./max-tokens-calibrator.js";

// A helper producing a deterministic ascending sample set of size n.
const seq = (n: number, f: (i: number) => number): number[] =>
  Array.from({ length: n }, (_, i) => f(i));

describe("calibrateMaxTokens — insufficient data", () => {
  it("returns insufficient_data with fewer than minSamples valid samples", () => {
    const r = calibrateMaxTokens([100, 200, 300]); // default minSamples 20
    expect(r.status).toBe("insufficient_data");
    expect(r.recommendedMaxTokens).toBeNull();
    expect(r.quantileValue).toBeNull();
    expect(r.estimatedTruncationRateAtRecommended).toBeNull();
    expect(r.overReservationVsMaxObserved).toBeNull();
    expect(r.sampleCount).toBe(3);
  });

  it("still reports min/max and current truncation when data is short", () => {
    const r = calibrateMaxTokens([100, 200, 300], { currentMaxTokens: 150 });
    expect(r.status).toBe("insufficient_data");
    expect(r.maxObserved).toBe(300);
    expect(r.minObserved).toBe(100);
    // 200 and 300 exceed 150 => 2/3
    expect(r.estimatedTruncationRateAtCurrent).toBeCloseTo(2 / 3, 10);
  });

  it("empty / non-array inputs are insufficient_data, never throw", () => {
    for (const bad of [[], undefined, null, "nope", 42, {}]) {
      const r = calibrateMaxTokens(bad as unknown);
      expect(r.status).toBe("insufficient_data");
      expect(r.recommendedMaxTokens).toBeNull();
      expect(r.sampleCount).toBe(0);
      expect(r.maxObserved).toBeNull();
    }
  });

  it("respects a custom (lower) minSamples", () => {
    const r = calibrateMaxTokens([10, 20, 30], { minSamples: 3 });
    expect(r.status).toBe("ok");
    expect(r.recommendedMaxTokens).not.toBeNull();
  });
});

describe("calibrateMaxTokens — garbage filtering", () => {
  it("drops NaN/Infinity/negative/non-number and counts rejects", () => {
    const samples = [
      100,
      NaN,
      Infinity,
      -50,
      "200" as unknown as number,
      null as unknown as number,
      undefined as unknown as number,
      {} as unknown as number,
      300,
    ];
    const r = calibrateMaxTokens(samples, { minSamples: 2 });
    // valid: 100, 300 (rest filtered: NaN, Inf, -50, "200", null, undefined, {})
    expect(r.sampleCount).toBe(2);
    expect(r.rejectedSamples).toBe(7);
    expect(r.status).toBe("ok");
  });

  it("0 is a valid (non-negative) sample", () => {
    const r = calibrateMaxTokens([0, 0, 0], { minSamples: 3, bucket: 1 });
    expect(r.status).toBe("ok");
    expect(r.minObserved).toBe(0);
    expect(r.maxObserved).toBe(0);
    // quantile 0 * 1.15 = 0 -> ceilToBucket(0,1) = 0
    expect(r.recommendedMaxTokens).toBe(0);
  });
});

describe("calibrateMaxTokens — nearest-rank quantile method", () => {
  it("computes the documented nearest-rank percentile", () => {
    // samples 1..100, p=0.95 => rank = ceil(0.95*100)=95 => x[94]=95
    const samples = seq(100, (i) => i + 1);
    const r = calibrateMaxTokens(samples, {
      p: 0.95,
      safetyMargin: 0,
      bucket: 1,
    });
    expect(r.quantileValue).toBe(95);
    expect(r.recommendedMaxTokens).toBe(95); // *1 *1, bucket 1
  });

  it("p=1 maps to the maximum, p=0 to the minimum", () => {
    const samples = seq(40, (i) => (i + 1) * 10); // 10..400
    const hi = calibrateMaxTokens(samples, { p: 1, safetyMargin: 0, bucket: 1 });
    expect(hi.quantileValue).toBe(400);
    const lo = calibrateMaxTokens(samples, { p: 0, safetyMargin: 0, bucket: 1 });
    expect(lo.quantileValue).toBe(10);
  });

  it("is order-independent (sorts internally)", () => {
    const asc = seq(50, (i) => i + 1);
    const desc = [...asc].reverse();
    const shuffled = [...asc].sort((a, b) => ((a * 7 + 3) % 11) - ((b * 7 + 3) % 11));
    const ra = calibrateMaxTokens(asc, { bucket: 1 });
    const rd = calibrateMaxTokens(desc, { bucket: 1 });
    const rs = calibrateMaxTokens(shuffled, { bucket: 1 });
    expect(ra.recommendedMaxTokens).toBe(rd.recommendedMaxTokens);
    expect(ra.recommendedMaxTokens).toBe(rs.recommendedMaxTokens);
  });
});

describe("calibrateMaxTokens — safety margin and bucketing", () => {
  it("applies safetyMargin then rounds UP to bucket", () => {
    const samples = seq(100, (i) => i + 1); // q95 = 95
    const r = calibrateMaxTokens(samples, {
      p: 0.95,
      safetyMargin: 0.15,
      bucket: 256,
    });
    // 95 * 1.15 = 109.25 -> ceil to 256 => 256
    expect(r.quantileValue).toBe(95);
    expect(r.recommendedMaxTokens).toBe(256);
  });

  it("rounds up to the correct multiple for larger values", () => {
    const samples = seq(100, () => 1000); // all 1000
    const r = calibrateMaxTokens(samples, {
      p: 0.95,
      safetyMargin: 0.15,
      bucket: 256,
    });
    // 1000 * 1.15 = 1150 -> ceil to multiple of 256 => 1280
    expect(r.recommendedMaxTokens).toBe(1280);
  });

  it("safetyMargin=0 with exact bucket multiple stays put", () => {
    const samples = seq(30, () => 512);
    const r = calibrateMaxTokens(samples, {
      p: 0.95,
      safetyMargin: 0,
      bucket: 256,
    });
    expect(r.recommendedMaxTokens).toBe(512);
  });
});

describe("calibrateMaxTokens — truncation & over-reservation diagnostics", () => {
  it("estimatedTruncationRateAtRecommended is small for a good fit", () => {
    const samples = seq(100, (i) => i + 1); // 1..100
    const r = calibrateMaxTokens(samples, {
      p: 0.95,
      safetyMargin: 0.15,
      bucket: 1,
    });
    // recommended = ceil(95*1.15)=110 ; nothing exceeds 110 => 0
    expect(r.recommendedMaxTokens).toBe(110);
    expect(r.estimatedTruncationRateAtRecommended).toBe(0);
  });

  it("counts samples strictly above the cap as truncated", () => {
    const samples = [...seq(95, () => 100), ...seq(5, () => 100000)];
    const r = calibrateMaxTokens(samples, {
      p: 0.95,
      safetyMargin: 0,
      bucket: 1,
    });
    // q95 of this set: rank=ceil(0.95*100)=95 => x[94]. sorted: 95x100 then 5x100000
    // x[94] = 100 (0-based index 94 is the last 100). recommended=100.
    expect(r.quantileValue).toBe(100);
    expect(r.recommendedMaxTokens).toBe(100);
    // 5 samples of 100000 exceed 100 => 5/100
    expect(r.estimatedTruncationRateAtRecommended).toBeCloseTo(0.05, 10);
  });

  it("reports current truncation rate vs recommended improvement", () => {
    const samples = seq(100, (i) => i + 1);
    const r = calibrateMaxTokens(samples, {
      p: 0.95,
      safetyMargin: 0.15,
      bucket: 1,
      currentMaxTokens: 50,
    });
    // 50 samples (51..100) exceed 50 => 0.5
    expect(r.estimatedTruncationRateAtCurrent).toBeCloseTo(0.5, 10);
    expect(r.estimatedTruncationRateAtRecommended!).toBeLessThan(
      r.estimatedTruncationRateAtCurrent!
    );
  });

  it("overReservationVsMaxObserved = recommended - max", () => {
    const samples = seq(30, () => 200);
    const r = calibrateMaxTokens(samples, {
      p: 0.95,
      safetyMargin: 0.15,
      bucket: 256,
    });
    // max=200, recommended: 200*1.15=230 -> ceil256 => 256 ; over = 56
    expect(r.maxObserved).toBe(200);
    expect(r.recommendedMaxTokens).toBe(256);
    expect(r.overReservationVsMaxObserved).toBe(56);
  });

  it("over-reservation can be negative when recommendation < worst sample", () => {
    // heavy tail: most small, a few enormous, low p => recommendation below max
    const samples = [...seq(99, () => 10), 100000];
    const r = calibrateMaxTokens(samples, {
      p: 0.5,
      safetyMargin: 0,
      bucket: 1,
    });
    expect(r.maxObserved).toBe(100000);
    expect(r.overReservationVsMaxObserved!).toBeLessThan(0);
  });

  it("currentMaxTokens omitted => current rate null", () => {
    const r = calibrateMaxTokens(seq(30, (i) => i + 1));
    expect(r.estimatedTruncationRateAtCurrent).toBeNull();
  });
});

describe("calibrateMaxTokens — option clamping (never throw)", () => {
  it("clamps p outside [0,1]", () => {
    const samples = seq(50, (i) => i + 1);
    const hi = calibrateMaxTokens(samples, { p: 5, safetyMargin: 0, bucket: 1 });
    expect(hi.p).toBe(1);
    expect(hi.quantileValue).toBe(50); // p=1 => max
    const lo = calibrateMaxTokens(samples, { p: -3, safetyMargin: 0, bucket: 1 });
    expect(lo.p).toBe(0);
    expect(lo.quantileValue).toBe(1); // p=0 => min
  });

  it("falls back on NaN p / safetyMargin / bucket", () => {
    const samples = seq(50, (i) => i + 1);
    const r = calibrateMaxTokens(samples, {
      p: NaN as unknown as number,
      safetyMargin: NaN as unknown as number,
      bucket: NaN as unknown as number,
    });
    expect(r.p).toBe(0.95);
    expect(r.safetyMargin).toBe(0.15);
    expect(r.bucket).toBe(256);
    expect(r.status).toBe("ok");
  });

  it("negative safetyMargin falls back to default", () => {
    const samples = seq(50, (i) => i + 1);
    const r = calibrateMaxTokens(samples, { safetyMargin: -1 });
    expect(r.safetyMargin).toBe(0.15);
  });

  it("ignores invalid currentMaxTokens", () => {
    const r = calibrateMaxTokens(seq(30, (i) => i + 1), {
      currentMaxTokens: -10,
    });
    expect(r.estimatedTruncationRateAtCurrent).toBeNull();
  });
});

describe("calibrateMaxTokens — determinism", () => {
  it("same input => identical result", () => {
    const samples = seq(60, (i) => (i * 37) % 1000);
    const a: CalibrationResult = calibrateMaxTokens(samples, {
      currentMaxTokens: 500,
    });
    const b: CalibrationResult = calibrateMaxTokens(samples, {
      currentMaxTokens: 500,
    });
    expect(a).toEqual(b);
  });
});

describe("calibrateMaxTokens — realistic distribution", () => {
  it("recommends a sane cap for a right-skewed code-output distribution", () => {
    // 200 samples: bulk around 400-800, a tail up to ~3000
    const bulk = seq(180, (i) => 400 + (i % 400));
    const tail = seq(20, (i) => 1500 + i * 75);
    const samples = [...bulk, ...tail];
    const r = calibrateMaxTokens(samples, {
      p: 0.95,
      safetyMargin: 0.15,
      bucket: 256,
      currentMaxTokens: 4096,
    });
    expect(r.status).toBe("ok");
    expect(r.recommendedMaxTokens!).toBeGreaterThan(r.quantileValue!);
    // recommendation should be well below an over-provisioned 4096
    expect(r.recommendedMaxTokens!).toBeLessThan(4096);
    expect(r.estimatedTruncationRateAtRecommended!).toBeLessThanOrEqual(0.05);
    // current 4096 over-reserves: 0 truncation but lots of waste
    expect(r.estimatedTruncationRateAtCurrent).toBe(0);
  });
});
