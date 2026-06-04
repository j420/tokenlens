/**
 * Tests for the f5 (HUD) telemetry contract — the discrete spend-severity
 * transition signal decided for pending action 1.3.
 *
 * Run directly (the extension package has no turbo `test` task):
 *   npx vitest run apps/extension/src/hud-f5-telemetry.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  detectSeverityTransition,
  buildHudQualityProof,
  classifySeverity,
  computeHud,
  F5_FEATURE_ID,
} from "./hud-compute.js";

describe("computeHud — unpriced-model honesty (no silent default-rate overclaim)", () => {
  const thresholds = { greenUsd: 0.01, redUsd: 0.1 };

  it("a PRICED model shows a clean cost with no fallback marker", () => {
    const c = computeHud("hello world, some prompt text", "gpt-4o", thresholds);
    expect(c.priced).toBe(true);
    expect(c.displayText).not.toContain("*");
    expect(c.tooltipText).toContain("Pricing source:");
    expect(c.tooltipText).not.toContain("UNKNOWN model");
  });

  it("an UNKNOWN model marks the cost as a fallback estimate, not a real price", () => {
    const c = computeHud("hello world, some prompt text", "made-up-model-x", thresholds);
    expect(c.priced).toBe(false);
    expect(c.displayText).toContain("*"); // visible fallback marker
    expect(c.tooltipText).toContain("UNKNOWN model");
    expect(c.tooltipText).toContain("estimate");
  });

  it("the f5 proof records pricedModel so telemetry never reports a fallback cost as fact", () => {
    const c = computeHud("some text here", "made-up-model-x", thresholds);
    const t = detectSeverityTransition("green", "red")!;
    const proof = buildHudQualityProof(t, c, thresholds);
    expect(proof.pricedModel).toBe(false);
  });
});

describe("detectSeverityTransition", () => {
  it("returns null on the first render (no prior severity)", () => {
    expect(detectSeverityTransition(null, "green")).toBeNull();
    expect(detectSeverityTransition(null, "red")).toBeNull();
  });

  it("returns null when the zone is unchanged (no per-render spam)", () => {
    expect(detectSeverityTransition("green", "green")).toBeNull();
    expect(detectSeverityTransition("red", "red")).toBeNull();
  });

  it("reports an escalation green→yellow→red", () => {
    expect(detectSeverityTransition("green", "yellow")).toEqual({
      from: "green",
      to: "yellow",
      escalated: true,
    });
    expect(detectSeverityTransition("yellow", "red")).toEqual({
      from: "yellow",
      to: "red",
      escalated: true,
    });
    expect(detectSeverityTransition("green", "red")).toEqual({
      from: "green",
      to: "red",
      escalated: true,
    });
  });

  it("reports a de-escalation as escalated:false", () => {
    expect(detectSeverityTransition("red", "green")).toMatchObject({ escalated: false });
    expect(detectSeverityTransition("yellow", "green")).toMatchObject({ escalated: false });
  });
});

describe("buildHudQualityProof", () => {
  const thresholds = { greenUsd: 0.01, redUsd: 0.1 };

  it("is PII-safe: severities + cost/tokens + thresholds, never the prompt", () => {
    const transition = detectSeverityTransition("green", "red")!;
    const proof = buildHudQualityProof(
      transition,
      { tokens: 5000, cost: 0.15, source: "exact" },
      thresholds
    );
    expect(proof.featureId).toBe(F5_FEATURE_ID);
    expect(proof.event).toBe("severity_transition");
    expect(proof.from).toBe("green");
    expect(proof.to).toBe("red");
    expect(proof.escalated).toBe(true);
    expect(proof.tokens).toBe(5000);
    expect(proof.costUsd).toBeCloseTo(0.15);
    expect(proof.thresholds).toEqual(thresholds);
    // No prompt text anywhere.
    expect(JSON.stringify(proof)).not.toMatch(/prompt|text/i);
  });
});

describe("integration: classify → transition → proof", () => {
  const thresholds = { greenUsd: 0.01, redUsd: 0.1 };

  it("a cost crossing from below-green to red yields one escalation proof", () => {
    const prev = classifySeverity(0.0, thresholds); // green
    const next = classifySeverity(0.2, thresholds); // red
    const transition = detectSeverityTransition(prev, next);
    expect(transition).not.toBeNull();
    const proof = buildHudQualityProof(
      transition!,
      { tokens: 10000, cost: 0.2, source: "exact" },
      thresholds
    );
    expect(proof.to).toBe("red");
    expect(proof.escalated).toBe(true);
  });

  it("staying in the same zone across renders produces no transition", () => {
    const a = classifySeverity(0.02, thresholds); // yellow
    const b = classifySeverity(0.03, thresholds); // yellow
    expect(detectSeverityTransition(a, b)).toBeNull();
  });
});
