/**
 * Retry-vs-Reframe Advisor  (F5)
 * ==============================
 * When the user rejects an AI attempt, the reflex is to retry the same approach.
 * But a naive retry that keeps failing is the most expensive thing an agent
 * does (it re-pays the whole turn for the same low success odds). Often a cheap
 * REFRAME — a different framing assembled from history — has a better cost-per-
 * success. This advisor prices the two at the moment of rejection.
 *
 * `adviseRetryVsReframe(options)` is a PURE function. The decision is EXPECTED
 * COST PER SUCCESS = cost / P(success): the dollars it takes, in expectation, to
 * land one accepted result down each path. Lower wins.
 *
 * THE DISCIPLINE (no model in the decision): both the cost and the success
 * PRIOR are CALLER-FED — the host derives P(success) from history (F1 utility,
 * F11 accept rates) and the cost from the tokenizer/pricing. This package only
 * does the expected-value arithmetic. Fail-safe: a missing cost or prior ⇒
 * recommend RETRY (the known path), never a fabricated comparison. No regex.
 */

// ============================================================================
// Types
// ============================================================================

export interface PathPrior {
  /** USD cost to run this path once. null ⇒ unknown. */
  costUsd: number | null;
  /** Caller-estimated P(this path yields an accepted result), in (0,1]. null ⇒ unknown. */
  successProb: number | null;
}

export interface AdviseOptions {
  retry: PathPrior;
  reframe: PathPrior;
  /**
   * Minimum fractional advantage the reframe must show to be recommended over a
   * retry (hysteresis so a coin-flip doesn't flip the default). Default 0 — any
   * strictly lower expected cost wins.
   */
  margin?: number;
}

export type Recommendation = "retry" | "reframe";

export interface AdviceReport {
  recommended: Recommendation;
  /** cost / successProb for each path; null when either input is missing/invalid. */
  retryExpectedCostUsd: number | null;
  reframeExpectedCostUsd: number | null;
  /** Fractional saving of the recommended reframe vs retry; null unless reframe wins on numbers. */
  expectedSavingFraction: number | null;
  reason:
    | "reframe-cheaper-per-success"
    | "retry-cheaper-or-equal"
    | "insufficient-data-default-retry";
}

// ============================================================================
// adviseRetryVsReframe
// ============================================================================

export function adviseRetryVsReframe(options: AdviseOptions): AdviceReport {
  const margin =
    options && typeof options.margin === "number" && Number.isFinite(options.margin) && options.margin >= 0
      ? options.margin
      : 0;

  const retryE = expectedCost(options?.retry);
  const reframeE = expectedCost(options?.reframe);

  // Either side unknown ⇒ we cannot honestly compare ⇒ stick with the known
  // path (retry). Never fabricate a comparison.
  if (retryE === null || reframeE === null) {
    return {
      recommended: "retry",
      retryExpectedCostUsd: retryE,
      reframeExpectedCostUsd: reframeE,
      expectedSavingFraction: null,
      reason: "insufficient-data-default-retry",
    };
  }

  // Reframe wins only if strictly cheaper per success by at least the margin.
  const winsBy = retryE > 0 ? (retryE - reframeE) / retryE : reframeE < retryE ? 1 : 0;
  if (reframeE < retryE && winsBy > margin) {
    return {
      recommended: "reframe",
      retryExpectedCostUsd: retryE,
      reframeExpectedCostUsd: reframeE,
      expectedSavingFraction: round(winsBy),
      reason: "reframe-cheaper-per-success",
    };
  }

  return {
    recommended: "retry",
    retryExpectedCostUsd: retryE,
    reframeExpectedCostUsd: reframeE,
    expectedSavingFraction: null,
    reason: "retry-cheaper-or-equal",
  };
}

// ============================================================================
// Helpers
// ============================================================================

/** Expected cost per success = cost / P(success). null when either is invalid. */
function expectedCost(p: PathPrior | undefined): number | null {
  if (!p) return null;
  const cost = typeof p.costUsd === "number" && Number.isFinite(p.costUsd) && p.costUsd >= 0 ? p.costUsd : null;
  const prob =
    typeof p.successProb === "number" && Number.isFinite(p.successProb) && p.successProb > 0 && p.successProb <= 1
      ? p.successProb
      : null;
  if (cost === null || prob === null) return null;
  return round(cost / prob);
}

function round(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
