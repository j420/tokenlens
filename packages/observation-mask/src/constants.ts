/**
 * Tunable constants for the masking planner. Centralized so the defaults are
 * auditable and overridable per call.
 */

/**
 * Default placeholder token cost. A masked observation is replaced by a one-line
 * marker; 16 tokens is a conservative upper bound for that marker. Callers that
 * want exact reclaim figures pass a tokenizer-measured value via MaskConfig.
 */
export const DEFAULT_PLACEHOLDER_TOKENS = 16;

/**
 * Default sliding window (in turns). Observations older than this many turns
 * from the current turn are eligible for masking. Chosen to keep recent tool
 * results fully visible while bounding long-horizon accumulation.
 */
export const DEFAULT_WINDOW_TURNS = 6;
