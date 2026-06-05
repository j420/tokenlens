import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildSession, type SessionFixture } from "./fixtures/session";
import { runEdgeCaseScenario } from "./scenarios/edge-cases";
import { loadDashboard } from "./drivers/dashboard-driver";
import { findStep, type ScenarioResult } from "./types";

function failedChecks(result: ScenarioResult): string[] {
  return result.steps.flatMap((s) => (s.checks ?? []).filter((c) => !c.passed).map((c) => `${s.name}: ${c.label}`));
}

describe("Flow X — discipline matrix + no-degradation proofs", () => {
  let fx: SessionFixture;
  let result: ScenarioResult;
  beforeAll(async () => {
    fx = buildSession();
    const lib = await loadDashboard();
    result = await runEdgeCaseScenario(fx, lib);
  });
  afterAll(() => fx.cleanup());

  it("every invariant check passes", () => {
    expect(failedChecks(result)).toEqual([]);
  });

  it("independent equivalence proof: lossless prune is byte-equivalent", () => {
    expect(findStep(result, "no-degradation: lossless prune ⇒ bytes unchanged").quality!.preserved).toBe(true);
  });

  it("independent equivalence proof: squeeze(lossless) is AST-equivalent", () => {
    expect(findStep(result, "no-degradation: squeeze(lossless) ⇒ AST-equivalent").quality!.preserved).toBe(true);
  });

  it("strict pricing yields a null projected cost for an unpriced model", () => {
    expect((findStep(result, "strict pricing (unpriced model)").output as { projectedTotalUsd: unknown }).projectedTotalUsd).toBeNull();
  });

  it("forwarder is gapless and exactly-once under a mid-run failure", () => {
    expect(failedChecks({ flow: "", summary: "", steps: [findStep(result, "forwarder stop-on-failure + gapless resume")] })).toEqual([]);
  });
});
