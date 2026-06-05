/**
 * File-State Thrash Detector  (Cost-Security)
 * ===========================================
 * An agent stuck in an edit loop rewrites a file to state B, then back to a
 * previous state A, then to B again (A -> B -> A -> B ...). Each lap re-reads
 * and re-sends the file and burns an output rewrite, and the loop can run for
 * many turns before a human notices. `loop-breaker` catches low-ROI *turns*;
 * this catches the narrower, cheaper-to-detect signal of a file *returning to a
 * content state it already had* — pure waste, because no net progress was made.
 *
 * `detectThrash(timeline, options?)` is a PURE function over a caller-fed
 * timeline of per-turn file content hashes (the hook builds the timeline from a
 * small per-session state file — it never reads file bodies here). It reports,
 * per path, how many times the content OSCILLATED back to an earlier state.
 *
 * DISCIPLINE:
 *   - Deterministic & total. Same timeline => same report. Garbage entries are
 *     skipped, never thrown on.
 *   - Caller-fed only. Operates on content SHAs the caller supplies; it does not
 *     hash files itself, so it carries no file content (PII-safe by construction).
 *   - Advisory. Returns a verdict + findings; it never blocks. A genuine
 *     back-and-forth that is real work (each state distinct, monotonic progress)
 *     does not oscillate and is not flagged.
 */

// ============================================================================
// Types
// ============================================================================

/** One observed file state after an edit, at a given logical turn. */
export interface FileEditEvent {
  /** Monotonic turn / step index (used only for ordering + span reporting). */
  turn: number;
  /** File path (identity key; not interpreted). */
  path: string;
  /** Content hash AFTER this edit (e.g. first 12 hex of sha256). */
  sha: string;
}

export interface ThrashOptions {
  /**
   * Minimum number of oscillations (returns to an earlier state) for a path to
   * be flagged. Default 2 (A->B->A->B = 2 returns to a seen state).
   */
  minCycles?: number;
  /**
   * Only consider the most recent `window` events per path. 0 / unset = all.
   * Bounds memory and focuses on current behaviour. Default 0 (all).
   */
  window?: number;
}

export interface ThrashFinding {
  path: string;
  /** How many times the content returned to a previously-seen state. */
  cycles: number;
  /** Number of DISTINCT content states observed. */
  distinctStates: number;
  /** Total edit events observed for this path. */
  edits: number;
  /** First and last turn in the considered window. */
  firstTurn: number;
  lastTurn: number;
  /**
   * Edits that produced no net-new state — a conservative lower bound on wasted
   * rewrites (edits - distinctStates). >= 0.
   */
  wastedEdits: number;
}

export interface ThrashReport {
  verdict: "ok" | "warn";
  findings: ThrashFinding[];
}

// ============================================================================
// detectThrash
// ============================================================================

export function detectThrash(timeline: unknown, options: ThrashOptions = {}): ThrashReport {
  const minCycles = posInt(options.minCycles, 2);
  const window = Number.isFinite(options.window) && (options.window ?? 0) > 0 ? Math.floor(options.window as number) : 0;

  // --- Coerce + filter to well-formed events (never throw). ------------------
  const events: FileEditEvent[] = Array.isArray(timeline)
    ? (timeline.filter(isFileEditEvent) as FileEditEvent[])
    : [];
  if (events.length === 0) return { verdict: "ok", findings: [] };

  // --- Group by path, preserving input order, applying the per-path window. --
  const byPath = new Map<string, FileEditEvent[]>();
  for (const e of events) {
    const list = byPath.get(e.path) ?? [];
    list.push(e);
    byPath.set(e.path, list);
  }

  const findings: ThrashFinding[] = [];
  for (const [path, listRaw] of byPath) {
    // Stable ordering by turn, then by original arrival for equal turns.
    const list = [...listRaw].sort((a, b) => a.turn - b.turn);
    const considered = window > 0 ? list.slice(-window) : list;
    if (considered.length < 3) continue; // need at least A,B,A to oscillate

    const seen = new Set<string>();
    let cycles = 0;
    let prev: string | null = null;
    for (const e of considered) {
      // A "return" = re-encountering a state we've seen before, and it isn't
      // just the immediately-preceding state repeated (an idempotent no-op edit).
      if (seen.has(e.sha) && e.sha !== prev) cycles++;
      seen.add(e.sha);
      prev = e.sha;
    }

    if (cycles >= minCycles) {
      findings.push({
        path,
        cycles,
        distinctStates: seen.size,
        edits: considered.length,
        firstTurn: considered[0]!.turn,
        lastTurn: considered[considered.length - 1]!.turn,
        wastedEdits: Math.max(0, considered.length - seen.size),
      });
    }
  }

  // Deterministic ordering of findings: worst (most cycles) first, then path.
  findings.sort((a, b) => b.cycles - a.cycles || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  return { verdict: findings.length > 0 ? "warn" : "ok", findings };
}

// ============================================================================
// Helpers
// ============================================================================

function isFileEditEvent(v: unknown): v is FileEditEvent {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.turn === "number" &&
    Number.isFinite(e.turn) &&
    typeof e.path === "string" &&
    e.path.length > 0 &&
    typeof e.sha === "string" &&
    e.sha.length > 0
  );
}

function posInt(v: unknown, dflt: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 1 ? Math.floor(v) : dflt;
}
