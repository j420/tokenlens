import { describe, it, expect } from "vitest";
import { evaluateWaterbed, type TransformEffect } from "./gate.js";

describe("evaluateWaterbed", () => {
  it("approves a transform whose saving survives the induced cost", () => {
    const t: TransformEffect = {
      grossSavingUsd: 0.1,
      induced: [{ kind: "retry", expectedOccurrences: 0.1, perOccurrenceUsd: 0.04 }], // 0.004
    };
    const r = evaluateWaterbed(t);
    expect(r.verdict).toBe("approve");
    expect(r.inducedCostUsd).toBeCloseTo(0.004, 9);
    expect(r.netSavingUsd).toBeCloseTo(0.096, 9);
  });

  it("vetoes a transform whose induced cost eats the saving (the waterbed)", () => {
    const t: TransformEffect = {
      grossSavingUsd: 0.03,
      induced: [{ kind: "re-ask", expectedOccurrences: 1, perOccurrenceUsd: 0.05 }], // 0.05 > 0.03
    };
    const r = evaluateWaterbed(t);
    expect(r.verdict).toBe("veto");
    expect(r.approved).toBe(false);
    expect(r.netSavingUsd).toBeCloseTo(-0.02, 9);
  });

  it("nets transform overhead as well as induced costs", () => {
    const t: TransformEffect = {
      grossSavingUsd: 0.1,
      overheadUsd: 0.05,
      induced: [{ kind: "cache-write", expectedOccurrences: 1, perOccurrenceUsd: 0.04 }],
    };
    const r = evaluateWaterbed(t);
    // induced total = overhead 0.05 + 0.04 = 0.09; net = 0.01
    expect(r.inducedCostUsd).toBeCloseTo(0.09, 9);
    expect(r.netSavingUsd).toBeCloseTo(0.01, 9);
    expect(r.verdict).toBe("approve");
  });

  it("requires the net saving to CLEAR the margin", () => {
    const t: TransformEffect = { grossSavingUsd: 0.01, induced: [] };
    expect(evaluateWaterbed(t, { marginUsd: 0.02 }).verdict).toBe("veto");
    expect(evaluateWaterbed(t, { marginUsd: 0.005 }).verdict).toBe("approve");
  });

  it("vetoes exactly at the margin boundary (strictly greater required)", () => {
    const t: TransformEffect = { grossSavingUsd: 0.01, induced: [] };
    // net 0.01, margin 0.01 → not strictly greater → veto
    expect(evaluateWaterbed(t, { marginUsd: 0.01 }).verdict).toBe("veto");
  });

  it("returns insufficient_data (never approves) when the gross saving is unknown", () => {
    const r = evaluateWaterbed({ grossSavingUsd: null, induced: [] });
    expect(r.verdict).toBe("insufficient_data");
    expect(r.approved).toBe(false);
    expect(r.netSavingUsd).toBeNull();
  });

  it("returns insufficient_data when an induced price is unknown", () => {
    const t: TransformEffect = {
      grossSavingUsd: 1.0,
      induced: [{ kind: "retry", expectedOccurrences: 1, perOccurrenceUsd: null }],
    };
    const r = evaluateWaterbed(t);
    expect(r.verdict).toBe("insufficient_data");
    expect(r.approved).toBe(false);
    expect(r.inducedCostUsd).toBeNull();
  });

  it("approves a clean saving with no induced costs", () => {
    expect(evaluateWaterbed({ grossSavingUsd: 0.5 }).verdict).toBe("approve");
  });

  it("skips malformed induced entries without throwing", () => {
    const t = {
      grossSavingUsd: 0.1,
      induced: [
        { kind: "retry", expectedOccurrences: 1, perOccurrenceUsd: 0.01 },
        { kind: "", expectedOccurrences: 1, perOccurrenceUsd: 0.5 }, // bad kind
        { expectedOccurrences: 1, perOccurrenceUsd: 0.5 }, // missing kind
        null,
      ],
    };
    const r = evaluateWaterbed(t as unknown);
    // only the first valid induced cost (0.01) is netted
    expect(r.inducedCostUsd).toBeCloseTo(0.01, 9);
    expect(r.verdict).toBe("approve");
  });

  it("is total on garbage input", () => {
    expect(evaluateWaterbed(null).verdict).toBe("insufficient_data");
    expect(evaluateWaterbed("nope" as unknown).verdict).toBe("insufficient_data");
    expect(evaluateWaterbed(42 as unknown).approved).toBe(false);
  });

  it("rounds every USD value in the reason string consistently (no raw long decimals)", () => {
    // A margin with float dust must not leak into the human-readable reason.
    const r = evaluateWaterbed({ grossSavingUsd: 0.01, induced: [] }, { marginUsd: 0.0000001234 });
    expect(r.reason).not.toContain("0.0000001234");
    // every "$<number>" token in the reason is rounded to <= 6 decimals
    const nums = r.reason.match(/\$(-?\d+\.?\d*)/g) ?? [];
    for (const n of nums) {
      const dec = (n.split(".")[1] ?? "").length;
      expect(dec).toBeLessThanOrEqual(6);
    }
  });

  it("is deterministic", () => {
    const t: TransformEffect = {
      grossSavingUsd: 0.2,
      induced: [{ kind: "retry", expectedOccurrences: 0.3, perOccurrenceUsd: 0.04 }],
    };
    expect(evaluateWaterbed(t)).toEqual(evaluateWaterbed(t));
  });
});
