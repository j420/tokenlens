import { describe, expect, it } from "vitest";

import { aggregateIterations, computeReplayCost } from "./cost-model.js";
import { computeDivergence } from "./divergence.js";
import { planReplay } from "./whatif.js";
import { canonicalSession, seg, timeline } from "./test-helpers.js";

/**
 * Hand-verified arithmetic for the canonical session under
 * claude-sonnet-4-5-20250929 (input=$3/1M, output=$15/1M, cached_input=$0.375/1M).
 *
 * Mutate segment 3 (the second user prompt "Q2"). Shared prefix = segments
 * 0,1,2; divergence at index 3.
 *   sharedTokensIn = 2000 + 500 + 800 = 3300
 *   tailTokensIn   = 300 + 1000 = 1300
 *   tailTokensOut  = 0 + 1000   = 1000
 *   allTokensIn    = 4600 ; allTokensOut = 1800
 *
 *   naive  = (4600*3 + 1800*15)/1e6 = (13800 + 27000)/1e6 = 0.0408
 *   replay = (3300*0.375 + 1300*3 + 1000*15)/1e6
 *          = (1237.5 + 3900 + 15000)/1e6 = 0.0201375
 *   saved  = 0.0206625 ; ratio = 0.0206625/0.0408 = 0.506434...
 */
describe("computeReplayCost — exact arithmetic", () => {
  it("matches the hand-derived figures when mutating the last user prompt", () => {
    const original = canonicalSession();
    const plan = planReplay(original, {
      atIndex: 3,
      newPayload: { role: "user", content: "Q2-variant" },
    });
    const c = plan.cost;
    expect(c.naiveCostUsd).toBeCloseTo(0.0408, 10);
    expect(c.replayCostUsd).toBeCloseTo(0.0201375, 10);
    expect(c.savedUsd).toBeCloseTo(0.0206625, 10);
    expect(c.savedRatio).toBeCloseTo(0.506434, 5);
    expect(c.sharedPrefixTokensIn).toBe(3300);
    expect(c.recomputedTokensIn).toBe(1300);
    expect(c.recomputedTokensOut).toBe(1000);
    expect(c.cacheReadTierAvailable).toBe(true);
  });

  it("saving grows when the mutation is later / tail is cheaper", () => {
    // A long shared prefix, a tiny cheap tail → near-total saving.
    const t = timeline([
      seg("system", "S", 50_000, 0),
      seg("user", "Q1", 1_000, 0),
      seg("assistant", "A1", 20_000, 20_000),
      seg("user", "Q2", 50, 0), // mutate this; tail is just this + a tiny answer
      seg("assistant", "A2", 80, 80),
    ]);
    const plan = planReplay(t, {
      atIndex: 3,
      newPayload: { role: "user", content: "tweak" },
    });
    expect(plan.cost.savedRatio).toBeGreaterThan(0.7);
  });

  it("returns null USD for an unpriced model but keeps token movement", () => {
    const t = timeline(
      [seg("system", "S", 100, 0), seg("user", "Q", 50, 0), seg("assistant", "A", 60, 60)],
      "some-unknown-model-xyz"
    );
    const plan = planReplay(t, { atIndex: 1, newPayload: { role: "user", content: "x" } });
    expect(plan.cost.naiveCostUsd).toBeNull();
    expect(plan.cost.replayCostUsd).toBeNull();
    expect(plan.cost.savedUsd).toBeNull();
    expect(plan.cost.savedRatio).toBeNull();
    // Structural figures still populated.
    expect(plan.cost.sharedPrefixTokensIn).toBe(100);
    expect(plan.cost.recomputedTokensIn).toBe(110);
    expect(plan.cost.cacheReadTierAvailable).toBe(false);
  });

  it("bills the shared prefix at full input when the model has no cache-read tier", () => {
    // gpt-4-turbo has no cached_input in the pricing table.
    const t = timeline(
      [
        seg("system", "S", 10_000, 0),
        seg("user", "Q", 100, 0),
        seg("assistant", "A", 200, 200),
      ],
      "gpt-4-turbo"
    );
    // gpt-4-turbo: input=10, output=30, no cached_input.
    const plan = planReplay(t, { atIndex: 1, newPayload: { role: "user", content: "x" } });
    expect(plan.cost.cacheReadTierAvailable).toBe(false);
    // Shared prefix (10_000 in) billed at full input=10, NOT a cache tier.
    // The only saving vs naive is the skipped regeneration of the shared
    // segment outputs — but seg0 has 0 output, so saving here is exactly the
    // shared prefix's output (0). Net: savedUsd === 0 for this shape.
    expect(plan.cost.savedUsd).toBeCloseTo(0, 10);
  });

  it("reflects a caller-supplied newTokensIn in the tail", () => {
    const original = canonicalSession();
    const plan = planReplay(original, {
      atIndex: 3,
      newPayload: { role: "user", content: "much longer variant prompt" },
      newTokensIn: 900, // was 300
    });
    // tail in = 900 + 1000 = 1900 (was 1300)
    expect(plan.cost.recomputedTokensIn).toBe(1900);
    expect(plan.reusedOriginalTokens).toBe(false);
  });
});

describe("computeReplayCost — direct over a divergence", () => {
  it("agrees with planReplay's embedded cost", () => {
    const original = canonicalSession();
    const plan = planReplay(original, { atIndex: 3, newPayload: { role: "user", content: "z" } });
    const direct = computeReplayCost(plan.modified, computeDivergence(original, plan.modified));
    expect(direct).toEqual(plan.cost);
  });
});

describe("aggregateIterations", () => {
  it("sums naive and replay costs across iterations", () => {
    const original = canonicalSession();
    const plans = [
      planReplay(original, { atIndex: 3, newPayload: { role: "user", content: "v1" } }),
      planReplay(original, { atIndex: 3, newPayload: { role: "user", content: "v2" } }),
      planReplay(original, { atIndex: 3, newPayload: { role: "user", content: "v3" } }),
    ];
    const agg = aggregateIterations(plans.map((p) => p.cost));
    expect(agg.iterations).toBe(3);
    expect(agg.cumulativeNaiveUsd).toBeCloseTo(0.0408 * 3, 10);
    expect(agg.cumulativeReplayUsd).toBeCloseTo(0.0201375 * 3, 10);
    expect(agg.cumulativeSavedRatio).toBeCloseTo(0.506434, 5);
  });

  it("returns nulls when no iteration was priced", () => {
    const t = timeline([seg("system", "S", 10, 0), seg("user", "Q", 5, 0)], "unknown-model");
    const plan = planReplay(t, { atIndex: 1, newPayload: { role: "user", content: "x" } });
    const agg = aggregateIterations([plan.cost]);
    expect(agg.cumulativeNaiveUsd).toBeNull();
    expect(agg.cumulativeSavedRatio).toBeNull();
  });

  it("ignores unpriced iterations but aggregates the priced ones", () => {
    const priced = planReplay(canonicalSession(), {
      atIndex: 3,
      newPayload: { role: "user", content: "v" },
    });
    const unpriced = planReplay(
      timeline([seg("system", "S", 10, 0), seg("user", "Q", 5, 0)], "unknown-model"),
      { atIndex: 1, newPayload: { role: "user", content: "x" } }
    );
    const agg = aggregateIterations([priced.cost, unpriced.cost]);
    expect(agg.iterations).toBe(2);
    expect(agg.cumulativeNaiveUsd).toBeCloseTo(0.0408, 10);
  });
});
