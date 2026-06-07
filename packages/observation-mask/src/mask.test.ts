import { describe, expect, it } from "vitest";
import { planMask } from "./mask.js";
import type { Observation } from "./types.js";

function obs(
  id: string,
  turn: number,
  tokens: number,
  extra: Partial<Observation> = {}
): Observation {
  return { id, turn, tokens, contentHash: `hash-${id}`, ...extra };
}

describe("planMask — sliding window", () => {
  it("masks observations older than the window, keeps recent ones", () => {
    const observations = [
      obs("a", 0, 1000),
      obs("b", 1, 1000),
      obs("c", 8, 1000),
      obs("d", 10, 1000),
    ];
    const plan = planMask(observations, { currentTurn: 10, windowTurns: 3 });
    const maskedIds = plan.masked.map((m) => m.id).sort();
    // age(a)=10, age(b)=9 → stale; age(c)=2, age(d)=0 → kept.
    expect(maskedIds).toEqual(["a", "b"]);
  });

  it("never masks a pinned observation", () => {
    const observations = [obs("a", 0, 1000, { pinned: true }), obs("b", 0, 1000)];
    const plan = planMask(observations, { currentTurn: 10, windowTurns: 1 });
    expect(plan.masked.map((m) => m.id)).toEqual(["b"]);
  });

  it("computes reclaimed and retained tokens consistently", () => {
    const observations = [obs("a", 0, 1000), obs("b", 10, 500)];
    const plan = planMask(observations, {
      currentTurn: 10,
      windowTurns: 1,
      placeholderTokens: 16,
    });
    expect(plan.totalTokens).toBe(1500);
    expect(plan.reclaimedTokens).toBe(1000 - 16);
    expect(plan.retainedTokens).toBe(1500 - (1000 - 16));
  });
});

describe("planMask — monotone (cache-stable) masking", () => {
  it("keeps previously-masked observations masked even if now in-window", () => {
    const observations = [obs("a", 9, 1000), obs("b", 10, 1000)];
    const plan = planMask(observations, {
      currentTurn: 10,
      windowTurns: 5,
      previouslyMaskedIds: ["a"],
    });
    const a = plan.masked.find((m) => m.id === "a");
    expect(a?.reason).toBe("carried");
  });
});

describe("planMask — budget eviction (Belady)", () => {
  it("evicts in-window observations until under the token budget", () => {
    const observations = [
      obs("a", 8, 1000),
      obs("b", 9, 1000),
      obs("c", 10, 1000),
    ];
    // All in window (window=5); budget forces dropping ~2000 worth.
    const plan = planMask(observations, {
      currentTurn: 10,
      windowTurns: 5,
      placeholderTokens: 0,
      tokenBudget: 1200,
    });
    expect(plan.retainedTokens).toBeLessThanOrEqual(1200);
    expect(plan.masked.every((m) => m.reason === "budget")).toBe(true);
  });

  it("evicts the farthest-next-use first when foresight is available (true Belady)", () => {
    const observations = [
      obs("soon", 8, 1000, { nextUseTurn: 11 }),
      obs("late", 9, 1000, { nextUseTurn: 50 }),
      obs("now", 10, 1000),
    ];
    const plan = planMask(observations, {
      currentTurn: 10,
      windowTurns: 5,
      placeholderTokens: 0,
      tokenBudget: 2000, // must drop exactly one
    });
    expect(plan.masked).toHaveLength(1);
    // "now" has no future use (infinite distance) → evicted before "late"/"soon".
    expect(plan.masked[0].id).toBe("now");
  });
});

describe("planMask — the structural guarantee", () => {
  it("bounds retained tokens by the window regardless of trajectory length", () => {
    // 200 turns, one 1000-token observation each. Window of 5.
    const observations: Observation[] = [];
    for (let t = 0; t < 200; t++) observations.push(obs(`o${t}`, t, 1000));
    const plan = planMask(observations, {
      currentTurn: 199,
      windowTurns: 5,
      placeholderTokens: 10,
    });
    // Unmasked observations: turns 194..199 → 6 of them at full cost; the other
    // 194 collapse to placeholders. Retained is O(window), not O(n).
    const unmaskedCount = observations.length - plan.masked.length;
    expect(unmaskedCount).toBe(6);
    // Retained ≈ 6*1000 + 194*10, far below the naive 200*1000.
    expect(plan.retainedTokens).toBeLessThan(10000);
    expect(plan.totalTokens).toBe(200000);
  });

  it("is empty (no masking) when everything is inside the window", () => {
    const observations = [obs("a", 9, 100), obs("b", 10, 100)];
    const plan = planMask(observations, { currentTurn: 10, windowTurns: 5 });
    expect(plan.masked).toHaveLength(0);
    expect(plan.reclaimedTokens).toBe(0);
  });
});
