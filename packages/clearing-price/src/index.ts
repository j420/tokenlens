/**
 * @prune/clearing-price — F18, the Token Clearing-Price Controller.
 *
 * Public surface:
 *   - initialState / updatePrice / quote → the PID price loop
 *   - shouldSpend(qualityGain, tokenCost, lambda) → the bid rule actuators call
 *   - DEFAULT_CONFIG
 *
 * Pure control math. A null/unknown price makes every consumer abstain (no-op),
 * so the controller never forces a change it cannot price. No regex, no model,
 * no fabricated tokens.
 */

export * from "./types.js";
export {
  DEFAULT_CONFIG,
  initialState,
  updatePrice,
  quote,
} from "./controller.js";
export { shouldSpend } from "./bid.js";
