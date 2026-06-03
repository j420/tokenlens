/**
 * @prune/skill-library — typed surface.
 *
 * A "skill" is the distilled, reusable trace of a task an agent has already
 * solved: the ordered sequence of INFLUENTIAL steps (the ones that actually
 * shaped the final output, per @prune/trajectory-diet's influence labels),
 * fingerprinted by the task's intent terms. When a future task fingerprints
 * close to a stored skill, the library can hand the agent the cached
 * trajectory as guidance and let it skip the discovery phase it would
 * otherwise re-pay for.
 *
 * Discipline:
 *   - No regex (char-code tokenizer).
 *   - No model call (matching is Jaccard over term sets; capture is a filter).
 *   - Caller-declared everything: the influential-step set comes from the
 *     trajectory-diet advisor, the freshness preconditions come from the host.
 *   - Replay is ADVISORY + GUARDED: a stale precondition forces a fall-back to
 *     normal discovery; a replayed outcome is gated by @prune/equivalence. A
 *     wrong skill can never produce a wrong shipped result — at worst it wastes
 *     the tokens of one ignored hint.
 *   - Deterministic: same inputs ⇒ same skill ⇒ same content hash.
 */

/** One influential step retained in a skill's reusable trace. */
export interface SkillStep {
  /** Stable order within the skill, 0-based. */
  order: number;
  /** The tool the step invoked (e.g. "Read", "Grep", "Edit"). */
  toolName: string;
  /**
   * The step's target — file path, command, or grep pattern. Null when the
   * step had no identifiable target. Used by the replay guard to check the
   * target still exists / is unchanged.
   */
  target: string | null;
  /** Tokens this step's result contributed (the discovery cost it represents). */
  tokenFootprint: number;
}

/** A captured, reusable skill. */
export interface Skill {
  /** Stable id (content hash prefix). Two byte-identical skills share an id. */
  id: string;
  /** Human-facing label (the classified intent, e.g. "add-crud-endpoint"). */
  label: string;
  /**
   * Deterministic intent fingerprint — the sorted set of meaningful task
   * terms. Matching is Jaccard over these against a new task's terms.
   */
  intentSignature: readonly string[];
  /** The ordered influential steps. */
  steps: readonly SkillStep[];
  /** Sum of step tokenFootprints — the discovery cost this skill captures. */
  discoveryTokens: number;
  /** Turn at which the originating session succeeded. */
  capturedAtTurn: number;
  /** ISO timestamp of capture. */
  capturedAtIso: string;
  /** SHA-256 hex over the canonical (label, signature, steps) — provenance. */
  contentHash: string;
  /** How many times this skill has been reused (replayed). */
  useCount: number;
  /** Optional ed25519 signature over contentHash (caller-supplied signer). */
  signature: string | null;
}

/** A match between a new task and a stored skill. */
export interface SkillMatch {
  skill: Skill;
  /** Jaccard similarity in [0,1] between task terms and skill signature. */
  similarity: number;
  /** Terms present in BOTH the task and the skill (the evidence). */
  matchedTerms: readonly string[];
}

/** Serializable library snapshot for the persistence layer. */
export interface SkillLibraryState {
  version: 1;
  skills: Skill[];
}

/**
 * A caller-declared freshness precondition for a skill step's target. Mirrors
 * the @prune/intelligence speculative-cache freshness model: equal tokens ⇒
 * the underlying source is unchanged. The host probes these; the library only
 * compares them.
 */
export interface ReplayPrecondition {
  /** The target this precondition refers to (matches SkillStep.target). */
  target: string;
  /**
   * Opaque freshness token: content-SHA, mtime+size, etc. The library never
   * interprets it — it only checks the host's CURRENT token against the one
   * the host recorded when the skill was captured.
   */
  freshnessToken: string;
}

/** Result of the replay guard. */
export interface ReplayGuardResult {
  /** Safe to offer the skill as guidance? */
  safe: boolean;
  /** Targets whose freshness token changed (or is missing) since capture. */
  staleTargets: readonly string[];
  /** Targets with no precondition supplied — treated as unverifiable. */
  unverifiableTargets: readonly string[];
  /** Human-readable reason when not safe. */
  reason: string | null;
}

/** Projected dollar saving from reusing a skill instead of re-discovering. */
export interface SkillSavingProjection {
  /** Discovery tokens the skill lets the agent skip. */
  discoveryTokens: number;
  /** USD saved per reuse at the model's input rate. Null when unpriced. */
  savedUsdPerReuse: number | null;
  /** Cumulative USD saved across all reuses so far. Null when unpriced. */
  cumulativeSavedUsd: number | null;
}
