/**
 * Identical-Action Loop Detector  (degeneration-loop fold into loop-breaker)
 * ==========================================================================
 * `loop-breaker` blocks on sustained *low-ROI* turns; `thrash-detector` catches
 * a file oscillating A->B->A. Both miss a third no-progress mode: the agent
 * re-issuing the EXACT same tool call — same tool, same (canonicalized) input —
 * and getting back the EXACT same result, over and over. That is provable
 * no-progress (the world did not change between calls), and it can happen while
 * per-turn ROI looks fine (e.g. re-running a failing test verbatim, re-reading
 * an unchanged file the speculative cache didn't serve).
 *
 * `evaluateIdenticalActionLoop(observations, options?)` is a PURE function over
 * a caller-fed list of `(tool, input, resultSha)` observations. It groups by the
 * triple — tool + canonical input + result SHA — and blocks when one triple
 * recurs at least `minRepetitions` times. The result-SHA gate is the soundness
 * lever: two calls with the same args but DIFFERENT results are real progress
 * (the state changed) and never trip it.
 *
 * SOUNDNESS NOTE (honest limitation): the gate requires the result to be
 * BYTE-IDENTICAL (same SHA). Results that embed volatile text — a test runner's
 * elapsed-time line, a timestamp, a random port — differ run-to-run and so will
 * NOT be flagged even when the loop is real. That is deliberate under-detection
 * (it preserves the zero-false-positive guarantee); the caller hashes the result
 * and may normalize volatile fields before doing so if it wants higher recall.
 *
 * DISCIPLINE:
 *   - Deterministic & total. Input is canonicalized by a stable, recursive
 *     key-sorted serialization — same observations => same decision. Malformed
 *     observations are skipped, never thrown on.
 *   - No regex, no model. Grouping is exact-key equality; nothing parses or
 *     classifies content. The result SHA is caller-supplied (the hook hashes the
 *     result), so this module carries no result bytes (PII-safe).
 *   - Advisory/fail-safe. Returns a decision; the caller (loop-breaker hook)
 *     decides whether to surface it. Below threshold => shouldBlock:false.
 */

// ============================================================================
// Types
// ============================================================================

/** One observed tool call paired with the SHA of the result it produced. */
export interface ActionObservation {
  /** Monotonic turn/step index (ordering + span reporting only). */
  turn: number;
  /** Tool name (identity key; not interpreted). */
  tool: string;
  /** Tool input; canonicalized internally to a stable key. */
  input: unknown;
  /** Content hash of the tool RESULT (e.g. first 12 hex of sha256). */
  resultSha: string;
}

export interface IdenticalActionOptions {
  /**
   * How many identical (tool, input, result) occurrences trip the detector.
   * Default 3 — the same no-op action a third time is a confirmed loop.
   */
  minRepetitions?: number;
  /**
   * Only consider the most recent `window` observations. 0 / unset = all.
   * Default 0 (all supplied; the caller already bounds the session view).
   */
  window?: number;
}

export interface IdenticalActionDecision {
  shouldBlock: boolean;
  /** Human-readable reason, present iff shouldBlock. */
  reason?: string;
  /** The looping tool, iff shouldBlock. */
  tool?: string;
  /** How many times the identical action recurred, iff shouldBlock. */
  repetitions?: number;
  /** The shared result SHA, iff shouldBlock. */
  resultSha?: string;
  /** Turn indices where the loop's identical action occurred, iff shouldBlock. */
  turns?: number[];
}

// ============================================================================
// evaluateIdenticalActionLoop
// ============================================================================

export function evaluateIdenticalActionLoop(
  observations: unknown,
  options: IdenticalActionOptions = {}
): IdenticalActionDecision {
  const minRepetitions = posInt(options.minRepetitions, 3);
  const window =
    typeof options.window === "number" &&
    Number.isFinite(options.window) &&
    options.window > 0
      ? Math.floor(options.window)
      : 0;

  const all: ActionObservation[] = Array.isArray(observations)
    ? (observations.filter(isActionObservation) as ActionObservation[])
    : [];
  const considered = window > 0 ? all.slice(-window) : all;

  // Group by the (tool, canonical input, result SHA) triple. A JSON array key
  // is unambiguous — no separator a value could collide with. The map value
  // records the count and the turn indices, in arrival order.
  const groups = new Map<string, { tool: string; resultSha: string; turns: number[] }>();
  for (const o of considered) {
    const key = JSON.stringify([o.tool, canonicalKey(o.input), o.resultSha]);
    const g = groups.get(key) ?? { tool: o.tool, resultSha: o.resultSha, turns: [] };
    g.turns.push(o.turn);
    groups.set(key, g);
  }

  // Pick the worst offender: most repetitions, tie-broken by latest activity.
  let worst: { tool: string; resultSha: string; turns: number[] } | null = null;
  for (const g of groups.values()) {
    if (g.turns.length < minRepetitions) continue;
    if (
      !worst ||
      g.turns.length > worst.turns.length ||
      (g.turns.length === worst.turns.length &&
        lastOf(g.turns) > lastOf(worst.turns))
    ) {
      worst = g;
    }
  }

  if (!worst) return { shouldBlock: false };

  const reps = worst.turns.length;
  return {
    shouldBlock: true,
    tool: worst.tool,
    repetitions: reps,
    resultSha: worst.resultSha,
    turns: [...worst.turns],
    reason:
      `Prune circuit-breaker: the "${worst.tool}" tool was called ${reps} times with ` +
      `identical input and produced an identical result each time — no progress is being made. ` +
      `Re-issuing the same call will return the same answer; change the input, the approach, ` +
      `or re-read the failing signal before trying again.`,
  };
}

// ============================================================================
// Canonicalization (stable, recursive key sort — never regex)
// ============================================================================

/**
 * Deterministic key for an arbitrary JSON-ish value: object keys are sorted
 * recursively so `{a:1,b:2}` and `{b:2,a:1}` map to the same string. Total —
 * any value that cannot be serialized collapses to a stable sentinel rather
 * than throwing.
 */
export function canonicalKey(value: unknown): string {
  try {
    return JSON.stringify(sortValue(value, new WeakSet()));
  } catch {
    return "[unserializable]";
  }
}

function sortValue(value: unknown, ancestors: WeakSet<object>): unknown {
  if (value === null || typeof value !== "object") return value;
  // Track ANCESTORS only (add on enter, remove on exit) so a true cycle is
  // caught while a shared-but-acyclic sub-object (a DAG) still serializes
  // identically wherever it appears.
  if (ancestors.has(value)) return "[cycle]";
  ancestors.add(value);
  let result: unknown;
  if (Array.isArray(value)) {
    result = value.map((v) => sortValue(v, ancestors));
  } else {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) out[k] = sortValue(obj[k], ancestors);
    result = out;
  }
  ancestors.delete(value);
  return result;
}

// ============================================================================
// Helpers
// ============================================================================

function isActionObservation(v: unknown): v is ActionObservation {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.turn === "number" &&
    Number.isFinite(o.turn) &&
    typeof o.tool === "string" &&
    o.tool.length > 0 &&
    typeof o.resultSha === "string" &&
    o.resultSha.length > 0
  );
}

function lastOf(turns: number[]): number {
  return turns.length > 0 ? turns[turns.length - 1]! : -Infinity;
}

function posInt(v: unknown, dflt: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 1
    ? Math.floor(v)
    : dflt;
}
