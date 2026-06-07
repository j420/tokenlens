/**
 * Types for the Dedup-VoI Read Gate (F16).
 *
 * The gate tracks which files are *resident* in the model's context and denies a
 * re-read only when it can prove the identical bytes are still there. "Provably
 * still there" has exactly two conditions, both required:
 *
 *   1. Same content hash — the file hasn't changed since it was read, so a
 *      re-read would deliver nothing new.
 *   2. Same compaction epoch — no compaction has occurred since, so the bytes
 *      that were read are still in the window (compaction may evict them, which
 *      bumps the epoch and clears residency).
 *
 * When both hold, denying the read loses zero information — that is the whole
 * soundness argument. Any uncertainty (different hash, different epoch, unknown
 * file) resolves to ALLOW.
 */

export type ReadDecision = "allow" | "deny";

/** A single resident file: the content hash read, and when/at-what-cost. */
export interface ResidentEntry {
  contentHash: string;
  /** The turn the file first became resident in the current epoch. */
  turn: number;
  /** Measured token cost of the file's content (caller-supplied). */
  tokens: number;
}

/**
 * The resident set, scoped to one compaction epoch. Serializable so a hook can
 * persist it between invocations. Keyed by file path.
 */
export interface ResidentSet {
  epoch: number;
  entries: Record<string, ResidentEntry>;
}

/** A proposed read to evaluate. */
export interface ReadRequest {
  path: string;
  /** SHA of the current on-disk content of the file. */
  contentHash: string;
  /** Current turn number. */
  turn: number;
  /** Measured token cost of reading this file. */
  tokens: number;
  /** Current compaction epoch (monotonic; increments on each compaction). */
  epoch: number;
}

export interface ReadVerdict {
  decision: ReadDecision;
  /** Machine reason: `not_resident` | `content_changed` | `epoch_advanced` | `already_resident`. */
  reason: string;
  /** Tokens saved if the read is denied (the measured read cost); 0 on allow. */
  reclaimedTokens: number;
  /** The turn the resident copy was first read, when denying; else null. */
  firstReadTurn: number | null;
}
