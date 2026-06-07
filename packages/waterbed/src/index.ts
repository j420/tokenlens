/**
 * @prune/waterbed (F12)
 *
 * General induced-cost gate. Nets a transform's gross saving against its
 * overhead and every caller-supplied induced downstream cost, vetoing a
 * "saving" that merely reappears elsewhere. Fail-toward-veto on missing data.
 */

export {
  evaluateWaterbed,
  type InducedCost,
  type TransformEffect,
  type WaterbedOptions,
  type WaterbedVerdict,
  type WaterbedReport,
} from "./gate.js";
