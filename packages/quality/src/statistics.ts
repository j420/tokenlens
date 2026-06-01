/**
 * Hypothesis tests for the TCRP quality-preservation framework.
 *
 * Every TCRP feature must prove it does not degrade generated-code quality.
 * "Does not degrade" is operationalized as a one-sided NON-INFERIORITY test:
 * we do not need treatment to be *better*, only "not worse by more than a
 * pre-registered margin" at a stated significance level. This is the correct
 * frame — a superiority test would wrongly fail features that are quality-
 * neutral, and a plain equality test cannot bound the downside.
 *
 * Tests implemented (all derived from first principles, pinned to reference
 * values in statistics.test.ts):
 *   - mcnemarTest                  paired binary, exact + asymptotic
 *   - twoProportionZTest           independent proportions
 *   - nonInferiorityProportion     one-sided NI on a proportion (AR, TPR gate)
 *   - wilcoxonSignedRank           paired ordinal (PWED gate)
 *   - sampleSizeProportionNI       power-based n for the NI proportion test
 */

import {
  binomialTwoSidedP,
  chiSquareSf,
  normalCdf,
  normalQuantile,
} from "./distributions.js";

export interface TestResult {
  /** Human-readable name of the test performed. */
  test: string;
  /** The test statistic (z, chi-square, W, …). */
  statistic: number;
  /** The p-value for the stated alternative. */
  pValue: number;
  /** Whether the null was rejected at the supplied alpha. */
  reject: boolean;
  /** Alpha used for the decision. */
  alpha: number;
  /** Extra context (effect estimate, margin, etc.). */
  detail: Record<string, number | string>;
}

// ============================================================================
// McNemar's test — paired binary outcomes
// ============================================================================

/**
 * McNemar's test for paired binary data.
 *
 * Inputs are the two discordant cell counts of the 2×2 paired table:
 *   - `b`: pairs where control succeeded and treatment failed
 *   - `c`: pairs where control failed and treatment succeeded
 *
 * Concordant pairs (both succeed / both fail) carry no information about a
 * difference and are correctly ignored. Returns the exact binomial p-value
 * for small discordant totals (b + c < 25) and the continuity-corrected
 * chi-square approximation otherwise.
 */
export function mcnemarTest(b: number, c: number, alpha = 0.05): TestResult {
  if (b < 0 || c < 0 || !Number.isInteger(b) || !Number.isInteger(c)) {
    throw new Error("mcnemarTest: b and c must be non-negative integers");
  }
  const n = b + c;
  if (n === 0) {
    return {
      test: "McNemar (no discordant pairs)",
      statistic: 0,
      pValue: 1,
      reject: false,
      alpha,
      detail: { b, c, discordant: 0 },
    };
  }
  if (n < 25) {
    const p = binomialTwoSidedP(Math.min(b, c), n);
    return {
      test: "McNemar exact (binomial)",
      statistic: Math.min(b, c),
      pValue: p,
      reject: p < alpha,
      alpha,
      detail: { b, c, discordant: n },
    };
  }
  // Continuity-corrected chi-square with 1 df.
  const chi2 = Math.pow(Math.abs(b - c) - 1, 2) / n;
  const p = chiSquareSf(chi2, 1);
  return {
    test: "McNemar asymptotic (continuity-corrected χ²)",
    statistic: chi2,
    pValue: p,
    reject: p < alpha,
    alpha,
    detail: { b, c, discordant: n },
  };
}

// ============================================================================
// Two-proportion z-test — independent groups
// ============================================================================

export interface TwoProportionInput {
  successesA: number;
  nA: number;
  successesB: number;
  nB: number;
  alpha?: number;
  /** "two-sided" tests pA ≠ pB; "greater" tests pA > pB; "less" tests pA < pB. */
  alternative?: "two-sided" | "greater" | "less";
}

/**
 * Standard two-proportion z-test for independent samples (pooled variance
 * under H0: pA = pB).
 */
export function twoProportionZTest(input: TwoProportionInput): TestResult {
  const { successesA, nA, successesB, nB } = input;
  const alpha = input.alpha ?? 0.05;
  const alternative = input.alternative ?? "two-sided";
  if (nA <= 0 || nB <= 0) {
    throw new Error("twoProportionZTest: sample sizes must be positive");
  }
  const pA = successesA / nA;
  const pB = successesB / nB;
  const pPool = (successesA + successesB) / (nA + nB);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / nA + 1 / nB));
  const z = se === 0 ? 0 : (pA - pB) / se;
  const p = pValueFromZ(z, alternative);
  return {
    test: `two-proportion z-test (${alternative})`,
    statistic: z,
    pValue: p,
    reject: p < alpha,
    alpha,
    detail: { pA, pB, diff: pA - pB, se },
  };
}

// ============================================================================
// Non-inferiority test on a proportion difference
// ============================================================================

export interface NonInferiorityInput {
  /** Successes/total under the treatment (cost-reduced) arm. */
  treatmentSuccesses: number;
  treatmentN: number;
  /** Successes/total under the control (status-quo) arm. */
  controlSuccesses: number;
  controlN: number;
  /**
   * Non-inferiority margin (absolute, e.g. 0.01 for "1 percentage point").
   * The treatment is declared non-inferior when its true rate is no worse
   * than control − margin.
   */
  margin: number;
  alpha?: number;
}

/**
 * One-sided non-inferiority test for two independent proportions.
 *
 * H0 (inferiority):     p_treatment ≤ p_control − margin
 * H1 (non-inferiority): p_treatment >  p_control − margin
 *
 * Reject H0 (conclude non-inferiority) when the lower one-sided z exceeds the
 * critical value. This is the gate the plan applies to Acceptance Rate (AR,
 * margin 1pp) and Test-Pass Rate (TPR, margin 0.5pp). Unpooled SE is used
 * because under H1 the two proportions are not assumed equal.
 */
export function nonInferiorityProportion(
  input: NonInferiorityInput
): TestResult {
  const { treatmentN, controlN, margin } = input;
  const alpha = input.alpha ?? 0.05;
  if (treatmentN <= 0 || controlN <= 0) {
    throw new Error("nonInferiorityProportion: sample sizes must be positive");
  }
  if (margin < 0) {
    throw new Error("nonInferiorityProportion: margin must be ≥ 0");
  }
  const pT = input.treatmentSuccesses / treatmentN;
  const pC = input.controlSuccesses / controlN;
  // Test the shifted difference d = (pT - pC) + margin against 0.
  const diff = pT - pC + margin;
  const se = Math.sqrt(
    (pT * (1 - pT)) / treatmentN + (pC * (1 - pC)) / controlN
  );
  const z = se === 0 ? (diff > 0 ? Infinity : 0) : diff / se;
  // One-sided: reject inferiority when z is large positive.
  const p = pValueFromZ(z, "greater");
  return {
    test: "non-inferiority z-test (one-sided, unpooled)",
    statistic: z,
    pValue: p,
    reject: p < alpha,
    alpha,
    detail: {
      pTreatment: pT,
      pControl: pC,
      observedDiff: pT - pC,
      margin,
      shiftedDiff: diff,
      se,
    },
  };
}

// ============================================================================
// Wilcoxon signed-rank test — paired ordinal/continuous
// ============================================================================

/**
 * Wilcoxon signed-rank test on paired differences (e.g. PWED: per-pair
 * treatment−control edit distance). Normal approximation with tie correction
 * and continuity correction. Zero differences are dropped (Wilcoxon's
 * original handling).
 *
 * `alternative`:
 *   - "less"      → median difference < 0 (treatment edit-distance lower; good)
 *   - "greater"   → median difference > 0
 *   - "two-sided" → median difference ≠ 0
 */
export function wilcoxonSignedRank(
  differences: number[],
  alternative: "two-sided" | "greater" | "less" = "two-sided",
  alpha = 0.05
): TestResult {
  const nonzero = differences.filter((d) => d !== 0);
  const n = nonzero.length;
  if (n === 0) {
    return {
      test: "Wilcoxon signed-rank (all zero differences)",
      statistic: 0,
      pValue: 1,
      reject: false,
      alpha,
      detail: { n: 0 },
    };
  }
  // Rank absolute differences, averaging ties.
  const ranked = nonzero
    .map((d, i) => ({ abs: Math.abs(d), sign: Math.sign(d), i }))
    .sort((a, b) => a.abs - b.abs);
  const ranks = new Array<number>(n);
  let i = 0;
  let tieCorrection = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && ranked[j + 1].abs === ranked[i].abs) j++;
    const avgRank = (i + j) / 2 + 1; // 1-based average rank
    const tieSize = j - i + 1;
    if (tieSize > 1) tieCorrection += tieSize ** 3 - tieSize;
    for (let k = i; k <= j; k++) ranks[k] = avgRank;
    i = j + 1;
  }
  let wPlus = 0;
  let wMinus = 0;
  for (let k = 0; k < n; k++) {
    if (ranked[k].sign > 0) wPlus += ranks[k];
    else wMinus += ranks[k];
  }
  const W = Math.min(wPlus, wMinus);
  const meanW = (n * (n + 1)) / 4;
  const varW = (n * (n + 1) * (2 * n + 1)) / 24 - tieCorrection / 48;
  if (varW <= 0) {
    return {
      test: "Wilcoxon signed-rank (degenerate variance)",
      statistic: W,
      pValue: 1,
      reject: false,
      alpha,
      detail: { n, wPlus, wMinus },
    };
  }
  // Use the directional statistic (wPlus) for one-sided alternatives.
  const stat = alternative === "two-sided" ? W : wPlus;
  const cc = 0.5; // continuity correction
  let z: number;
  if (alternative === "two-sided") {
    z = (Math.abs(W - meanW) - cc) / Math.sqrt(varW);
    const p = 2 * (1 - normalCdf(Math.abs(z)));
    return {
      test: "Wilcoxon signed-rank (normal approx, two-sided)",
      statistic: W,
      pValue: Math.min(1, p),
      reject: Math.min(1, p) < alpha,
      alpha,
      detail: { n, wPlus, wMinus, z: -z },
    };
  }
  // One-sided: large wPlus ⇒ differences tend positive.
  z = (wPlus - meanW + (wPlus < meanW ? cc : -cc)) / Math.sqrt(varW);
  const p =
    alternative === "greater" ? 1 - normalCdf(z) : normalCdf(z);
  return {
    test: `Wilcoxon signed-rank (normal approx, ${alternative})`,
    statistic: stat,
    pValue: Math.min(1, Math.max(0, p)),
    reject: Math.min(1, Math.max(0, p)) < alpha,
    alpha,
    detail: { n, wPlus, wMinus, z },
  };
}

// ============================================================================
// Sample-size planning
// ============================================================================

export interface SampleSizeInput {
  /** Pooled/assumed baseline success proportion (p̄). */
  baselineProportion: number;
  /** Non-inferiority margin δ (absolute). */
  margin: number;
  /** One-sided significance level. */
  alpha?: number;
  /** Desired power (1 − β). */
  power?: number;
}

export interface SampleSizeResult {
  /** Required sample size PER ARM, rounded up. */
  nPerArm: number;
  /** Total across both arms. */
  nTotal: number;
  zAlpha: number;
  zBeta: number;
  detail: Record<string, number>;
}

/**
 * Sample size per arm for the one-sided non-inferiority proportion test.
 *
 *   n = (z_{1-α} + z_{1-β})² · 2·p̄·(1−p̄) / δ²
 *
 * This is the textbook normal-approximation formula for two equal-sized arms
 * under the worst-case-equal-variance assumption. We compute it from first
 * principles rather than hard-coding any target so callers can see exactly
 * what their chosen (p̄, δ, α, power) imply.
 *
 * NOTE on the plan's "n ≥ 1936": with exact z-values the formula yields 1913
 * per arm for δ = 0.04 (4pp), α=0.05 one-sided, power=0.80, p̄=0.55 (the plan's
 * 1936 used rounded z-values). A 2pp margin under the same assumptions
 * requires ~7652/arm. The real number is computed here rather than hard-coded
 * — callers pick the margin they can actually fund.
 */
export function sampleSizeProportionNI(
  input: SampleSizeInput
): SampleSizeResult {
  const p = input.baselineProportion;
  const delta = input.margin;
  const alpha = input.alpha ?? 0.05;
  const power = input.power ?? 0.8;
  if (p <= 0 || p >= 1) {
    throw new Error("sampleSizeProportionNI: baselineProportion must be in (0,1)");
  }
  if (delta <= 0) {
    throw new Error("sampleSizeProportionNI: margin must be > 0");
  }
  const zAlpha = normalQuantile(1 - alpha);
  const zBeta = normalQuantile(power);
  const variance = 2 * p * (1 - p);
  const nPerArm = Math.ceil(((zAlpha + zBeta) ** 2 * variance) / delta ** 2);
  return {
    nPerArm,
    nTotal: nPerArm * 2,
    zAlpha,
    zBeta,
    detail: { baselineProportion: p, margin: delta, alpha, power, variance },
  };
}

// ============================================================================
// internal
// ============================================================================

function pValueFromZ(
  z: number,
  alternative: "two-sided" | "greater" | "less"
): number {
  if (alternative === "greater") return 1 - normalCdf(z);
  if (alternative === "less") return normalCdf(z);
  return Math.min(1, 2 * (1 - normalCdf(Math.abs(z))));
}
