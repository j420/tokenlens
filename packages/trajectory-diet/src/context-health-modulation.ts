/**
 * F1 v2 — Context-Health-Aware Advisor Modulation.
 *
 * When the upstream `@prune/context-health` (F6) reports a non-healthy
 * regime, the F1 advisor's behavior must change:
 *
 *  - "warning"   ⇒ raise the confidence threshold (more conservative; we
 *                  emit fewer advisories so the user sees less noise
 *                  while their context is already degrading)
 *  - "critical"  ⇒ raise it further AND drop the redundancy requirement
 *                  (any low-influence step is fair game to skip; the
 *                  user is in the coherence-cliff zone and every token
 *                  reclaimed is high-value)
 *  - "healthy" / "insufficient_data" ⇒ baseline behavior (no change)
 *
 * The modulation is a PURE FUNCTION of the F6 regime + the baseline
 * advisor options. No reaching back into context-health internals; the
 * regime is the only signal that crosses the boundary.
 *
 * This is the "graceful degradation" (iv) lever from Phase 7 P7.2: the
 * two features COMPOUND. F1 alone is a conservative diet; F1 + F6
 * tightens the diet as context fullness rises.
 */

import type { AdvisorOptions } from "./advisor.js";

/**
 * The minimum subset of @prune/context-health's regime we depend on.
 * We don't import the package — that would create a hard dep cycle if
 * context-health ever wants to call trajectory-diet. Caller passes the
 * literal regime string.
 */
export type ContextHealthRegime =
  | "healthy"
  | "warning"
  | "critical"
  | "insufficient_data";

/**
 * Per-regime multipliers + flag overrides. Pinned. Changing these
 * requires re-running the F1 NI gate on the replay corpus.
 *
 *  threshold_warning   = baseline × 1.5   (more conservative)
 *  threshold_critical  = baseline × 2.5   (much more conservative)
 *  redundancy_required is dropped in critical only.
 *
 * Rationale: we want F1 to fire LESS often when context-health is
 * warning (avoid piling more noise on a user already getting f6
 * warnings); but in critical, every reclaimed token has outsized
 * value, so we relax the "must be redundant" gate while keeping the
 * higher score-confidence threshold.
 *
 * Numerical safety: the multiplied threshold is clamped to ≤ 0.5 so
 * we never advise against a step the model thinks is ≥50% likely to
 * be influential — that ceiling is invariant regardless of regime.
 */
export const REGIME_MODULATION = {
  healthy: { thresholdMultiplier: 1, requireRedundancyOverride: null as boolean | null },
  insufficient_data: { thresholdMultiplier: 1, requireRedundancyOverride: null },
  warning: { thresholdMultiplier: 1.5, requireRedundancyOverride: null },
  critical: { thresholdMultiplier: 2.5, requireRedundancyOverride: false },
} as const;

/** Hard ceiling — never advise skipping when the model's score is ≥ this. */
export const THRESHOLD_CEILING = 0.5;

const BASELINE_THRESHOLD = 0.15;

/**
 * Compute the effective AdvisorOptions for the given regime + baseline.
 * Pure — no side effects, deterministic.
 *
 * NaN-safe: a non-finite baseline threshold (NaN / Infinity) is mapped
 * to the hard ceiling so the advisor still has a well-defined behavior.
 */
export function modulateAdvisorOptions(
  baseline: AdvisorOptions | undefined,
  regime: ContextHealthRegime
): Required<AdvisorOptions> {
  const baselineThresholdRaw = baseline?.confidenceThreshold ?? BASELINE_THRESHOLD;
  const baselineThreshold = Number.isFinite(baselineThresholdRaw)
    ? (baselineThresholdRaw as number)
    : THRESHOLD_CEILING;
  const baselineRedundancy = baseline?.requireRedundancySignal ?? true;
  const mod = REGIME_MODULATION[regime] ?? REGIME_MODULATION.healthy;

  const raised = baselineThreshold * mod.thresholdMultiplier;
  const finiteRaised = Number.isFinite(raised) ? raised : THRESHOLD_CEILING;
  const clamped = Math.min(THRESHOLD_CEILING, Math.max(0, finiteRaised));

  return {
    confidenceThreshold: clamped,
    requireRedundancySignal:
      mod.requireRedundancyOverride === null
        ? baselineRedundancy
        : mod.requireRedundancyOverride,
  };
}
