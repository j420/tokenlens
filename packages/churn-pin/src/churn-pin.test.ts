import { describe, it, expect } from "vitest";
import { planChurnPins, type ChurnFile } from "./churn-pin.js";

function f(path: string, recentCommits: number, tokens: number): ChurnFile {
  return { path, recentCommits, tokens };
}

describe("planChurnPins", () => {
  it("pins stable (low-churn) files and skips high-churn ones", () => {
    const plan = planChurnPins([
      f("stable.ts", 0, 1000),
      f("hot.ts", 9, 2000),
      f("calm.ts", 1, 500),
    ]);
    expect(plan.pin.map((p) => p.path)).toEqual(["stable.ts", "calm.ts"]);
    expect(plan.skip.map((p) => p.path)).toEqual(["hot.ts"]);
    expect(plan.skip[0]!.reason).toBe("high-churn");
    expect(plan.pinnedTokens).toBe(1500);
    expect(plan.skippedTokens).toBe(2000);
  });

  it("orders pins most-stable-first, then larger file first", () => {
    const plan = planChurnPins([
      f("a.ts", 1, 100),
      f("b.ts", 0, 100),
      f("c.ts", 0, 900), // same churn as b, bigger → comes first
    ]);
    expect(plan.pin.map((p) => p.path)).toEqual(["c.ts", "b.ts", "a.ts"]);
  });

  it("respects maxRecentCommits threshold", () => {
    const files = [f("x.ts", 2, 100), f("y.ts", 3, 100)];
    expect(planChurnPins(files, { maxRecentCommits: 2 }).pin.map((p) => p.path)).toEqual(["x.ts"]);
    expect(planChurnPins(files, { maxRecentCommits: 3 }).pin.length).toBe(2);
  });

  it("spills lowest-priority stable files to skip with reason 'budget'", () => {
    const plan = planChurnPins(
      [f("big.ts", 0, 1000), f("small.ts", 0, 500)],
      { maxPinnedTokens: 1000 }
    );
    // big.ts pinned first (bigger, same churn); small.ts spills (would exceed budget)
    expect(plan.pin.map((p) => p.path)).toEqual(["big.ts"]);
    expect(plan.skip[0]!.path).toBe("small.ts");
    expect(plan.skip[0]!.reason).toBe("budget");
    expect(plan.pinnedTokens).toBe(1000);
  });

  it("a high-churn file is skipped even under budget", () => {
    const plan = planChurnPins([f("hot.ts", 5, 10)], { maxPinnedTokens: 100000 });
    expect(plan.pin.length).toBe(0);
    expect(plan.skip[0]!.reason).toBe("high-churn");
  });

  it("counts malformed entries and skips them", () => {
    const plan = planChurnPins([
      f("ok.ts", 0, 100),
      { path: "bad.ts" }, // missing fields
      { path: "neg.ts", recentCommits: -1, tokens: 10 }, // negative churn
      null,
    ] as unknown);
    expect(plan.skippedMalformed).toBe(3);
    expect(plan.pin.length).toBe(1);
  });

  it("is total on garbage input", () => {
    expect(planChurnPins(null).pin).toEqual([]);
    expect(planChurnPins("nope" as unknown).pinnedTokens).toBe(0);
  });

  it("is deterministic", () => {
    const files = [f("a.ts", 0, 100), f("b.ts", 1, 200)];
    expect(planChurnPins(files)).toEqual(planChurnPins(files));
  });
});
