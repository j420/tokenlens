/**
 * F1 — Trajectory Diet: advisor + offline analysis.
 *
 * Turns influence predictions into ADVISORIES. The advisor never skips a step
 * itself — it surfaces a suggestion the agent is free to ignore. This is a
 * deliberate, stronger-than-the-paper safety choice: AgentDiet permits
 * automatic skipping; we do not, so a wrong prediction can at most produce an
 * ignorable hint, never a changed output.
 */

import { equivalent, type EquivalenceOptions } from "@prune/equivalence";
import type { StepFeatures } from "./feature-extractor.js";
import type { InfluenceModel } from "./influence-model.js";

export interface AdvisorOptions {
  /**
   * Fire an advisory only when P(influential) is below this. Low by design
   * (default 0.15) — we advise only when confident the step won't matter.
   */
  confidenceThreshold?: number;
  /**
   * Extra conservatism: also require the step to look redundant — high input
   * similarity to a prior step OR low file novelty. Prevents advising against
   * a genuinely novel-but-low-scored step. Default true.
   */
  requireRedundancySignal?: boolean;
}

export interface StepAdvisory {
  stepIndex: number;
  turnNumber: number;
  toolName: string;
  target: string | null;
  predictedInfluence: number;
  /** Model confidence that the step is non-influential, = 1 − score. */
  confidence: number;
  projectedTokensSaved: number;
  message: string;
}

const DEFAULTS: Required<AdvisorOptions> = {
  confidenceThreshold: 0.15,
  requireRedundancySignal: true,
};

/**
 * Decide whether to advise skipping/narrowing a single step. Returns null when
 * no advisory is warranted (the common case).
 */
export function adviseStep(
  features: StepFeatures,
  model: InfluenceModel,
  options: AdvisorOptions = {}
): StepAdvisory | null {
  const opts = { ...DEFAULTS, ...options };
  const score = model.score(features);
  if (score >= opts.confidenceThreshold) return null;

  if (opts.requireRedundancySignal) {
    const redundant =
      features.inputSimilarityToPrior >= 0.6 ||
      features.targetFileNovelty <= 0.34; // ≥2 prior touches
    if (!redundant) return null;
  }

  return {
    stepIndex: features.stepIndex,
    turnNumber: features.turnNumber,
    toolName: features.toolName,
    target: features.target,
    predictedInfluence: round(score),
    confidence: round(1 - score),
    projectedTokensSaved: features.stepTokenCost,
    message: buildMessage(features, score),
  };
}

export interface TrajectorySummary {
  totalSteps: number;
  lowInfluenceSteps: number;
  /** Fraction of steps that would receive an advisory. */
  dietableFraction: number;
  /** Sum of stepTokenCost over advisory steps. */
  projectedTokensSaved: number;
  /** Sum of stepTokenCost over ALL steps (for a savings ratio). */
  totalStepTokens: number;
  advisories: StepAdvisory[];
  modelName: string;
  modelVersion: string;
}

/**
 * Offline analysis of a full trajectory: which steps the model would advise
 * against, and the projected token savings. Used by the shadow harness to
 * collect predicted-vs-realized data.
 */
export function summarizeTrajectory(
  features: StepFeatures[],
  model: InfluenceModel,
  options: AdvisorOptions = {}
): TrajectorySummary {
  const advisories: StepAdvisory[] = [];
  let totalStepTokens = 0;
  for (const f of features) {
    totalStepTokens += f.stepTokenCost;
    const a = adviseStep(f, model, options);
    if (a) advisories.push(a);
  }
  const projectedTokensSaved = advisories.reduce(
    (s, a) => s + a.projectedTokensSaved,
    0
  );
  return {
    totalSteps: features.length,
    lowInfluenceSteps: advisories.length,
    dietableFraction:
      features.length > 0 ? advisories.length / features.length : 0,
    projectedTokensSaved,
    totalStepTokens,
    advisories,
    modelName: model.name,
    modelVersion: model.version,
  };
}

/**
 * Validation primitive for the shadow/replay harness: is the dieted final
 * output equivalent to the original? Delegates to @prune/equivalence. The diet
 * is only ever considered safe when this returns equivalent=true.
 */
export function finalOutputEquivalent(
  originalFinalOutput: string,
  dietedFinalOutput: string,
  options?: EquivalenceOptions
): { equivalent: boolean; similarity: number; strategy: string } {
  const r = equivalent(originalFinalOutput, dietedFinalOutput, options);
  return { equivalent: r.equivalent, similarity: r.similarity, strategy: r.strategy };
}

function buildMessage(features: StepFeatures, score: number): string {
  const conf = Math.round((1 - score) * 100);
  const what = features.target ? ` (${features.target})` : "";
  return (
    `TokenLens advisory: this ${features.toolName} step${what} resembles ` +
    `earlier low-influence lookups (model confidence ${conf}% it won't affect ` +
    `the final output). Consider skipping or narrowing. ` +
    `~${features.stepTokenCost} tokens projected to save.`
  );
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}
