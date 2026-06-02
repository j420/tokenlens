import { describe, expect, it } from "vitest";
import {
  modulateAdvisorOptions,
  REGIME_MODULATION,
  THRESHOLD_CEILING,
} from "./context-health-modulation.js";

describe("modulateAdvisorOptions — baseline regimes", () => {
  it("healthy preserves baseline", () => {
    const r = modulateAdvisorOptions(
      { confidenceThreshold: 0.15, requireRedundancySignal: true },
      "healthy"
    );
    expect(r.confidenceThreshold).toBe(0.15);
    expect(r.requireRedundancySignal).toBe(true);
  });

  it("insufficient_data preserves baseline", () => {
    const r = modulateAdvisorOptions(
      { confidenceThreshold: 0.2 },
      "insufficient_data"
    );
    expect(r.confidenceThreshold).toBe(0.2);
    expect(r.requireRedundancySignal).toBe(true);
  });
});

describe("modulateAdvisorOptions — warning", () => {
  it("raises threshold by 1.5×", () => {
    const r = modulateAdvisorOptions({ confidenceThreshold: 0.2 }, "warning");
    expect(r.confidenceThreshold).toBeCloseTo(0.3, 6);
  });

  it("keeps redundancy requirement", () => {
    const r = modulateAdvisorOptions(
      { confidenceThreshold: 0.1, requireRedundancySignal: true },
      "warning"
    );
    expect(r.requireRedundancySignal).toBe(true);
  });
});

describe("modulateAdvisorOptions — critical", () => {
  it("raises threshold by 2.5×", () => {
    const r = modulateAdvisorOptions({ confidenceThreshold: 0.1 }, "critical");
    expect(r.confidenceThreshold).toBeCloseTo(0.25, 6);
  });

  it("drops redundancy requirement", () => {
    const r = modulateAdvisorOptions(
      { confidenceThreshold: 0.1, requireRedundancySignal: true },
      "critical"
    );
    expect(r.requireRedundancySignal).toBe(false);
  });
});

describe("modulateAdvisorOptions — ceiling clamp", () => {
  it("clamps any raised threshold to <= 0.5", () => {
    const r = modulateAdvisorOptions({ confidenceThreshold: 0.4 }, "critical");
    // 0.4 * 2.5 = 1.0 → clamped to 0.5
    expect(r.confidenceThreshold).toBe(THRESHOLD_CEILING);
    expect(r.confidenceThreshold).toBe(0.5);
  });

  it("clamps a 0.35 baseline at warning (0.525 → 0.5)", () => {
    const r = modulateAdvisorOptions({ confidenceThreshold: 0.35 }, "warning");
    expect(r.confidenceThreshold).toBe(0.5);
  });

  it("clamps negative input to 0", () => {
    const r = modulateAdvisorOptions({ confidenceThreshold: -1 }, "critical");
    expect(r.confidenceThreshold).toBe(0);
  });
});

describe("modulateAdvisorOptions — defaults when no baseline supplied", () => {
  it("uses 0.15 default threshold and true redundancy", () => {
    const r = modulateAdvisorOptions(undefined, "healthy");
    expect(r.confidenceThreshold).toBe(0.15);
    expect(r.requireRedundancySignal).toBe(true);
  });

  it("warning applies multiplier to the default 0.15 baseline", () => {
    const r = modulateAdvisorOptions(undefined, "warning");
    expect(r.confidenceThreshold).toBeCloseTo(0.225, 6);
  });

  it("critical applies multiplier and drops redundancy", () => {
    const r = modulateAdvisorOptions(undefined, "critical");
    expect(r.confidenceThreshold).toBeCloseTo(0.375, 6);
    expect(r.requireRedundancySignal).toBe(false);
  });
});

describe("REGIME_MODULATION constants are pinned (require re-running NI gate to change)", () => {
  it("warning multiplier = 1.5", () => {
    expect(REGIME_MODULATION.warning.thresholdMultiplier).toBe(1.5);
  });

  it("critical multiplier = 2.5", () => {
    expect(REGIME_MODULATION.critical.thresholdMultiplier).toBe(2.5);
  });

  it("critical drops redundancy override", () => {
    expect(REGIME_MODULATION.critical.requireRedundancyOverride).toBe(false);
  });

  it("healthy and insufficient_data leave redundancy alone (null override)", () => {
    expect(REGIME_MODULATION.healthy.requireRedundancyOverride).toBe(null);
    expect(REGIME_MODULATION.insufficient_data.requireRedundancyOverride).toBe(null);
  });
});
