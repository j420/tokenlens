/**
 * 1h-vs-5m TTL amortization chooser.
 *
 * Anthropic's prompt-cache write multipliers:
 *   5m TTL → 1.25× input price
 *   1h TTL → 2.00× input price
 *   Cache read (any TTL) → 0.10× input price
 *
 * Within one hour, with a constant prefix-read rate R reads/hour:
 *
 *   5m total cost units = 12 × 1.25  + 0.10 × (R − 12) = 13.8 + 0.10R
 *   1h total cost units =  1 × 2.00  + 0.10 × (R − 1)  =  1.9 + 0.10R
 *
 * 1h beats 5m whenever the savings on writes (13.8 − 1.9 = 11.9 units)
 * outweighs the per-write differential (2.00 − 1.25 = 0.75 unit per
 * write avoided × 11 writes saved = 8.25 unit). The cross-over in
 * read-rate terms is **R ≥ ~12 reads / hour** to amortize the higher
 * write cost — i.e. as long as the prefix gets re-used at least once
 * every five minutes on average over the hour.
 *
 * Below that read rate (rare reuse), 5m is cheaper because we pay the
 * 0.75-unit extra write penalty without enough reads to offset it.
 *
 * This module gives you:
 *
 *  - constants for the break-even points
 *  - `chooseTtl(history)` — applies the amortization rule to a
 *    caller-supplied read-rate fingerprint history
 *  - `amortizingTtlChooser` — a `TtlChooser` you can pass to
 *    `planBreakpoints` via the (new) `ttlChooser` option
 *
 * Pure logic. No persistence; the caller supplies the history.
 */

import type { CacheBreakpoint, MessageRequest } from "./types.js";

export const BREAK_EVEN_READS_PER_HOUR = 12;
export const WRITE_MULTIPLIER_5M = 1.25;
export const WRITE_MULTIPLIER_1H = 2.0;
export const READ_MULTIPLIER = 0.1;

/**
 * Caller-supplied evidence: how many cache reads did a prefix
 * fingerprint serve over the last `windowMs` milliseconds? Computed
 * by the caller's telemetry layer (EventRow.tokens_cached histogram
 * keyed by `prefixFingerprint(...)`).
 */
export interface PrefixReadHistory {
  /** The fingerprint this history is keyed under (informational). */
  fingerprint: string;
  /** Number of cache-read events observed in the window. */
  reads: number;
  /** Length of the observation window in milliseconds. */
  windowMs: number;
}

/**
 * Compute the rate in reads/hour. Returns 0 when the window is
 * non-finite or zero-length.
 */
export function readsPerHour(history: PrefixReadHistory): number {
  if (!history || typeof history.reads !== "number" || typeof history.windowMs !== "number") {
    return 0;
  }
  if (!Number.isFinite(history.reads) || history.reads < 0) return 0;
  if (!Number.isFinite(history.windowMs) || history.windowMs <= 0) return 0;
  return (history.reads / history.windowMs) * 3_600_000;
}

/**
 * Decision: pick "1h" when the observed read rate amortizes the
 * higher write multiplier. "5m" otherwise (the conservative default).
 *
 * Tunable: `breakEven` lets you raise the threshold defensively
 * (e.g. require ≥ 18 reads/hour for sustained 1h selection).
 */
export interface TtlDecision {
  ttl: "5m" | "1h";
  readsPerHour: number;
  breakEven: number;
  rationale: string;
}

export function chooseTtl(
  history: PrefixReadHistory | undefined,
  breakEven: number = BREAK_EVEN_READS_PER_HOUR
): TtlDecision {
  const be =
    Number.isFinite(breakEven) && breakEven > 0
      ? breakEven
      : BREAK_EVEN_READS_PER_HOUR;
  const rate = history ? readsPerHour(history) : 0;
  if (rate >= be) {
    return {
      ttl: "1h",
      readsPerHour: rate,
      breakEven: be,
      rationale: `Observed ${rate.toFixed(2)} reads/hour ≥ break-even ${be}; 1h cache amortizes its write premium.`,
    };
  }
  return {
    ttl: "5m",
    readsPerHour: rate,
    breakEven: be,
    rationale: `Observed ${rate.toFixed(2)} reads/hour < break-even ${be}; 5m TTL is cheaper at this read rate.`,
  };
}

/**
 * A `TtlChooser` adapts the planner so each breakpoint candidate can
 * pick a TTL based on the caller's per-fingerprint history.
 *
 * The chooser is called with the candidate breakpoint context
 * (segment + blockIndex + cumulative tokens) and the full request,
 * so callers with sophisticated histories can key by anything.
 */
export interface TtlChooserContext {
  request: MessageRequest;
  candidate: {
    segment: CacheBreakpoint["segment"];
    blockIndex: number;
    cumulativeTokens: number;
  };
}

export type TtlChooser = (ctx: TtlChooserContext) => "5m" | "1h";

/**
 * Build an amortizing TtlChooser from a fingerprint→history map.
 * The chooser falls back to `defaultTtl` when no history is available
 * for the candidate's fingerprint.
 */
export interface AmortizingTtlChooserOptions {
  /**
   * Map from prefix fingerprint → PrefixReadHistory. The chooser
   * computes the fingerprint via the caller-supplied `keyFor`
   * function (so the planner doesn't impose a specific hashing
   * scheme).
   */
  histories: Map<string, PrefixReadHistory>;
  /** Per-candidate fingerprint computation. */
  keyFor: (ctx: TtlChooserContext) => string;
  /** When no history exists for the candidate. Default "5m". */
  defaultTtl?: "5m" | "1h";
  /** Override break-even reads/hour. Default 12. */
  breakEven?: number;
}

export function amortizingTtlChooser(
  options: AmortizingTtlChooserOptions
): TtlChooser {
  const def = options.defaultTtl ?? "5m";
  return (ctx) => {
    const key = options.keyFor(ctx);
    if (typeof key !== "string" || key.length === 0) return def;
    const hist = options.histories.get(key);
    if (!hist) return def;
    return chooseTtl(hist, options.breakEven).ttl;
  };
}
