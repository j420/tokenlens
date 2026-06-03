/**
 * The What-If engine — orchestrates mutation → divergence → cost into a plan.
 *
 * `applyMutation` produces the MODIFIED timeline: segments before the mutated
 * index are carried verbatim; the mutated segment gets the new payload (and
 * token count); segments AFTER the mutated index are carried from the original
 * as a structural placeholder. Those tail segments WILL be regenerated on a
 * real replay (their content depends on the new prompt), so their original
 * payloads are not byte-truth — but their token FOOTPRINT is the best available
 * predictor of the regeneration cost, and we use it as such, labeled in the
 * audit as an estimate (`reusedOriginalTokens`).
 *
 * The engine itself never calls a model. A caller that wants to actually
 * execute the tail supplies a `TailReplayer` to `executeReplay`; that's the
 * only path that touches a wire, mirroring the agent-sdk-adapter boundary.
 */

import { buildTimeline } from "./segment.js";
import { computeDivergence } from "./divergence.js";
import { computeReplayCost } from "./cost-model.js";
import type {
  ReplayPlan,
  ReplaySegment,
  SegmentMutation,
  SessionTimeline,
} from "./types.js";

/**
 * Apply a single-segment mutation to a timeline, returning a fresh, fully
 * re-hashed modified timeline. Pure. Throws on an out-of-range index so a
 * caller bug surfaces immediately rather than producing a silently-wrong plan.
 */
export function applyMutation(
  original: SessionTimeline,
  mutation: SegmentMutation
): { modified: SessionTimeline; reusedOriginalTokens: boolean } {
  const k = mutation.atIndex;
  if (!Number.isInteger(k) || k < 0 || k >= original.segments.length) {
    throw new Error(
      `replay-cost: mutation index ${k} out of range ` +
        `[0, ${original.segments.length - 1}]`
    );
  }
  const reusedOriginalTokens = mutation.newTokensIn === undefined;
  const raw: ReplaySegment[] = original.segments.map((s) => ({
    index: s.index,
    role: s.role,
    payload: s.payload,
    tokensIn: s.tokensIn,
    tokensOut: s.tokensOut,
  }));
  const target = raw[k]!;
  raw[k] = {
    index: target.index,
    role: target.role,
    payload: mutation.newPayload,
    tokensIn:
      mutation.newTokensIn !== undefined ? mutation.newTokensIn : target.tokensIn,
    tokensOut: target.tokensOut,
  };
  if (raw[k]!.tokensIn < 0 || !Number.isFinite(raw[k]!.tokensIn)) {
    throw new Error(
      `replay-cost: mutation newTokensIn ${raw[k]!.tokensIn} must be finite and non-negative`
    );
  }
  const modified = buildTimeline({
    model: original.model,
    provider: original.provider,
    segments: raw,
  });
  return { modified, reusedOriginalTokens };
}

/**
 * Plan a what-if replay: apply the mutation, find the divergence, and quantify
 * the cost. Pure end-to-end — no model call, deterministic.
 */
export function planReplay(
  original: SessionTimeline,
  mutation: SegmentMutation
): ReplayPlan {
  const { modified, reusedOriginalTokens } = applyMutation(original, mutation);
  const divergence = computeDivergence(original, modified);
  const cost = computeReplayCost(modified, divergence);
  return { modified, divergence, cost, reusedOriginalTokens };
}

/**
 * A caller-supplied tail re-executor. Receives the shared prefix (already
 * cache-warm bytes) and the diverged tail's first segment (the new prompt),
 * and returns the regenerated tail text. This is the ONLY surface that talks
 * to a model; the engine treats it as opaque.
 */
export type TailReplayer = (args: {
  timeline: SessionTimeline;
  divergenceIndex: number;
  signal?: AbortSignal;
}) => Promise<string>;

/**
 * Stateful engine wrapping one original timeline. Convenience for the common
 * loop: plan many mutations against the same baseline, then compare outputs.
 */
export class WhatIfEngine {
  constructor(private readonly original: SessionTimeline) {}

  /** Read-only access to the baseline. */
  get baseline(): SessionTimeline {
    return this.original;
  }

  /** Plan a single mutation. Pure. */
  plan(mutation: SegmentMutation): ReplayPlan {
    return planReplay(this.original, mutation);
  }

  /**
   * Execute a planned replay's tail via a caller-supplied replayer. The engine
   * does not interpret the returned text beyond handing it back; equivalence
   * comparison is a separate, explicit step (`compareOutputs`).
   */
  async execute(
    plan: ReplayPlan,
    replayer: TailReplayer,
    signal?: AbortSignal
  ): Promise<string> {
    const idx =
      plan.divergence.divergenceIndex ?? plan.modified.segments.length;
    return replayer({
      timeline: plan.modified,
      divergenceIndex: idx,
      signal,
    });
  }
}
