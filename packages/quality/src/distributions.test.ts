import { describe, expect, it } from "vitest";
import {
  binomialTwoSidedP,
  chiSquareSf,
  erf,
  logChoose,
  normalCdf,
  normalQuantile,
} from "./distributions.js";

describe("distributions", () => {
  describe("normalCdf", () => {
    // Reference values from R: pnorm(z).
    it("matches standard reference points", () => {
      expect(normalCdf(0)).toBeCloseTo(0.5, 6);
      expect(normalCdf(1)).toBeCloseTo(0.8413447, 5);
      expect(normalCdf(-1)).toBeCloseTo(0.1586553, 5);
      expect(normalCdf(1.96)).toBeCloseTo(0.9750021, 5);
      expect(normalCdf(-1.96)).toBeCloseTo(0.0249979, 5);
      expect(normalCdf(1.6449)).toBeCloseTo(0.95, 4);
    });

    it("is monotone increasing", () => {
      let prev = 0;
      for (let z = -4; z <= 4; z += 0.5) {
        const v = normalCdf(z);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
    });
  });

  describe("erf", () => {
    it("matches reference values", () => {
      expect(erf(0)).toBeCloseTo(0, 6);
      expect(erf(1)).toBeCloseTo(0.8427008, 5);
      expect(erf(-1)).toBeCloseTo(-0.8427008, 5);
      expect(erf(2)).toBeCloseTo(0.9953223, 5);
    });
  });

  describe("normalQuantile", () => {
    // Reference values from R: qnorm(p). Inverse of normalCdf.
    it("matches standard reference points", () => {
      expect(normalQuantile(0.5)).toBeCloseTo(0, 6);
      expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 4);
      expect(normalQuantile(0.95)).toBeCloseTo(1.644854, 4);
      expect(normalQuantile(0.8)).toBeCloseTo(0.8416212, 4);
      expect(normalQuantile(0.025)).toBeCloseTo(-1.959964, 4);
    });

    it("round-trips with normalCdf", () => {
      for (const p of [0.1, 0.25, 0.5, 0.75, 0.9, 0.99]) {
        expect(normalCdf(normalQuantile(p))).toBeCloseTo(p, 5);
      }
    });

    it("handles boundaries", () => {
      expect(normalQuantile(0)).toBe(-Infinity);
      expect(normalQuantile(1)).toBe(Infinity);
    });
  });

  describe("chiSquareSf", () => {
    // Reference values from R: pchisq(x, df, lower.tail=FALSE).
    it("matches reference upper-tail probabilities (df=1)", () => {
      expect(chiSquareSf(3.841459, 1)).toBeCloseTo(0.05, 4);
      expect(chiSquareSf(6.634897, 1)).toBeCloseTo(0.01, 4);
      expect(chiSquareSf(0, 1)).toBe(1);
    });

    it("matches reference upper-tail probabilities (df=2)", () => {
      expect(chiSquareSf(5.991465, 2)).toBeCloseTo(0.05, 4);
      expect(chiSquareSf(9.21034, 2)).toBeCloseTo(0.01, 4);
    });
  });

  describe("binomialTwoSidedP", () => {
    // Reference: 2 * pbinom(min(k,n-k), n, 0.5), capped at 1.
    it("matches reference values", () => {
      // n=10, k=1: 2 * pbinom(1,10,0.5) = 2 * 0.01074219 = 0.02148
      expect(binomialTwoSidedP(1, 10)).toBeCloseTo(0.02148, 4);
      // n=10, k=5 (the mode): should be 1 (capped).
      expect(binomialTwoSidedP(5, 10)).toBe(1);
      // n=20, k=3: 2 * pbinom(3,20,0.5) = 2 * 0.001288 = 0.002577
      expect(binomialTwoSidedP(3, 20)).toBeCloseTo(0.002577, 4);
    });

    it("returns 1 for n=0", () => {
      expect(binomialTwoSidedP(0, 0)).toBe(1);
    });
  });

  describe("logChoose", () => {
    it("matches exact small binomials", () => {
      expect(Math.exp(logChoose(10, 5))).toBeCloseTo(252, 4);
      expect(Math.exp(logChoose(6, 2))).toBeCloseTo(15, 6);
      expect(Math.exp(logChoose(52, 5))).toBeCloseTo(2598960, 0);
    });

    it("returns -Infinity out of range", () => {
      expect(logChoose(5, 6)).toBe(-Infinity);
      expect(logChoose(5, -1)).toBe(-Infinity);
    });
  });
});
