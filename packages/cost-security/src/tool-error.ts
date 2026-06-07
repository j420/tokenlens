/**
 * Tool-Error-Rate Breaker  (Cost-Security)
 * ========================================
 * A degeneration signal `loop-breaker` misses: a sustained high TOOL-ERROR rate
 * over a window — malformed args, file-not-found, non-zero exits — each retried,
 * each re-billing the turn. `loop-breaker` keys on token-ROI *magnitude*; a
 * session can keep non-low ROI while its tool calls keep failing (args
 * repeatedly malformed), and it won't catch it. This keys on the error-vs-
 * success OUTCOME, never on *why* (that would be semantic classification).
 *
 * `assessToolErrorRate(results, options?)` is a PURE function over a caller-fed
 * list of tool-result signals. The ONLY signal it reads is the host-tagged
 * `is_error` boolean (present in the normalized transcript —
 * `@prune/telemetry` turn-mapper `toolResults[].is_error`). It NEVER inspects
 * result content / prose.
 *
 * DISCIPLINE:
 *   - Deterministic & total. Same results => same report. Never throws.
 *   - No regex, no model, no prose-sniffing. Only the boolean outcome flag.
 *   - Fail-open on missing signal. `is_error` is an OPTIONAL host field; results
 *     that don't carry a boolean are not counted, and if NONE do, the verdict is
 *     `insufficient_signal` (a permanent honest no-op — it must never fall back
 *     to text matching).
 *   - Advisory. Returns a verdict + the rate that drove it; it never blocks.
 */

// ============================================================================
// Types
// ============================================================================

/** One tool-result outcome. Only `isError` is read; content is irrelevant. */
export interface ToolResultSignal {
  /**
   * Host-tagged error flag. `true` = the tool call failed; `false` = it
   * succeeded; absent = the host did not tag this result (not counted).
   */
  isError?: boolean;
}

export interface ToolErrorOptions {
  /**
   * Error-rate at or above which the detector fires, in [0,1]. Default 0.5 —
   * half or more of the tagged calls failing is a clear degeneration signal.
   */
  threshold?: number;
  /**
   * Minimum number of TAGGED results (with a boolean `is_error`) required
   * before the detector may fire. Default 4 — below this the rate is noise.
   */
  floor?: number;
}

export interface ToolErrorReport {
  /**
   * "warn"  — tagged volume >= floor AND error rate >= threshold.
   * "ok"    — tagged volume present but below the trip conditions.
   * "insufficient_signal" — no result carried a boolean `is_error`.
   */
  verdict: "ok" | "warn" | "insufficient_signal";
  /** Results tagged is_error === true. */
  errorCount: number;
  /** Results carrying a boolean is_error (the denominator). */
  observedCount: number;
  /** All results supplied (informational; observedCount <= totalCount). */
  totalCount: number;
  /** errorCount / observedCount, or null when observedCount === 0. */
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
  let errorCount = 0;
  let observedCount = 0;
  for (const r of list) {
    const flag = errorFlagOf(r);
    if (flag === null) continue; // untagged — never counted, never inferred
    observedCount++;
    if (flag) errorCount++;
  }

  if (observedCount === 0) {
    return {
      verdict: "insufficient_signal",
      errorCount: 0,
      observedCount: 0,
      totalCount: list.length,
      ratio: null,
    };
  }

  const ratio = errorCount / observedCount;
  const warn = observedCount >= floor && ratio >= threshold;

  return {
    verdict: warn ? "warn" : "ok",
    errorCount,
    observedCount,
    totalCount: list.length,
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
