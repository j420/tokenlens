/**
 * @prune/observation-mask — F15, Observation Masking + Belady eviction.
 *
 * Public surface:
 *   - planMask(observations, config) → the deterministic mask plan
 *   - beladyEvictionOrder(candidates, currentTurn) → eviction ordering
 *   - placeholderFor(obs) → the deterministic placeholder string
 *
 * Pure (math + content hashes), fail-safe by construction (no I/O), never calls
 * a model or fabricates a token count.
 */

export * from "./types.js";
export { DEFAULT_PLACEHOLDER_TOKENS, DEFAULT_WINDOW_TURNS } from "./constants.js";
export { planMask } from "./mask.js";
export { beladyEvictionOrder } from "./belady.js";
export { placeholderFor } from "./placeholder.js";
