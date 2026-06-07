/**
 * Increment Prefix Aligner  (List1)
 * =================================
 * OpenAI prompt caching is not all-or-nothing: it engages once the prefix
 * reaches a minimum (1024 tokens) and then caches in fixed increments (128
 * tokens). A prefix of 1100 tokens caches only its first 1024 — the trailing 76
 * tokens fall outside the increment and are re-billed at full input rate every
 * turn. Aligning the stable prefix to an increment boundary (by padding it up,
 * or by knowing exactly how much is cacheable) recovers that tail.
 *
 * `alignPrefix(prefixTokens, options?)` is a PURE arithmetic function over a
 * caller-supplied prefix token count. No fabricated numbers, no regex, no model.
 */

// ============================================================================
// Types
// ============================================================================

export interface AlignOptions {
  /** Minimum cacheable prefix (OpenAI: 1024). Default 1024. */
  minCacheableTokens?: number;
  /** Cache increment size (OpenAI: 128). Default 128. */
  incrementTokens?: number;
}

export interface AlignResult {
  /** True once the prefix clears the minimum cacheable size. */
  eligible: boolean;
  /** Tokens actually cached: largest min + k·increment that is <= prefixTokens. */
  cacheableTokens: number;
  /** Tokens beyond the last boundary that are NOT cached (re-billed each turn). */
  wastedTailTokens: number;
  /** The next increment boundary above the prefix. */
  nextBoundaryTokens: number;
  /** Tokens of stable padding that would push the prefix to the next boundary. */
  padToNextTokens: number;
}

// ============================================================================
// alignPrefix
// ============================================================================

export function alignPrefix(prefixTokens: unknown, options: AlignOptions = {}): AlignResult {
  const min = posInt(options.minCacheableTokens, 1024);
  const inc = posInt(options.incrementTokens, 128);
  const tokens = nonNegInt(prefixTokens);

  if (tokens < min) {
    return {
      eligible: false,
      cacheableTokens: 0,
      wastedTailTokens: tokens, // nothing cached yet
      nextBoundaryTokens: min,
      padToNextTokens: min - tokens,
    };
  }

  const k = Math.floor((tokens - min) / inc);
  const cacheableTokens = min + k * inc;
  const wastedTailTokens = tokens - cacheableTokens; // 0 .. inc-1
  const nextBoundaryTokens = cacheableTokens + inc;
  return {
    eligible: true,
    cacheableTokens,
    wastedTailTokens,
    nextBoundaryTokens,
    padToNextTokens: nextBoundaryTokens - tokens,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function posInt(v: unknown, dflt: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 1 ? Math.floor(v) : dflt;
}

function nonNegInt(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}
