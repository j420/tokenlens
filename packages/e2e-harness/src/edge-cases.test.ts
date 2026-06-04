import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildSession, type SessionFixture } from "./fixtures/session";
import { runEdgeCaseScenario } from "./scenarios/edge-cases";
import { loadDashboard } from "./drivers/dashboard-driver";
import { findStep, type ScenarioResult } from "./types";

describe("Flow X — discipline matrix", () => {
  let fx: SessionFixture;
  let result: ScenarioResult;
  beforeAll(async () => {
    fx = buildSession();
    const lib = await loadDashboard();
    result = await runEdgeCaseScenario(fx, lib);
  });
  afterAll(() => fx.cleanup());

  it("every invariant holds (no edge-case step regressed)", () => {
    const regressed = result.steps.filter((s) => s.status === "warn").map((s) => s.name);
    expect(regressed).toEqual([]);
  });

  it("strict pricing: an unpriced model yields a null projected cost", () => {
    const d = findStep(result, "strict pricing (unpriced model)").data!;
    expect(d.priced).toBe(false);
    expect(d.projectedTotalUsd).toBeNull();
  });

  it("boundary safety: a missing required arg returns a JSON error, not a throw", () => {
    expect(findStep(result, "boundary safety (missing required arg)").data!.error).toBe(true);
  });

  it("fail-safe: a missing transcript yields an empty-derived snapshot", () => {
    expect(findStep(result, "fail-safe (missing transcript)").data!.transcriptHadTurns).toBe(false);
  });

  it("no false positive: proposing the same model does not fire CH-001", () => {
    expect(findStep(result, "no false positive (same model)").data!.firedCH001).toBe(false);
  });

  it("result_prune is idempotent (re-pruning saves nothing)", () => {
    expect(Number(findStep(result, "result_prune idempotency").data!.secondSaved)).toBe(0);
  });

  it("max_tokens_calibrate refuses to invent a number from too few samples", () => {
    const d = findStep(result, "max_tokens_calibrate (too few samples)").data!;
    expect(d.status).toBe("insufficient_data");
    expect(d.recommendedMaxTokens).toBeNull();
  });

  it("reasoning_effort_route holds on insufficient data", () => {
    expect(findStep(result, "reasoning_effort_route (insufficient data)").data!.hold).toBe(true);
  });

  it("forwarder: stops on failure, then resumes gaplessly with no duplicates", () => {
    const d = findStep(result, "forwarder stop-on-failure + gapless resume").data!;
    expect(d.run1Sent).toBe(2);
    expect(d.stopped).toBe(true);
    expect(d.uniqueDelivered).toBe(4);
  });

  it("forwarder: ships only feature-tagged rows (skips plain events)", () => {
    expect(findStep(result, "forwarder skips non-feature rows").data!.attempted).toBe(1);
  });

  it("rollup: defensively counts malformed proofs and excludes out-of-scope ids", () => {
    const d = findStep(result, "rollup defensive decoding").data!;
    expect(d.f9MalformedProofCount as number).toBeGreaterThanOrEqual(1);
    expect(d.outOfScopeEventCount).toBe(1);
  });
});
