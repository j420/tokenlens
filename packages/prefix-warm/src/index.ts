/**
 * @prune/prefix-warm — TTL-aware prompt-cache prefix warming for cross-session
 * reuse (companion to f12 skill-library).
 *
 * Public surface:
 *   - assessCache(entry, now, ttlMs) → warm | expired | absent + expiry
 *   - shouldWarm(entry, now, config, reuseExpected) → keep-alive decision
 *   - useEntry(entry, now) → refresh TTL on use
 *   - cacheHitSavings(tokens, discount, hits) → read-discount savings
 *
 * Pure, deterministic cache arithmetic. No model, no regex, no fabricated
 * numbers — tokens, TTL, and discount are caller-supplied.
 */

export * from "./types.js";
export {
  assessCache,
  shouldWarm,
  useEntry,
  cacheHitSavings,
} from "./warm.js";
