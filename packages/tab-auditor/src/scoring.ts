/**
 * The relevance scoring model.
 *
 * Each open tab is scored against the current task by blending four structural
 * signals, every one normalized to [0,1]:
 *
 *   activeAdjacency  How structurally close the tab is to the active file —
 *                    import-graph BFS proximity when edges are supplied,
 *                    otherwise shared-path-prefix proximity. (graph.ts)
 *
 *   recency          How recently the tab was accessed. Computed by ranking
 *                    the supplied lastAccessedAt timestamps; the most recent
 *                    tab → 1, the oldest → 0. NULL timestamps are NEUTRAL
 *                    (0.5) — never fabricated as "now" or "ancient".
 *
 *   taskMatch        Jaccard overlap between the tab's structural path tokens
 *                    and the task keyword tokens. (tokenize.ts)
 *
 *   sizePenalty      A KEEP signal derived from token count: small files are
 *                    cheap to keep (→1), large files are expensive (→toward 0).
 *                    So a large file lowers keep-priority. MISSING tokenCount
 *                    ⇒ this signal is OMITTED (we don't invent a size).
 *
 * WEIGHTS (sum to 1). They are the default; callers may override any subset.
 * When a signal is OMITTED for a given audit (e.g. no keywords ⇒ taskMatch
 * omitted, or no tokenCount on a tab ⇒ sizePenalty omitted), the remaining
 * weights are RENORMALIZED so they still sum to 1 over the present signals.
 * This keeps every relevance score in [0,1] and comparable.
 */

export interface ScoringWeights {
  activeAdjacency: number;
  recency: number;
  taskMatch: number;
  sizePenalty: number;
}

export const DEFAULT_WEIGHTS: Readonly<ScoringWeights> = Object.freeze({
  activeAdjacency: 0.4,
  recency: 0.2,
  taskMatch: 0.3,
  sizePenalty: 0.1,
});

/** A signal value that is present, or `null` meaning "omit from the blend". */
export type Signal = number | null;

export interface SignalSet {
  activeAdjacency: Signal;
  recency: Signal;
  taskMatch: Signal;
  sizePenalty: Signal;
}

/** Clamp x into [0,1]; non-finite ⇒ 0. */
export function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/**
 * Blend present signals using renormalized weights.
 *
 * - Each present signal is clamped to [0,1].
 * - Weights for present signals are summed and used to renormalize, so the
 *   effective weights always sum to 1 across the signals that exist.
 * - If NO signal is present (degenerate), returns 0 (nothing to go on).
 *
 * Returns both the score and the effective (renormalized) weights actually
 * used, for transparency/auditing.
 */
export function blend(
  signals: SignalSet,
  weights: ScoringWeights = DEFAULT_WEIGHTS,
): { score: number; effectiveWeights: Partial<ScoringWeights> } {
  const keys: (keyof ScoringWeights)[] = [
    "activeAdjacency",
    "recency",
    "taskMatch",
    "sizePenalty",
  ];

  let presentWeightSum = 0;
  for (const k of keys) {
    if (signals[k] !== null && signals[k] !== undefined) {
      const w = weights[k];
      if (Number.isFinite(w) && w > 0) presentWeightSum += w;
    }
  }

  if (presentWeightSum <= 0) {
    return { score: 0, effectiveWeights: {} };
  }

  let score = 0;
  const effectiveWeights: Partial<ScoringWeights> = {};
  for (const k of keys) {
    const v = signals[k];
    if (v === null || v === undefined) continue;
    const w = weights[k];
    if (!Number.isFinite(w) || w <= 0) continue;
    const ew = w / presentWeightSum;
    effectiveWeights[k] = ew;
    score += ew * clamp01(v);
  }

  return { score: clamp01(score), effectiveWeights };
}

/**
 * Map a token count to a sizePenalty KEEP signal in (0,1].
 *
 * We use a soft inverse curve: keepValue = midpoint / (midpoint + tokenCount).
 * At tokenCount = 0 → 1 (free to keep). At tokenCount = midpoint → 0.5.
 * As tokenCount → ∞ → 0 (very expensive to keep). `midpoint` is the token
 * count considered "medium" (default 2000). Monotonic decreasing, bounded.
 *
 * Returns null for a missing/invalid count so the signal is omitted.
 */
export function sizeKeepSignal(
  tokenCount: number | null | undefined,
  midpoint = 2000,
): Signal {
  if (
    tokenCount === null ||
    tokenCount === undefined ||
    !Number.isFinite(tokenCount) ||
    tokenCount < 0
  ) {
    return null;
  }
  const m = Number.isFinite(midpoint) && midpoint > 0 ? midpoint : 2000;
  return m / (m + tokenCount);
}
