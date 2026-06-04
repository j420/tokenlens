import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildSession, UNPRICED_MODEL, type SessionFixture } from "./fixtures/session";
import { runExtensionScenario } from "./scenarios/extension";
import { findStep, type ScenarioResult } from "./types";

describe("Flow A — Extension core (headless)", () => {
  let fx: SessionFixture;
  let result: ScenarioResult;
  beforeAll(() => {
    fx = buildSession();
    result = runExtensionScenario(fx);
  });
  afterAll(() => fx.cleanup());

  it("Smart Copy never inflates and reports honest token deltas", () => {
    const d = findStep(result, "Smart Copy").data!;
    expect(d.optimizedTokens as number).toBeLessThanOrEqual(d.originalTokens as number);
    expect(d.originalTokens as number).toBeGreaterThan(0);
  });

  it("Pre-flight recommends a subset (fewer/equal files and tokens)", () => {
    const d = findStep(result, "Pre-flight").data!;
    expect(d.recommendedFiles as number).toBeLessThanOrEqual(d.currentFiles as number);
    expect(d.recommendedTokens as number).toBeLessThanOrEqual(d.currentTokens as number);
    // The unrelated thumbnail file should not be in the recommended set.
    expect(d.recommendedList as string[]).not.toContain("src/media/thumbnail.ts");
  });

  it("Session-memory dedup detects the re-read and reports tokens saved", () => {
    const d = findStep(result, "Session-memory dedup").data!;
    expect(d.firstDuplicate).toBe(false);
    expect(d.secondDuplicate).toBe(true);
    expect(d.tokensSaved as number).toBeGreaterThan(0);
  });

  it("HUD is honest about pricing: priced model true, unpriced model false + '*'", () => {
    expect(findStep(result, "HUD (priced)").data!.priced).toBe(true);
    const u = findStep(result, "HUD (unpriced)").data!;
    expect(u.priced).toBe(false);
    expect(u.displayHasStar).toBe(true);
  });

  it("Context relevance ranks the imported type above the unrelated file", () => {
    const d = findStep(result, "Context relevance").data!;
    expect(d.typesScore as number).toBeGreaterThanOrEqual((d.thumbnailScore as number) ?? 0);
  });

  it("Intent classifier returns a concrete intent", () => {
    const d = findStep(result, "Intent classification").data!;
    expect(typeof d.primary).toBe("string");
    expect((d.primary as string).length).toBeGreaterThan(0);
  });

  it("Squeeze is valid and non-inflating at every tier; deeper tiers save more", () => {
    const tiers = findStep(result, "Squeeze (3 tiers)").data!.tiers as Array<{
      tier: string;
      originalTokens: number;
      compressedTokens: number;
      savingsPercent: number;
      isValid: boolean;
    }>;
    for (const t of tiers) {
      expect(t.isValid).toBe(true);
      expect(t.compressedTokens).toBeLessThanOrEqual(t.originalTokens);
    }
    const byTier = Object.fromEntries(tiers.map((t) => [t.tier, t.savingsPercent]));
    expect(byTier.telegraphic).toBeGreaterThanOrEqual(byTier.lossless);
  });

  it("the HUD honesty step never invents a rate for the unknown model", () => {
    // Belt-and-suspenders cross-check of the strict-pricing discipline.
    const hud = findStep(result, "HUD (unpriced)");
    expect(hud.data!.priced).toBe(false);
    expect(UNPRICED_MODEL).toContain("acme");
  });
});
