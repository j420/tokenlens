import { describe, it, expect } from "vitest";
import { routeRequest, type BatchRequest } from "./router.js";

const batchable: BatchRequest = {
  interactive: false,
  batchLaneAvailable: true,
  latencySlackMs: 6 * 3_600_000,
  interactiveCostUsd: 1.0,
};

describe("routeRequest", () => {
  it("routes a non-interactive, slack-rich request to the batch lane at a discount", () => {
    const d = routeRequest(batchable, { batchDiscount: 0.5 });
    expect(d.lane).toBe("batch");
    expect(d.eligible).toBe(true);
    expect(d.laneCostUsd).toBeCloseTo(0.5, 9);
    expect(d.savingsUsd).toBeCloseTo(0.5, 9);
  });

  it("keeps an interactive turn on the interactive lane", () => {
    const d = routeRequest({ ...batchable, interactive: true }, { batchDiscount: 0.5 });
    expect(d.lane).toBe("interactive");
    expect(d.reason).toBe("interactive-turn");
    expect(d.savingsUsd).toBe(0);
  });

  it("defaults a request with no `interactive` flag to interactive (safe)", () => {
    expect(routeRequest({ batchLaneAvailable: true, latencySlackMs: 9e9 }).reason).toBe(
      "interactive-turn"
    );
  });

  it("declines when the provider has no batch lane", () => {
    const d = routeRequest({ ...batchable, batchLaneAvailable: false });
    expect(d.eligible).toBe(false);
    expect(d.reason).toBe("no-batch-lane");
  });

  it("declines when latency slack is below the minimum", () => {
    const d = routeRequest({ ...batchable, latencySlackMs: 60_000 }, { minSlackMs: 3_600_000 });
    expect(d.reason).toBe("insufficient-slack");
  });

  it("returns null cost/saving for an unpriced request (never fabricates)", () => {
    const d = routeRequest({ ...batchable, interactiveCostUsd: null });
    expect(d.interactiveCostUsd).toBeNull();
    expect(d.savingsUsd).toBeNull();
  });

  it("is total on garbage and deterministic", () => {
    expect(routeRequest(null).lane).toBe("interactive");
    expect(routeRequest(batchable, { batchDiscount: 0.5 })).toEqual(
      routeRequest(batchable, { batchDiscount: 0.5 })
    );
  });
});
