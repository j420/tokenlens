/**
 * Marginal-Value Probe  (F8)
 * ==========================
 * f1 trajectory-diet PREDICTS which context will be low-influence. This MEASURES
 * it after the fact: a gated counterfactual replay re-runs a completed turn with
 * one chunk withheld, and the existing `@prune/equivalence` gate decides whether
 * the output is unchanged. A chunk whose removal leaves the output equivalent
 * had ZERO realized value — it was paid for and did nothing. The measured
 * verdicts both quantify the waste and feed the Context-Utility Model (F1) as
 * ground-truth contribution labels.
 *
 * `assessMarginalValue(chunks, options?)` is a deterministic function over
 * caller-fed verdicts: each chunk carries `outputEquivalentWithout` — the
 * equivalence gate's boolean (the host ran the replay; this package never calls
 * a model). Deterministic set arithmetic, no regex. (Determinism is over the
 * inputs INCLUDING `options.atIso`; when `atIso` is omitted the emitted
 * observations are stamped with the wall clock, so always pass `atIso` for a
 * fully reproducible result.)
 */

// ============================================================================
// Types
// ============================================================================

export interface ChunkVerdict {
  /** Atom/chunk id (used as the F1 observation key). */
  id: string;
  /** Tokens the chunk cost. */
  tokens: number;
  /**
   * Did the output stay EQUIVALENT when this chunk was withheld? (caller-fed
   * from the replay + @prune/equivalence). true ⇒ the chunk contributed nothing.
   * null ⇒ not probed (uncertain) — kept, and not labelled either way.
   */
  outputEquivalentWithout: boolean | null;
}

export interface AssessOptions {
  /** ISO timestamp stamped onto the emitted F1 observations. Default: now. */
  atIso?: string;
}

/** F1-shaped observation (matches @prune/context-utility UtilityObservation). */
export interface ContributionObservation {
  atomId: string;
  contributed: boolean;
  atIso: string;
}

export interface MarginalValueReport {
  /** Chunks proven to add nothing (equivalent without them). */
  zeroValueChunks: string[];
  /** Chunks that did contribute (output changed when withheld). */
  contributingChunks: string[];
  /** Chunks not probed (verdict null) — kept, unlabelled. */
  unprobedChunks: string[];
  /** Tokens spent on zero-value chunks — the measured, removable waste. */
  wastedTokens: number;
  /** Total tokens across all chunks. */
  totalTokens: number;
  /** F1 observations to fold into the Context-Utility Model. */
  observations: ContributionObservation[];
  skipped: number;
}

// ============================================================================
// assessMarginalValue
// ============================================================================

export function assessMarginalValue(chunks: unknown, options: AssessOptions = {}): MarginalValueReport {
  const atIso =
    options && typeof options.atIso === "string" && options.atIso.length > 0
      ? options.atIso
      : new Date().toISOString();

  const list: ChunkVerdict[] = Array.isArray(chunks) ? (chunks.filter(isChunk) as ChunkVerdict[]) : [];
  const skipped = (Array.isArray(chunks) ? chunks.length : 0) - list.length;

  const zeroValueChunks: string[] = [];
  const contributingChunks: string[] = [];
  const unprobedChunks: string[] = [];
  const observations: ContributionObservation[] = [];
  let wastedTokens = 0;
  let totalTokens = 0;

  for (const c of list) {
    const tokens = nonNeg(c.tokens);
    totalTokens += tokens;
    if (c.outputEquivalentWithout === true) {
      zeroValueChunks.push(c.id);
      wastedTokens += tokens;
      observations.push({ atomId: c.id, contributed: false, atIso });
    } else if (c.outputEquivalentWithout === false) {
      contributingChunks.push(c.id);
      observations.push({ atomId: c.id, contributed: true, atIso });
    } else {
      unprobedChunks.push(c.id); // null verdict ⇒ kept, no label emitted
    }
  }

  zeroValueChunks.sort();
  contributingChunks.sort();
  unprobedChunks.sort();

  return {
    zeroValueChunks,
    contributingChunks,
    unprobedChunks,
    wastedTokens,
    totalTokens,
    observations,
    skipped,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function isChunk(v: unknown): v is ChunkVerdict {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.id === "string" &&
    c.id.length > 0 &&
    typeof c.tokens === "number" &&
    Number.isFinite(c.tokens) &&
    (c.outputEquivalentWithout === null || typeof c.outputEquivalentWithout === "boolean")
  );
}

function nonNeg(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}
