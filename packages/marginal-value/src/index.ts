/**
 * @prune/marginal-value (F8)
 *
 * Turns caller-fed counterfactual equivalence verdicts into a zero-value-chunk
 * waste accounting and F1-shaped contribution observations. Deterministic set
 * arithmetic; no model call, no regex.
 */

export {
  assessMarginalValue,
  type ChunkVerdict,
  type AssessOptions,
  type ContributionObservation,
  type MarginalValueReport,
} from "./probe.js";
