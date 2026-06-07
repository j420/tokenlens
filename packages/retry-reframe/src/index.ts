/**
 * @prune/retry-reframe (F5)
 *
 * At a rejection, advise retry vs reframe by expected cost-per-success
 * (cost / P(success)); caller-fed cost + success priors; deterministic
 * expected-value arithmetic; defaults to retry on missing data. No regex/model.
 */

export {
  adviseRetryVsReframe,
  type PathPrior,
  type AdviseOptions,
  type Recommendation,
  type AdviceReport,
} from "./advise.js";
