/**
 * Cross-Session Recurring-Waste Memo  (F13)
 * =========================================
 * cache-habits catches a waste pattern WITHIN a session. But the most expensive
 * patterns are habits — the same developer makes the same costly move across
 * many sessions (re-pasting the same huge file, always running the max model for
 * trivial edits, re-explaining the same module). A per-request nag is ignored;
 * a periodic memo of "here are the three recurring things that cost you the
 * most" changes behavior.
 *
 * `buildWasteMemo(records, options?)` is a PURE function over a caller-supplied
 * longitudinal store of waste OCCURRENCES, each keyed by an opaque hashed
 * FINGERPRINT (the host hashes the pattern → no content crosses the boundary).
 * It groups by fingerprint, keeps only patterns that RECUR (enough occurrences
 * across enough distinct days), and ranks them by realized cost.
 *
 * DISCIPLINE:
 *   - Deterministic & total. Same records => same memo. Malformed records skipped.
 *   - PII-safe by construction. Fingerprints are opaque hashes; this package
 *     never sees the underlying pattern, path, or content.
 *   - Honest pricing. A pattern's cost is null unless EVERY occurrence carried a
 *     cost; ranking then falls back to tokens. Never fabricates a dollar figure.
 *   - No regex, no model. Pure grouping + threshold arithmetic.
 */

// ============================================================================
// Types
// ============================================================================

/** One occurrence of a (hashed) waste pattern, observed at a point in time. */
export interface WasteRecord {
  /** Opaque hash of the waste pattern (PII-safe; host-computed). */
  fingerprint: string;
  /** Short human label for the pattern class (host-supplied, content-free). */
  label?: string;
  /** Tokens wasted by this occurrence. Finite, >= 0. */
  tokens: number;
  /** USD cost of this occurrence, or null when the model was unpriced. */
  costUsd?: number | null;
  /** ISO timestamp of the occurrence (used for distinct-day recurrence). */
  atIso: string;
}

export interface WasteMemoOptions {
  /** Minimum occurrences for a pattern to count as recurring. Default 3. */
  minOccurrences?: number;
  /** Minimum DISTINCT calendar days a pattern must span. Default 2. */
  minDistinctDays?: number;
  /** Cap the memo to the top-N patterns by rank. 0 / unset = all. Default 5. */
  topN?: number;
}

export interface WastePattern {
  fingerprint: string;
  label: string | null;
  occurrences: number;
  /** Distinct UTC calendar days the pattern was seen on. */
  distinctDays: number;
  totalTokens: number;
  /** Sum of costs; null when ANY occurrence was unpriced (never fabricated). */
  totalCostUsd: number | null;
  firstSeenIso: string;
  lastSeenIso: string;
}

export interface WasteMemo {
  /** Recurring patterns, ranked worst-first (cost when fully priced, else tokens). */
  patterns: WastePattern[];
  /** Distinct fingerprints seen (before the recurrence filter). */
  totalPatternsSeen: number;
  /** Patterns that did NOT meet the recurrence thresholds. */
  belowThreshold: number;
  /** Records ignored because they were malformed. */
  skipped: number;
}

// ============================================================================
// buildWasteMemo
// ============================================================================

export function buildWasteMemo(records: unknown, options: WasteMemoOptions = {}): WasteMemo {
  const minOccurrences = intOr(options.minOccurrences, 3, 1);
  const minDistinctDays = intOr(options.minDistinctDays, 2, 1);
  const topN =
    typeof options.topN === "number" && Number.isFinite(options.topN) && options.topN > 0
      ? Math.floor(options.topN)
      : options.topN === undefined
        ? 5
        : 0; // explicit 0 = all

  const list: unknown[] = Array.isArray(records) ? records : [];
  let skipped = 0;

  interface Acc {
    fingerprint: string;
    label: string | null;
    occurrences: number;
    days: Set<string>;
    totalTokens: number;
    totalCostUsd: number;
    costComplete: boolean;
    firstMs: number;
    lastMs: number;
    firstIso: string;
    lastIso: string;
  }
  const byFp = new Map<string, Acc>();

  for (const r of list) {
    if (!isWasteRecord(r)) {
      skipped++;
      continue;
    }
    const ms = Date.parse(r.atIso);
    if (!Number.isFinite(ms)) {
      skipped++;
      continue;
    }
    const acc =
      byFp.get(r.fingerprint) ??
      ({
        fingerprint: r.fingerprint,
        label: null,
        occurrences: 0,
        days: new Set<string>(),
        totalTokens: 0,
        totalCostUsd: 0,
        costComplete: true,
        firstMs: Infinity,
        lastMs: -Infinity,
        firstIso: r.atIso,
        lastIso: r.atIso,
      } as Acc);

    acc.occurrences++;
    acc.days.add(utcDay(ms));
    acc.totalTokens += nonNeg(r.tokens);
    if (acc.label === null && typeof r.label === "string" && r.label.length > 0) {
      acc.label = r.label;
    }
    const cost = r.costUsd;
    if (typeof cost === "number" && Number.isFinite(cost)) acc.totalCostUsd += cost;
    else acc.costComplete = false; // null/absent ⇒ cannot total honestly
    if (ms < acc.firstMs) {
      acc.firstMs = ms;
      acc.firstIso = r.atIso;
    }
    if (ms > acc.lastMs) {
      acc.lastMs = ms;
      acc.lastIso = r.atIso;
    }
    byFp.set(r.fingerprint, acc);
  }

  const totalPatternsSeen = byFp.size;
  let belowThreshold = 0;
  const patterns: WastePattern[] = [];
  for (const acc of byFp.values()) {
    if (acc.occurrences < minOccurrences || acc.days.size < minDistinctDays) {
      belowThreshold++;
      continue;
    }
    patterns.push({
      fingerprint: acc.fingerprint,
      label: acc.label,
      occurrences: acc.occurrences,
      distinctDays: acc.days.size,
      totalTokens: acc.totalTokens,
      totalCostUsd: acc.costComplete ? round(acc.totalCostUsd) : null,
      firstSeenIso: acc.firstIso,
      lastSeenIso: acc.lastIso,
    });
  }

  // Rank worst-first: by cost when BOTH are priced; otherwise by tokens. A
  // priced pattern always outranks an unpriced one (a known cost is a stronger
  // signal). Fingerprint breaks ties for a total, stable order.
  patterns.sort((a, b) => {
    if (a.totalCostUsd !== null && b.totalCostUsd !== null) {
      if (b.totalCostUsd !== a.totalCostUsd) return b.totalCostUsd - a.totalCostUsd;
    } else if (a.totalCostUsd !== null) return -1;
    else if (b.totalCostUsd !== null) return 1;
    if (b.totalTokens !== a.totalTokens) return b.totalTokens - a.totalTokens;
    return a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : 0;
  });

  return {
    patterns: topN > 0 ? patterns.slice(0, topN) : patterns,
    totalPatternsSeen,
    belowThreshold,
    skipped,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

function isWasteRecord(v: unknown): v is WasteRecord {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.fingerprint === "string" &&
    r.fingerprint.length > 0 &&
    typeof r.tokens === "number" &&
    Number.isFinite(r.tokens) &&
    r.tokens >= 0 &&
    typeof r.atIso === "string" &&
    r.atIso.length > 0
  );
}

function nonNeg(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

function intOr(v: unknown, dflt: number, min: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= min ? Math.floor(v) : dflt;
}

function round(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
