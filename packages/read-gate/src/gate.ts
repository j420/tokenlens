/**
 * The read-gate state machine. All functions are pure: they take a resident set
 * and a request and return a verdict or a new set, never mutating the input and
 * never doing I/O. The persistence + hashing live in the calling hook.
 *
 * Soundness invariant (the only thing that matters here): `evaluateRead` returns
 * `deny` iff the request's path is resident in the SAME epoch with the SAME
 * content hash. Under those conditions the identical bytes are still in context,
 * so the denied read delivers nothing the model doesn't already have.
 */

import type {
  ReadRequest,
  ReadVerdict,
  ResidentEntry,
  ResidentSet,
} from "./types.js";

/** A fresh, empty resident set for the given epoch (default 0). */
export function emptyResidentSet(epoch = 0): ResidentSet {
  return { epoch, entries: {} };
}

/**
 * Decide a read WITHOUT mutating state. Deny only on a proven duplicate; every
 * uncertain case allows.
 */
export function evaluateRead(set: ResidentSet, req: ReadRequest): ReadVerdict {
  // A request from a different epoch than the set can't prove residency: either
  // the set is stale (older epoch) or a compaction has happened (newer epoch).
  if (req.epoch !== set.epoch) {
    return allow("epoch_advanced");
  }
  const entry = set.entries[req.path];
  if (!entry) return allow("not_resident");
  if (entry.contentHash !== req.contentHash) return allow("content_changed");

  return {
    decision: "deny",
    reason: "already_resident",
    reclaimedTokens: Math.max(0, req.tokens),
    firstReadTurn: entry.turn,
  };
}

function allow(reason: string): ReadVerdict {
  return { decision: "allow", reason, reclaimedTokens: 0, firstReadTurn: null };
}

/**
 * Record that a read happened (or will happen), returning a NEW set. If the
 * request's epoch is newer than the set's, the set is first rolled to the new
 * epoch (clearing all prior residency — those bytes may have been compacted
 * away). A stale request (older epoch) is ignored to preserve monotonicity.
 */
export function recordRead(set: ResidentSet, req: ReadRequest): ResidentSet {
  let base = set;
  if (req.epoch > set.epoch) {
    base = { epoch: req.epoch, entries: {} };
  } else if (req.epoch < set.epoch) {
    return set; // never move backwards
  }

  // First read of a path in this epoch pins its turn; a later read with the
  // same hash keeps the original turn (it's still the same resident copy).
  const existing = base.entries[req.path];
  const turn =
    existing && existing.contentHash === req.contentHash
      ? existing.turn
      : req.turn;
  const entry: ResidentEntry = {
    contentHash: req.contentHash,
    turn,
    tokens: Math.max(0, req.tokens),
  };
  return {
    epoch: base.epoch,
    entries: { ...base.entries, [req.path]: entry },
  };
}

/** Roll the set to a new (higher) epoch, clearing residency. */
export function advanceEpoch(set: ResidentSet, epoch: number): ResidentSet {
  if (epoch <= set.epoch) return set;
  return { epoch, entries: {} };
}

/**
 * Convenience for the hook: evaluate then record in one step. The returned set
 * always reflects that the read is now resident (whether it was allowed and
 * will execute, or denied because it already was).
 */
export function stepReadGate(
  set: ResidentSet,
  req: ReadRequest
): { verdict: ReadVerdict; set: ResidentSet } {
  const verdict = evaluateRead(set, req);
  return { verdict, set: recordRead(set, req) };
}
