/**
 * Latency + cache-window-preservation model.
 *
 * The primary win of speculation is wall-clock: a hit returns a result the
 * agent would otherwise have waited a full tool round-trip for. The secondary,
 * token-side win is cache-window preservation — by shortening the session's
 * wall-clock, more turns land inside the prompt-cache TTL window, so prefixes
 * that would have expired (and been re-written at the 1.25×/2× tier) stay warm
 * and re-serve at the 0.10× read tier.
 *
 * Both figures are computed from caller-measured latencies — we never fabricate
 * a round-trip time. The cache-window estimate is explicitly an ESTIMATE and is
 * labeled as such; it tells the user "this much wall-clock saved keeps you
 * inside the 5-minute window for ~N more turns."
 */

/** Anthropic prompt-cache TTL windows in milliseconds. */
export const TTL_WINDOW_MS = {
  "5m": 5 * 60_000,
  "1h": 60 * 60_000,
} as const;

export interface LatencyOutcome {
  /** Total wall-clock saved across all hits (ms). */
  totalLatencySavedMs: number;
  /** Mean latency saved per hit (ms); 0 when no hits. */
  meanLatencySavedMsPerHit: number;
  /** Number of hits the figure is based on. */
  hits: number;
}

/** Summarize latency savings from a list of per-hit saved-ms figures. */
export function summarizeLatency(savedMsPerHit: readonly number[]): LatencyOutcome {
  const hits = savedMsPerHit.length;
  const total = savedMsPerHit.reduce((s, x) => s + Math.max(0, x), 0);
  return {
    totalLatencySavedMs: total,
    meanLatencySavedMsPerHit: hits > 0 ? total / hits : 0,
    hits,
  };
}

export interface CacheWindowEstimate {
  /** Wall-clock saved (ms). */
  latencySavedMs: number;
  /** TTL window used for the estimate. */
  ttl: keyof typeof TTL_WINDOW_MS;
  /**
   * Estimated extra turns that now fit inside the TTL window, given a
   * caller-supplied mean per-turn wall-clock. Floor'd; never negative.
   */
  extraTurnsInsideWindow: number;
  /**
   * Did the saved wall-clock plausibly rescue at least one turn from crossing
   * the window boundary? A coarse, honest yes/no the HUD can surface.
   */
  likelyPreservesWindow: boolean;
}

/**
 * Estimate how the saved wall-clock helps the session stay inside a cache TTL
 * window. `meanTurnWallClockMs` is caller-measured (the average time a turn
 * takes); we never assume one. Pure.
 */
export function estimateCacheWindowPreservation(
  latencySavedMs: number,
  meanTurnWallClockMs: number,
  ttl: keyof typeof TTL_WINDOW_MS
): CacheWindowEstimate {
  const safeSaved = Math.max(0, latencySavedMs);
  const extraTurns =
    meanTurnWallClockMs > 0 ? Math.floor(safeSaved / meanTurnWallClockMs) : 0;
  return {
    latencySavedMs: safeSaved,
    ttl,
    extraTurnsInsideWindow: extraTurns,
    likelyPreservesWindow: extraTurns >= 1,
  };
}
