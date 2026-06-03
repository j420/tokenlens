/**
 * Result verification gate.
 *
 * Before a speculated result is treated as authoritative, it is gated against
 * the real tool's out-of-band (shadow) result by BYTE-EQUALITY via
 * @prune/equivalence. Byte-equality is the only relation strong enough to
 * substitute a result into the agent's live context — the same standard the
 * speculative-cache uses. A graded similarity is recorded for telemetry, but
 * only byteEqual gates substitution.
 */

import { byteEqual, equivalent } from "@prune/equivalence";

export interface VerificationResult {
  /** Safe to treat the speculated result as the real one? (byte-equality) */
  authoritative: boolean;
  /** Graded similarity for telemetry (0..1). */
  similarity: number;
  /** The strategy the graded comparison used. */
  strategy: string;
}

/**
 * Verify a speculated result against the real shadow result. Pure.
 *
 * `authoritative` is true ONLY on byte-equality. The graded `similarity`/
 * `strategy` come from the full equivalence dispatcher and are advisory — a
 * high similarity with non-identical bytes still yields `authoritative=false`,
 * because a single differing byte means the speculation returned stale content.
 */
export function verifyResult(
  speculated: string,
  shadowReal: string
): VerificationResult {
  const byte = byteEqual(speculated, shadowReal);
  const graded = equivalent(speculated, shadowReal);
  return {
    authoritative: byte.equivalent,
    similarity: graded.similarity,
    strategy: graded.strategy,
  };
}
