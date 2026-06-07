import { describe, it, expect } from "vitest";
import { priceDecision, pathCostUsd, type DecisionPath } from "./price-tag.js";

const OPUS = "claude-opus-4"; // input 15, output 75 (from pricing.ts)
const SONNET = "claude-sonnet-4-5-20250929"; // input 3, output 15
const UNPRICED = "totally-made-up-model-9000";

const opusPath: DecisionPath = { label: "Opus full", model: OPUS, inputTokens: 10_000, outputTokens: 2_000 };
const sonnetPath: DecisionPath = { label: "Sonnet pruned", model: SONNET, inputTokens: 4_000, outputTokens: 1_000 };

describe("pathCostUsd", () => {
  it("prices a known model, null on unknown", () => {
    expect(pathCostUsd(sonnetPath)).toBeCloseTo((4000 * 3 + 1000 * 15) / 1e6, 9);
    expect(pathCostUsd({ ...sonnetPath, model: UNPRICED })).toBeNull();
  });
});

describe("priceDecision", () => {
  it("flips to the cheap path when it is proven non-inferior AND cheaper", () => {
    const r = priceDecision(opusPath, sonnetPath, { equivalenceProven: true });
    expect(r.recommended).toBe("cheap");
    expect(r.flipped).toBe(true);
    expect(r.savingsUsd).toBeGreaterThan(0);
    expect(r.savingsPercent).toBeGreaterThan(0);
  });

  it("does NOT flip when the cheap path is not proven non-inferior", () => {
    const r = priceDecision(opusPath, sonnetPath, { equivalenceProven: false });
    expect(r.recommended).toBe("chosen");
    expect(r.flipped).toBe(false);
    // savings is still computed/shown (transparency), just not acted on
    expect(r.savingsUsd).toBeGreaterThan(0);
    expect(r.reason).toContain("NOT proven");
  });

  it("defaults equivalenceProven to false (no accidental flip)", () => {
    expect(priceDecision(opusPath, sonnetPath).recommended).toBe("chosen");
  });

  it("never flips to an unpriced alternative (no fabricated saving)", () => {
    const r = priceDecision(opusPath, { ...sonnetPath, model: UNPRICED }, { equivalenceProven: true });
    expect(r.recommended).toBe("chosen");
    expect(r.cheap.costUsd).toBeNull();
    expect(r.savingsUsd).toBeNull();
    expect(r.savingsPercent).toBeNull();
  });

  it("does not flip when the alternative is not actually cheaper", () => {
    // cheap path is more expensive → no flip even if 'proven'
    const r = priceDecision(sonnetPath, opusPath, { equivalenceProven: true });
    expect(r.recommended).toBe("chosen");
    expect(r.savingsUsd).toBeNull();
  });

  it("respects minSavingUsd (suppresses trivial flips)", () => {
    const r = priceDecision(opusPath, sonnetPath, { equivalenceProven: true, minSavingUsd: 1000 });
    expect(r.flipped).toBe(false); // saving is well under $1000
  });

  it("computes savings percent relative to the chosen cost", () => {
    const r = priceDecision(opusPath, sonnetPath, { equivalenceProven: true });
    const chosen = pathCostUsd(opusPath)!;
    const cheap = pathCostUsd(sonnetPath)!;
    expect(r.savingsPercent).toBeCloseTo(((chosen - cheap) / chosen) * 100, 4);
  });

  it("is total on garbage input", () => {
    const r = priceDecision(null, undefined);
    expect(r.recommended).toBe("chosen");
    expect(r.chosen.costUsd).toBeNull(); // empty model → unpriced
  });

  it("is deterministic", () => {
    const a = priceDecision(opusPath, sonnetPath, { equivalenceProven: true });
    const b = priceDecision(opusPath, sonnetPath, { equivalenceProven: true });
    expect(a).toEqual(b);
  });
});
