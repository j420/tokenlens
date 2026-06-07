import { describe, expect, it } from "vitest";
import { beladyEvictionOrder } from "./belady.js";
import type { Observation } from "./types.js";

function obs(id: string, turn: number, nextUseTurn?: number | null): Observation {
  return { id, turn, tokens: 1, contentHash: id, nextUseTurn };
}

describe("beladyEvictionOrder", () => {
  it("evicts the farthest next-use first (true MIN)", () => {
    const order = beladyEvictionOrder(
      [obs("a", 0, 11), obs("b", 0, 100), obs("c", 0, 50)],
      10
    );
    expect(order.map((o) => o.id)).toEqual(["b", "c", "a"]);
  });

  it("treats a never-reused item as infinitely far (best to evict)", () => {
    const order = beladyEvictionOrder([obs("reused", 0, 12), obs("dead", 0, null)], 10);
    expect(order[0].id).toBe("dead");
  });

  it("falls back to LRU (oldest first) when no foresight is available", () => {
    const order = beladyEvictionOrder([obs("new", 5), obs("old", 1), obs("mid", 3)], 10);
    expect(order.map((o) => o.id)).toEqual(["old", "mid", "new"]);
  });

  it("breaks final ties by id deterministically and does not mutate input", () => {
    const input = [obs("y", 2), obs("x", 2)];
    const order = beladyEvictionOrder(input, 10);
    expect(order.map((o) => o.id)).toEqual(["x", "y"]);
    expect(input.map((o) => o.id)).toEqual(["y", "x"]); // input untouched
  });
});
