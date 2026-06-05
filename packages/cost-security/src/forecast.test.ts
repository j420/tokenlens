import { describe, expect, it } from "vitest";
import { forecastTurnRisk } from "./forecast.js";

describe("forecastTurnRisk — fail-safe inputs", () => {
  it("returns low risk for empty/garbage input without throwing", () => {
    for (const bad of [{}, undefined as never, null as never]) {
      const r = forecastTurnRisk(bad as never);
      expect(r.risk).toBeGreaterThanOrEqual(0);
      expect(r.risk).toBeLessThanOrEqual(1);
      expect(["low", "elevated", "high"]).toContain(r.band);
    }
  });

  it("ignores out-of-range numbers safely", () => {
    const r = forecastTurnRisk({
      promptChars: -5,
      priorLowRoiStreak: NaN,
      contextFullnessPct: 9999,
      unresolvedErrorRepeats: -3,
    });
    expect(r.risk).toBeGreaterThanOrEqual(0);
    expect(r.risk).toBeLessThanOrEqual(1);
  });
});

describe("forecastTurnRisk — a well-specified prompt is low risk", () => {
  it("scores low with a concrete target and no failure signals", () => {
    const r = forecastTurnRisk({
      promptChars: 120,
      namesConcreteTarget: true,
      vagueDemand: false,
      priorLowRoiStreak: 0,
      contextFullnessPct: 30,
      unresolvedErrorRepeats: 0,
    });
    expect(r.band).toBe("low");
    expect(r.recommend).toBeNull();
    expect(r.factors).toEqual([]);
  });
});

describe("forecastTurnRisk — risk factors", () => {
  it("flags a vague, targetless, short retry as high risk with a reframe", () => {
    const r = forecastTurnRisk({
      promptChars: 10,
      namesConcreteTarget: false,
      vagueDemand: true,
      priorLowRoiStreak: 2,
    });
    expect(r.band).toBe("high");
    expect(r.recommend).toMatch(/specific|approach|specifics/i);
    expect(r.factors.map((f) => f.name)).toContain("vague_demand");
  });

  it("context pressure ramps from 80% to 100%", () => {
    const low = forecastTurnRisk({ namesConcreteTarget: true, contextFullnessPct: 80 });
    const high = forecastTurnRisk({ namesConcreteTarget: true, contextFullnessPct: 100 });
    const lowC = low.factors.find((f) => f.name === "context_pressure")?.contribution ?? 0;
    const highC = high.factors.find((f) => f.name === "context_pressure")?.contribution ?? 0;
    expect(highC).toBeGreaterThan(lowC);
  });

  it("caps the low-ROI streak contribution", () => {
    const huge = forecastTurnRisk({ namesConcreteTarget: true, priorLowRoiStreak: 100 });
    const f = huge.factors.find((x) => x.name === "low_roi_streak");
    expect(f?.contribution).toBeLessThanOrEqual(0.36 + 1e-9);
  });

  it("recommendation tracks the dominant factor", () => {
    const r = forecastTurnRisk({ namesConcreteTarget: true, priorLowRoiStreak: 3, contextFullnessPct: 10 });
    expect(r.band).not.toBe("low");
    expect(r.recommend).toMatch(/progress|approach|guidance/i);
  });
});

describe("forecastTurnRisk — deterministic", () => {
  it("same input yields an identical report", () => {
    const input = { promptChars: 10, vagueDemand: true, namesConcreteTarget: false, priorLowRoiStreak: 1 };
    expect(forecastTurnRisk(input)).toEqual(forecastTurnRisk(input));
  });
});
