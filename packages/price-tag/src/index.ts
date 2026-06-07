/**
 * @prune/price-tag (F14)
 *
 * Decision-time dual price tag + default-flip. Prices the chosen path against a
 * cheap-sufficient alternative and pre-selects the cheaper one only when it is
 * caller-proven equivalence-non-inferior. Honest pricing; never flips to an
 * unproven or unpriced path; never fabricates a saving.
 */

export {
  priceDecision,
  pathCostUsd,
  type DecisionPath,
  type PriceTagOptions,
  type Recommended,
  type PriceTagReport,
} from "./price-tag.js";
