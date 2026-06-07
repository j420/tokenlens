/**
 * Context-Utility Model (CUM)  — F1
 * =================================
 * CLAUDE.md Phase-2(a) made a product surface. Every selector (the
 * prune-intelligence DAG walker, trajectory-diet, repo-map, the pull protocol)
 * independently guesses how useful a context atom is. The CUM is the standing
 * model they should all query instead: per atom (a symbol / file / tool-result
 * region, identified by an opaque id), it learns the atom's REALIZED
 * contribution to accepted output — supervised by the developer's terminal
 * verdict (kept vs threw away), the one ground-truth signal no per-request
 * feature observes.
 *
 * THE DISCIPLINE (why this is not a "model in the decision core"):
 *   - The learning signal is CALLER-FED. The host decides, per observation,
 *     whether an atom `contributed` (via cite-back / accept-reject); this
 *     package never inspects content and never calls a model.
 *   - The estimator is a pure, deterministic **decayed Beta-Binomial
 *     empirical-Bayes** counter. Utility = posterior mean of P(contributes);
 *     uncertainty = the closed-form posterior std-dev. Same observations (in any
 *     order) => same posterior. No randomness, no regex, no model.
 *   - Recency is handled by exponentially-decayed counts (half-life), so a
 *     stale prior fades deterministically rather than dominating forever.
 *   - FLOOR-SAFE: below `minObservations` an atom's utility is `null`, so a
 *     selector that queries it falls back to its base behavior — the CUM can
 *     only ever ADD a prior, never force-drop an atom. Correct when switched off.
 */

// ============================================================================
// Types
// ============================================================================

/** One outcome observation for a context atom. `contributed` is caller-derived. */
export interface UtilityObservation {
  /** Opaque atom id (symbol/file/region). Never interpreted. */
  atomId: string;
  /** Did this atom contribute to the ACCEPTED output? (host: cite-back/accept). */
  contributed: boolean;
  /** ISO timestamp of the observation (drives deterministic decay + ordering). */
  atIso: string;
}

/** Per-atom decayed counters. `included`/`contributed` are real-valued weights. */
export interface AtomStat {
  /** Decayed count of times the atom was included. */
  included: number;
  /** Decayed count of times it contributed (<= included). */
  contributed: number;
  /** Raw (undecayed) observation count — drives the cold-start floor. */
  n: number;
  /** Epoch ms the counters are decayed-to (the latest folded observation). */
  asOfMs: number;
}

/** The standing model. Plain JSON — serialize by `JSON.stringify`. */
export interface CumState {
  version: 1;
  atoms: Record<string, AtomStat>;
}

export interface UpdateOptions {
  /**
   * Decay half-life in ms. When set, each atom's counters are decayed to the
   * timestamp of each new observation before it is folded in (exponentially-
   * weighted counting). Unset / <= 0 ⇒ no decay (counts are plain sums).
   */
  halfLifeMs?: number;
}

export interface QueryOptions {
  /** Beta prior pseudo-counts. Default α=β=1 (uniform / Laplace smoothing). */
  priorAlpha?: number;
  priorBeta?: number;
  /**
   * Minimum RAW observations before a utility is reported. Below this the atom
   * is cold-start and `utility` is null. Default 3.
   */
  minObservations?: number;
  /**
   * Optionally decay the stored counters forward to this instant before
   * estimating (so a query "now" ages a prior last touched long ago). Requires
   * halfLifeMs. ISO 8601.
   */
  nowIso?: string;
  /** Decay half-life in ms for the optional query-time forward-decay. */
  halfLifeMs?: number;
}

export interface UtilityEstimate {
  atomId: string;
  /**
   * Posterior mean of P(atom contributes) in [0,1], or null when cold-start /
   * unknown. NEVER fabricated — null means "no prior, run the base selector".
   */
  utility: number | null;
  /** Closed-form posterior std-dev (uncertainty), or null when cold-start. */
  stdDev: number | null;
  /** Effective (decayed) inclusion weight backing the estimate. */
  effectiveObservations: number;
  /** Raw observation count (the cold-start denominator). */
  rawObservations: number;
}

// ============================================================================
// State construction
// ============================================================================

export function emptyCumState(): CumState {
  return { version: 1, atoms: {} };
}

// ============================================================================
// updateUtility — fold observations into the model (pure; immutable)
// ============================================================================

export function updateUtility(
  state: unknown,
  observations: unknown,
  options: UpdateOptions = {}
): CumState {
  const halfLifeMs =
    typeof options.halfLifeMs === "number" && Number.isFinite(options.halfLifeMs) && options.halfLifeMs > 0
      ? options.halfLifeMs
      : 0;

  const next = coerceState(state);
  const obs: UtilityObservation[] = Array.isArray(observations)
    ? (observations.filter(isObservation) as UtilityObservation[])
    : [];

  // Sort by time so decayed counting is deterministic regardless of input order
  // (and so we never decay by a negative age). Ties keep input order (stable).
  const ordered = obs
    .map((o, i) => ({ o, t: Date.parse(o.atIso), i }))
    .filter((x) => Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t || a.i - b.i);

  for (const { o, t } of ordered) {
    const prev = next.atoms[o.atomId];
    const stat: AtomStat = prev
      ? { ...prev }
      : { included: 0, contributed: 0, n: 0, asOfMs: t };
    if (halfLifeMs > 0 && t > stat.asOfMs) {
      const f = decayFactor(t - stat.asOfMs, halfLifeMs);
      stat.included *= f;
      stat.contributed *= f;
    }
    stat.included += 1;
    if (o.contributed) stat.contributed += 1;
    stat.n += 1;
    if (t > stat.asOfMs) stat.asOfMs = t;
    next.atoms[o.atomId] = stat;
  }
  return next;
}

// ============================================================================
// queryUtility — the empirical-Bayes posterior (pure)
// ============================================================================

export function queryUtility(
  state: unknown,
  atomId: string,
  options: QueryOptions = {}
): UtilityEstimate {
  const priorAlpha = posNum(options.priorAlpha, 1);
  const priorBeta = posNum(options.priorBeta, 1);
  const minObservations = intOr(options.minObservations, 3, 1);

  const s = coerceState(state);
  const stat = typeof atomId === "string" ? s.atoms[atomId] : undefined;

  if (!stat || stat.n < minObservations) {
    return {
      atomId,
      utility: null,
      stdDev: null,
      effectiveObservations: stat ? stat.included : 0,
      rawObservations: stat ? stat.n : 0,
    };
  }

  let included = stat.included;
  let contributed = stat.contributed;

  // Optional forward-decay to a query "now".
  const halfLifeMs =
    typeof options.halfLifeMs === "number" && Number.isFinite(options.halfLifeMs) && options.halfLifeMs > 0
      ? options.halfLifeMs
      : 0;
  if (halfLifeMs > 0 && typeof options.nowIso === "string") {
    const now = Date.parse(options.nowIso);
    if (Number.isFinite(now) && now > stat.asOfMs) {
      const f = decayFactor(now - stat.asOfMs, halfLifeMs);
      included *= f;
      contributed *= f;
    }
  }

  // Beta posterior: a = contributed + α, b = (included − contributed) + β.
  const a = contributed + priorAlpha;
  const b = Math.max(0, included - contributed) + priorBeta;
  const mean = a / (a + b);
  const variance = (a * b) / ((a + b) * (a + b) * (a + b + 1));
  return {
    atomId,
    utility: clamp01(mean),
    stdDev: Math.sqrt(Math.max(0, variance)),
    effectiveObservations: included,
    rawObservations: stat.n,
  };
}

// ============================================================================
// rankAtoms — deterministic utility ranking (pure)
// ============================================================================

export interface RankedAtom extends UtilityEstimate {
  /** True when utility is null (cold-start) — ranked last, base selector wins. */
  coldStart: boolean;
}

export function rankAtoms(
  state: unknown,
  atomIds: unknown,
  options: QueryOptions = {}
): RankedAtom[] {
  const ids: string[] = Array.isArray(atomIds)
    ? (atomIds.filter((x) => typeof x === "string" && x.length > 0) as string[])
    : [];
  const ranked = ids.map((id) => {
    const est = queryUtility(state, id, options);
    return { ...est, coldStart: est.utility === null };
  });
  // Known utility first (desc); cold-start last; stable tiebreak by atomId.
  ranked.sort((x, y) => {
    if (x.utility === null && y.utility === null) return cmp(x.atomId, y.atomId);
    if (x.utility === null) return 1;
    if (y.utility === null) return -1;
    if (y.utility !== x.utility) return y.utility - x.utility;
    return cmp(x.atomId, y.atomId);
  });
  return ranked;
}

// ============================================================================
// Helpers
// ============================================================================

function decayFactor(ageMs: number, halfLifeMs: number): number {
  return Math.pow(0.5, ageMs / halfLifeMs);
}

function coerceState(state: unknown): CumState {
  const out: CumState = { version: 1, atoms: {} };
  if (!state || typeof state !== "object") return out;
  const s = state as Partial<CumState>;
  if (!s.atoms || typeof s.atoms !== "object") return out;
  for (const [id, raw] of Object.entries(s.atoms)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Partial<AtomStat>;
    if (
      typeof r.included === "number" &&
      Number.isFinite(r.included) &&
      typeof r.contributed === "number" &&
      Number.isFinite(r.contributed) &&
      typeof r.n === "number" &&
      Number.isFinite(r.n) &&
      typeof r.asOfMs === "number" &&
      Number.isFinite(r.asOfMs)
    ) {
      out.atoms[id] = {
        included: Math.max(0, r.included),
        contributed: Math.max(0, Math.min(r.included, r.contributed)),
        n: Math.max(0, Math.floor(r.n)),
        asOfMs: r.asOfMs,
      };
    }
  }
  return out;
}

function isObservation(v: unknown): v is UtilityObservation {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.atomId === "string" &&
    o.atomId.length > 0 &&
    typeof o.contributed === "boolean" &&
    typeof o.atIso === "string" &&
    o.atIso.length > 0
  );
}

function posNum(v: unknown, dflt: number): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : dflt;
}

function intOr(v: unknown, dflt: number, min: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= min ? Math.floor(v) : dflt;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
