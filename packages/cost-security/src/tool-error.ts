/**
 * Tool-Error-Rate Breaker  (Cost-Security)
 * ========================================
 * Catches a degeneration signal `loop-breaker` misses: a sustained high
 * TOOL-ERROR rate over a window — malformed args, file-not-found, non-zero
 * exits — each retried, each re-billing the turn. `loop-breaker` keys on
 * token-ROI magnitude; a session can keep non-low ROI while its tool calls keep
 * failing, and it won't catch it. This keys on the error-vs-success OUTCOME,
 * never on *why* (that would be semantic classification).
 *
 * `assessToolErrorRate(results, options?)` is a PURE function over a caller-fed
 * list of tool-result signals. The ONLY signal it reads is the host-tagged
 * `is_error` boolean (present in the normalized transcript —
 * `@prune/telemetry` turn-mapper `toolResults[].is_error`). It NEVER inspects
 * result content / prose.
 *
 * The denominator is ALL results in the window. Per the Anthropic `tool_result`
 * contract, `is_error` is OMITTED on success and set `true` only on failure, so
 * an absent flag counts as a success — not as "unknown". (A tagged-only
 * denominator would collapse to the error count whenever a host omits the flag
 * on success, reporting a ~100% rate from a handful of failures: a false
 * positive. Honoring the API default avoids that.)
 *
 * DISCIPLINE:
 *   - Deterministic & total. Same results => same report. Never throws.
 *   - No regex, no model, no prose-sniffing. Only the boolean outcome flag.
 *   - Honest about blindness. If NO result carries a boolean `is_error`
 *     (the host doesn't tag outcomes at all), the verdict is
 *     `insufficient_signal` — it never claims a rate it can't observe, and it
 *     never falls back to text-matching.
 *   - Fail-open. The detector can only ever `warn` when real `is_error: true`
 *     flags are present AND they dominate the full call volume. Advisory; it
 *     never blocks.
 */

// ============================================================================
// Types
// ============================================================================

/** One tool-result outcome. Only `isError` is read; content is irrelevant. */
export interface ToolResultSignal {
  /**
   * Host-tagged error flag. `true` = the tool call failed; `false` = explicit
   * success; absent = success per the API default (counted as a success).
   */
  isError?: boolean;
}

export interface ToolErrorOptions {
  /**
   * Error-rate at or above which the detector fires, in [0,1]. Default 0.5 —
   * half or more of the calls failing is a clear degeneration signal.
   */
  threshold?: number;
  /**
   * Minimum number of total results (the denominator) required before the
   * detector may fire. Default 4 — below this the rate is noise.
   */
  floor?: number;
}

export interface ToolErrorReport {
  /**
   * "warn"  — total volume >= floor AND error rate >= threshold.
   * "ok"    — outcomes observed but below the trip conditions.
   * "insufficient_signal" — no result carried a boolean `is_error` (the host
   *           does not tag outcomes), or there were no results at all.
   */
  verdict: "ok" | "warn" | "insufficient_signal";
  /** Results with isError === true. */
  errorCount: number;
  /** Results carrying an EXPLICIT boolean is_error (how much the host tags). */
  taggedCount: number;
  /** All results supplied — the rate denominator. */
  totalCount: number;
  /** errorCount / totalCount, or null when the verdict is insufficient_signal. */
  ratio: number | null;
}

// ============================================================================
// assessToolErrorRate
// ============================================================================

export function assessToolErrorRate(
  results: unknown,
  options: ToolErrorOptions = {}
): ToolErrorReport {
  const threshold = unitInterval(options.threshold, 0.5);
  const floor = posInt(options.floor, 4);

  const list: unknown[] = Array.isArray(results) ? results : [];
  const totalCount = list.length;
  let errorCount = 0;
  let taggedCount = 0;
  for (const r of list) {
    const flag = errorFlagOf(r);
    if (flag === null) continue; // untagged — counts as a success in the rate
    taggedCount++;
    if (flag) errorCount++;
  }

  // Honest about blindness: with no error-tagging at all (or no results) we
  // cannot assert a rate. We never warn here — warning requires real is_error
  // flags — so this is purely an honest verdict, not a behavioural change.
  if (totalCount === 0 || taggedCount === 0) {
    return {
      verdict: "insufficient_signal",
      errorCount,
      taggedCount,
      totalCount,
      ratio: null,
    };
  }

  const ratio = errorCount / totalCount;
  const warn = totalCount >= floor && ratio >= threshold;

  return {
    verdict: warn ? "warn" : "ok",
    errorCount,
    taggedCount,
    totalCount,
    ratio,
  };
}

// ============================================================================
// Helpers
// ============================================================================

/** Returns the boolean is_error flag, or null when the result is untagged. */
function errorFlagOf(v: unknown): boolean | null {
  if (!v || typeof v !== "object") return null;
  const e = (v as Record<string, unknown>).isError;
  return typeof e === "boolean" ? e : null;
}

function unitInterval(v: unknown, dflt: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1
    ? v
    : dflt;
}

function posInt(v: unknown, dflt: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 1
    ? Math.floor(v)
    : dflt;
}
