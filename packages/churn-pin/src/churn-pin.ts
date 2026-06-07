/**
 * Git-Churn Cache-Pin Planner  (F9)
 * =================================
 * A prompt-cache prefix is only worth building if it survives. The existing
 * cache planners reason about the CURRENT content (is the prefix byte-stable
 * right now?); none look FORWARD. Git history is a free, forward-looking signal:
 * a file edited many times in the last fortnight is about to be edited again, so
 * pinning it into the cached prefix pays a cache-write that the next edit
 * immediately busts. A file untouched for months is stable — pin it.
 *
 * `planChurnPins(files, options?)` is a PURE function over caller-supplied
 * per-file churn (the HOST runs `git log --numstat` / blame; this package never
 * shells out). It classifies each file pin vs skip by recent-commit frequency
 * and returns a deterministic, prefix-ordered plan.
 *
 * DISCIPLINE:
 *   - Deterministic & total. Same churn => same plan. Malformed files skipped.
 *   - Caller-fed only. Operates on commit COUNTS + token counts the host
 *     supplies; it carries no file content (PII-safe by construction).
 *   - No fabricated numbers. It never invents a churn count or a token size.
 *   - No regex, no model. Pure threshold arithmetic.
 */

// ============================================================================
// Types
// ============================================================================

/** Per-file churn the host derived from git. */
export interface ChurnFile {
  /** File path (identity key; not interpreted). */
  path: string;
  /**
   * Number of commits touching this file within the host's chosen RECENT
   * window (e.g. last 14 days). The forward-invalidation proxy. Finite, >= 0.
   */
  recentCommits: number;
  /** Token size of the file's cacheable content (caller-supplied via tokenizer). */
  tokens: number;
}

export interface ChurnPinOptions {
  /**
   * Maximum recent commits for a file to still be PINNED. Default 1 — a file
   * touched at most once recently is stable enough to cache; more than that and
   * the next edit will likely bust the prefix before the cache pays off.
   */
  maxRecentCommits?: number;
  /**
   * Optional cap on total pinned tokens (prefix budget). When set, the lowest-
   * churn files are pinned first until the budget is reached; the rest spill to
   * `skip` with reason "budget". 0 / unset = no cap.
   */
  maxPinnedTokens?: number;
}

export type PinReason = "stable" | "high-churn" | "budget";

export interface PinDecision {
  path: string;
  recentCommits: number;
  tokens: number;
  pinned: boolean;
  reason: PinReason;
}

export interface ChurnPinPlan {
  /** Files to pin, ordered for prefix placement (most stable first). */
  pin: PinDecision[];
  /** Files to keep OUT of the cached prefix. */
  skip: PinDecision[];
  pinnedTokens: number;
  skippedTokens: number;
  /** Files ignored because they were malformed. */
  skippedMalformed: number;
}

// ============================================================================
// planChurnPins
// ============================================================================

export function planChurnPins(files: unknown, options: ChurnPinOptions = {}): ChurnPinPlan {
  const maxRecentCommits = intOr(options.maxRecentCommits, 1, /*min*/ 0);
  const budget =
    typeof options.maxPinnedTokens === "number" &&
    Number.isFinite(options.maxPinnedTokens) &&
    options.maxPinnedTokens > 0
      ? Math.floor(options.maxPinnedTokens)
      : 0;

  const list: ChurnFile[] = Array.isArray(files)
    ? (files.filter(isChurnFile) as ChurnFile[])
    : [];
  const skippedMalformed = (Array.isArray(files) ? files.length : 0) - list.length;

  // Deterministic priority: lowest churn first, then larger files (a bigger
  // stable file is more valuable to cache), then path for a total order.
  const ordered = [...list].sort(
    (a, b) =>
      a.recentCommits - b.recentCommits ||
      b.tokens - a.tokens ||
      (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  );

  const pin: PinDecision[] = [];
  const skip: PinDecision[] = [];
  let pinnedTokens = 0;
  let skippedTokens = 0;

  for (const f of ordered) {
    if (f.recentCommits > maxRecentCommits) {
      skip.push(decision(f, false, "high-churn"));
      skippedTokens += f.tokens;
      continue;
    }
    if (budget > 0 && pinnedTokens + f.tokens > budget) {
      skip.push(decision(f, false, "budget"));
      skippedTokens += f.tokens;
      continue;
    }
    pin.push(decision(f, true, "stable"));
    pinnedTokens += f.tokens;
  }

  return { pin, skip, pinnedTokens, skippedTokens, skippedMalformed };
}

// ============================================================================
// Helpers
// ============================================================================

function decision(f: ChurnFile, pinned: boolean, reason: PinReason): PinDecision {
  return { path: f.path, recentCommits: f.recentCommits, tokens: f.tokens, pinned, reason };
}

function isChurnFile(v: unknown): v is ChurnFile {
  if (!v || typeof v !== "object") return false;
  const f = v as Record<string, unknown>;
  return (
    typeof f.path === "string" &&
    f.path.length > 0 &&
    typeof f.recentCommits === "number" &&
    Number.isFinite(f.recentCommits) &&
    f.recentCommits >= 0 &&
    typeof f.tokens === "number" &&
    Number.isFinite(f.tokens) &&
    f.tokens >= 0
  );
}

function intOr(v: unknown, dflt: number, min: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= min ? Math.floor(v) : dflt;
}
