import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildSession, type SessionFixture } from "./fixtures/session";
import { runHooksScenario } from "./scenarios/hooks";
import { findStep, type ScenarioResult } from "./types";

function failedChecks(result: ScenarioResult): string[] {
  return result.steps.flatMap((s) => (s.checks ?? []).filter((c) => !c.passed).map((c) => `${s.name}: ${c.label}`));
}

describe("Flow C — Claude Code hooks (real child processes)", () => {
  let fx: SessionFixture;
  let result: ScenarioResult;
  beforeAll(async () => {
    fx = buildSession();
    result = await runHooksScenario(fx);
  });
  afterAll(() => fx.cleanup());

  it("every invariant check passes across all hooks", () => {
    expect(failedChecks(result)).toEqual([]);
  });

  it("sentinel-prompt BLOCKS an AWS key (exit 2)", () => {
    expect((findStep(result, "sentinel-prompt (AWS key)").output as { exitCode: number }).exitCode).toBe(2);
  });

  it("sentinel-mcp BLOCKS prompt injection", () => {
    expect(findStep(result, "sentinel-mcp (injection)").status).toBe("block");
  });

  it("flag gating: shadow stays silent, general surfaces (cache-habits idle)", () => {
    expect(failedChecks({ flow: "", summary: "", steps: [findStep(result, "cache-habits-advisor (idle, f9=general)"), findStep(result, "cache-habits-advisor (f9=shadow gating)")] })).toEqual([]);
  });

  it("fail-safe: every empty/garbage/missing-transcript invocation exits 0", () => {
    const codes = (findStep(result, "fail-safe matrix").output as { exitCodes: number[] }).exitCodes;
    expect(codes.every((c) => c === 0)).toBe(true);
  });
});
