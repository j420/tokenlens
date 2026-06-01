/**
 * F4 — scoring: turn raw bench executions into per-model quality/cost
 * aggregates.
 *
 * Quality is scored by comparing a candidate model's output to the user's own
 * ACCEPTED output for the same prompt, via @prune/equivalence. We never invent
 * a quality label — the reference is real accepted work. Acceptance is the
 * equivalence similarity passing a threshold; test-pass rate is carried
 * through when a suite ran.
 */

import { equivalent, type EquivalenceOptions } from "@prune/equivalence";

export interface BenchExecution {
  promptId: string;
  model: string;
  /** The candidate model's output for this prompt. */
  output: string;
  /** Realized cost of this execution (USD). */
  costUsd: number;
  /** Whether the downstream test suite passed, when one ran. */
  testPassed: boolean | null;
}

export interface ScoredSample {
  promptId: string;
  model: string;
  qualityScore: number; // [0,1]
  accepted: boolean;
  testPassed: boolean | null;
  costUsd: number;
}

export interface ScoringOptions {
  /** Equivalence similarity at/above which an output counts as accepted. */
  acceptanceThreshold?: number;
  equivalence?: EquivalenceOptions;
}

const DEFAULT_ACCEPTANCE = 0.85;

/**
 * Score one execution against the user's accepted reference output.
 */
export function scoreSample(
  execution: BenchExecution,
  referenceOutput: string,
  options: ScoringOptions = {}
): ScoredSample {
  const threshold = options.acceptanceThreshold ?? DEFAULT_ACCEPTANCE;
  const eq = equivalent(execution.output, referenceOutput, options.equivalence);
  // Exact/structural equivalence pins quality to 1; otherwise use the graded
  // similarity so near-misses are scored fairly.
  const qualityScore = eq.equivalent ? 1 : eq.similarity;
  return {
    promptId: execution.promptId,
    model: execution.model,
    qualityScore,
    accepted: qualityScore >= threshold,
    testPassed: execution.testPassed,
    costUsd: execution.costUsd,
  };
}

export interface ModelAggregate {
  model: string;
  clusterId: string;
  n: number;
  acceptedCount: number;
  acceptanceRate: number;
  /** Test-pass rate over samples that ran a suite; null if none did. */
  testPassRate: number | null;
  testN: number;
  testPassedCount: number;
  meanCost: number;
  totalCost: number;
  /** Raw quality-per-dollar = acceptanceRate / meanCost (∞-guarded). */
  qpdRaw: number;
}

/**
 * Aggregate scored samples for a single (cluster, model) into the stats the
 * recommender consumes.
 */
export function aggregateModel(
  clusterId: string,
  model: string,
  samples: ScoredSample[]
): ModelAggregate {
  const n = samples.length;
  const acceptedCount = samples.filter((s) => s.accepted).length;
  const withTests = samples.filter((s) => s.testPassed !== null);
  const testPassedCount = withTests.filter((s) => s.testPassed).length;
  const totalCost = samples.reduce((sum, s) => sum + s.costUsd, 0);
  const meanCost = n > 0 ? totalCost / n : 0;
  const acceptanceRate = n > 0 ? acceptedCount / n : 0;
  return {
    model,
    clusterId,
    n,
    acceptedCount,
    acceptanceRate,
    testPassRate: withTests.length > 0 ? testPassedCount / withTests.length : null,
    testN: withTests.length,
    testPassedCount,
    meanCost,
    totalCost,
    // Quality per dollar. No samples ⇒ no value delivered ⇒ 0 (not Infinity).
    // A genuinely free model that delivers quality is infinitely cost-
    // efficient, so that case stays Infinity.
    qpdRaw:
      n === 0
        ? 0
        : meanCost > 0
          ? acceptanceRate / meanCost
          : acceptanceRate > 0
            ? Infinity
            : 0,
  };
}
