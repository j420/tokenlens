/**
 * Helpers for cache-aware accounting on Anthropic usage records.
 *
 * Definitions (per Anthropic Messages API):
 *   total_input = input_tokens + cache_read_input_tokens
 *                              + cache_creation_input_tokens
 *   cache hit rate = cache_read / total_input
 *   write amplification = cache_creation / cache_read (how many writes per
 *                                                      hit)
 *
 * Cost tiers (per 1M tokens, relative to input price):
 *   read:           ~0.10×  (cached_input field on pricing.ts entries)
 *   create (5m):    ~1.25×
 *   create (1h):    ~2.00×
 *   uncached:        1.00×
 */

import type { UsageTotals } from "./turn-mapper.js";

export interface CacheMetrics {
  totalInputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  uncachedInputTokens: number;
  outputTokens: number;
  hitRate: number; // 0..1
  writeAmplification: number; // unbounded
}

export function totalInput(u: UsageTotals): number {
  return u.input + u.cacheRead + u.cacheCreate;
}

export function hitRate(u: UsageTotals): number {
  const t = totalInput(u);
  return t > 0 ? u.cacheRead / t : 0;
}

export function writeAmplification(u: UsageTotals): number {
  return u.cacheRead > 0 ? u.cacheCreate / u.cacheRead : 0;
}

export function aggregateUsage(usages: UsageTotals[]): UsageTotals {
  const acc: UsageTotals = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheCreate: 0,
  };
  for (const u of usages) {
    acc.input += u.input;
    acc.output += u.output;
    acc.cacheRead += u.cacheRead;
    acc.cacheCreate += u.cacheCreate;
  }
  return acc;
}

export function summarize(u: UsageTotals): CacheMetrics {
  return {
    totalInputTokens: totalInput(u),
    cacheReadTokens: u.cacheRead,
    cacheCreationTokens: u.cacheCreate,
    uncachedInputTokens: u.input,
    outputTokens: u.output,
    hitRate: hitRate(u),
    writeAmplification: writeAmplification(u),
  };
}
