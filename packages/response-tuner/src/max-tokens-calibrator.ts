/**
 * max_tokens Calibrator
 * ---------------------
 * Given caller-supplied OBSERVED output-token-count samples for a task class
 * (e.g. "the model's completions for code-review requests have historically been
 * these lengths"), recommend a `max_tokens` value that makes truncation rare
 * without over-reserving budget.
 *
 * The math is plain order statistics — no model, no fabrication:
 *
 *   recommended_raw = quantile(p) * (1 + safetyMargin)
 *   recommended     = ceilToBucket(recommended_raw, bucket)
 *
 * where `quantile(p)` is the NEAREST-RANK percentile of the cleaned sample set.
 *
 * Nearest-rank method (documented & deterministic):
 *   - Sort the n valid samples ascending: x[0] <= ... <= x[n-1].
 *   - For percentile p in [0,1], the ordinal rank is:
 *         rank = ceil(p * n)            (1-based), clamped to [1, n]
 *     and the quantile is x[rank - 1].
 *   - p = 0 maps to rank 1 (the minimum); p = 1 maps to rank n (the maximum).
 *   This is the classic "nearest-rank" estimator (no interpolation), so the
 *   result is always an actually-observed value and is fully reproducible.
 *
 * Reported diagnostics, all measured against the cleaned samples:
 *   - estimatedTruncationRateAtRecommended: fraction of samples STRICTLY greater
 *     than the recommended cap (those would be truncated).
 *   - estimatedTruncationRateAtCurrent:     same, against the supplied current
 *     max_tokens (null when none supplied).
 *   - overReservationVsMaxObserved:         recommended - max(samples). Positive
 *     means we reserve more than anything ever observed (headroom); negative
 *     means even the recommendation is below the worst observed sample.
 *
 * Guards:
 *   - Fewer than `minSamples` VALID samples => status "insufficient_data",
 *     recommendation null. We never invent a number from too little data.
 *   - NaN / Infinity / negative / non-number samples are filtered out before any
 *     statistic is computed; `rejectedSamples` reports how many were dropped.
 *   - Pure & deterministic: same input => same output.
 */

// ============================================================================
// Types
// ============================================================================

export type CalibrationStatus = "ok" | "insufficient_data";

export interface CalibrateOptions {
  /** Target non-truncation quantile, 0..1. Default 0.95. */
  p?: number;
  /** Fractional headroom added on top of the quantile. Default 0.15. */
  safetyMargin?: number;
  /** Round the recommendation UP to the nearest multiple of this. Default 256. */
  bucket?: number;
  /** Minimum count of VALID samples required to recommend. Default 20. */
  minSamples?: number;
  /** The caller's current max_tokens, for comparison. Optional. */
  currentMaxTokens?: number;
}

export interface CalibrationResult {
  status: CalibrationStatus;
  /** Recommended max_tokens, or null when insufficient data. */
  recommendedMaxTokens: number | null;
  /** Number of valid samples used. */
  sampleCount: number;
  /** Number of supplied samples that were rejected as invalid. */
  rejectedSamples: number;
  /** The quantile value (pre-margin, pre-bucket) actually used, or null. */
  quantileValue: number | null;
  /** The p that was used (after clamping). */
  p: number;
  /** The safetyMargin that was used (after clamping). */
  safetyMargin: number;
  /** The bucket that was used. */
  bucket: number;
  /** max(samples) or null when no valid samples. */
  maxObserved: number | null;
  /** min(samples) or null. */
  minObserved: number | null;
  /** Fraction (0..1) of samples > recommendation, or null. */
  estimatedTruncationRateAtRecommended: number | null;
  /** Fraction (0..1) of samples > currentMaxTokens, or null when not supplied. */
  estimatedTruncationRateAtCurrent: number | null;
  /** recommended - maxObserved, or null. */
  overReservationVsMaxObserved: number | null;
}

// ============================================================================
// Defaults
// ============================================================================

const DEFAULTS = {
  p: 0.95,
  safetyMargin: 0.15,
  bucket: 256,
  minSamples: 20,
} as const;

// ============================================================================
// Helpers
// ============================================================================

/** A sample is valid iff it is a finite, non-negative real number. */
function isValidSample(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x) && x >= 0;
}

/**
 * Nearest-rank quantile. `sorted` MUST be ascending and non-empty. `p` in
 * [0,1]. Returns an element of `sorted`.
 */
function nearestRankQuantile(sorted: number[], p: number): number {
  const n = sorted.length;
  // rank in [1, n]
  let rank = Math.ceil(p * n);
  if (rank < 1) rank = 1;
  if (rank > n) rank = n;
  return sorted[rank - 1];
}

/** Round `x` UP to the nearest positive multiple of `bucket`. */
function ceilToBucket(x: number, bucket: number): number {
  if (!(bucket > 0)) return Math.ceil(x);
  return Math.ceil(x / bucket) * bucket;
}

/** Count of samples strictly greater than `cap` (would be truncated). */
function truncationRate(sorted: number[], cap: number): number {
  // sorted ascending; count elements > cap via linear scan from the end.
  let count = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i] > cap) count++;
    else break; // ascending: once <= cap, all earlier are too
  }
  return count / sorted.length;
}

function clamp01(x: number, fallback: number): number {
  if (typeof x !== "number" || !Number.isFinite(x)) return fallback;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

// ============================================================================
// Main
// ============================================================================

export function calibrateMaxTokens(
  samples: unknown,
  options: CalibrateOptions = {}
): CalibrationResult {
  // ---- option sanitation (never throw) ------------------------------------
  const p = clamp01(options.p as number, DEFAULTS.p);
  const safetyMargin =
    typeof options.safetyMargin === "number" &&
    Number.isFinite(options.safetyMargin) &&
    options.safetyMargin >= 0
      ? options.safetyMargin
      : DEFAULTS.safetyMargin;
  const bucket =
    typeof options.bucket === "number" &&
    Number.isFinite(options.bucket) &&
    options.bucket >= 1
      ? Math.floor(options.bucket)
      : DEFAULTS.bucket;
  const minSamples =
    typeof options.minSamples === "number" &&
    Number.isFinite(options.minSamples) &&
    options.minSamples >= 1
      ? Math.floor(options.minSamples)
      : DEFAULTS.minSamples;
  const currentMaxTokens =
    typeof options.currentMaxTokens === "number" &&
    Number.isFinite(options.currentMaxTokens) &&
    options.currentMaxTokens >= 0
      ? options.currentMaxTokens
      : null;

  // ---- filter samples ------------------------------------------------------
  const raw: unknown[] = Array.isArray(samples) ? samples : [];
  const valid: number[] = [];
  for (const s of raw) {
    if (isValidSample(s)) valid.push(s);
  }
  const rejectedSamples = raw.length - valid.length;

  // ---- insufficient data ---------------------------------------------------
  if (valid.length < minSamples) {
    return {
      status: "insufficient_data",
      recommendedMaxTokens: null,
      sampleCount: valid.length,
      rejectedSamples,
      quantileValue: null,
      p,
      safetyMargin,
      bucket,
      maxObserved: valid.length > 0 ? Math.max(...valid) : null,
      minObserved: valid.length > 0 ? Math.min(...valid) : null,
      estimatedTruncationRateAtRecommended: null,
      estimatedTruncationRateAtCurrent:
        currentMaxTokens !== null && valid.length > 0
          ? truncationRate([...valid].sort((a, b) => a - b), currentMaxTokens)
          : null,
      overReservationVsMaxObserved: null,
    };
  }

  // ---- compute ------------------------------------------------------------
  const sorted = [...valid].sort((a, b) => a - b);
  const maxObserved = sorted[sorted.length - 1];
  const minObserved = sorted[0];

  const quantileValue = nearestRankQuantile(sorted, p);
  const recommendedRaw = quantileValue * (1 + safetyMargin);
  const recommendedMaxTokens = ceilToBucket(recommendedRaw, bucket);

  const estimatedTruncationRateAtRecommended = truncationRate(
    sorted,
    recommendedMaxTokens
  );
  const estimatedTruncationRateAtCurrent =
    currentMaxTokens !== null ? truncationRate(sorted, currentMaxTokens) : null;
  const overReservationVsMaxObserved = recommendedMaxTokens - maxObserved;

  return {
    status: "ok",
    recommendedMaxTokens,
    sampleCount: sorted.length,
    rejectedSamples,
    quantileValue,
    p,
    safetyMargin,
    bucket,
    maxObserved,
    minObserved,
    estimatedTruncationRateAtRecommended,
    estimatedTruncationRateAtCurrent,
    overReservationVsMaxObserved,
  };
}
