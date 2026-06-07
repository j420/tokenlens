import { describe, expect, it } from "vitest";
import { computeSlice } from "./slice.js";
import { fromSymbolGraph } from "./adapter.js";
import type { SliceGraphInput } from "./types.js";

// A → B → C ;  A → D ;  E (unrelated) ;  C → F
const graph: SliceGraphInput = {
  nodes: [
    { id: "A", tokens: 100 },
    { id: "B", tokens: 100 },
    { id: "C", tokens: 100 },
    { id: "D", tokens: 100 },
    { id: "E", tokens: 100 },
    { id: "F", tokens: 100 },
  ],
  edges: [
    { from: "A", to: "B" },
    { from: "B", to: "C" },
    { from: "A", to: "D" },
    { from: "C", to: "F" },
  ],
};

const ids = (r: { included: { id: string }[] }) => r.included.map((m) => m.id).sort();

describe("computeSlice — backward (dependencies)", () => {
  it("includes the full transitive dependency closure of the seed", () => {
    const r = computeSlice(graph, { seeds: ["A"] });
    expect(ids(r)).toEqual(["A", "B", "C", "D", "F"]);
    expect(r.sound).toBe(true);
  });

  it("excludes unrelated symbols", () => {
    const r = computeSlice(graph, { seeds: ["A"] });
    expect(r.included.find((m) => m.id === "E")).toBeUndefined();
  });

  it("records minimum hop distance from the seed", () => {
    const r = computeSlice(graph, { seeds: ["A"] });
    const dist = Object.fromEntries(r.included.map((m) => [m.id, m.distance]));
    expect(dist.A).toBe(0);
    expect(dist.B).toBe(1);
    expect(dist.C).toBe(2);
    expect(dist.F).toBe(3);
  });

  it("respects maxDepth", () => {
    const r = computeSlice(graph, { seeds: ["A"], maxDepth: 1 });
    expect(ids(r)).toEqual(["A", "B", "D"]);
  });
});

describe("computeSlice — forward (impact)", () => {
  it("returns the symbols that transitively depend on the seed", () => {
    const r = computeSlice(graph, { seeds: ["C"], direction: "forward" });
    // Who reaches C? B (B→C), A (A→B→C). F is a dependency of C, not a dependent.
    expect(ids(r)).toEqual(["A", "B", "C"]);
  });
});

describe("computeSlice — soundness vs budget", () => {
  it("is sound (drops nothing) without a budget", () => {
    const r = computeSlice(graph, { seeds: ["A"] });
    expect(r.cutByBudget).toHaveLength(0);
    expect(r.sound).toBe(true);
  });

  it("cuts the FARTHEST symbols first under a budget and reports them", () => {
    const r = computeSlice(graph, { seeds: ["A"], tokenBudget: 300 });
    // 300 budget / 100 each = 3 nearest kept: A(0), B(1), D(1).
    expect(ids(r)).toEqual(["A", "B", "D"]);
    expect(r.sound).toBe(false);
    expect(r.cutByBudget.map((m) => m.id).sort()).toEqual(["C", "F"]);
  });

  it("reports missing seeds instead of failing silently", () => {
    const r = computeSlice(graph, { seeds: ["A", "ZZZ"] });
    expect(r.missingSeeds).toEqual(["ZZZ"]);
    expect(ids(r)).toContain("A");
  });
});

describe("fromSymbolGraph adapter", () => {
  it("treats outNeighbors as dependency edges", () => {
    const repoGraph = {
      nodes: new Map([
        ["A", { id: "A", outNeighbors: ["B"], text: "x".repeat(40) }],
        ["B", { id: "B", outNeighbors: [], text: "y".repeat(8) }],
      ]),
    };
    const input = fromSymbolGraph(repoGraph);
    const r = computeSlice(input, { seeds: ["A"] });
    expect(r.included.map((m) => m.id).sort()).toEqual(["A", "B"]);
    // char/4 token estimate
    const a = r.included.find((m) => m.id === "A");
    expect(a?.tokens).toBe(10);
  });

  it("honours a custom token measurer", () => {
    const repoGraph = {
      nodes: new Map([["A", { id: "A", outNeighbors: [] }]]),
    };
    const input = fromSymbolGraph(repoGraph, () => 999);
    expect(input.nodes[0].tokens).toBe(999);
  });
});
