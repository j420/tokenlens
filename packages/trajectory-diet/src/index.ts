/**
 * @prune/trajectory-diet (F1)
 *
 * Predicts which agent retrieval steps had low influence on the final output
 * and advises skipping similar steps. ADVISORY ONLY — never auto-skips, never
 * alters the agent's output. Ships a transparent influence baseline (v0) until
 * a trained model is validated against real influence labels (shadow gate).
 */

export * from "./feature-extractor.js";
export * from "./influence-model.js";
export * from "./advisor.js";
export * from "./context-health-modulation.js";
export * from "./replay-harness.js";
