import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildSession } from "./fixtures/session";
import { runMcpScenario } from "./scenarios/mcp";
import { runDashboardScenario } from "./scenarios/dashboard";
import { loadDashboard } from "./drivers/dashboard-driver";
import { findStep, type ScenarioResult } from "./types";

function failedChecks(result: ScenarioResult): string[] {
  return result.steps.flatMap((s) => (s.checks ?? []).filter((c) => !c.passed).map((c) => `${s.name}: ${c.label}`));
}

describe("Flow E — dashboard observability closed loop", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("closes the loop and every invariant check passes", async () => {
    const fx = buildSession();
    try {
      const mcpOut = await runMcpScenario(fx);
      const lib = await loadDashboard();
      const result = await runDashboardScenario(lib, mcpOut.proofs);
      expect(failedChecks(result)).toEqual([]);
      const fwd = findStep(result, "forward → ingest").output as { failures: number; sent: number };
      expect(fwd.failures).toBe(0);
      expect(fwd.sent).toBe(mcpOut.proofs.length);
    } finally {
      fx.cleanup();
    }
  });

  it("HTTP contract: POST /api/v1/events → GET /api/v1/features sees the feature", async () => {
    vi.resetModules();
    const { NextRequest } = await import("next/server");
    const events = await import("../../../apps/dashboard/src/app/api/v1/events/route");
    const features = await import("../../../apps/dashboard/src/app/api/v1/features/route");
    const postRes = await events.POST(
      new NextRequest("http://e2e.local/api/v1/events", {
        method: "POST",
        body: JSON.stringify({ id: "rc-1", timestamp: new Date().toISOString(), feature_id: "f11", quality_proof: { cost: { savedUsd: 0.5, naiveCostUsd: 0.7, replayCostUsd: 0.2 } }, tokensIn: 10, costUsd: 0.001 }),
      }) as never
    );
    expect(((await postRes.json()) as { featureId: string }).featureId).toBe("f11");
    const getRes = await features.GET(new NextRequest("http://e2e.local/api/v1/features") as never);
    const rollup = (await getRes.json()) as { features: Array<{ featureId: string; eventCount: number }> };
    expect(rollup.features.find((f) => f.featureId === "f11")!.eventCount).toBeGreaterThanOrEqual(1);
  });
});
