/**
 * MCP handlers for the deterministic value / economics / paradigm levers
 * (List1/List2/List3 Fxx packages). Each handler validates minimally, calls the
 * pure package function (which is itself total + fail-safe), and returns a JSON
 * string. No decision logic lives here — these are honest pass-throughs that
 * make the library tier reachable as MCP self-regulation tools.
 */

import { negotiateSpans, recordProbe, recordFetchBack } from "@prune/known-knowledge";
import { buildManifest, resolvePull } from "@prune/pull-context";
import { planChurnPins } from "@prune/churn-pin";
import { buildWasteMemo } from "@prune/waste-memo";
import { buildLspGraphPayload } from "@prune/lsp-graph";
import { allocate, spend, transfer, balance, balances } from "@prune/allowance-market";
import { priceReservations } from "@prune/futures-desk";
import { evaluateBounty } from "@prune/bounty";
import { routeRequest } from "@prune/batch-router";
import { alignPrefix } from "@prune/prefix-align";
import { detectTtlRegression } from "@prune/ttl-regression";
import { adviseRetryVsReframe } from "@prune/retry-reframe";
import { recordFixEpisode, rankFixContext } from "@prune/ci-validator";
import { putResolved, getResolved } from "@prune/fleet-cache";
import { assessMarginalValue } from "@prune/marginal-value";
import { assessWriters } from "@prune/cache-poison";
import {
  checkPrunerCacheBust,
  checkSkipStarvesCapture,
  checkResqueezePrefixBust,
} from "@prune/anti-synergy";
import { reconcileCacheHits } from "@prune/cache-reconcile";

type Args = Record<string, unknown>;
const obj = (v: unknown): Args => (v && typeof v === "object" ? (v as Args) : {});
const J = (v: unknown): string => JSON.stringify(v, null, 2);
const err = (m: string): string => J({ error: m });

// --- F2 known-knowledge -----------------------------------------------------
export function handleKnownKnowledge(args: unknown): string {
  const a = obj(args);
  if (!Array.isArray(a.spans)) return err("known_knowledge_negotiate requires a `spans` array.");
  if (typeof a.modelId !== "string") return err("known_knowledge_negotiate requires a `modelId` string.");
  let store: unknown = a.store ?? undefined;
  for (const p of Array.isArray(a.probes) ? a.probes : []) store = recordProbe(store, p);
  for (const fb of Array.isArray(a.fetchBacks) ? a.fetchBacks : []) store = recordFetchBack(store, fb);
  const plan = negotiateSpans(store, a.spans, {
    modelId: a.modelId,
    ...(typeof a.stubTokens === "number" ? { stubTokens: a.stubTokens } : {}),
    ...(typeof a.minKnownMargin === "number" ? { minKnownMargin: a.minKnownMargin } : {}),
  });
  return J({ store, plan });
}

// --- F3 pull-context --------------------------------------------------------
export function handlePullContext(args: unknown): string {
  const a = obj(args);
  if (!Array.isArray(a.symbols)) return err("pull_context_resolve requires a `symbols` array.");
  const manifest = buildManifest(a.symbols);
  const plan = resolvePull(
    a.symbols,
    a.requestedIds,
    typeof a.reFetchBufferTokens === "number" ? { reFetchBufferTokens: a.reFetchBufferTokens } : {}
  );
  return J({ manifest, plan });
}

// --- F9 churn-pin -----------------------------------------------------------
export function handleChurnPin(args: unknown): string {
  const a = obj(args);
  if (!Array.isArray(a.files)) return err("churn_pin_plan requires a `files` array.");
  return J(
    planChurnPins(a.files, {
      ...(typeof a.maxRecentCommits === "number" ? { maxRecentCommits: a.maxRecentCommits } : {}),
      ...(typeof a.maxPinnedTokens === "number" ? { maxPinnedTokens: a.maxPinnedTokens } : {}),
    })
  );
}

// --- F13 waste-memo ---------------------------------------------------------
export function handleWasteMemo(args: unknown): string {
  const a = obj(args);
  if (!Array.isArray(a.records)) return err("waste_memo requires a `records` array.");
  return J(
    buildWasteMemo(a.records, {
      ...(typeof a.minOccurrences === "number" ? { minOccurrences: a.minOccurrences } : {}),
      ...(typeof a.minDistinctDays === "number" ? { minDistinctDays: a.minDistinctDays } : {}),
      ...(typeof a.topN === "number" ? { topN: a.topN } : {}),
    })
  );
}

// --- F10 lsp-graph ----------------------------------------------------------
export function handleLspGraph(args: unknown): string {
  const a = obj(args);
  if (!a.index) return err("lsp_graph requires an `index` { symbols, references }.");
  return J(
    buildLspGraphPayload(a.index, {
      ...(typeof a.maxTokens === "number" ? { maxTokens: a.maxTokens } : {}),
      ...(typeof a.fullContextTokens === "number" ? { fullContextTokens: a.fullContextTokens } : {}),
    })
  );
}

// --- F15 allowance-market (op-dispatched) -----------------------------------
export function handleAllowanceMarket(args: unknown): string {
  const a = obj(args);
  switch (a.op) {
    case "allocate":
      return J({ state: allocate(a.envelope, a.actors) });
    case "spend":
      return J(spend(a.state, String(a.actorId ?? ""), a.amount));
    case "transfer":
      return J(transfer(a.state, String(a.from ?? ""), String(a.to ?? ""), a.amount));
    case "balances":
      return J({ balances: balances(a.state) });
    case "balance":
      return J({ balance: balance(a.state, String(a.actorId ?? "")) });
    default:
      return err('allowance_market requires `op` ∈ allocate|spend|transfer|balance|balances.');
  }
}

// --- F16 futures-desk -------------------------------------------------------
export function handleFuturesDesk(args: unknown): string {
  const a = obj(args);
  if (!Array.isArray(a.reservations)) return err("futures_desk requires a `reservations` array.");
  if (typeof a.batchDiscount !== "number") return err("futures_desk requires a numeric `batchDiscount`.");
  return J(
    priceReservations(a.reservations, {
      batchDiscount: a.batchDiscount,
      ...(typeof a.minLeadMs === "number" ? { minLeadMs: a.minLeadMs } : {}),
      ...(typeof a.nowIso === "string" ? { nowIso: a.nowIso } : {}),
    })
  );
}

// --- F17 bounty -------------------------------------------------------------
export function handleBounty(args: unknown): string {
  const a = obj(args);
  if (!Array.isArray(a.submissions)) return err("bounty_evaluate requires a `submissions` array.");
  return J(
    evaluateBounty(a.submissions, {
      ...(typeof a.incumbentCostUsd === "number" ? { incumbentCostUsd: a.incumbentCostUsd } : {}),
      ...(typeof a.incumbentCostTokens === "number" ? { incumbentCostTokens: a.incumbentCostTokens } : {}),
    })
  );
}

// --- batch-router -----------------------------------------------------------
export function handleBatchRoute(args: unknown): string {
  const a = obj(args);
  if (!a.request) return err("batch_route requires a `request` object.");
  return J(
    routeRequest(a.request, {
      ...(typeof a.batchDiscount === "number" ? { batchDiscount: a.batchDiscount } : {}),
      ...(typeof a.minSlackMs === "number" ? { minSlackMs: a.minSlackMs } : {}),
    })
  );
}

// --- prefix-align -----------------------------------------------------------
export function handlePrefixAlign(args: unknown): string {
  const a = obj(args);
  if (typeof a.prefixTokens !== "number") return err("prefix_align requires a numeric `prefixTokens`.");
  return J(
    alignPrefix(a.prefixTokens, {
      ...(typeof a.minCacheableTokens === "number" ? { minCacheableTokens: a.minCacheableTokens } : {}),
      ...(typeof a.incrementTokens === "number" ? { incrementTokens: a.incrementTokens } : {}),
    })
  );
}

// --- ttl-regression ---------------------------------------------------------
export function handleTtlRegression(args: unknown): string {
  const a = obj(args);
  return J(
    detectTtlRegression(a, typeof a.tolerance === "number" ? { tolerance: a.tolerance } : {})
  );
}

// --- F5 retry-reframe -------------------------------------------------------
export function handleRetryReframe(args: unknown): string {
  const a = obj(args);
  if (!a.retry || !a.reframe) return err("retry_reframe_advise requires `retry` and `reframe` priors.");
  return J(
    adviseRetryVsReframe({
      retry: a.retry as never,
      reframe: a.reframe as never,
      ...(typeof a.margin === "number" ? { margin: a.margin } : {}),
    })
  );
}

// --- F6 ci-validator --------------------------------------------------------
export function handleCiFixContext(args: unknown): string {
  const a = obj(args);
  if (typeof a.failureClass !== "string") return err("ci_fix_context requires a `failureClass` string.");
  let state: unknown = a.state ?? undefined;
  for (const e of Array.isArray(a.episodes) ? a.episodes : []) state = recordFixEpisode(state, e);
  const ranked = rankFixContext(
    state,
    a.failureClass,
    a.candidates,
    typeof a.minObservations === "number" ? { minObservations: a.minObservations } : {}
  );
  return J({ state, ranked });
}

// --- F7 fleet-cache (op-dispatched) -----------------------------------------
export function handleFleetCache(args: unknown): string {
  const a = obj(args);
  switch (a.op) {
    case "put":
      return J({ cache: putResolved(a.cache, String(a.key ?? ""), a.entry) });
    case "get":
      return J(getResolved(a.cache, String(a.key ?? ""), a.currentDepShas));
    default:
      return err("fleet_cache requires `op` ∈ put|get.");
  }
}

// --- F8 marginal-value ------------------------------------------------------
export function handleMarginalValue(args: unknown): string {
  const a = obj(args);
  if (!Array.isArray(a.chunks)) return err("marginal_value requires a `chunks` array.");
  return J(assessMarginalValue(a.chunks, typeof a.atIso === "string" ? { atIso: a.atIso } : {}));
}

// --- F21 cache-poison -------------------------------------------------------
export function handleCachePoison(args: unknown): string {
  const a = obj(args);
  if (!Array.isArray(a.events)) return err("cache_poison_check requires an `events` array.");
  return J(
    assessWriters(a.events, {
      ...(typeof a.minWrites === "number" ? { minWrites: a.minWrites } : {}),
      ...(typeof a.rejectionThreshold === "number" ? { rejectionThreshold: a.rejectionThreshold } : {}),
      ...(typeof a.collisionThreshold === "number" ? { collisionThreshold: a.collisionThreshold } : {}),
    })
  );
}

// --- G1/G2/G3 anti-synergy --------------------------------------------------
export function handleAntiSynergy(args: unknown): string {
  const a = obj(args);
  switch (a.guard) {
    case "G1":
      return J(checkPrunerCacheBust(a.input));
    case "G2":
      return J(checkSkipStarvesCapture(a.input));
    case "G3":
      return J(checkResqueezePrefixBust(a.input));
    default:
      return err("anti_synergy_check requires `guard` ∈ G1|G2|G3 and an `input` object.");
  }
}

// --- U3 cache-reconcile -----------------------------------------------------
export function handleCacheReconcile(args: unknown): string {
  const a = obj(args);
  return J(
    reconcileCacheHits(a, typeof a.tolerance === "number" ? { tolerance: a.tolerance } : {})
  );
}
