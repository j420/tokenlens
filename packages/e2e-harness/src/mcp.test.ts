import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildSession, type SessionFixture } from "./fixtures/session";
import { runMcpScenario, type McpScenarioOutput } from "./scenarios/mcp";
import { findStep, type ScenarioResult } from "./types";

function failedChecks(result: ScenarioResult): string[] {
  return result.steps.flatMap((s) => (s.checks ?? []).filter((c) => !c.passed).map((c) => `${s.name}: ${c.label}`));
}

describe("Flow B — MCP tool handlers (real)", () => {
  let fx: SessionFixture;
  let out: McpScenarioOutput;
  beforeAll(async () => {
    fx = buildSession();
    out = await runMcpScenario(fx);
  });
  afterAll(() => fx.cleanup());

  it("every invariant check passes across all MCP tools", () => {
    expect(failedChecks(out.result)).toEqual([]);
  });

  it("diff_vs_rewrite reports a sound round-trip (no degradation)", () => {
    expect(findStep(out.result, "diff_vs_rewrite (tiny edit)").quality!.preserved).toBe(true);
  });

  it("result_prune reduction is classified n/a (intentional, manifest-accounted)", () => {
    const q = findStep(out.result, "result_prune").quality!;
    expect(q.preserved).toBeNull();
    expect(q.detail).toContain("lossless=");
  });

  it("collects the real rich-decoder proofs (f2,f4,f9,f10,f11) for the dashboard loop", () => {
    const ids = out.proofs.map((p) => p.featureId);
    for (const need of ["f2", "f4", "f9", "f10", "f11"]) expect(ids).toContain(need);
    for (const p of out.proofs) expect(Object.keys(p.qualityProof).length).toBeGreaterThan(0);
  });

  it("every step records real input and output", () => {
    for (const s of out.result.steps) {
      expect(s.input).toBeDefined();
      expect(s.output).toBeDefined();
    }
  });
});
