/**
 * Types for TTL-aware prefix warming (cross-session reuse).
 *
 * Provider prompt caches keep a prompt PREFIX (system prompt + tool definitions
 * + pinned context) for a fixed TTL, refreshed on each use. If the same prefix
 * will be reused — across turns or across sessions — a cache hit re-serves it at
 * a steep read discount instead of paying full input price again. This module is
 * the deterministic arithmetic behind that: it never calls a provider and never
 * invents a number; the caller supplies the prefix's token count, the TTL, and
 * the cache-read discount.
 */

/** A tracked cacheable prefix. */
export interface PrefixEntry {
  /** Content hash of the stable prefix region. */
  prefixHash: string;
  /** Token count of the cacheable prefix region (caller-measured). */
  tokens: number;
  /** Epoch ms the prefix was last sent (and therefore cached/refreshed). */
  lastUsedAt: number;
}

export type CacheStatus = "warm" | "expired" | "absent";

export interface CacheAssessment {
  status: CacheStatus;
  /** Ms until the cached prefix expires; 0 when expired or absent. */
  msUntilExpiry: number;
  /** Epoch ms of expiry, or null when absent. */
  expiresAt: number | null;
}

export interface WarmConfig {
  /** Provider cache TTL in ms (e.g. Anthropic 5-min default = 300_000). */
  ttlMs: number;
  /** Send a keep-alive when a warm prefix expires within this window. */
  refreshThresholdMs: number;
}

export interface WarmDecision {
  /** Whether to send a warming/keep-alive request now. */
  warm: boolean;
  reason: string;
  assessment: CacheAssessment;
}
