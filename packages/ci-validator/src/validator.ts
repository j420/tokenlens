/**
 * CI-Outcome Fix-Context Validator  (F6)
 * ======================================
 * f1 trajectory-diet predicts in-session influence; the Context-Utility Model
 * (F1) learns from accept/reject. Neither uses the cleanest external supervisor
 * for a BUG-FIX task: the build. A red→green test transition is ground truth
 * that the fix worked; a still-red one is ground truth it didn't. This learns,
 * per (failure class, context atom), how strongly the atom's presence is
 * associated with a fix — so the next failure of that class can be given the
 * context that historically fixed it.
 *
 * THE DISCIPLINE (no model in the decision): the red→green verdict is CALLER-FED
 * (the host reads it from CI). The estimator is a pure Beta-Binomial counter,
 * keyed by failure class. With no CI signal for a class it is INERT — every
 * association is null and the caller's base selection stands. No regex, no model.
 */

// ============================================================================
// Types
// ============================================================================

export interface FixCounter {
  /** Atom present when the class went red→green (fixed). */
  fixed: number;
  /** Atom present when the class stayed red (not fixed). */
  notFixed: number;
}

/** Plain JSON store. Key = `${failureClass}` → atomId → counter. */
export interface CiState {
  version: 1;
  classes: Record<string, Record<string, FixCounter>>;
}

export interface FixEpisode {
  /** The failure class (test id / error signature bucket). Caller-supplied id. */
  failureClass: string;
  /** Context atom ids that were present for this fix attempt. */
  atoms: string[];
  /** Did the build go red→green this attempt? (caller-fed CI transition). */
  fixed: boolean;
}

export interface QueryOptions {
  priorAlpha?: number;
  priorBeta?: number;
  /** Minimum observations of the atom (in this class) before reporting. Default 2. */
  minObservations?: number;
}

export interface FixAssociation {
  atomId: string;
  /** Posterior P(fix | atom present) in [0,1], or null when cold-start. */
  association: number | null;
  fixed: number;
  notFixed: number;
}

export interface RankedFixAtom extends FixAssociation {
  coldStart: boolean;
}

// ============================================================================
// Construction + folding
// ============================================================================

export function emptyCiState(): CiState {
  return { version: 1, classes: {} };
}

export function recordFixEpisode(state: unknown, episode: unknown): CiState {
  const next = coerce(state);
  if (!isEpisode(episode)) return next;
  const cls = next.classes[episode.failureClass] ?? {};
  const seen = new Set<string>();
  for (const atom of episode.atoms) {
    if (typeof atom !== "string" || atom.length === 0 || seen.has(atom)) continue;
    seen.add(atom);
    const c = cls[atom] ?? { fixed: 0, notFixed: 0 };
    if (episode.fixed) c.fixed += 1;
    else c.notFixed += 1;
    cls[atom] = c;
  }
  next.classes[episode.failureClass] = cls;
  return next;
}

// ============================================================================
// Query + rank
// ============================================================================

export function queryFixAssociation(
  state: unknown,
  failureClass: string,
  atomId: string,
  options: QueryOptions = {}
): FixAssociation {
  const priorAlpha = posNum(options.priorAlpha, 1);
  const priorBeta = posNum(options.priorBeta, 1);
  const minObservations = intOr(options.minObservations, 2, 1);

  const s = coerce(state);
  const c = s.classes[failureClass]?.[atomId];
  const fixed = c?.fixed ?? 0;
  const notFixed = c?.notFixed ?? 0;
  const n = fixed + notFixed;
  if (n < minObservations) {
    return { atomId, association: null, fixed, notFixed };
  }
  const a = fixed + priorAlpha;
  const b = notFixed + priorBeta;
  return { atomId, association: a / (a + b), fixed, notFixed };
}

export function rankFixContext(
  state: unknown,
  failureClass: string,
  candidateAtoms: unknown,
  options: QueryOptions = {}
): RankedFixAtom[] {
  const ids: string[] = Array.isArray(candidateAtoms)
    ? (candidateAtoms.filter((x) => typeof x === "string" && x.length > 0) as string[])
    : [];
  const ranked = ids.map((id) => {
    const est = queryFixAssociation(state, failureClass, id, options);
    return { ...est, coldStart: est.association === null };
  });
  ranked.sort((x, y) => {
    if (x.association === null && y.association === null) return cmp(x.atomId, y.atomId);
    if (x.association === null) return 1;
    if (y.association === null) return -1;
    if (y.association !== x.association) return y.association - x.association;
    return cmp(x.atomId, y.atomId);
  });
  return ranked;
}

// ============================================================================
// Helpers
// ============================================================================

function coerce(state: unknown): CiState {
  const out: CiState = { version: 1, classes: {} };
  if (!state || typeof state !== "object") return out;
  const s = state as Partial<CiState>;
  if (!s.classes || typeof s.classes !== "object") return out;
  for (const [cls, atoms] of Object.entries(s.classes)) {
    if (!atoms || typeof atoms !== "object") continue;
    const bucket: Record<string, FixCounter> = {};
    for (const [atom, raw] of Object.entries(atoms)) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Partial<FixCounter>;
      if (
        typeof r.fixed === "number" &&
        Number.isFinite(r.fixed) &&
        typeof r.notFixed === "number" &&
        Number.isFinite(r.notFixed)
      ) {
        bucket[atom] = { fixed: Math.max(0, Math.floor(r.fixed)), notFixed: Math.max(0, Math.floor(r.notFixed)) };
      }
    }
    out.classes[cls] = bucket;
  }
  return out;
}

function isEpisode(v: unknown): v is FixEpisode {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.failureClass === "string" &&
    e.failureClass.length > 0 &&
    Array.isArray(e.atoms) &&
    typeof e.fixed === "boolean"
  );
}

function posNum(v: unknown, dflt: number): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : dflt;
}

function intOr(v: unknown, dflt: number, min: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= min ? Math.floor(v) : dflt;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
