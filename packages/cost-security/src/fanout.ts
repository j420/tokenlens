/**
 * Subagent Fan-Out Acceleration  (Cost-Security)
 * ==============================================
 * `subagent-warden` caps the ABSOLUTE size of a subagent fan-out (parallel
 * count, concurrency, lifetime spend). A crafted task can stay under every
 * absolute cap while its spawn rate climbs super-linearly turn over turn
 * (2 -> 5 -> 12 -> 30 ...), the signature of a recursive/amplifying decomposition
 * that will blow the budget a few turns later. This is the DERIVATIVE the
 * warden's level-thresholds miss.
 *
 * `assessFanoutAcceleration(perBucketCounts, options?)` takes the spawns-per-turn
 * series and reports whether the fan-out is accelerating (positive and rising
 * second difference). Pure, deterministic, total — a complement to, not a
 * replacement for, the warden's caps. Advisory only.
 */

export interface FanoutOptions {
  /** Minimum buckets (turns) before a trend is meaningful. Default 3. */
  minBuckets?: number;
  /**
   * Minimum acceleration (second difference of the spawn series) to flag.
   * Default 2 — the latest turn's spawn increase grew by >= 2 over the prior.
   */
  accelThreshold?: number;
  /** Minimum spawns in the latest bucket to bother flagging. Default 3. */
  minLatest?: number;
}

export interface FanoutReport {
  accelerating: boolean;
  /** Number of buckets considered. */
  buckets: number;
  /** Spawns in the most recent bucket. */
  latest: number;
  /** latest - previous bucket (first difference / current spawn growth). */
  firstDiff: number;
  /** (latest - prev) - (prev - prevPrev): the acceleration. */
  secondDiff: number;
  /** Total spawns across all buckets. */
  cumulative: number;
}

export function assessFanoutAcceleration(
  perBucketCounts: unknown,
  options: FanoutOptions = {}
): FanoutReport {
  const minBuckets = posInt(options.minBuckets, 3);
  const accelThreshold = num(options.accelThreshold, 2);
  const minLatest = posInt(options.minLatest, 3);

  // Coerce to a clean non-negative integer series.
  const series: number[] = Array.isArray(perBucketCounts)
    ? perBucketCounts.filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0).map((n) => Math.floor(n))
    : [];

  const buckets = series.length;
  const cumulative = series.reduce((s, n) => s + n, 0);
  const latest = buckets > 0 ? series[buckets - 1]! : 0;

  if (buckets < minBuckets) {
    return { accelerating: false, buckets, latest, firstDiff: 0, secondDiff: 0, cumulative };
  }

  const prev = series[buckets - 2]!;
  const prevPrev = series[buckets - 3]!;
  const firstDiff = latest - prev;
  const prevDiff = prev - prevPrev;
  const secondDiff = firstDiff - prevDiff;

  const accelerating = latest >= minLatest && firstDiff > 0 && secondDiff >= accelThreshold;

  return { accelerating, buckets, latest, firstDiff, secondDiff, cumulative };
}

function posInt(v: unknown, dflt: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 1 ? Math.floor(v) : dflt;
}
function num(v: unknown, dflt: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : dflt;
}
