/**
 * N5 — Session-Idle Cache Guard.
 *
 * During an idle gap, a cached prompt prefix is racing its TTL. Two outcomes:
 *   - it EXPIRES → the next real turn pays the full cache-WRITE multiplier
 *     (1.25× for 5m, 2.00× for 1h) to rebuild the whole prefix; or
 *   - we keep it warm with a "heartbeat" — a minimal request that READS the
 *     cached prefix (0.10×) and resets the TTL window — so the next real turn
 *     reads (0.10×) instead of rewriting.
 *
 * The decision is whether a heartbeat is worth its own read cost. The clean
 * result, derived below, is that the decision is INDEPENDENT of both the
 * prefix size and the model's price — it reduces to a single comparison of the
 * caller's continuation probability against a TTL-specific threshold. Only the
 * dollar figures need pricing; the action does not.
 *
 *   Let p = P(the session continues with another real turn this window).
 *   Heartbeat now costs        READ·prefix·price        (a cache read).
 *   It avoids, with prob p,    (WRITE − READ)·prefix·price  on the next turn
 *                              (read instead of rewrite).
 *   Heartbeat is EV-positive  ⇔  p·(WRITE − READ) > READ
 *                             ⇔  p > READ / (WRITE − READ).
 *
 *   5m:  threshold = 0.10 / (1.25 − 0.10) = 0.0870  (heartbeat if p > 8.70%)
 *   1h:  threshold = 0.10 / (2.00 − 0.10) = 0.0526  (heartbeat if p > 5.26%)
 *
 * The prefix tokens and price cancel, so an unpriced model still gets a sound
 * action; the USD fields are simply null in that case.
 *
 * A per-idle heartbeat BUDGET caps the downside on an abandoned session: each
 * heartbeat is a single-step bet, and without a cap a wrong "continues" guess
 * would bleed reads forever. The guard refuses once the budget is spent.
 *
 * Pure logic. The caller measures the idle gap, supplies the continuation
 * probability (its own signal — e.g. "user is typing", "CI job pending"), and
 * executes the heartbeat. The guard never sends anything itself.
 */

import { FLAT_PRICING, type ModelPricing } from "@prune/shared";

import {
  READ_MULTIPLIER,
  WRITE_MULTIPLIER_1H,
  WRITE_MULTIPLIER_5M,
} from "./ttl-amortization.js";

/** TTL window lengths in milliseconds. */
export const TTL_WINDOW_MS: Record<"5m" | "1h", number> = {
  "5m": 5 * 60_000,
  "1h": 60 * 60_000,
};

/** Cache-write multiplier for a TTL tier. */
function writeMultiplier(ttl: "5m" | "1h"): number {
  return ttl === "1h" ? WRITE_MULTIPLIER_1H : WRITE_MULTIPLIER_5M;
}

/**
 * The continuation-probability threshold above which a single heartbeat is
 * expected-value positive. Pure function of the TTL tier's write multiplier;
 * independent of prefix size and model price.
 */
export function heartbeatThreshold(ttl: "5m" | "1h"): number {
  const w = writeMultiplier(ttl);
  return READ_MULTIPLIER / (w - READ_MULTIPLIER);
}

export type IdleGuardAction =
  | "wait" // not near expiry yet — do nothing
  | "heartbeat" // fire a keep-alive read; EV-positive
  | "let_expire" // continuation too unlikely to justify a heartbeat
  | "already_expired" // the window already elapsed; nothing to protect
  | "budget_exhausted" // heartbeat budget spent this idle period
  | "nothing_to_protect"; // no cacheable prefix at risk

export interface IdleGuardInput {
  /** Active TTL tier of the cached prefix. */
  ttl: "5m" | "1h";
  /** Model id for the USD figures (decision works without it). */
  model: string;
  /** Cacheable prefix tokens at risk of expiry. */
  cacheablePrefixTokens: number;
  /** Milliseconds since the last cache touch (read or write). */
  idleMs: number;
  /**
   * Caller-declared probability the session continues with another real turn
   * within the next window, in [0,1]. Out-of-range or non-finite ⇒ treated as
   * 0 (conservative: never heartbeat on a fabricated/garbage signal).
   */
  continuationProbability: number;
  /** Max heartbeats permitted this idle period (downside cap). */
  maxHeartbeats: number;
  /** Heartbeats already fired this idle period. */
  heartbeatsSoFar: number;
  /**
   * Fire the heartbeat once the remaining time-to-expiry drops below this many
   * ms. Default: 20% of the TTL window (so a 5m window heartbeats with ~60s of
   * headroom). Clamped to [0, window].
   */
  marginMs?: number;
}

export interface IdleGuardDecision {
  action: IdleGuardAction;
  reason: string;
  /** Remaining ms before the cached prefix expires (0 when already expired). */
  timeToExpiryMs: number;
  /** Continuation-probability threshold for a positive-EV heartbeat. */
  continuationThreshold: number;
  /** Cost of one heartbeat (a cache read) in USD; null when model is unpriced. */
  heartbeatCostUsd: number | null;
  /** Rewrite cost avoided if the heartbeat saves the next turn; null if unpriced. */
  rewriteCostAvoidedUsd: number | null;
  /**
   * Expected value of heartbeating in USD = p·rewriteAvoided − heartbeatCost.
   * Null when the model is unpriced. Positive ⇒ the action is "heartbeat".
   */
  heartbeatEvUsd: number | null;
}

/** Strict pricing — null for unknown models (never DEFAULT_PRICING). */
function strictPricing(model: string): ModelPricing | null {
  return FLAT_PRICING[model] ?? null;
}

function clampProbability(p: number): number {
  if (!Number.isFinite(p) || p < 0) return 0;
  if (p > 1) return 1;
  return p;
}

/**
 * Decide whether to fire a cache keep-alive heartbeat during an idle gap.
 * Pure and deterministic.
 */
export function evaluateIdleGuard(input: IdleGuardInput): IdleGuardDecision {
  const windowMs = TTL_WINDOW_MS[input.ttl];
  const threshold = heartbeatThreshold(input.ttl);

  // USD figures (decision is independent of these; they're for reporting).
  const pricing = strictPricing(input.model);
  const prefix = Math.max(0, input.cacheablePrefixTokens);
  let heartbeatCostUsd: number | null = null;
  let rewriteCostAvoidedUsd: number | null = null;
  if (pricing && typeof pricing.input === "number") {
    heartbeatCostUsd = (prefix * pricing.input * READ_MULTIPLIER) / 1_000_000;
    rewriteCostAvoidedUsd =
      (prefix * pricing.input * (writeMultiplier(input.ttl) - READ_MULTIPLIER)) /
      1_000_000;
  }

  const p = clampProbability(input.continuationProbability);
  const heartbeatEvUsd =
    rewriteCostAvoidedUsd === null || heartbeatCostUsd === null
      ? null
      : p * rewriteCostAvoidedUsd - heartbeatCostUsd;

  const base = {
    continuationThreshold: threshold,
    heartbeatCostUsd,
    rewriteCostAvoidedUsd,
    heartbeatEvUsd,
  };

  // Nothing cacheable ⇒ no benefit possible.
  if (prefix === 0) {
    return {
      action: "nothing_to_protect",
      reason: "No cacheable prefix at risk; heartbeating cannot save anything.",
      timeToExpiryMs: Math.max(0, windowMs - Math.max(0, input.idleMs)),
      ...base,
    };
  }

  const idleMs = Math.max(0, input.idleMs);
  const timeToExpiryMs = Math.max(0, windowMs - idleMs);

  // Already expired — the prefix is gone; the next turn rewrites regardless.
  if (idleMs >= windowMs) {
    return {
      action: "already_expired",
      reason: `Idle ${(idleMs / 1000).toFixed(1)}s ≥ ${input.ttl} window; the cached prefix has expired and the next turn will rewrite it.`,
      timeToExpiryMs: 0,
      ...base,
    };
  }

  // Budget cap — refuse before evaluating, so an abandoned session can't bleed.
  if (input.maxHeartbeats <= 0 || input.heartbeatsSoFar >= input.maxHeartbeats) {
    return {
      action: "budget_exhausted",
      reason: `Heartbeat budget spent (${input.heartbeatsSoFar}/${input.maxHeartbeats}); letting the prefix expire to bound idle waste.`,
      timeToExpiryMs,
      ...base,
    };
  }

  // Not near expiry yet — wait.
  const rawMargin = input.marginMs ?? windowMs * 0.2;
  const margin = Math.max(0, Math.min(windowMs, rawMargin));
  if (timeToExpiryMs > margin) {
    return {
      action: "wait",
      reason: `${(timeToExpiryMs / 1000).toFixed(1)}s to expiry > ${(margin / 1000).toFixed(1)}s margin; too early to heartbeat.`,
      timeToExpiryMs,
      ...base,
    };
  }

  // Within the margin: fire iff the continuation probability clears the
  // TTL-specific threshold (price- and size-independent).
  if (p > threshold) {
    return {
      action: "heartbeat",
      reason: `Continuation p=${(p * 100).toFixed(1)}% > ${(threshold * 100).toFixed(2)}% threshold; a keep-alive read is cheaper than the expected rewrite.`,
      timeToExpiryMs,
      ...base,
    };
  }
  return {
    action: "let_expire",
    reason: `Continuation p=${(p * 100).toFixed(1)}% ≤ ${(threshold * 100).toFixed(2)}% threshold; a heartbeat is not expected to pay for itself.`,
    timeToExpiryMs,
    ...base,
  };
}
