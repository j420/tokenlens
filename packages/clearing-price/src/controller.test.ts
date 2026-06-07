import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, initialState, quote, updatePrice } from "./controller.js";
import type { BudgetObservation } from "./types.js";

function drive(util: number, steps: number) {
  let state = initialState();
  const obs: BudgetObservation = { spent: util * 1000, budget: 1000 };
  for (let i = 0; i < steps; i++) state = updatePrice(state, obs);
  return state;
}

describe("updatePrice — control behaviour", () => {
  it("starts at the midpoint of the price range", () => {
    expect(quote(initialState())).toBe(0.5);
  });

  it("raises the price toward the ceiling under sustained over-budget", () => {
    const state = drive(2.0, 30); // 200% utilization
    expect(state.lambda).toBeGreaterThan(0.9);
    expect(state.lambda).toBeLessThanOrEqual(DEFAULT_CONFIG.lambdaMax);
  });

  it("lowers the price toward the floor under sustained under-budget", () => {
    const state = drive(0.1, 30); // 10% utilization
    expect(state.lambda).toBeLessThan(0.1);
    expect(state.lambda).toBeGreaterThanOrEqual(DEFAULT_CONFIG.lambdaMin);
  });

  it("is monotone: higher utilization yields a higher settled price", () => {
    const low = drive(0.5, 30).lambda;
    const high = drive(1.5, 30).lambda;
    expect(high).toBeGreaterThan(low);
  });

  it("never exceeds the configured bounds", () => {
    for (const u of [0, 0.5, 1, 5, 100]) {
      const s = drive(u, 50);
      expect(s.lambda).toBeGreaterThanOrEqual(DEFAULT_CONFIG.lambdaMin);
      expect(s.lambda).toBeLessThanOrEqual(DEFAULT_CONFIG.lambdaMax);
    }
  });

  it("ignores a non-positive or non-finite budget reading (no movement)", () => {
    const s0 = initialState();
    expect(updatePrice(s0, { spent: 100, budget: 0 })).toBe(s0);
    expect(updatePrice(s0, { spent: Number.NaN, budget: 1000 })).toBe(s0);
  });

  it("does not mutate the input state", () => {
    const s0 = initialState();
    const before = { ...s0 };
    updatePrice(s0, { spent: 1500, budget: 1000 });
    expect(s0).toEqual(before);
  });
});
