/**
 * L4-27 — Within-turn duplicate parallel tool-call gate (Cost-Security).
 *
 * A parallel tool block sometimes dispatches the EXACT same call twice
 * (same tool, same canonicalized input) — both bill, one is pure waste.
 * Cross-turn repetition is loop-breaker's territory (token-ROI) and
 * speculative-prune's (result reuse); this detector covers the one cell
 * neither sees: duplicates inside a single turn's dispatch set.
 *
 * Canonicalization is PINNED to loop-breaker's standard (`canonicalKey`
 * from @prune/intelligence) — the L4 review killed a naive JSON.stringify
 * variant because key order and undefined fields make it unstable; two
 * detectors disagreeing about what "identical" means would be worse than
 * either alone.
 *
 * Deterministic, total, fail-open: a candidate that cannot be canonicalized
 * is "no_duplicate" (never a false block), and the surface is ADVISORY —
 * promotion to a hard gate goes through the proof pipeline like every
 * other actuator.
 */

import { canonicalKey } from "@prune/intelligence";

export interface DispatchedCall {
  tool: string;
  input: unknown;
}

export interface DuplicateCallReport {
  verdict: "no_duplicate" | "duplicate";
  /** Index of the FIRST identical dispatch, when verdict is "duplicate". */
  matchIndex: number | null;
  /** The shared canonical key (for telemetry joins with loop-breaker). */
  key: string | null;
}

export function assessDuplicateParallelCall(
  dispatched: DispatchedCall[],
  candidate: DispatchedCall
): DuplicateCallReport {
  let candidateKey: string;
  try {
    candidateKey = JSON.stringify([candidate.tool, canonicalKey(candidate.input)]);
  } catch {
    return { verdict: "no_duplicate", matchIndex: null, key: null }; // fail-open
  }
  for (let i = 0; i < dispatched.length; i++) {
    const call = dispatched[i];
    if (call.tool !== candidate.tool) continue; // cheap reject before canonicalizing
    let key: string;
    try {
      key = JSON.stringify([call.tool, canonicalKey(call.input)]);
    } catch {
      continue; // an uncanonicalizable prior call can never match
    }
    if (key === candidateKey) {
      return { verdict: "duplicate", matchIndex: i, key: candidateKey };
    }
  }
  return { verdict: "no_duplicate", matchIndex: null, key: null };
}
