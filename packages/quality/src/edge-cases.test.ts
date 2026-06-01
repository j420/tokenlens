/**
 * Degenerate-input robustness for the statistics layer.
 *
 * A NaN or Infinity silently flowing into a p-value would flip a quality-gate
 * decision invisibly — either shipping a regression or blocking a good
 * feature. These tests pin the behavior of the nastiest inputs: zero-variance
 * arms, all-tied ranks, extreme proportions, n=1, and tiny margins. Every
 * result must be finite and correctly directed.
 */

import { describe, expect, it } from "vitest";
import {
  mcnemarTest,
  nonInferiorityProportion,
  sampleSizeProportionNI,
  twoProportionZTest,
  wilcoxonSignedRank,
} from "./statistics.js";
import { normalCdf, normalQuantile } from "./distributions.js";

const finite = (x: number) => Number.isFinite(x);

describe("non-inferiority with zero-variance arms", () => {
  it("both arms perfect ⇒ finite p, declares non-inferior", () => {
    const r = nonInferiorityProportion({
      treatmentSuccesses: 100,
      treatmentN: 100,
      controlSuccesses: 100,
      controlN: 100,
      margin: 0.01,
    });
    expect(finite(r.pValue)).toBe(true);
    expect(r.reject).toBe(true);
  });

  it("both arms zero ⇒ finite p", () => {
    const r = nonInferiorityProportion({
      treatmentSuccesses: 0,
      treatmentN: 100,
      controlSuccesses: 0,
      controlN: 100,
      margin: 0.01,
    });
    expect(finite(r.pValue)).toBe(true);
  });

  it("a drop exactly at the margin is NOT certified non-inferior", () => {
    const r = nonInferiorityProportion({
      treatmentSuccesses: 99,
      treatmentN: 100,
      controlSuccesses: 100,
      controlN: 100,
      margin: 0.01,
    });
    expect(r.pValue).toBeCloseTo(0.5, 2);
    expect(r.reject).toBe(false);
  });
});

describe("Wilcoxon degenerate inputs", () => {
  it("all-tied nonzero differences ⇒ finite p", () => {
    const r = wilcoxonSignedRank([3, 3, 3, 3, 3, 3, 3, 3], "two-sided");
    expect(finite(r.pValue)).toBe(true);
    expect(r.pValue).toBeGreaterThanOrEqual(0);
    expect(r.pValue).toBeLessThanOrEqual(1);
  });

  it("n=1 cannot be significant", () => {
    const r = wilcoxonSignedRank([5], "two-sided");
    expect(r.pValue).toBeGreaterThan(0.9);
    expect(r.reject).toBe(false);
  });

  it("perfectly symmetric differences are not significant", () => {
    const r = wilcoxonSignedRank([-2, -2, 2, 2], "greater");
    expect(r.reject).toBe(false);
  });
});

describe("two-proportion extremes", () => {
  it("both zero ⇒ p≈1, finite", () => {
    const r = twoProportionZTest({ successesA: 0, nA: 50, successesB: 0, nB: 50 });
    expect(finite(r.pValue)).toBe(true);
    expect(r.pValue).toBeGreaterThan(0.9);
  });
  it("both full ⇒ p≈1, finite", () => {
    const r = twoProportionZTest({ successesA: 50, nA: 50, successesB: 50, nB: 50 });
    expect(finite(r.pValue)).toBe(true);
    expect(r.pValue).toBeGreaterThan(0.9);
  });
});

describe("McNemar large discordant", () => {
  it("uses asymptotic and stays finite", () => {
    const r = mcnemarTest(5000, 5200);
    expect(finite(r.pValue)).toBe(true);
    expect(r.test).toContain("χ²");
  });
});

describe("distribution boundary behavior", () => {
  it("quantile stays finite near 0 and 1", () => {
    expect(finite(normalQuantile(0.999999))).toBe(true);
    expect(finite(normalQuantile(1e-9))).toBe(true);
  });
  it("CDF saturates at the tails without overflow", () => {
    expect(normalCdf(40)).toBe(1);
    expect(normalCdf(-40)).toBe(0);
  });
});

describe("sample size for extreme margins", () => {
  it("a 0.1pp margin demands a (finite, enormous) sample", () => {
    const r = sampleSizeProportionNI({ baselineProportion: 0.5, margin: 0.001 });
    expect(finite(r.nPerArm)).toBe(true);
    expect(r.nPerArm).toBeGreaterThan(1_000_000);
  });
});
