import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildSession, type SessionFixture } from "./fixtures/session";
import { runExtensionScenario } from "./scenarios/extension";
import { findStep, type ScenarioResult } from "./types";

function failedChecks(result: ScenarioResult): string[] {
  return result.steps.flatMap((s) => (s.checks ?? []).filter((c) => !c.passed).map((c) => `${s.name}: ${c.label}`));
}

describe("Flow A — Extension core (headless)", () => {
  let fx: SessionFixture;
  let result: ScenarioResult;
  beforeAll(() => {
    fx = buildSession();
    result = runExtensionScenario(fx);
  });
  afterAll(() => fx.cleanup());

  it("every invariant check passes (feature did its job 100%)", () => {
    expect(failedChecks(result)).toEqual([]);
  });

  it("Smart Copy never inflates token count", () => {
    const d = findStep(result, "Smart Copy").data!;
    expect(d.optimizedTokens as number).toBeLessThanOrEqual(d.originalTokens as number);
  });

  it("HUD is honest about pricing (unpriced → priced=false, no fabricated rate)", () => {
    const q = findStep(result, "HUD (unpriced model)").quality!;
    expect(q.preserved).toBe(true);
    expect(findStep(result, "HUD (unpriced model)").output as { priced: boolean }).toMatchObject({ priced: false });
  });

  it("Squeeze preserves syntax at every tier (no degradation)", () => {
    const q = findStep(result, "Squeeze (3 tiers)").quality!;
    expect(q.preserved).toBe(true);
  });

  it("every step records real input and output", () => {
    for (const s of result.steps) {
      expect(s.input).toBeDefined();
      expect(s.output).toBeDefined();
    }
  });
});
