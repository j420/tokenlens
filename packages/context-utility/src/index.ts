/**
 * @prune/context-utility (F1 — Context-Utility Model)
 *
 * Standing, outcome-learned per-atom utility store. Decayed Beta-Binomial
 * empirical-Bayes over caller-supplied contribution verdicts; pure and
 * deterministic; cold-start / unknown atoms return null (selectors run
 * unchanged). The substrate the Phase-2/3 selectors query for a prior.
 */

export {
  emptyCumState,
  updateUtility,
  queryUtility,
  rankAtoms,
  type UtilityObservation,
  type AtomStat,
  type CumState,
  type UpdateOptions,
  type QueryOptions,
  type UtilityEstimate,
  type RankedAtom,
} from "./cum.js";
