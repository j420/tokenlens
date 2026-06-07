/**
 * Silent TTL-Regression Detector  (List1)
 * =======================================
 * A session can configure the 1-hour cache tier (paying the 2x write multiplier
 * up front to keep the prefix warm for an hour). If the provider silently fails
 * to honor it — the prefix actually evicts at ~5 minutes — the session keeps
 * paying cache rewrites it budgeted against an hour of reuse: a silent, ongoing
 * overspend. The regression is invisible per-request; it only shows up as an
 * effective TTL shorter than the configured one.
 *
 * `detectTtlRegression(input, options?)` is a PURE comparison of the CONFIGURED
 * TTL (what the caller asked for) against the OBSERVED TTL (what the host
 * inferred from cache-hit timing). It never measures timing itself and never
 * fabricates a value — if either side is unknown the verdict is
 * `insufficient_signal`. No regex, no model.
 */

// ============================================================================
// Types
// ============================================================================

export interface TtlObservation {
  /** TTL the session configured, in seconds (e.g. 3600 for the 1h tier). */
  configuredTtlSeconds: number;
  /**
   * TTL actually observed, in seconds — the host infers this from the gap after
   * which a warm prefix stopped hitting. null/absent ⇒ unknown.
   */
  observedTtlSeconds?: number | null;
}

export interface TtlOptions {
  /**
   * Fractional tolerance: the observed TTL must be at least
   * configured·(1−tolerance) to be considered honored. Default 0.1 (10%) — small
   * timing noise doesn't trip it, a tier downgrade does.
   */
  tolerance?: number;
}

export interface TtlReport {
  verdict: "ok" | "regressed" | "insufficient_signal";
  configuredTtlSeconds: number | null;
  observedTtlSeconds: number | null;
  /** configured − observed (seconds), when both known; else null. */
  shortfallSeconds: number | null;
  /** observed / configured in [0,1], when both known; else null. */
  ratio: number | null;
}

// ============================================================================
// detectTtlRegression
// ============================================================================

export function detectTtlRegression(input: unknown, options: TtlOptions = {}): TtlReport {
  const tolerance = unit(options.tolerance, 0.1);
  const i = (input ?? {}) as Partial<TtlObservation>;

  const configured =
    typeof i.configuredTtlSeconds === "number" &&
    Number.isFinite(i.configuredTtlSeconds) &&
    i.configuredTtlSeconds > 0
      ? i.configuredTtlSeconds
      : null;
  const observed =
    typeof i.observedTtlSeconds === "number" &&
    Number.isFinite(i.observedTtlSeconds) &&
    i.observedTtlSeconds >= 0
      ? i.observedTtlSeconds
      : null;

  if (configured === null || observed === null) {
    return {
      verdict: "insufficient_signal",
      configuredTtlSeconds: configured,
      observedTtlSeconds: observed,
      shortfallSeconds: null,
      ratio: null,
    };
  }

  const ratio = observed / configured;
  const regressed = observed < configured * (1 - tolerance);
  return {
    verdict: regressed ? "regressed" : "ok",
    configuredTtlSeconds: configured,
    observedTtlSeconds: observed,
    shortfallSeconds: round(configured - observed),
    ratio: round(ratio),
  };
}

// ============================================================================
// Helpers
// ============================================================================

function unit(v: unknown, dflt: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 1 ? v : dflt;
}

function round(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
