/**
 * @prune/bounty (F17)
 *
 * Cheapest-context bounty: among submissions that pass a caller-fed frozen
 * quality gate, deterministically select the minimum-cost one (USD when all
 * priced, else tokens). Honest savings vs a caller-supplied incumbent.
 */

export {
  evaluateBounty,
  type BountySubmission,
  type BountyOptions,
  type RankedSubmission,
  type BountyResult,
} from "./bounty.js";
