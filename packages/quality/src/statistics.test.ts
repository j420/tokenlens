import { describe, expect, it } from "vitest";
import {
  mcnemarTest,
  nonInferiorityProportion,
  sampleSizeProportionNI,
  twoProportionZTest,
  wilcoxonSignedRank,
} from "./statistics.js";

describe("statistics", () => {
  describe("mcnemarTest", () => {
    it("returns p=1 with no discordant pairs", () => {
      const r = mcnemarTest(0, 0);
      expect(r.pValue).toBe(1);
      expect(r.reject).toBe(false);
    });

    it("uses exact binomial for small discordant totals", () => {
      // b=1, c=9 → 2*pbinom(1,10,0.5) = 0.02148
      const r = mcnemarTest(1, 9);
      expect(r.test).toContain("exact");
      expect(r.pValue).toBeCloseTo(0.02148, 4);
      expect(r.reject).toBe(true);
    });

    it("uses continuity-corrected chi-square for large totals", () => {
      // b=10, c=30: chi2 = (|10-30|-1)^2/40 = 361/40 = 9.025
      // pchisq(9.025,1,lower=FALSE) = 0.002662
      const r = mcnemarTest(10, 30);
      expect(r.test).toContain("χ²");
      expect(r.statistic).toBeCloseTo(9.025, 3);
      expect(r.pValue).toBeCloseTo(0.002662, 4);
      expect(r.reject).toBe(true);
    });

    it("does not reject when discordant pairs are balanced", () => {
      const r = mcnemarTest(25, 25);
      expect(r.reject).toBe(false);
      expect(r.pValue).toBeGreaterThan(0.5);
    });

    it("rejects non-integer or negative inputs", () => {
      expect(() => mcnemarTest(1.5, 2)).toThrow();
      expect(() => mcnemarTest(-1, 2)).toThrow();
    });
  });

  describe("twoProportionZTest", () => {
    it("matches a hand-computed z", () => {
      // pA=80/100=0.8, pB=70/100=0.7, pPool=0.75
      // se=sqrt(0.75*0.25*(1/100+1/100))=sqrt(0.1875*0.02)=sqrt(0.00375)=0.061237
      // z=0.1/0.061237=1.63299
      const r = twoProportionZTest({
        successesA: 80,
        nA: 100,
        successesB: 70,
        nB: 100,
        alternative: "two-sided",
      });
      expect(r.statistic).toBeCloseTo(1.63299, 4);
      // two-sided p = 2*(1-pnorm(1.633)) = 0.10247
      expect(r.pValue).toBeCloseTo(0.10247, 4);
      expect(r.reject).toBe(false);
    });

    it("detects a large significant difference", () => {
      const r = twoProportionZTest({
        successesA: 95,
        nA: 100,
        successesB: 60,
        nB: 100,
      });
      expect(r.pValue).toBeLessThan(0.001);
      expect(r.reject).toBe(true);
    });
  });

  describe("nonInferiorityProportion", () => {
    it("declares non-inferiority when treatment ~ control", () => {
      // Treatment slightly lower but well within a 1pp margin at large n.
      const r = nonInferiorityProportion({
        treatmentSuccesses: 8900,
        treatmentN: 10000,
        controlSuccesses: 8920,
        controlN: 10000,
        margin: 0.01,
      });
      // observed diff = -0.002, shifted = +0.008, large n ⇒ significant.
      expect(r.detail.observedDiff).toBeCloseTo(-0.002, 6);
      expect(r.reject).toBe(true); // non-inferior
    });

    it("fails non-inferiority when treatment is clearly worse", () => {
      const r = nonInferiorityProportion({
        treatmentSuccesses: 800,
        treatmentN: 1000,
        controlSuccesses: 900,
        controlN: 1000,
        margin: 0.01,
      });
      // observed diff = -0.10, far beyond the 1pp margin.
      expect(r.reject).toBe(false);
      expect(r.pValue).toBeGreaterThan(0.05);
    });

    it("treats a zero margin as a one-sided superiority-or-equal test", () => {
      const r = nonInferiorityProportion({
        treatmentSuccesses: 520,
        treatmentN: 1000,
        controlSuccesses: 500,
        controlN: 1000,
        margin: 0,
      });
      expect(r.detail.margin).toBe(0);
      expect(r.statistic).toBeGreaterThan(0);
    });

    it("rejects invalid inputs", () => {
      expect(() =>
        nonInferiorityProportion({
          treatmentSuccesses: 1,
          treatmentN: 0,
          controlSuccesses: 1,
          controlN: 10,
          margin: 0.01,
        })
      ).toThrow();
      expect(() =>
        nonInferiorityProportion({
          treatmentSuccesses: 1,
          treatmentN: 10,
          controlSuccesses: 1,
          controlN: 10,
          margin: -0.01,
        })
      ).toThrow();
    });
  });

  describe("wilcoxonSignedRank", () => {
    it("returns p=1 when all differences are zero", () => {
      const r = wilcoxonSignedRank([0, 0, 0]);
      expect(r.pValue).toBe(1);
      expect(r.reject).toBe(false);
    });

    it("detects a consistent positive shift (two-sided)", () => {
      // All positive differences ⇒ strong signal.
      const diffs = [3, 5, 8, 2, 6, 7, 4, 9, 1, 10, 11, 12];
      const r = wilcoxonSignedRank(diffs, "two-sided");
      expect(r.pValue).toBeLessThan(0.01);
      expect(r.reject).toBe(true);
    });

    it("does not flag symmetric noise around zero", () => {
      const diffs = [1, -1, 2, -2, 3, -3, 4, -4, 5, -5];
      const r = wilcoxonSignedRank(diffs, "two-sided");
      expect(r.reject).toBe(false);
    });

    it("one-sided 'greater' flags treatment-worse PWED", () => {
      // Treatment PWED consistently larger than control.
      const diffs = [2, 4, 1, 6, 3, 5, 7, 2, 8, 4, 9, 3];
      const r = wilcoxonSignedRank(diffs, "greater");
      expect(r.reject).toBe(true);
    });

    it("one-sided 'greater' does NOT flag treatment-better PWED", () => {
      // Treatment PWED consistently smaller (negative diffs) ⇒ good, not worse.
      const diffs = [-2, -4, -1, -6, -3, -5, -7, -2, -8, -4];
      const r = wilcoxonSignedRank(diffs, "greater");
      expect(r.reject).toBe(false);
    });
  });

  describe("sampleSizeProportionNI", () => {
    it("reproduces the textbook formula (δ=4pp, exact z ⇒ 1913/arm)", () => {
      // p̄=0.55, δ=0.04, α=0.05 one-sided, power=0.80.
      // Exact: (qnorm(.95)+qnorm(.80))² · 2·.55·.45 / .04²
      //      = (1.6448536+0.8416212)² · 0.495 / 0.0016 = 1912.7 → 1913.
      // The plan quoted ~1936 using rounded z-values; the exact value is 1913.
      const r = sampleSizeProportionNI({
        baselineProportion: 0.55,
        margin: 0.04,
        alpha: 0.05,
        power: 0.8,
      });
      expect(r.nPerArm).toBe(1913);
    });

    it("shows a 2pp margin demands ~4x the sample (~7651/arm)", () => {
      const r = sampleSizeProportionNI({
        baselineProportion: 0.55,
        margin: 0.02,
        alpha: 0.05,
        power: 0.8,
      });
      // Quartering δ² quadruples n: 1913 × 4 = 7652.
      expect(r.nPerArm).toBeGreaterThan(7600);
      expect(r.nPerArm).toBeLessThan(7700);
    });

    it("scales n inversely with margin squared", () => {
      const a = sampleSizeProportionNI({ baselineProportion: 0.5, margin: 0.02 });
      const b = sampleSizeProportionNI({ baselineProportion: 0.5, margin: 0.04 });
      // Halving margin (b→a) ~quadruples n.
      expect(a.nPerArm / b.nPerArm).toBeCloseTo(4, 0);
    });

    it("rejects invalid inputs", () => {
      expect(() =>
        sampleSizeProportionNI({ baselineProportion: 0, margin: 0.02 })
      ).toThrow();
      expect(() =>
        sampleSizeProportionNI({ baselineProportion: 0.5, margin: 0 })
      ).toThrow();
    });
  });
});
