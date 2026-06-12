import { describe, expect, it } from "vitest";
import { assessTierDrift } from "./tier-drift.js";

const RATES = {
  standard: { input: 3, output: 15 },
  priority: { input: 6, output: 30 },
};

describe("assessTierDrift", () => {
  it("no observations / all-absent tiers ⇒ no_signal (absence is never inferred)", () => {
    expect(assessTierDrift([]).verdict).toBe("no_signal");
    expect(
      assessTierDrift([{ tier: null }, { tier: null }, { tier: "" }]).verdict
    ).toBe("no_signal");
  });

  it("a constant tier is stable; gaps (null turns) do not fake a flip", () => {
    const r = assessTierDrift([
      { tier: "standard" },
      { tier: null },
      { tier: "standard" },
    ]);
    expect(r.verdict).toBe("stable");
    expect(r.taggedCount).toBe(2);
    expect(r.flip).toBeNull();
  });

  it("detects the FIRST flip with exact from/to/index; string equality only", () => {
    const r = assessTierDrift([
      { tier: "standard" },
      { tier: "priority" },
      { tier: "standard" }, // later flips are not re-reported
    ]);
    expect(r.verdict).toBe("drift");
    expect(r.flip).toEqual({ fromTier: "standard", toTier: "priority", atIndex: 1 });
  });

  it("flags an unexpected tier vs the operator pin", () => {
    const r = assessTierDrift([{ tier: "priority" }], { expectedTier: "standard" });
    expect(r.verdict).toBe("unexpected_tier");
    expect(r.unexpected).toEqual({ expected: "standard", observed: "priority", atIndex: 0 });
  });

  it("drift outranks unexpected_tier (drift implies the bill is already moving)", () => {
    const r = assessTierDrift(
      [{ tier: "standard" }, { tier: "priority" }],
      { expectedTier: "standard" }
    );
    expect(r.verdict).toBe("drift");
    expect(r.unexpected).not.toBeNull(); // still reported, just not the verdict
  });

  it("prices the differential ONLY when both tiers' rates are known", () => {
    const obs = [
      { tier: "standard", inputTokens: 0, outputTokens: 0 },
      { tier: "priority", inputTokens: 1_000_000, outputTokens: 1_000_000 },
    ];
    const priced = assessTierDrift(obs, { tierRates: RATES });
    // (6-3) + (30-15) = $18 per 1M each → $18 total.
    expect(priced.differentialUsd).toBeCloseTo(18, 10);
    // Unknown tier on either side ⇒ null, never a guessed rate.
    expect(
      assessTierDrift(obs, { tierRates: { standard: RATES.standard } }).differentialUsd
    ).toBeNull();
    expect(assessTierDrift(obs).differentialUsd).toBeNull();
  });

  it("poisons the differential to null on non-finite token counts (never clamps garbage)", () => {
    const r = assessTierDrift(
      [
        { tier: "standard" },
        { tier: "priority", inputTokens: Number.NaN, outputTokens: 10 },
      ],
      { tierRates: RATES }
    );
    expect(r.verdict).toBe("drift");
    expect(r.differentialUsd).toBeNull();
  });
});
