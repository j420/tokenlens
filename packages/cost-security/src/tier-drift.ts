/**
 * L4-35 — Billing-tier drift detector (Cost-Security).
 *
 * `usage.service_tier` is parsed by the telemetry schema and, until now,
 * consumed by nothing. A mid-session tier flip (standard ↔ priority)
 * silently changes the rate of EVERY subsequent token — the bill moves
 * while the transcript looks identical. This detector watches the observed
 * tier sequence and reports:
 *
 *   - "drift":           consecutive non-null tiers differ (string equality
 *                        only — no inference about what a tier "means");
 *   - "unexpected_tier": an observed tier differs from the operator-pinned
 *                        expectation (PRUNE_EXPECTED_TIER);
 *   - "stable" / "no_signal": honest residue — absent tiers are NO signal,
 *                        never guessed.
 *
 * The cost differential is priced ONLY when the caller supplies both tier
 * rates; otherwise it is null. Deterministic, total, fail-open.
 */

export interface TierObservation {
  /** Observed usage.service_tier for one assistant turn; null when absent. */
  tier: string | null;
  /** Output tokens of that turn (for the differential when rates are known). */
  outputTokens?: number;
  inputTokens?: number;
}

export interface TierRates {
  /** USD per 1M input tokens for this tier. */
  input: number;
  /** USD per 1M output tokens for this tier. */
  output: number;
}

export interface TierDriftOptions {
  /** Operator-pinned expected tier (PRUNE_EXPECTED_TIER); null = no pin. */
  expectedTier?: string | null;
  /** Per-tier rates; differential is null unless BOTH sides are present. */
  tierRates?: Record<string, TierRates>;
}

export interface TierDriftReport {
  verdict: "no_signal" | "stable" | "drift" | "unexpected_tier";
  /** First flip, when verdict is "drift". */
  flip: { fromTier: string; toTier: string; atIndex: number } | null;
  /** When verdict is "unexpected_tier". */
  unexpected: { expected: string; observed: string; atIndex: number } | null;
  /** Non-null tier observations seen (the signal density, reported). */
  taggedCount: number;
  /**
   * USD delta of the post-flip turns priced at the new tier vs the old one.
   * null unless BOTH tiers' rates were supplied — never a fabricated rate.
   */
  differentialUsd: number | null;
}

const NO_FLIP: TierDriftReport["flip"] = null;

export function assessTierDrift(
  observations: TierObservation[],
  opts: TierDriftOptions = {}
): TierDriftReport {
  const expected =
    typeof opts.expectedTier === "string" && opts.expectedTier.length > 0
      ? opts.expectedTier
      : null;

  let taggedCount = 0;
  let previous: { tier: string; index: number } | null = null;
  let flip: TierDriftReport["flip"] = NO_FLIP;
  let unexpected: TierDriftReport["unexpected"] = null;

  observations.forEach((obs, index) => {
    const tier = typeof obs.tier === "string" && obs.tier.length > 0 ? obs.tier : null;
    if (tier === null) return; // absent ⇒ no signal for this turn, never inferred
    taggedCount++;
    if (expected !== null && tier !== expected && unexpected === null) {
      unexpected = { expected, observed: tier, atIndex: index };
    }
    if (previous !== null && tier !== previous.tier && flip === null) {
      flip = { fromTier: previous.tier, toTier: tier, atIndex: index };
    }
    previous = { tier, index };
  });

  let differentialUsd: number | null = null;
  if (flip !== null && opts.tierRates !== undefined) {
    const fromRates = opts.tierRates[(flip as NonNullable<typeof flip>).fromTier];
    const toRates = opts.tierRates[(flip as NonNullable<typeof flip>).toTier];
    if (
      fromRates !== undefined &&
      toRates !== undefined &&
      [fromRates.input, fromRates.output, toRates.input, toRates.output].every(
        Number.isFinite
      )
    ) {
      // Differential over the turns AT and AFTER the flip: what those turns
      // cost at the new tier minus what they would have cost at the old one.
      let delta = 0;
      const flipAt = (flip as NonNullable<typeof flip>).atIndex;
      for (let i = flipAt; i < observations.length; i++) {
        const input = observations[i].inputTokens ?? 0;
        const output = observations[i].outputTokens ?? 0;
        if (!Number.isFinite(input) || !Number.isFinite(output)) {
          differentialUsd = null;
          delta = Number.NaN;
          break;
        }
        delta +=
          (input * (toRates.input - fromRates.input) +
            output * (toRates.output - fromRates.output)) /
          1_000_000;
      }
      differentialUsd = Number.isFinite(delta) ? delta : null;
    }
  }

  const verdict: TierDriftReport["verdict"] =
    flip !== null
      ? "drift"
      : unexpected !== null
        ? "unexpected_tier"
        : taggedCount > 0
          ? "stable"
          : "no_signal";

  return { verdict, flip, unexpected, taggedCount, differentialUsd };
}
