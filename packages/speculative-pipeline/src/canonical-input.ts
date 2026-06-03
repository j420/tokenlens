/**
 * Canonical-input keying.
 *
 * The reconciliation identity of a tool call is the SHA-256 over the RFC-8785
 * canonical form of `{ name, input }`. Reusing @prune/replay-vault's
 * canonicalization means two calls are "the same speculation" iff they are
 * byte-identical modulo JSON key order — the exact condition under which a
 * speculative result is a sound substitute for the real call's result.
 *
 * This is the same soundness backbone the replay-cost engine uses for segment
 * identity; sharing it keeps "same call" meaning one thing across the codebase.
 */

import { canonicalize, sha256Hex } from "@prune/replay-vault";

import type { ToolCall } from "./types.js";

/** Deterministic key for a tool call. Pure. */
export function speculationKey(call: ToolCall): string {
  return sha256Hex(canonicalize({ name: call.name, input: call.input }));
}

/** True iff two calls have byte-identical canonical form. */
export function sameCall(a: ToolCall, b: ToolCall): boolean {
  return speculationKey(a) === speculationKey(b);
}
