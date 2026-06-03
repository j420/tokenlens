/**
 * @prune/quality
 *
 * The statistical backbone of the Token-Cost Reduction Program. Provides the
 * non-inferiority tests and the three-metric quality gate that prove a
 * cost-reduction feature does not degrade generated-code quality.
 *
 * Nothing here collects data or talks to a model — it consumes already-paired
 * observations and returns verdicts. That separation keeps the credibility
 * surface small and fully unit-testable.
 */

export * from "./distributions.js";
export * from "./statistics.js";
export * from "./metrics.js";
