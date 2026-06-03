/**
 * Adversarial probes for the what-if replay engine.
 *
 * Phase 7 hard rule #5: every feature ships an adversarial-probe suite.
 */

import { describe, expect, it } from "vitest";

import { buildTimeline } from "./segment.js";
import { computeDivergence } from "./divergence.js";
import { computeReplayCost, aggregateIterations } from "./cost-model.js";
import { planReplay } from "./whatif.js";
import { canonicalSession, seg, timeline } from "./test-helpers.js";

describe("edge — degenerate timelines", () => {
  it("single-segment timeline: mutating it leaves zero shared prefix", () => {
    const t = timeline([seg("user", "only", 100, 0)]);
    const plan = planReplay(t, { atIndex: 0, newPayload: { role: "user", content: "x" } });
    expect(plan.divergence.divergenceIndex).toBe(0);
    expect(plan.cost.sharedPrefixTokensIn).toBe(0);
    expect(plan.cost.recomputedTokensIn).toBe(100);
  });

  it("all-zero token timeline: cost is exactly zero, ratio is null (no naive cost)", () => {
    const t = timeline([seg("system", "S", 0, 0), seg("user", "Q", 0, 0)]);
    const plan = planReplay(t, { atIndex: 1, newPayload: { role: "user", content: "x" } });
    expect(plan.cost.naiveCostUsd).toBe(0);
    expect(plan.cost.replayCostUsd).toBe(0);
    expect(plan.cost.savedUsd).toBe(0);
    expect(plan.cost.savedRatio).toBeNull(); // guarded division by zero
  });

  it("a no-op mutation (identical payload) produces null divergence and full sharing", () => {
    const original = canonicalSession();
    const same = original.segments[3]!.payload;
    const plan = planReplay(original, { atIndex: 3, newPayload: same });
    expect(plan.divergence.divergenceIndex).toBeNull();
    expect(plan.divergence.sharedSegmentCount).toBe(5);
    // Everything shared → tail is empty → replay only pays cache reads.
    expect(plan.cost.recomputedTokensIn).toBe(0);
    expect(plan.cost.recomputedTokensOut).toBe(0);
  });
});

describe("edge — hashing robustness", () => {
  it("structurally-equal-but-key-reordered payloads hash identically (no false divergence)", () => {
    const a = buildTimeline({
      model: "claude-sonnet-4-5-20250929",
      provider: "anthropic",
      segments: [
        { index: 0, role: "user", payload: { a: 1, b: 2, c: 3 }, tokensIn: 10, tokensOut: 0 },
      ],
    });
    const b = buildTimeline({
      model: "claude-sonnet-4-5-20250929",
      provider: "anthropic",
      segments: [
        { index: 0, role: "user", payload: { c: 3, b: 2, a: 1 }, tokensIn: 10, tokensOut: 0 },
      ],
    });
    expect(computeDivergence(a, b).divergenceIndex).toBeNull();
  });

  it("nested payload differences are detected", () => {
    const a = timeline([seg("user", { nested: { x: 1 } }, 10, 0)]);
    const b = timeline([seg("user", { nested: { x: 2 } }, 10, 0)]);
    expect(computeDivergence(a, b).divergenceIndex).toBe(0);
  });

  it("distinguishes number 1 from string '1' in payloads", () => {
    const a = timeline([seg("user", { v: 1 }, 10, 0)]);
    const b = timeline([seg("user", { v: "1" }, 10, 0)]);
    expect(computeDivergence(a, b).divergenceIndex).toBe(0);
  });
});

describe("edge — cost-model boundaries", () => {
  it("savedUsd is never negative for a valid mutation (replay ≤ naive)", () => {
    // Replay can never cost MORE than naive: shared prefix is billed at a rate
    // ≤ input, and its outputs are skipped. Verify across several mutation points.
    const original = canonicalSession();
    for (let k = 0; k < original.segments.length; k++) {
      const plan = planReplay(original, { atIndex: k, newPayload: { role: "x", content: `m${k}` } });
      if (plan.cost.savedUsd !== null) {
        expect(plan.cost.savedUsd).toBeGreaterThanOrEqual(-1e-12);
      }
    }
  });

  it("computeReplayCost over an empty modified timeline is all-zero / null-ratio", () => {
    const empty = timeline([]);
    const div = computeDivergence(empty, empty);
    const c = computeReplayCost(empty, div);
    expect(c.naiveCostUsd).toBe(0);
    expect(c.replayCostUsd).toBe(0);
    expect(c.savedRatio).toBeNull();
  });

  it("aggregateIterations over an empty list returns null totals", () => {
    const agg = aggregateIterations([]);
    expect(agg.iterations).toBe(0);
    expect(agg.cumulativeNaiveUsd).toBeNull();
  });
});

describe("edge — provider/model coupling", () => {
  it("an opus model uses opus pricing (input 15, cached 1.875)", () => {
    const t = timeline(
      [seg("system", "S", 1000, 0), seg("user", "Q", 100, 0), seg("assistant", "A", 200, 200)],
      "claude-opus-4-5-20251101"
    );
    const plan = planReplay(t, { atIndex: 1, newPayload: { role: "user", content: "x" } });
    // shared = seg0 (1000 in). read tier = 1.875.
    // naive  = (1300*15 + 200*75)/1e6 = (19500 + 15000)/1e6 = 0.0345
    // replay = (1000*1.875 + 300*15 + 200*75)/1e6 = (1875 + 4500 + 15000)/1e6 = 0.021375
    expect(plan.cost.naiveCostUsd).toBeCloseTo(0.0345, 10);
    expect(plan.cost.replayCostUsd).toBeCloseTo(0.021375, 10);
    expect(plan.cost.cacheReadTierAvailable).toBe(true);
  });
});
