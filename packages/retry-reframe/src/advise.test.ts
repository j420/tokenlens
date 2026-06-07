import { describe, it, expect } from "vitest";
import { adviseRetryVsReframe } from "./advise.js";

describe("adviseRetryVsReframe", () => {
  it("recommends reframe when its expected cost-per-success is lower", () => {
    // retry: $0.10 / 0.2 = $0.50 ; reframe: $0.15 / 0.6 = $0.25
    const r = adviseRetryVsReframe({
      retry: { costUsd: 0.1, successProb: 0.2 },
      reframe: { costUsd: 0.15, successProb: 0.6 },
    });
    expect(r.recommended).toBe("reframe");
    expect(r.retryExpectedCostUsd).toBeCloseTo(0.5, 9);
    expect(r.reframeExpectedCostUsd).toBeCloseTo(0.25, 9);
    expect(r.expectedSavingFraction).toBeCloseTo(0.5, 6);
  });

  it("recommends retry when it is cheaper per success despite a higher raw price", () => {
    // retry: $0.20 / 0.9 = $0.222 ; reframe: $0.05 / 0.1 = $0.50
    const r = adviseRetryVsReframe({
      retry: { costUsd: 0.2, successProb: 0.9 },
      reframe: { costUsd: 0.05, successProb: 0.1 },
    });
    expect(r.recommended).toBe("retry");
    expect(r.reason).toBe("retry-cheaper-or-equal");
  });

  it("defaults to retry when a cost is unknown (never fabricates a comparison)", () => {
    const r = adviseRetryVsReframe({
      retry: { costUsd: null, successProb: 0.2 },
      reframe: { costUsd: 0.15, successProb: 0.6 },
    });
    expect(r.recommended).toBe("retry");
    expect(r.reason).toBe("insufficient-data-default-retry");
    expect(r.retryExpectedCostUsd).toBeNull();
  });

  it("defaults to retry when a success prior is unknown or zero", () => {
    expect(
      adviseRetryVsReframe({ retry: { costUsd: 0.1, successProb: null }, reframe: { costUsd: 0.1, successProb: 0.5 } }).reason
    ).toBe("insufficient-data-default-retry");
    expect(
      adviseRetryVsReframe({ retry: { costUsd: 0.1, successProb: 0 }, reframe: { costUsd: 0.1, successProb: 0.5 } }).recommended
    ).toBe("retry");
  });

  it("requires the reframe to clear the margin (hysteresis)", () => {
    // reframe is 10% cheaper per success; margin 0.2 → not enough
    const r = adviseRetryVsReframe({
      retry: { costUsd: 0.1, successProb: 0.5 },
      reframe: { costUsd: 0.09, successProb: 0.5 },
      margin: 0.2,
    });
    expect(r.recommended).toBe("retry");
  });

  it("does not flip on an exact tie", () => {
    const r = adviseRetryVsReframe({
      retry: { costUsd: 0.1, successProb: 0.5 },
      reframe: { costUsd: 0.1, successProb: 0.5 },
    });
    expect(r.recommended).toBe("retry");
  });

  it("is deterministic", () => {
    const o = { retry: { costUsd: 0.1, successProb: 0.2 }, reframe: { costUsd: 0.15, successProb: 0.6 } };
    expect(adviseRetryVsReframe(o)).toEqual(adviseRetryVsReframe(o));
  });
});
