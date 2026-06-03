/**
 * Cache economics — pure math the rules call to compute waste estimates.
 *
 * Source for the multipliers: Anthropic prompt-caching documentation, also
 * mirrored verbatim in `@prune/agent-sdk-adapter/ttl-amortization.ts`:
 *
 *   5m TTL  → write multiplier 1.25×, read multiplier 0.10×
 *   1h TTL  → write multiplier 2.00×, read multiplier 0.10×
 *
 * Break-even point: 1h TTL beats 5m TTL when sustained read rate ≥ 12
 * reads / hour over the hour (cross-over derived in ttl-amortization.ts).
 *
 * All functions here are pure and deterministic. They return `null` when
 * an input is missing (e.g., model not priced) rather than fabricating
 * a default — the linter must never invent a dollar number.
 */

import { FLAT_PRICING, type ModelPricing } from "@prune/shared";

import type { CacheTtl } from "./types.js";

/**
 * Look up pricing without falling back to DEFAULT_PRICING — caller decides
 * what "unknown" means. This is the strict variant the linter uses so it
 * can return `null` instead of fabricating a per-token rate for a model it
 * has no canonical entry for.
 */
function strictPricing(model: string): ModelPricing | null {
  const p = FLAT_PRICING[model];
  return p ?? null;
}

/** Anthropic 5m-TTL cache write multiplier vs the model's input rate. */
export const WRITE_MULTIPLIER_5M = 1.25;
/** Anthropic 1h-TTL cache write multiplier vs the model's input rate. */
export const WRITE_MULTIPLIER_1H = 2.0;
/** Cache read tier (cached_input field in pricing). */
export const READ_MULTIPLIER_CACHED = 0.1;
/**
 * Break-even read rate (reads per hour) at which 1h TTL becomes cheaper
 * than 5m TTL. Below this rate, 5m is cheaper.
 */
export const TTL_BREAK_EVEN_READS_PER_HOUR = 12;

/** TTL → write multiplier. */
export function writeMultiplier(ttl: CacheTtl): number | null {
  if (ttl === "5m") return WRITE_MULTIPLIER_5M;
  if (ttl === "1h") return WRITE_MULTIPLIER_1H;
  return null;
}

/**
 * USD cost to (re)write `tokens` of prefix into the cache at the given TTL,
 * for the given model. Returns null when the model is unpriced or the TTL
 * is "none" (no cache write would happen, so the concept doesn't apply).
 */
export function cacheWriteCostUsd(
  tokens: number,
  ttl: CacheTtl,
  model: string
): number | null {
  if (tokens <= 0) return 0;
  const mult = writeMultiplier(ttl);
  if (mult === null) return null;
  const pricing = strictPricing(model);
  if (!pricing || typeof pricing.input !== "number") return null;
  // pricing.input is per 1M tokens; multiply by tokens / 1M.
  return (tokens * pricing.input * mult) / 1_000_000;
}

/**
 * USD savings *forgone* per future read of `tokens` if the cache is busted —
 * the next read would have cost (cached_input) but will instead cost (input)
 * after the bust forces a rewrite. Per-read delta.
 *
 * Returns null when the model is unpriced or has no cached_input rate.
 */
export function cacheReadSavingsPerReadUsd(
  tokens: number,
  model: string
): number | null {
  if (tokens <= 0) return 0;
  const pricing = strictPricing(model);
  if (!pricing || typeof pricing.input !== "number" || typeof pricing.cached_input !== "number") {
    return null;
  }
  const delta = pricing.input - pricing.cached_input;
  return (tokens * delta) / 1_000_000;
}

/**
 * Conservative estimate of the cumulative cache investment about to be
 * lost when a session-prefix-busting action fires. Combines the cost of
 * re-creating the cache writes already paid for, NOT the speculative
 * future read savings (we don't know how many turns remain).
 *
 * Returns null when the model is unpriced.
 */
export function cacheInvestmentLossUsd(
  cacheCreationTokensSoFar: number,
  ttl: CacheTtl,
  model: string
): number | null {
  return cacheWriteCostUsd(cacheCreationTokensSoFar, ttl, model);
}

/**
 * Minutes between two ISO timestamps. Returns null if either is invalid
 * or null. The linter never fabricates a gap.
 */
export function minutesBetween(
  earlierIso: string | null,
  laterIso: string
): number | null {
  if (!earlierIso) return null;
  const a = Date.parse(earlierIso);
  const b = Date.parse(laterIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (b < a) return 0;
  return (b - a) / 60_000;
}

/**
 * Min cacheable prefix tokens by model family. Same source as
 * `@prune/agent-sdk-adapter/cache-planner.ts:DEFAULT_MIN_CACHEABLE_TOKENS`.
 * Sonnet families: 1024. Opus / Haiku: 4096. Unknown: 4096 conservative.
 */
export function minCacheablePrefix(modelFamily: string): number {
  if (modelFamily === "sonnet") return 1024;
  if (modelFamily === "opus" || modelFamily === "haiku") return 4096;
  // OpenAI auto-cache threshold is documented at 1024 tokens, so for
  // gpt-4o / gpt-4o-mini we use 1024.
  if (modelFamily === "gpt-4o" || modelFamily === "gpt-4o-mini") return 1024;
  return 4096;
}

/**
 * TTL of the active session in seconds. Used by CH-004 to compare against
 * idle gap.
 */
export function ttlSeconds(ttl: CacheTtl): number | null {
  if (ttl === "5m") return 300;
  if (ttl === "1h") return 3600;
  return null;
}
