/**
 * Tests for the Reasoning-Effort Auto-Router (2.4d).
 *
 * Verifies the dial policy on top of qpd-bench's gates: down-route only, floor
 * respected, honest hold on insufficient data or no safe down-route, and that a
 * clearly quality-non-inferior cheaper effort is recommended with savings.
 */

import { describe, it, expect } from "vitest";
import {
  routeReasoningEffort,
  EFFORT_ORDER,
  isReasoningEffort,
  type EffortOutcomeStats,
} from "./effort-router.js";

/** A big, clean sample so the sample-size + AR gates are well-powered. */
function stats(
  effort: EffortOutcomeStats["effort"],
  ar: number,
  meanCostUsd: number,
  n = 200
): EffortOutcomeStats {
  return {
    effort,
    n,
    acceptedCount: Math.round(n * ar),
    meanCostUsd,
  };
}

describe("EFFORT_ORDER / isReasoningEffort", () => {
  it("is ordered low→high and recognizes valid efforts", () => {
    expect([...EFFORT_ORDER]).toEqual(["standard", "high", "xhigh", "max"]);
    expect(isReasoningEffort("xhigh")).toBe(true);
    expect(isReasoningEffort("turbo")).toBe(false);
    expect(isReasoningEffort(3)).toBe(false);
  });
});

describe("down-routing", () => {
  it("recommends a cheaper, quality-equivalent lower effort with projected savings", () => {
    // On an easy task class extra reasoning doesn't help: 'high' matches/edges
    // 'max' on AR at 5x lower cost. 'standard' drops quality hard and must lose.
    const rec = routeReasoningEffort("max", [
      stats("max", 0.9, 0.1),
      stats("high", 0.92, 0.02),
      stats("standard", 0.72, 0.004), // big AR drop — must NOT be chosen
    ]);
    expect(rec.hold).toBe(false);
    expect(rec.recommendedEffort).toBe("high");
    expect(rec.projectedSavingsPct).toBeGreaterThan(70);
    expect(rec.gates?.ar).toBe(true);
    expect(rec.basis).toBe("history");
  });

  it("never escalates: a cheaper-but-higher effort is impossible by construction", () => {
    // Only 'standard' has data below 'high'; 'max' (higher) is ignored as a candidate.
    const rec = routeReasoningEffort("high", [
      stats("high", 0.9, 0.02),
      stats("standard", 0.9, 0.004),
      stats("max", 0.95, 0.2),
    ]);
    expect(rec.recommendedEffort).toBe("standard");
    expect(["standard", "high"]).toContain(rec.recommendedEffort);
    expect(rec.recommendedEffort).not.toBe("max");
  });
});

describe("holding", () => {
  it("holds when no lower effort is quality-non-inferior", () => {
    const rec = routeReasoningEffort("max", [
      stats("max", 0.92, 0.1),
      stats("high", 0.7, 0.02), // 22pp AR drop — fails the AR gate
    ]);
    expect(rec.hold).toBe(true);
    expect(rec.recommendedEffort).toBe("max");
    expect(rec.projectedSavingsPct).toBeNull();
    expect(rec.gates?.ar).toBe(false);
  });

  it("holds at the floor — never recommends below it", () => {
    const rec = routeReasoningEffort(
      "high",
      [stats("high", 0.9, 0.02), stats("standard", 0.9, 0.004)],
      { floor: "high" }
    );
    expect(rec.hold).toBe(true);
    expect(rec.recommendedEffort).toBe("high");
    expect(rec.rationale).toMatch(/floor/);
  });

  it("holds when already at the lowest effort", () => {
    const rec = routeReasoningEffort("standard", [stats("standard", 0.9, 0.004)]);
    expect(rec.hold).toBe(true);
    expect(rec.basis).toBe("history");
  });
});

describe("insufficient data / robustness", () => {
  it("insufficient_data when there is no current-effort history", () => {
    const rec = routeReasoningEffort("max", [stats("high", 0.9, 0.02)]);
    expect(rec.basis).toBe("insufficient_data");
    expect(rec.hold).toBe(true);
  });

  it("holds when a lower effort lacks enough samples (sample-size gate)", () => {
    const rec = routeReasoningEffort("max", [
      stats("max", 0.92, 0.1, 200),
      stats("high", 0.92, 0.02, 5), // only 5 samples — under-powered
    ]);
    expect(rec.hold).toBe(true);
    expect(rec.gates?.sampleSize).toBe(false);
  });

  it("unknown current effort ⇒ insufficient_data, never throws", () => {
    const rec = routeReasoningEffort("turbo" as never, [stats("high", 0.9, 0.02)]);
    expect(rec.basis).toBe("insufficient_data");
  });

  it("never throws on garbage outcomes", () => {
    const garbage = [null, undefined, 42, { effort: "nope", n: 5 }] as unknown as EffortOutcomeStats[];
    expect(() => routeReasoningEffort("high", garbage)).not.toThrow();
    expect(routeReasoningEffort("high", garbage).basis).toBe("insufficient_data");
  });
});
