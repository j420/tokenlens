/**
 * Output-comparison gate.
 *
 * After a replay produces a new final output, the user wants one of two
 * answers:
 *   - "no_change": the tweak produced an equivalent result — the variant is a
 *     no-op (stop iterating, or ship the cheaper/simpler of the two).
 *   - "changed":   the tweak materially changed the output — worth a look.
 *
 * We delegate the hard part to `@prune/equivalence`, which already ships AST /
 * text / symbol-coverage / byte strategies with a documented dispatcher. This
 * module is a thin, honest adapter: it never decides equivalence itself, it
 * reports what the equivalence engine found.
 */

import { equivalent, type EquivalenceOptions } from "@prune/equivalence";

import type { OutputComparison } from "./types.js";

/**
 * Compare an original final output against a replayed one. Pure.
 *
 * `equivalent === true` ⇒ verdict "no_change". The graded similarity and the
 * strategy that fired are passed through so the caller can show WHY (e.g.
 * "structurally identical modulo variable renaming" vs "95% token overlap").
 */
export function compareOutputs(
  originalFinal: string,
  replayedFinal: string,
  options?: EquivalenceOptions
): OutputComparison {
  const r = equivalent(originalFinal, replayedFinal, options);
  return {
    verdict: r.equivalent ? "no_change" : "changed",
    equivalent: r.equivalent,
    similarity: r.similarity,
    strategy: r.strategy,
  };
}
