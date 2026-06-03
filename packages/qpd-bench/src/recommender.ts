/**
 * F4 — recommender.
 *
 * Given per-model aggregates for one workload cluster and the current
 * (baseline) model, decide which cheaper models — if any — are safe to
 * recommend. A model is recommendable ONLY when:
 *
 *   1. AR non-inferior:  treatment acceptance ≥ baseline − arMargin (1pp), p<α
 *   2. TPR non-inferior: treatment test-pass ≥ baseline − tprMargin (0.5pp), p<α
 *      (skipped only when NEITHER arm produced test signal; if baseline has
 *       tests and candidate doesn't, that's a fail — no evidence of safety)
 *   3. Cost dominance:   candidate meanCost ≤ costDominanceRatio × baseline
 *
 * We NEVER silently route. The output is a ranked set of recommendations with
 * full statistical detail for the trust UX; the user picks. When nothing
 * passes, the recommendation is to stay on the baseline.
 */

import { nonInferiorityProportion, type TestResult } from "@prune/quality";
import type { ModelAggregate } from "./scoring.js";

export interface RecommenderOptions {
  /** AR non-inferiority margin (absolute). Default 0.05 (5pp) — see note. */
  arMargin?: number;
  /** TPR non-inferiority margin (absolute). Default 0.03 (3pp) — see note. */
  tprMargin?: number;
  /** Significance level (one-sided). Default 0.05. */
  alpha?: number;
  /** Candidate cost must be ≤ this × baseline cost. Default 0.7. */
  costDominanceRatio?: number;
  /** Minimum samples per arm before a recommendation is allowed. Default 30. */
  minSamples?: number;
}

/**
 * TWO-TIER MARGIN DESIGN (important, surfaced not hidden).
 *
 * The bench uses a COARSER non-inferiority margin (5pp AR / 3pp TPR) than the
 * production quality framework in @prune/quality (1pp / 0.5pp). This is
 * deliberate and necessary: proving non-inferiority at a 1pp margin requires
 * ~7,600 paired samples per arm, but a per-workload bench cluster has tens to
 * a few hundred samples. A 1pp gate would make the bench unable to recommend
 * ANYTHING, regardless of how good a cheaper tier is.
 *
 * So the bench is a SCREENING instrument: "is this cheaper tier clearly good
 * enough to try?" The fine 1pp gate then runs CONTINUOUSLY on real traffic
 * after a switch (the quality framework), and auto-rolls-back if the tighter
 * bar is violated. Coarse screen → switch → fine continuous monitor.
 */

export interface GateOutcome {
  passed: boolean;
  detail: string;
}

export interface ModelRecommendation {
  model: string;
  recommended: boolean;
  baselineModel: string;
  costRatio: number;
  projectedSavingsPct: number;
  arGate: GateOutcome & { test: TestResult };
  tprGate: GateOutcome & { test?: TestResult };
  costGate: GateOutcome;
  sampleSizeGate: GateOutcome;
  /** Relative quality-per-dollar vs baseline (baseline = 1.0). */
  qpdRelative: number;
  candidate: ModelAggregate;
}

export interface ClusterRecommendation {
  clusterId: string;
  baselineModel: string;
  /** Sorted best-first; only entries with recommended=true are safe. */
  recommendations: ModelRecommendation[];
  /** The single best safe recommendation, or null to stay on baseline. */
  best: ModelRecommendation | null;
}

const DEFAULTS: Required<RecommenderOptions> = {
  // Coarse screening margins — see the TWO-TIER MARGIN DESIGN note above.
  arMargin: 0.05,
  tprMargin: 0.03,
  alpha: 0.05,
  costDominanceRatio: 0.7,
  minSamples: 30,
};

export function recommendForCluster(
  baseline: ModelAggregate,
  candidates: ModelAggregate[],
  options: RecommenderOptions = {}
): ClusterRecommendation {
  // Coalesce per field rather than spread: an explicit `undefined` from a
  // caller (e.g. an MCP handler forwarding optional args) must NOT clobber a
  // default. `{...DEFAULTS, ...{arMargin: undefined}}` would yield undefined.
  const opts: Required<RecommenderOptions> = {
    arMargin: options.arMargin ?? DEFAULTS.arMargin,
    tprMargin: options.tprMargin ?? DEFAULTS.tprMargin,
    alpha: options.alpha ?? DEFAULTS.alpha,
    costDominanceRatio:
      options.costDominanceRatio ?? DEFAULTS.costDominanceRatio,
    minSamples: options.minSamples ?? DEFAULTS.minSamples,
  };
  const recommendations = candidates
    .filter((c) => c.model !== baseline.model)
    .map((candidate) => evaluateCandidate(baseline, candidate, opts))
    // Best first: recommended ones, then by relative QpD.
    .sort((a, b) => {
      if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
      return b.qpdRelative - a.qpdRelative;
    });

  const best = recommendations.find((r) => r.recommended) ?? null;
  return {
    clusterId: baseline.clusterId,
    baselineModel: baseline.model,
    recommendations,
    best,
  };
}

function evaluateCandidate(
  baseline: ModelAggregate,
  candidate: ModelAggregate,
  opts: Required<RecommenderOptions>
): ModelRecommendation {
  // --- sample-size gate ---
  const sampleSizeGate: GateOutcome = {
    passed: candidate.n >= opts.minSamples && baseline.n >= opts.minSamples,
    detail: `candidate n=${candidate.n}, baseline n=${baseline.n} (min ${opts.minSamples})`,
  };

  // --- AR non-inferiority ---
  const arTest = nonInferiorityProportion({
    treatmentSuccesses: candidate.acceptedCount,
    treatmentN: candidate.n,
    controlSuccesses: baseline.acceptedCount,
    controlN: baseline.n,
    margin: opts.arMargin,
    alpha: opts.alpha,
  });
  const arGate = {
    passed: arTest.reject,
    detail: `AR ${candidate.acceptanceRate.toFixed(3)} vs ${baseline.acceptanceRate.toFixed(3)} (margin ${opts.arMargin}, p=${arTest.pValue.toFixed(4)})`,
    test: arTest,
  };

  // --- TPR non-inferiority ---
  const tprGate = evaluateTprGate(baseline, candidate, opts);

  // --- cost dominance ---
  const costRatio =
    baseline.meanCost > 0 ? candidate.meanCost / baseline.meanCost : Infinity;
  const costGate: GateOutcome = {
    passed: costRatio <= opts.costDominanceRatio,
    detail: `cost ratio ${costRatio.toFixed(3)} (must be ≤ ${opts.costDominanceRatio})`,
  };

  const recommended =
    sampleSizeGate.passed &&
    arGate.passed &&
    tprGate.passed &&
    costGate.passed;

  // Relative QpD: (candidate AR / baseline AR) / (candidate cost / baseline cost).
  const arRatio =
    baseline.acceptanceRate > 0
      ? candidate.acceptanceRate / baseline.acceptanceRate
      : candidate.acceptanceRate > 0
        ? Infinity
        : 1;
  const qpdRelative = costRatio > 0 ? arRatio / costRatio : Infinity;

  return {
    model: candidate.model,
    recommended,
    baselineModel: baseline.model,
    costRatio,
    projectedSavingsPct: costRatio < Infinity ? (1 - costRatio) * 100 : 0,
    arGate,
    tprGate,
    costGate,
    sampleSizeGate,
    qpdRelative,
    candidate,
  };
}

function evaluateTprGate(
  baseline: ModelAggregate,
  candidate: ModelAggregate,
  opts: Required<RecommenderOptions>
): GateOutcome & { test?: TestResult } {
  const baselineHasTests = baseline.testN > 0;
  const candidateHasTests = candidate.testN > 0;

  if (!baselineHasTests && !candidateHasTests) {
    // Neither arm produced test signal — TPR gate is not applicable. We allow
    // it to pass so AR + cost still govern, matching the plan (TPR only gates
    // when a suite ran). This is NOT the same as the quality framework's
    // fail-closed: here AR provides the primary quality evidence.
    return {
      passed: true,
      detail: "no test signal in either arm — TPR gate not applicable",
    };
  }
  if (baselineHasTests && !candidateHasTests) {
    return {
      passed: false,
      detail: "baseline has test signal but candidate has none — cannot prove TPR non-inferiority",
    };
  }

  const test = nonInferiorityProportion({
    treatmentSuccesses: candidate.testPassedCount,
    treatmentN: candidate.testN,
    controlSuccesses: baseline.testPassedCount,
    controlN: Math.max(baseline.testN, 1),
    margin: opts.tprMargin,
    alpha: opts.alpha,
  });
  return {
    passed: test.reject,
    detail: `TPR ${(candidate.testPassRate ?? 0).toFixed(3)} vs ${(baseline.testPassRate ?? 0).toFixed(3)} (margin ${opts.tprMargin}, p=${test.pValue.toFixed(4)})`,
    test,
  };
}
