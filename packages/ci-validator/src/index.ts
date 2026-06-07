/**
 * @prune/ci-validator (F6)
 *
 * CI red->green transitions as ground truth for which context atoms fix a
 * failure class. Caller-fed CI verdict; pure Beta-Binomial fix-association;
 * inert (null) with no CI signal. No model call, no regex.
 */

export {
  emptyCiState,
  recordFixEpisode,
  queryFixAssociation,
  rankFixContext,
  type FixCounter,
  type CiState,
  type FixEpisode,
  type QueryOptions,
  type FixAssociation,
  type RankedFixAtom,
} from "./validator.js";
