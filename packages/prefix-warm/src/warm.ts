/**
 * Cache TTL arithmetic. All pure; time is passed in as `now` so the logic is
 * fully deterministic and testable (no Date.now() inside).
 */

import type {
  CacheAssessment,
  PrefixEntry,
  WarmConfig,
  WarmDecision,
} from "./types.js";

/**
 * Assess whether a prefix is still cached. `entry` may be null (never seen →
 * absent). A non-positive TTL is treated as "no caching" → always expired.
 */
export function assessCache(
  entry: PrefixEntry | null,
  now: number,
  ttlMs: number
): CacheAssessment {
  if (!entry) {
    return { status: "absent", msUntilExpiry: 0, expiresAt: null };
  }
  if (!(ttlMs > 0)) {
    return { status: "expired", msUntilExpiry: 0, expiresAt: entry.lastUsedAt };
  }
  const expiresAt = entry.lastUsedAt + ttlMs;
  const msUntilExpiry = expiresAt - now;
  if (msUntilExpiry > 0) {
    return { status: "warm", msUntilExpiry, expiresAt };
  }
  return { status: "expired", msUntilExpiry: 0, expiresAt };
}

/** Refresh the entry's TTL by recording a use at `now`. Pure (returns new). */
export function useEntry(entry: PrefixEntry, now: number): PrefixEntry {
  return { ...entry, lastUsedAt: now };
}

/**
 * Decide whether to send a keep-alive warming request now. We warm only when:
 *   - the prefix is WARM but within the refresh threshold of expiry (a cheap
 *     keep-alive avoids an imminent cold miss), and reuse is expected.
 * We do NOT warm an absent/expired prefix speculatively: priming a cold prefix
 * only pays off if it will actually be reused, which the caller asserts via
 * `reuseExpected`; without that, warming would just spend tokens.
 */
export function shouldWarm(
  entry: PrefixEntry | null,
  now: number,
  config: WarmConfig,
  reuseExpected: boolean
): WarmDecision {
  const assessment = assessCache(entry, now, config.ttlMs);

  if (!reuseExpected) {
    return { warm: false, reason: "no reuse expected", assessment };
  }
  if (assessment.status === "warm") {
    if (assessment.msUntilExpiry <= config.refreshThresholdMs) {
      return { warm: true, reason: "warm but expiring soon — keep alive", assessment };
    }
    return { warm: false, reason: "warm with ample time left", assessment };
  }
  if (assessment.status === "expired") {
    return { warm: true, reason: "expired — prime before reuse", assessment };
  }
  return { warm: true, reason: "absent — prime before reuse", assessment };
}

/**
 * Read-discount savings of a cache HIT versus paying full input price for the
 * prefix. `cacheReadDiscount` in [0,1] is the fraction of full price a cache
 * read costs (e.g. 0.1 ⇒ a hit costs 10%, saving 90%). `hits` is how many times
 * the prefix is re-served warm. Caller-supplied numbers only.
 */
export function cacheHitSavings(
  tokens: number,
  cacheReadDiscount: number,
  hits: number
): number {
  const t = Math.max(0, tokens);
  const discount = Math.min(1, Math.max(0, cacheReadDiscount));
  const n = Math.max(0, Math.floor(hits));
  return t * (1 - discount) * n;
}
