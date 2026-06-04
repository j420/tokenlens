import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildSession, type SessionFixture } from "./fixtures/session";
import { runHooksScenario } from "./scenarios/hooks";
import { findStep, type ScenarioResult } from "./types";

describe("Flow C — Claude Code hooks (real child processes)", () => {
  let fx: SessionFixture;
  let result: ScenarioResult;
  beforeAll(async () => {
    fx = buildSession();
    result = await runHooksScenario(fx);
  });
  afterAll(() => fx.cleanup());

  it("sentinel-prompt passes a clean prompt", () => {
    const d = findStep(result, "sentinel-prompt (clean)").data!;
    expect(d.exitCode).toBe(0);
    expect(d.blocked).toBe(false);
  });

  it("sentinel-prompt BLOCKS a prompt carrying an AWS key (exit 2)", () => {
    const d = findStep(result, "sentinel-prompt (AWS key)").data!;
    expect(d.exitCode).toBe(2);
    expect(d.blocked).toBe(true);
  });

  it("WARN_ONLY demotes the same secret to an advisory (never blocks)", () => {
    const d = findStep(result, "sentinel-prompt (WARN_ONLY)").data!;
    expect(d.exitCode).toBe(0);
    expect(d.blocked).toBe(false);
  });

  it("sentinel-mcp BLOCKS a prompt-injection tool result", () => {
    const d = findStep(result, "sentinel-mcp (injection)").data!;
    expect(d.blocked).toBe(true);
  });

  it("cache-habits-advisor surfaces the idle advisory when f9 is general", () => {
    const d = findStep(result, "cache-habits-advisor (idle, f9=general)").data!;
    expect(d.exitCode).toBe(0);
    expect(d.advisory).toBeTruthy();
  });

  it("flag gating: f9=shadow does NOT surface the advisory", () => {
    const d = findStep(result, "cache-habits-advisor (f9=shadow gating)").data!;
    expect(d.surfaced).toBe(false);
    expect(d.exitCode).toBe(0);
  });

  it("flag gating: trajectory-diet stays silent in shadow", () => {
    const d = findStep(result, "trajectory-diet (f1 shadow vs general)").data!;
    expect(d.shadowSurfaced).toBe(false);
    expect(d.shadowExit).toBe(0);
    expect(d.generalExit).toBe(0);
  });

  it("fail-safe: empty/garbage/missing-transcript inputs never crash (all exit 0)", () => {
    const d = findStep(result, "fail-safe matrix").data!;
    expect(d.allSafe).toBe(true);
    expect((d.exitCodes as number[]).every((c) => c === 0)).toBe(true);
  });
});
