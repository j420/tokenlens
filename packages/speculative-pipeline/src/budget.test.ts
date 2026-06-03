import { describe, expect, it } from "vitest";

import { SpeculationBudget } from "./budget.js";

describe("SpeculationBudget concurrency", () => {
  it("allows up to maxConcurrent slots", () => {
    const b = new SpeculationBudget({ maxConcurrent: 2 });
    expect(b.decide(0).verdict).toBe("allow");
    b.launch();
    expect(b.decide(0).verdict).toBe("allow");
    b.launch();
    expect(b.decide(0).verdict).toBe("at_capacity");
  });

  it("frees slots on settle", () => {
    const b = new SpeculationBudget({ maxConcurrent: 1 });
    b.launch();
    expect(b.decide(0).verdict).toBe("at_capacity");
    b.settle(false, 0);
    expect(b.decide(0).verdict).toBe("allow");
  });

  it("launch throws when no slot free", () => {
    const b = new SpeculationBudget({ maxConcurrent: 1 });
    b.launch();
    expect(() => b.launch()).toThrow(/no free slot/);
  });

  it("rejects maxConcurrent < 1", () => {
    expect(() => new SpeculationBudget({ maxConcurrent: 0 })).toThrow(/must be ≥ 1/);
  });
});

describe("SpeculationBudget breaker", () => {
  it("trips when wasted-rate exceeds the threshold over enough samples", () => {
    const b = new SpeculationBudget({
      maxConcurrent: 10,
      minSamples: 5,
      wastedRateThreshold: 0.6,
      cooldownMs: 1000,
    });
    // 5 wasted out of 5 → wastedRate 1.0 ≥ 0.6 → trips.
    for (let i = 0; i < 5; i++) {
      b.launch();
      b.settle(true, 100);
    }
    expect(b.isDisabled(100)).toBe(true);
    expect(b.decide(100).verdict).toBe("circuit_open");
  });

  it("does not trip below minSamples even at 100% wasted", () => {
    const b = new SpeculationBudget({ minSamples: 10, wastedRateThreshold: 0.5 });
    for (let i = 0; i < 3; i++) {
      b.launch();
      b.settle(true, 0);
    }
    expect(b.isDisabled(0)).toBe(false);
  });

  it("re-enables after the cooldown elapses", () => {
    const b = new SpeculationBudget({
      maxConcurrent: 10,
      minSamples: 3,
      wastedRateThreshold: 0.5,
      cooldownMs: 1000,
    });
    for (let i = 0; i < 3; i++) {
      b.launch();
      b.settle(true, 100);
    }
    expect(b.isDisabled(100)).toBe(true);
    expect(b.isDisabled(1101)).toBe(false); // 100 + 1000 cooldown elapsed
  });

  it("a healthy hit-rate keeps the breaker closed", () => {
    const b = new SpeculationBudget({ minSamples: 4, wastedRateThreshold: 0.6 });
    // 3 useful, 1 wasted → wastedRate 0.25 < 0.6.
    for (const wasted of [false, false, true, false]) {
      b.launch();
      b.settle(wasted, 0);
    }
    expect(b.isDisabled(0)).toBe(false);
    expect(b.wastedRate).toBeCloseTo(0.25, 10);
  });

  it("rolls the window — old outcomes age out", () => {
    const b = new SpeculationBudget({ windowSize: 2, minSamples: 2, wastedRateThreshold: 0.99 });
    b.launch(); b.settle(true, 0);
    b.launch(); b.settle(false, 0);
    b.launch(); b.settle(false, 0); // window now [false, false]
    expect(b.wastedRate).toBe(0);
  });
});
