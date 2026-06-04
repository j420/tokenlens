import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildSession } from "./fixtures/session";
import { runMcpScenario } from "./scenarios/mcp";
import { runDashboardScenario } from "./scenarios/dashboard";
import { loadDashboard } from "./drivers/dashboard-driver";
import { findStep } from "./types";

interface FeatureCard {
  featureId: string;
  eventCount: number;
  malformedProofCount: number;
  seeded: boolean;
}

describe("Flow E — dashboard observability closed loop", () => {
  // Fresh module graph per test ⇒ fresh in-process event store (mirrors the
  // dashboard's own api.test.ts pattern), so counts are deterministic.
  beforeEach(() => {
    vi.resetModules();
  });

  it("closes the loop: real MCP proofs → forwarder → ingest → rollup", async () => {
    const fx = buildSession();
    try {
      const mcpOut = await runMcpScenario(fx);
      const lib = await loadDashboard();
      const result = await runDashboardScenario(lib, mcpOut.proofs);

      const fwd = findStep(result, "forward → ingest").data!;
      expect(fwd.failures).toBe(0);
      expect(fwd.sent).toBe(mcpOut.proofs.length);

      const roll = findStep(result, "dashboard rollup").data!;
      const feats = roll.features as FeatureCard[];
      const seeded = feats.filter((f) => f.seeded);
      expect(seeded.length).toBeGreaterThanOrEqual(5);
      for (const f of seeded) {
        expect(f.eventCount).toBeGreaterThanOrEqual(1);
        expect(f.malformedProofCount).toBe(0);
      }
      expect(roll.outOfScopeEventCount).toBe(0);
    } finally {
      fx.cleanup();
    }
  });

  it("HTTP contract: POST /api/v1/events → GET /api/v1/features sees the feature", async () => {
    vi.resetModules();
    const { NextRequest } = await import("next/server");
    // Import both route handlers in the same module window so they share the
    // in-process store (exactly how the dashboard's own tests drive them).
    const events = await import("../../../apps/dashboard/src/app/api/v1/events/route");
    const features = await import("../../../apps/dashboard/src/app/api/v1/features/route");

    const postRes = await events.POST(
      new NextRequest("http://e2e.local/api/v1/events", {
        method: "POST",
        body: JSON.stringify({
          id: "rc-1",
          timestamp: new Date().toISOString(),
          feature_id: "f11",
          quality_proof: { cost: { savedUsd: 0.5, naiveCostUsd: 0.7, replayCostUsd: 0.2 } },
          tokensIn: 10,
          costUsd: 0.001,
        }),
      }) as never
    );
    const postBody = (await postRes.json()) as { featureId: string };
    expect(postBody.featureId).toBe("f11");

    const getRes = await features.GET(
      new NextRequest("http://e2e.local/api/v1/features") as never
    );
    const rollup = (await getRes.json()) as {
      features: Array<{ featureId: string; eventCount: number; summary: { data?: { savedUsd?: number } } }>;
    };
    const f11 = rollup.features.find((f) => f.featureId === "f11")!;
    expect(f11.eventCount).toBeGreaterThanOrEqual(1);
  });
});
