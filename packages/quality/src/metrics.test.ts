import { describe, expect, it } from "vitest";
import {
  acceptanceRateMcNemar,
  evaluateQualityGate,
  type PairedSession,
} from "./metrics.js";

/**
 * Build n paired sessions with controllable behavior. `flip` controls how
 * many treatment sessions deviate from control on each metric.
 */
function makePairs(opts: {
  n: number;
  controlAcceptRate?: number;
  treatmentAcceptRate?: number;
  controlPwed?: number;
  treatmentPwed?: number;
  controlTpr?: number;
  treatmentTpr?: number;
  withTests?: boolean;
}): PairedSession[] {
  const {
    n,
    controlAcceptRate = 0.9,
    treatmentAcceptRate = 0.9,
    controlPwed = 10,
    treatmentPwed = 10,
    controlTpr = 0.95,
    treatmentTpr = 0.95,
    withTests = true,
  } = opts;
  const pairs: PairedSession[] = [];
  for (let i = 0; i < n; i++) {
    const frac = i / n;
    pairs.push({
      sessionId: `s${i}`,
      control: {
        accepted: frac < controlAcceptRate,
        pwed: controlPwed,
        testPassed: withTests ? frac < controlTpr : null,
      },
      treatment: {
        accepted: frac < treatmentAcceptRate,
        pwed: treatmentPwed,
        testPassed: withTests ? frac < treatmentTpr : null,
      },
    });
  }
  return pairs;
}

describe("evaluateQualityGate", () => {
  it("passes when treatment matches control AND sample is adequately powered", () => {
    // Proving non-inferiority at a 1pp AR margin / 0.5pp TPR margin needs
    // several thousand pairs per arm. n=16000 clears the power bar for all
    // three metrics; smaller samples cannot (see underpowered test below).
    const pairs = makePairs({ n: 16000 });
    const result = evaluateQualityGate(pairs);
    expect(result.pass).toBe(true);
    expect(result.verdicts.every((v) => v.nonInferior)).toBe(true);
  });

  it("cannot prove non-inferiority on a neutral feature when underpowered", () => {
    // Identical arms, but only 2000 pairs — insufficient power for a 1pp
    // margin. The gate correctly refuses to certify (absence of power is not
    // proof of safety). This is the framework being honest, not a bug.
    const pairs = makePairs({ n: 2000 });
    const result = evaluateQualityGate(pairs);
    expect(result.pass).toBe(false);
  });

  it("fails AR when treatment acceptance drops well beyond margin", () => {
    const pairs = makePairs({
      n: 2000,
      controlAcceptRate: 0.9,
      treatmentAcceptRate: 0.7, // 20pp drop, far beyond 1pp margin
    });
    const result = evaluateQualityGate(pairs);
    expect(result.pass).toBe(false);
    const ar = result.verdicts.find((v) => v.metric === "acceptanceRate")!;
    expect(ar.nonInferior).toBe(false);
    expect(result.failureReason).toContain("acceptanceRate");
  });

  it("fails PWED when treatment edit-distance is consistently larger", () => {
    const pairs = makePairs({
      n: 500,
      controlPwed: 5,
      treatmentPwed: 25, // treatment output needs far more rework
    });
    const result = evaluateQualityGate(pairs);
    const pwed = result.verdicts.find((v) => v.metric === "pwed")!;
    expect(pwed.nonInferior).toBe(false);
    expect(result.pass).toBe(false);
  });

  it("passes PWED when treatment edit-distance is lower (better)", () => {
    const pairs = makePairs({
      n: 500,
      controlPwed: 25,
      treatmentPwed: 5,
    });
    const result = evaluateQualityGate(pairs);
    const pwed = result.verdicts.find((v) => v.metric === "pwed")!;
    expect(pwed.nonInferior).toBe(true);
  });

  it("fails TPR closed when no test-suite signal exists", () => {
    const pairs = makePairs({ n: 2000, withTests: false });
    const result = evaluateQualityGate(pairs);
    const tpr = result.verdicts.find((v) => v.metric === "testPassRate")!;
    expect(tpr.nonInferior).toBe(false); // fail-closed: no evidence of safety
    expect(tpr.effectiveN).toBe(0);
    expect(result.pass).toBe(false);
  });

  it("reports honest point estimates", () => {
    const pairs = makePairs({
      n: 1000,
      controlAcceptRate: 0.9,
      treatmentAcceptRate: 0.88,
    });
    const result = evaluateQualityGate(pairs);
    const ar = result.verdicts.find((v) => v.metric === "acceptanceRate")!;
    expect(ar.controlEstimate).toBeCloseTo(0.9, 2);
    expect(ar.treatmentEstimate).toBeCloseTo(0.88, 2);
  });

  it("underpowered samples cannot pass (small n, real but tiny diff)", () => {
    // Only 20 pairs — even an identical treatment lacks power to PROVE NI.
    const pairs = makePairs({ n: 20 });
    const result = evaluateQualityGate(pairs);
    const ar = result.verdicts.find((v) => v.metric === "acceptanceRate")!;
    // With n=20 and a 1pp margin the NI test should not reach significance.
    expect(ar.nonInferior).toBe(false);
  });
});

describe("acceptanceRateMcNemar", () => {
  it("agrees with the NI direction on a balanced sample", () => {
    const pairs = makePairs({ n: 1000 });
    const r = acceptanceRateMcNemar(pairs);
    // Identical arms ⇒ no discordant pairs ⇒ p=1.
    expect(r.pValue).toBe(1);
  });

  it("flags a paired shift", () => {
    // Construct explicit discordance: 5 control-only accepts, 40 treatment-only.
    const pairs: PairedSession[] = [];
    for (let i = 0; i < 5; i++) {
      pairs.push({
        sessionId: `b${i}`,
        control: { accepted: true, pwed: 1, testPassed: true },
        treatment: { accepted: false, pwed: 1, testPassed: true },
      });
    }
    for (let i = 0; i < 40; i++) {
      pairs.push({
        sessionId: `c${i}`,
        control: { accepted: false, pwed: 1, testPassed: true },
        treatment: { accepted: true, pwed: 1, testPassed: true },
      });
    }
    const r = acceptanceRateMcNemar(pairs);
    expect(r.detail.b).toBe(5);
    expect(r.detail.c).toBe(40);
    expect(r.reject).toBe(true);
  });
});
