/**
 * Decision-Time Dual Price Tag + Default-Flip  (F14)
 * ==================================================
 * The actor who spends a token is not the payer; below the budget cap the
 * marginal token is priced at $0 to them, so the expensive path is chosen by
 * default. budget-gate only warns near a cap; attribution is a post-hoc rollup.
 * Neither re-prices the decision AT decision time. This does: given the path the
 * user is about to take and a cheap-sufficient alternative, it shows the real $
 * of each and PRE-SELECTS the cheaper one — but only when that alternative is
 * caller-proven equivalence-non-inferior, so the flipped default is never worse.
 *
 * `priceDecision(chosen, cheap, options?)` is a PURE function.
 *
 * DISCIPLINE:
 *   - Deterministic & total. Same inputs => same recommendation. Never throws.
 *   - Honest pricing. Costs come from `@prune/shared` strict pricing; an
 *     unpriced model yields a null cost, and a null cost NEVER flips the default
 *     and NEVER claims a saving.
 *   - Never flips to an unproven path. The flip requires `equivalenceProven`
 *     true AND a strictly lower, fully-priced cost. Otherwise the chosen path
 *     stands. (This is the "default is never inferior" guarantee.)
 *   - No fabricated numbers. No regex, no model.
 *
 * Relation to f18 clearing-price: f18 is a standing PID-paced price λ every
 * actuator bids against; F14 prices ONE concrete binary choice at the moment of
 * decision and flips its default. Complementary, not a duplicate.
 */

import { getModelPricingStrictByName } from "@prune/shared";

// ============================================================================
// Types
// ============================================================================

/** One candidate path the request could take. Tokens are caller-supplied. */
export interface DecisionPath {
  /** Human label, e.g. "Opus, full context" / "Sonnet, pruned context". */
  label: string;
  /** Model the path runs on (drives pricing; unpriced ⇒ null cost). */
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface PriceTagOptions {
  /**
   * Whether the cheap path is PROVEN equivalence-non-inferior to the chosen one
   * (caller-supplied — e.g. from `@prune/equivalence` / `@prune/quality`). The
   * default only flips to `cheap` when this is true. Default false (no flip).
   */
  equivalenceProven?: boolean;
  /**
   * Minimum USD saving required to bother flipping. Default 0 — any strictly
   * positive saving flips (when proven). Raise to suppress trivial flips.
   */
  minSavingUsd?: number;
}

export type Recommended = "chosen" | "cheap";

export interface PriceTagReport {
  recommended: Recommended;
  /** True when the recommendation differs from the user's default (chosen). */
  flipped: boolean;
  chosen: { label: string; costUsd: number | null; tokens: number };
  cheap: { label: string; costUsd: number | null; tokens: number };
  /** chosenCost − cheapCost, when both are priced and cheap < chosen; else null. */
  savingsUsd: number | null;
  /** savingsUsd / chosenCost × 100, rounded; null when savingsUsd is null. */
  savingsPercent: number | null;
  /** Whether the cheap path was caller-proven non-inferior. */
  equivalenceProven: boolean;
  reason: string;
}

// ============================================================================
// priceDecision
// ============================================================================

export function priceDecision(
  chosen: unknown,
  cheap: unknown,
  options: PriceTagOptions = {}
): PriceTagReport {
  const proven = options.equivalenceProven === true;
  const minSaving =
    typeof options.minSavingUsd === "number" && Number.isFinite(options.minSavingUsd)
      ? options.minSavingUsd
      : 0;

  const c = coercePath(chosen, "chosen");
  const k = coercePath(cheap, "cheap");
  const chosenCost = pathCostUsd(c);
  const cheapCost = pathCostUsd(k);

  const bothPriced = chosenCost !== null && cheapCost !== null;
  const savingsUsd =
    bothPriced && cheapCost! < chosenCost! ? round(chosenCost! - cheapCost!) : null;
  const savingsPercent =
    savingsUsd !== null && chosenCost! > 0 ? round((savingsUsd / chosenCost!) * 100) : null;

  // The flip is gated three ways, ALL deterministic and caller-grounded:
  //   1) the cheap path is proven non-inferior,
  //   2) both paths are fully priced (no fabricated saving),
  //   3) the saving strictly clears the minimum.
  const flip = proven && savingsUsd !== null && savingsUsd > minSaving;
  const recommended: Recommended = flip ? "cheap" : "chosen";

  let reason: string;
  if (flip) {
    reason =
      `Recommend "${k.label}" — proven non-inferior and $${savingsUsd} cheaper ` +
      `(${savingsPercent}% less) than "${c.label}".`;
  } else if (!proven && savingsUsd !== null) {
    reason =
      `Keeping "${c.label}": "${k.label}" is $${savingsUsd} cheaper but NOT proven ` +
      `equivalence-non-inferior — not flipping to a possibly-worse path.`;
  } else if (!bothPriced) {
    reason =
      `Keeping "${c.label}": a path is on an unpriced model, so no saving can be ` +
      `verified (cost shown as null, never fabricated).`;
  } else {
    reason = `Keeping "${c.label}": no cost advantage to the alternative.`;
  }

  return {
    recommended,
    flipped: flip,
    chosen: { label: c.label, costUsd: chosenCost, tokens: pathTokens(c) },
    cheap: { label: k.label, costUsd: cheapCost, tokens: pathTokens(k) },
    savingsUsd,
    savingsPercent,
    equivalenceProven: proven,
    reason,
  };
}

// ============================================================================
// Pricing (honest — null on unpriced model)
// ============================================================================

export function pathCostUsd(p: DecisionPath): number | null {
  const pricing = getModelPricingStrictByName(p.model);
  if (!pricing || typeof pricing.input !== "number" || typeof pricing.output !== "number") {
    return null;
  }
  const cachedRate = typeof pricing.cached_input === "number" ? pricing.cached_input : pricing.input;
  const usd =
    (nonNeg(p.inputTokens) * pricing.input +
      nonNeg(p.outputTokens) * pricing.output +
      nonNeg(p.cacheReadTokens) * cachedRate +
      nonNeg(p.cacheWriteTokens) * pricing.input) /
    1_000_000;
  // Never leak a non-finite cost (overflow at astronomical token counts) as a
  // number — treat it as unpriced.
  return Number.isFinite(usd) ? round(usd) : null;
}

function pathTokens(p: DecisionPath): number {
  return (
    nonNeg(p.inputTokens) +
    nonNeg(p.outputTokens) +
    nonNeg(p.cacheReadTokens) +
    nonNeg(p.cacheWriteTokens)
  );
}

// ============================================================================
// Helpers
// ============================================================================

function coercePath(v: unknown, fallbackLabel: string): DecisionPath {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return {
    label: typeof o.label === "string" && o.label.length > 0 ? o.label : fallbackLabel,
    model: typeof o.model === "string" ? o.model : "",
    inputTokens: nonNeg(o.inputTokens),
    outputTokens: nonNeg(o.outputTokens),
    cacheReadTokens: nonNeg(o.cacheReadTokens),
    cacheWriteTokens: nonNeg(o.cacheWriteTokens),
  };
}

function nonNeg(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

function round(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
