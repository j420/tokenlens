import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildSession, type SessionFixture } from "./fixtures/session";
import { runMcpScenario, type McpScenarioOutput } from "./scenarios/mcp";
import { findStep } from "./types";

describe("Flow B — MCP tool handlers (real)", () => {
  let fx: SessionFixture;
  let out: McpScenarioOutput;
  beforeAll(async () => {
    fx = buildSession();
    out = await runMcpScenario(fx);
  });
  afterAll(() => fx.cleanup());

  it("cache_habits_from_transcript flags the mid-session model switch (CH-001)", () => {
    const d = findStep(out.result, "cache_habits_from_transcript (→ Opus)").data!;
    expect(d.firedCH001).toBe(true);
    expect(d.verdict).toBe("warn");
  });

  it("no MCP tool throws across the wire (no error field on happy paths)", () => {
    for (const s of out.result.steps) {
      // Every step's data must be present; none surfaced a handler error.
      expect(s.data).toBeTruthy();
      if (s.data && "keys" in s.data) {
        expect(s.data.keys as string[]).not.toContain("error");
      }
    }
  });

  it("result_prune meaningfully shrinks a repetitive tool result", () => {
    const d = findStep(out.result, "result_prune").data!;
    expect(d.originalTokens as number).toBeGreaterThan(0);
    expect(d.savedTokens as number).toBeGreaterThan(0);
  });

  it("mcp_proxy_trim reports a non-negative token saving", () => {
    const d = findStep(out.result, "mcp_proxy_trim (intent=debug)").data!;
    expect(typeof d.savedTokens).toBe("number");
    expect(d.savedTokens as number).toBeGreaterThanOrEqual(0);
  });

  it("reasoning_effort_route down-routes from high when standard is non-inferior+cheaper", () => {
    const d = findStep(out.result, "reasoning_effort_route").data!;
    // With ample samples and standard ≈ high quality at 1/3 the cost, expect a
    // down-route (recommend standard) — never an up-route.
    expect(d.recommendedEffort).toBe("standard");
  });

  it("diff_vs_rewrite returns a recommendation for both the tiny edit and the rewrite", () => {
    expect(findStep(out.result, "diff_vs_rewrite (tiny edit)").data!.recommendation).toBeTruthy();
    expect(findStep(out.result, "diff_vs_rewrite (near-total rewrite)").data!.recommendation).toBeTruthy();
  });

  it("collects the real rich-decoder proofs (f2, f4, f9, f10, f11) for the dashboard loop", () => {
    const ids = out.proofs.map((p) => p.featureId).sort();
    for (const need of ["f2", "f4", "f9", "f10", "f11"]) {
      expect(ids).toContain(need);
    }
    // Every collected proof is a non-empty object (a real bundle, not a stub).
    for (const p of out.proofs) {
      expect(p.qualityProof && typeof p.qualityProof === "object").toBe(true);
      expect(Object.keys(p.qualityProof).length).toBeGreaterThan(0);
    }
  });
});
