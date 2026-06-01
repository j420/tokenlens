/**
 * The three production quality metrics every TCRP feature is judged against,
 * and the gate evaluator that decides whether a feature may be promoted.
 *
 * The metrics (see plan §"Cross-cutting: quality-preservation framework"):
 *   1. Acceptance Rate (AR)               — paired binary  → McNemar / NI z
 *   2. Persistence-Weighted Edit Distance — paired ordinal → Wilcoxon
 *   3. Downstream Test-Pass Rate (TPR)    — paired binary  → NI z
 *
 * A feature is promotable only when ALL THREE metrics are non-inferior at the
 * pre-registered margins. This module is pure: it consumes already-collected
 * paired observations and returns a decision. It never collects data itself.
 */

import {
  mcnemarTest,
  nonInferiorityProportion,
  wilcoxonSignedRank,
  type TestResult,
} from "./statistics.js";

/** A single session observed under both arms (treatment vs control). */
export interface PairedSession {
  sessionId: string;
  /** Whether the user accepted the model output (AR). */
  control: { accepted: boolean; pwed: number; testPassed: boolean | null };
  treatment: { accepted: boolean; pwed: number; testPassed: boolean | null };
}

/** Pre-registered non-inferiority margins. Frozen before data collection. */
export interface QualityMargins {
  /** AR margin (absolute proportion). Plan: 1pp. */
  acceptanceRate: number;
  /** TPR margin (absolute proportion). Plan: 0.5pp. */
  testPassRate: number;
  /** Significance level (one-sided). Plan: 0.05. */
  alpha: number;
}

export const DEFAULT_MARGINS: QualityMargins = {
  acceptanceRate: 0.01,
  testPassRate: 0.005,
  alpha: 0.05,
};

export interface MetricVerdict {
  metric: "acceptanceRate" | "pwed" | "testPassRate";
  /** True when treatment is statistically non-inferior to control. */
  nonInferior: boolean;
  /** Sample size that actually contributed (after dropping nulls/concordants). */
  effectiveN: number;
  /** Point estimates for transparency. */
  controlEstimate: number;
  treatmentEstimate: number;
  test: TestResult;
}

export interface QualityGateResult {
  /** Overall: all three metrics non-inferior. */
  pass: boolean;
  nPairs: number;
  verdicts: MetricVerdict[];
  /** Reason the gate failed (first failing metric), if any. */
  failureReason?: string;
}

/**
 * Evaluate the full quality gate over a set of paired sessions.
 *
 * AR and TPR are evaluated with the one-sided non-inferiority proportion test
 * (the primary gate); McNemar is additionally reported for AR as a paired
 * sanity check. PWED uses Wilcoxon signed-rank with the "less" alternative
 * (we want treatment edit-distance to be no larger; non-inferiority here means
 * NOT significantly greater).
 */
export function evaluateQualityGate(
  pairs: PairedSession[],
  margins: QualityMargins = DEFAULT_MARGINS
): QualityGateResult {
  const verdicts: MetricVerdict[] = [
    evaluateAcceptanceRate(pairs, margins),
    evaluatePwed(pairs, margins),
    evaluateTestPassRate(pairs, margins),
  ];
  const firstFailure = verdicts.find((v) => !v.nonInferior);
  return {
    pass: !firstFailure,
    nPairs: pairs.length,
    verdicts,
    failureReason: firstFailure
      ? `${firstFailure.metric} failed non-inferiority ` +
        `(control=${firstFailure.controlEstimate.toFixed(4)}, ` +
        `treatment=${firstFailure.treatmentEstimate.toFixed(4)}, ` +
        `p=${firstFailure.test.pValue.toFixed(4)})`
      : undefined,
  };
}

function evaluateAcceptanceRate(
  pairs: PairedSession[],
  margins: QualityMargins
): MetricVerdict {
  const controlSucc = pairs.filter((p) => p.control.accepted).length;
  const treatmentSucc = pairs.filter((p) => p.treatment.accepted).length;
  const n = pairs.length;
  const ni = nonInferiorityProportion({
    treatmentSuccesses: treatmentSucc,
    treatmentN: n,
    controlSuccesses: controlSucc,
    controlN: n,
    margin: margins.acceptanceRate,
    alpha: margins.alpha,
  });
  return {
    metric: "acceptanceRate",
    nonInferior: ni.reject, // reject inferiority ⇒ non-inferior
    effectiveN: n,
    controlEstimate: n ? controlSucc / n : 0,
    treatmentEstimate: n ? treatmentSucc / n : 0,
    test: ni,
  };
}

function evaluatePwed(
  pairs: PairedSession[],
  margins: QualityMargins
): MetricVerdict {
  // Only sessions accepted under BOTH arms have a meaningful edit distance.
  const diffs: number[] = [];
  let ctrlSum = 0;
  let trtSum = 0;
  let count = 0;
  for (const p of pairs) {
    if (p.control.accepted && p.treatment.accepted) {
      diffs.push(p.treatment.pwed - p.control.pwed);
      ctrlSum += p.control.pwed;
      trtSum += p.treatment.pwed;
      count++;
    }
  }
  // Alternative "greater" tests whether treatment PWED is significantly LARGER
  // (i.e. worse). Non-inferiority = we FAIL to find treatment significantly
  // worse, so nonInferior = !reject of the "greater" test.
  const w = wilcoxonSignedRank(diffs, "greater", margins.alpha);
  return {
    metric: "pwed",
    nonInferior: !w.reject,
    effectiveN: count,
    controlEstimate: count ? ctrlSum / count : 0,
    treatmentEstimate: count ? trtSum / count : 0,
    test: w,
  };
}

function evaluateTestPassRate(
  pairs: PairedSession[],
  margins: QualityMargins
): MetricVerdict {
  // Only sessions where a test suite ran under both arms count.
  const usable = pairs.filter(
    (p) => p.control.testPassed !== null && p.treatment.testPassed !== null
  );
  const n = usable.length;
  const controlSucc = usable.filter((p) => p.control.testPassed).length;
  const treatmentSucc = usable.filter((p) => p.treatment.testPassed).length;
  if (n === 0) {
    // No test signal — cannot prove non-inferiority. Default to FAIL-CLOSED
    // for promotion purposes: absence of evidence is not evidence of safety.
    return {
      metric: "testPassRate",
      nonInferior: false,
      effectiveN: 0,
      controlEstimate: 0,
      treatmentEstimate: 0,
      test: {
        test: "non-inferiority z-test (no test-suite signal)",
        statistic: 0,
        pValue: 1,
        reject: false,
        alpha: margins.alpha,
        detail: { note: "no sessions ran a test suite under both arms" },
      },
    };
  }
  const ni = nonInferiorityProportion({
    treatmentSuccesses: treatmentSucc,
    treatmentN: n,
    controlSuccesses: controlSucc,
    controlN: n,
    margin: margins.testPassRate,
    alpha: margins.alpha,
  });
  return {
    metric: "testPassRate",
    nonInferior: ni.reject,
    effectiveN: n,
    controlEstimate: controlSucc / n,
    treatmentEstimate: treatmentSucc / n,
    test: ni,
  };
}

/** McNemar paired sanity check for AR, exposed for reporting. */
export function acceptanceRateMcNemar(pairs: PairedSession[]): TestResult {
  // b: control accepted, treatment rejected; c: control rejected, treatment accepted.
  let b = 0;
  let c = 0;
  for (const p of pairs) {
    if (p.control.accepted && !p.treatment.accepted) b++;
    else if (!p.control.accepted && p.treatment.accepted) c++;
  }
  return mcnemarTest(b, c);
}
