/**
 * Cache-Hit Reconciliation  (U3)
 * ==============================
 * Cache planning is open-loop: a planner predicts the prefix will be re-read N
 * times and pays the cache-write multiplier up front. But did the reads
 * actually happen? The provider reports the truth — `cache_read_input_tokens`
 * in the turn usage. This closes the loop: it reconciles the PREDICTED cache
 * reads against the REALIZED ones and flags when a paid cache-write
 * under-performed, so the write multiplier wasn't recouped (a stranded write).
 *
 * `reconcileCacheHits(input, options?)` is a PURE comparison. Both the predicted
 * value (from the planner) and the realized value (from `usage`) are
 * CALLER-SUPPLIED; this never measures or fabricates. `insufficient_signal`
 * when either side is unknown. No regex, no model.
 */

// ============================================================================
// Types
// ============================================================================

export interface ReconcileInput {
  /** Cache-read tokens the planner PREDICTED would be served. null ⇒ unknown. */
  predictedCacheReadTokens: number | null;
  /** Cache-read tokens the provider REALLY served (usage.cache_read_input_tokens). null ⇒ unknown. */
  realizedCacheReadTokens: number | null;
  /**
   * Cache-WRITE tokens paid up front (at the write multiplier). When given and
   * the cache under-performed, the under-served fraction is reported as a
   * stranded write. Optional.
   */
  cacheWriteTokens?: number;
}

export interface ReconcileOptions {
  /**
   * Fractional tolerance: realized must be at least predicted·(1−tolerance) to
   * be "on-target". Default 0.2 (20%).
   */
  tolerance?: number;
}

export interface ReconcileReport {
  /**
   * "on-target"        — realized within tolerance of predicted (or better).
   * "over-performing"  — realized materially exceeded predicted.
   * "underperforming"  — realized fell short beyond tolerance (stranded write risk).
   * "insufficient_signal" — predicted/realized unknown, or predicted == 0.
   */
  verdict: "on-target" | "over-performing" | "underperforming" | "insufficient_signal";
  predictedCacheReadTokens: number | null;
  realizedCacheReadTokens: number | null;
  /** realized − predicted (negative ⇒ short); null when unknown. */
  driftTokens: number | null;
  /** realized / predicted in [0,∞); null when unknown / predicted 0. */
  hitRatio: number | null;
  /** Write tokens that did not pay off, when under-performing and a write is given; else 0. */
  strandedWriteTokens: number;
}

// ============================================================================
// reconcileCacheHits
// ============================================================================

export function reconcileCacheHits(input: unknown, options: ReconcileOptions = {}): ReconcileReport {
  const tolerance = unit(options.tolerance, 0.2);
  const i = (input ?? {}) as Partial<ReconcileInput>;

  const predicted = finiteNonNeg(i.predictedCacheReadTokens);
  const realized = finiteNonNeg(i.realizedCacheReadTokens);
  const write = finiteNonNeg(i.cacheWriteTokens) ?? 0;

  if (predicted === null || realized === null || predicted === 0) {
    return {
      verdict: "insufficient_signal",
      predictedCacheReadTokens: predicted,
      realizedCacheReadTokens: realized,
      driftTokens: predicted !== null && realized !== null ? realized - predicted : null,
      hitRatio: null,
      strandedWriteTokens: 0,
    };
  }

  const hitRatio = realized / predicted;
  const drift = realized - predicted;
  let verdict: ReconcileReport["verdict"];
  let stranded = 0;
  if (hitRatio < 1 - tolerance) {
    verdict = "underperforming";
    stranded = write > 0 ? round(write * Math.min(1, 1 - hitRatio)) : 0;
  } else if (hitRatio > 1 + tolerance) {
    verdict = "over-performing";
  } else {
    verdict = "on-target";
  }

  return {
    verdict,
    predictedCacheReadTokens: predicted,
    realizedCacheReadTokens: realized,
    driftTokens: drift,
    hitRatio: round(hitRatio),
    strandedWriteTokens: stranded,
  };
}

// ============================================================================
// Helpers
// ============================================================================

/** A finite, non-negative number, or null when missing/invalid. */
function finiteNonNeg(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

function unit(v: unknown, dflt: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 1 ? v : dflt;
}

function round(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
