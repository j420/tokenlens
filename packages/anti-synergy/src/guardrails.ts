/**
 * Anti-Synergy Guardrails  (G1 / G2 / G3)
 * =======================================
 * Each Prune optimization is locally correct, but two of them composed can be a
 * NET LOSS — one "saving" silently busts another's. These are the three verified
 * traps, each a deterministic gate the actuator consults BEFORE it acts. They
 * never block; they return a `safe` verdict + reason so the caller can re-order,
 * re-establish an anchor, or skip.
 *
 *   G1 pruner-vs-cache-bust   — pruning a result that anchors a cached/delta
 *      baseline forces a cache MISS; if the bust costs more than the prune
 *      saves, the net is negative. (The verified waterbed trap.)
 *   G2 skip-retrieval-starves-skill-capture — trajectory-diet skipping a step
 *      the skill-library is mid-capture on means a future cold retrieval costs
 *      more than the one-step saving.
 *   G3 re-squeeze-prefix-bust — re-compressing content already anchored in the
 *      cached prefix changes the bytes and busts the prefix.
 *
 * DISCIPLINE: pure set/arithmetic predicates over caller-supplied facts (token
 * counts, anchor ids, capture-set ids). Deterministic, total, no regex, no model.
 */

// ============================================================================
// G1 — pruner-vs-cache-bust
// ============================================================================

export interface PrunerCacheBustInput {
  /** Tokens the prune would save at the result site. */
  pruneSavingTokens: number;
  /** Is this result the byte-identical anchor of a cache / delta-resend baseline? */
  isCacheAnchor: boolean;
  /** Cached prefix tokens that the bust would force to be re-established. */
  bustedCacheTokens: number;
  /**
   * Tokens to re-establish the anchor (one cache write) if you prune-then-repin.
   * Default 0 (caller didn't model the repin path). When > 0 it is compared as
   * the cheaper of {bust-and-lose, repin}.
   */
  reestablishTokens?: number;
}

export type GuardVerdict = "safe" | "blocked";

export interface GuardResult {
  guard: "G1" | "G2" | "G3";
  verdict: GuardVerdict;
  /** Convenience: true when verdict === "safe". */
  safe: boolean;
  /** Net token effect of proceeding (saving − induced cost); may be negative. */
  netTokens: number | null;
  reason: string;
}

export function checkPrunerCacheBust(input: unknown): GuardResult {
  const i = (input ?? {}) as Partial<PrunerCacheBustInput>;
  const saving = nonNeg(i.pruneSavingTokens);
  const isAnchor = i.isCacheAnchor === true;
  const busted = nonNeg(i.bustedCacheTokens);
  const repin = nonNeg(i.reestablishTokens);

  if (!isAnchor) {
    return mk("G1", "safe", saving, "result is not a cache/delta anchor — pruning frees tokens cleanly");
  }
  // Cost of proceeding = the cheaper of losing the cache (busted) or re-pinning.
  const inducedCost = repin > 0 ? Math.min(busted, repin) : busted;
  const net = saving - inducedCost;
  if (net > 0) {
    return mk(
      "G1",
      "safe",
      net,
      `prune saves ${saving} tok; the cache bust/repin costs ${inducedCost} tok — net still +${net}`
    );
  }
  return mk(
    "G1",
    "blocked",
    net,
    `pruning anchor would bust ${busted} cached tok (induced ${inducedCost}) for only ${saving} tok saved ` +
      `(net ${net}); re-establish the anchor first or skip the prune`
  );
}

// ============================================================================
// G2 — skip-retrieval-starves-skill-capture
// ============================================================================

export interface SkipStarvesInput {
  /** The retrieval step trajectory-diet wants to skip. */
  stepId: string;
  /** Step ids the skill-library is mid-capture on (it needs them to replay). */
  captureInProgressSteps: string[];
}

export function checkSkipStarvesCapture(input: unknown): GuardResult {
  const i = (input ?? {}) as Partial<SkipStarvesInput>;
  const stepId = typeof i.stepId === "string" ? i.stepId : "";
  const capturing = Array.isArray(i.captureInProgressSteps)
    ? new Set(i.captureInProgressSteps.filter((s) => typeof s === "string" && s.length > 0))
    : new Set<string>();

  if (stepId.length === 0) {
    // No identifiable step ⇒ nothing to protect ⇒ skipping is the caller's call.
    return mk("G2", "safe", null, "no step id supplied — nothing in a capture set to protect");
  }
  if (capturing.has(stepId)) {
    return mk(
      "G2",
      "blocked",
      null,
      `step "${stepId}" is in the skill-library's capture-in-progress set — skipping it would starve the ` +
        `capture and force a costlier cold retrieval later`
    );
  }
  return mk("G2", "safe", null, `step "${stepId}" is not being captured — safe to skip`);
}

// ============================================================================
// G3 — re-squeeze-prefix-bust
// ============================================================================

export interface ResqueezeInput {
  /** Content the squeezer/repo-map wants to (re)compress. */
  contentId: string;
  /** Content ids already anchored in the cached prefix (squeezing busts them). */
  anchoredContentIds: string[];
}

export function checkResqueezePrefixBust(input: unknown): GuardResult {
  const i = (input ?? {}) as Partial<ResqueezeInput>;
  const contentId = typeof i.contentId === "string" ? i.contentId : "";
  const anchored = Array.isArray(i.anchoredContentIds)
    ? new Set(i.anchoredContentIds.filter((s) => typeof s === "string" && s.length > 0))
    : new Set<string>();

  if (contentId.length === 0) {
    return mk("G3", "safe", null, "no content id supplied — nothing anchored to protect");
  }
  if (anchored.has(contentId)) {
    return mk(
      "G3",
      "blocked",
      null,
      `content "${contentId}" is anchored in the cached prefix — re-compressing it changes the bytes and ` +
        `busts the prefix; squeeze only non-anchored content / the appended tail`
    );
  }
  return mk("G3", "safe", null, `content "${contentId}" is not prefix-anchored — safe to squeeze`);
}

// ============================================================================
// Helpers
// ============================================================================

function mk(
  guard: GuardResult["guard"],
  verdict: GuardVerdict,
  netTokens: number | null,
  reason: string
): GuardResult {
  return { guard, verdict, safe: verdict === "safe", netTokens, reason };
}

function nonNeg(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}
