/**
 * F1 — Trajectory Diet: influence model.
 *
 * The model answers: P(this step influenced the final output). A LOW score
 * means the step looks safely skippable; the advisor only fires when the score
 * is below a conservative threshold.
 *
 * SHIPPING HONESTY. The plan specifies a gradient-boosted model trained on a
 * dogfood corpus and exported to ONNX. That corpus does not exist yet, so this
 * file ships a TRANSPARENT, EXPLAINABLE logistic baseline (v0) with documented,
 * hand-set weights grounded in the feature semantics — NOT a fabricated
 * "trained" model with invented accuracy numbers. The InfluenceModel interface
 * lets a trained model drop in later with no change to the advisor.
 *
 * Operational consequence: until a trained model is validated against real
 * influence labels, F1 runs in SHADOW (predictions recorded, never surfaced),
 * exactly as the promotion gates require. The transparent baseline is good
 * enough to collect calibration data and to be auditable line-by-line.
 */

import type { StepFeatures } from "./feature-extractor.js";

export interface InfluenceModel {
  readonly name: string;
  readonly version: string;
  /** P(step influenced the final output), in [0,1]. */
  score(features: StepFeatures): number;
}

/**
 * Transparent logistic baseline. Every weight is explainable:
 *
 *   logit = bias
 *         + W_util     · priorOutputUtilization   (used downstream ⇒ influential)
 *         + W_novelty  · targetFileNovelty         (first touch ⇒ more likely useful)
 *         + W_intent   · intentClassMatch          (aligned with the task)
 *         - W_sim      · inputSimilarityToPrior    (redundant with a prior step)
 *         + W_costlog  · log1p(stepTokenCost)/10   (substantial results matter more)
 *
 * Calibrated by construction so that:
 *   - a redundant re-read (sim≈0.9, novelty≈0.1, util≈0) scores < 0.15
 *   - a novel, downstream-used step scores > 0.5
 * Verified by tests rather than asserted.
 */
export class TransparentInfluenceModel implements InfluenceModel {
  readonly name = "transparent-logistic";
  readonly version = "v0";

  // Weights are public for auditability.
  static readonly WEIGHTS = {
    bias: -0.4,
    utilization: 3.2,
    novelty: 1.4,
    intent: 0.8,
    similarity: 3.6,
    costLog: 0.6,
  };

  score(f: StepFeatures): number {
    const W = TransparentInfluenceModel.WEIGHTS;
    const costSignal = Math.log1p(Math.max(0, f.stepTokenCost)) / 10;
    const logit =
      W.bias +
      W.utilization * f.priorOutputUtilization +
      W.novelty * f.targetFileNovelty +
      W.intent * f.intentClassMatch -
      W.similarity * f.inputSimilarityToPrior +
      W.costLog * costSignal;
    return sigmoid(logit);
  }
}

/**
 * Adapter for a future trained model. Given a scoring function (e.g. an ONNX
 * inference closure), wrap it as an InfluenceModel. Kept here so the call sites
 * never branch on "trained vs baseline".
 */
export class FunctionInfluenceModel implements InfluenceModel {
  constructor(
    readonly name: string,
    readonly version: string,
    private readonly fn: (f: StepFeatures) => number
  ) {}
  score(f: StepFeatures): number {
    const s = this.fn(f);
    // Clamp defensively — a model must never return out of [0,1].
    return Math.max(0, Math.min(1, s));
  }
}

function sigmoid(x: number): number {
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1 / (1 + z);
  }
  const z = Math.exp(x);
  return z / (1 + z);
}
