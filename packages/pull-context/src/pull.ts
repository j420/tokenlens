/**
 * Negotiated Pull-Context  (F3)
 * =============================
 * repo-map pushes a host-selected context; f10 mcp-proxy lazily loads tool
 * SCHEMAS. Neither lets the MODEL request which symbol BODIES enter context.
 * This is the push→pull flip (CLAUDE.md Phase-3): a two-phase protocol.
 *
 *   Phase 1 (manifest): send only repo-map SIGNATURES + stable symbol-ids.
 *   Phase 2 (fulfillment): the model emits a FETCH list; the host injects only
 *   those bodies (byte-exact). The saving is every manifest body never fetched.
 *
 * The killer risk — under-request → failed turn → an expensive retry — is gated
 * THREE deterministic ways:
 *   1. DAG-closure auto-include: a requested symbol's mandatory dependencies
 *      (return types, base classes) are pulled in automatically using the
 *      existing dep edges — sound, not a guess.
 *   2. Coverage-floor candidate: if the request omits a symbol the push baseline
 *      rated `critical`, surface it as a "you may also need" candidate.
 *   3. Retry-economics gate: only PULL when the predicted manifest+fetch cost
 *      beats push by a margin wide enough to absorb one re-fetch; else decline
 *      to push.
 *
 * DISCIPLINE: deterministic (graph closure + arithmetic over caller-supplied
 * token counts), total (never throws), fail-safe (any malformed input ⇒ push).
 * The FETCH request is the model's output, CALLER-FED — there is no model call
 * here. No regex.
 */

// ============================================================================
// Types
// ============================================================================

/** One symbol available to the manifest. Token counts are caller-supplied. */
export interface PullSymbol {
  id: string;
  /** Signature-only token cost (what the manifest carries). */
  signatureTokens: number;
  /** Full body token cost (what a fetch / a push injects). */
  bodyTokens: number;
  /** Mandatory dependency symbol ids (return types, base classes, …). */
  deps?: string[];
  /** Did the push baseline rate this symbol critical? Drives the coverage floor. */
  critical?: boolean;
}

export interface ManifestPlan {
  /** Symbol ids carried in the manifest (all known symbols). */
  ids: string[];
  /** Sum of signature tokens (the manifest's cost). */
  manifestTokens: number;
  /** Sum of body tokens (the push-baseline cost the pull must beat). */
  pushBaselineTokens: number;
  symbolCount: number;
}

export interface ResolveOptions {
  /**
   * Tokens to reserve as a one-re-fetch buffer in the economics gate. When
   * unset, the buffer is the largest NON-injected body (worst-case single
   * re-fetch) — a sound, caller-free estimate.
   */
  reFetchBufferTokens?: number;
}

export type PullDecision = "pull" | "push";

export interface ResolvePlan {
  decision: PullDecision;
  /** Bodies to inject (requested + their transitive mandatory deps). */
  injectedIds: string[];
  /** Critical symbols neither requested nor pulled by closure — advisory candidates. */
  candidateIds: string[];
  /** Unknown ids in the request that were dropped. */
  droppedIds: string[];
  manifestTokens: number;
  injectedBodyTokens: number;
  /** manifest + injected bodies (the pull path's total cost). */
  pullCostTokens: number;
  /** Sum of all body tokens (the push path's total cost). */
  pushCostTokens: number;
  reFetchBufferTokens: number;
  /** pushCost − pullCost when pulling; 0 when declining to push. */
  savedTokens: number;
  reason: "pull-beats-push" | "margin-too-thin" | "malformed-fell-back-to-push";
}

// ============================================================================
// buildManifest
// ============================================================================

export function buildManifest(symbols: unknown): ManifestPlan {
  const list = coerceSymbols(symbols);
  let manifestTokens = 0;
  let pushBaselineTokens = 0;
  const ids: string[] = [];
  for (const s of list) {
    ids.push(s.id);
    manifestTokens += s.signatureTokens;
    pushBaselineTokens += s.bodyTokens;
  }
  return { ids, manifestTokens, pushBaselineTokens, symbolCount: list.length };
}

// ============================================================================
// resolvePull — fulfillment + the three gates
// ============================================================================

export function resolvePull(
  symbols: unknown,
  requestedIds: unknown,
  options: ResolveOptions = {}
): ResolvePlan {
  const list = coerceSymbols(symbols);
  const byId = new Map<string, PullSymbol>();
  for (const s of list) byId.set(s.id, s);

  const manifestTokens = sum(list, (s) => s.signatureTokens);
  const pushCostTokens = sum(list, (s) => s.bodyTokens);

  // A non-array request (the model produced nothing parseable) ⇒ fall back to
  // push: send everything, the safe default.
  if (!Array.isArray(requestedIds)) {
    return pushFallback(list, manifestTokens, pushCostTokens, "malformed-fell-back-to-push");
  }

  const requested = requestedIds.filter((x) => typeof x === "string" && x.length > 0) as string[];
  const dropped = requested.filter((id) => !byId.has(id));
  const known = requested.filter((id) => byId.has(id));

  // (1) DAG-closure auto-include — transitive mandatory deps. Cycle-safe.
  const injected = new Set<string>();
  const stack = [...known];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (injected.has(id)) continue;
    injected.add(id);
    const sym = byId.get(id);
    for (const dep of sym?.deps ?? []) {
      if (byId.has(dep) && !injected.has(dep)) stack.push(dep);
    }
  }

  // (2) Coverage-floor — critical symbols neither requested nor pulled in.
  const candidateIds = list
    .filter((s) => s.critical && !injected.has(s.id))
    .map((s) => s.id)
    .sort();

  const injectedIds = [...injected].sort();
  const injectedBodyTokens = injectedIds.reduce((a, id) => a + (byId.get(id)?.bodyTokens ?? 0), 0);
  const pullCostTokens = manifestTokens + injectedBodyTokens;

  // (3) Retry-economics gate. Buffer = caller value, else the largest
  // non-injected body (the worst single re-fetch).
  const buffer =
    typeof options.reFetchBufferTokens === "number" &&
    Number.isFinite(options.reFetchBufferTokens) &&
    options.reFetchBufferTokens >= 0
      ? Math.floor(options.reFetchBufferTokens)
      : list.reduce((mx, s) => (injected.has(s.id) ? mx : Math.max(mx, s.bodyTokens)), 0);

  const pull = pullCostTokens + buffer < pushCostTokens;

  if (!pull) {
    return {
      decision: "push",
      injectedIds: list.map((s) => s.id).sort(),
      candidateIds,
      droppedIds: dropped.sort(),
      manifestTokens,
      injectedBodyTokens: pushCostTokens,
      pullCostTokens: manifestTokens + pushCostTokens,
      pushCostTokens,
      reFetchBufferTokens: buffer,
      savedTokens: 0,
      reason: "margin-too-thin",
    };
  }

  return {
    decision: "pull",
    injectedIds,
    candidateIds,
    droppedIds: dropped.sort(),
    manifestTokens,
    injectedBodyTokens,
    pullCostTokens,
    pushCostTokens,
    reFetchBufferTokens: buffer,
    savedTokens: pushCostTokens - pullCostTokens,
    reason: "pull-beats-push",
  };
}

// ============================================================================
// Helpers
// ============================================================================

function pushFallback(
  list: PullSymbol[],
  manifestTokens: number,
  pushCostTokens: number,
  reason: ResolvePlan["reason"]
): ResolvePlan {
  return {
    decision: "push",
    injectedIds: list.map((s) => s.id).sort(),
    candidateIds: list.filter((s) => s.critical).map((s) => s.id).sort(),
    droppedIds: [],
    manifestTokens,
    injectedBodyTokens: pushCostTokens,
    pullCostTokens: manifestTokens + pushCostTokens,
    pushCostTokens,
    reFetchBufferTokens: 0,
    savedTokens: 0,
    reason,
  };
}

function coerceSymbols(symbols: unknown): PullSymbol[] {
  if (!Array.isArray(symbols)) return [];
  const out: PullSymbol[] = [];
  const seen = new Set<string>();
  for (const v of symbols) {
    if (!isSymbol(v)) continue;
    if (seen.has(v.id)) continue; // de-dup by id for a stable graph
    seen.add(v.id);
    out.push({
      id: v.id,
      signatureTokens: Math.max(0, v.signatureTokens),
      bodyTokens: Math.max(0, v.bodyTokens),
      deps: Array.isArray(v.deps) ? v.deps.filter((d) => typeof d === "string" && d.length > 0) : [],
      critical: v.critical === true,
    });
  }
  return out;
}

function isSymbol(v: unknown): v is PullSymbol {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.id === "string" &&
    s.id.length > 0 &&
    typeof s.signatureTokens === "number" &&
    Number.isFinite(s.signatureTokens) &&
    typeof s.bodyTokens === "number" &&
    Number.isFinite(s.bodyTokens)
  );
}

function sum<T>(list: T[], f: (t: T) => number): number {
  let s = 0;
  for (const t of list) s += f(t);
  return s;
}
