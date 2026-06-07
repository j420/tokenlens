import { describe, expect, it } from "vitest";
import { shouldSpend } from "./bid.js";

describe("shouldSpend — the bid rule", () => {
  it("spends when quality clears the price", () => {
    // gain 10 vs price 0.5 * cost 10 = 5 → surplus +5
    const d = shouldSpend(10, 10, 0.5);
    expect(d.action).toBe("spend");
    expect(d.surplus).toBe(5);
  });

  it("skips when quality is below the price", () => {
    const d = shouldSpend(2, 10, 0.5); // 2 vs 5 → surplus -3
    expect(d.action).toBe("skip");
    expect(d.surplus).toBe(-3);
  });

  it("spends exactly at the break-even surplus of 0", () => {
    const d = shouldSpend(5, 10, 0.5);
    expect(d.action).toBe("spend");
    expect(d.surplus).toBe(0);
  });

  it("abstains when there is no live price", () => {
    expect(shouldSpend(10, 10, null).action).toBe("abstain");
    expect(shouldSpend(10, 10, undefined).action).toBe("abstain");
    expect(shouldSpend(10, 10, Number.POSITIVE_INFINITY).action).toBe("abstain");
  });

  it("abstains when the quality gain is unknown", () => {
    expect(shouldSpend(null, 10, 0.5).action).toBe("abstain");
    expect(shouldSpend(undefined, 10, 0.5).action).toBe("abstain");
    expect(shouldSpend(Number.NaN, 10, 0.5).action).toBe("abstain");
  });

  it("treats negative token cost as zero (never negative price)", () => {
    const d = shouldSpend(1, -100, 0.5);
    expect(d.surplus).toBe(1); // cost clamped to 0
    expect(d.action).toBe("spend");
  });
});
