import { describe, it, expect } from "vitest";
import {
  buildAdjacency,
  bfsDistances,
  hopProximity,
  pathProximity,
} from "./graph.js";

describe("buildAdjacency", () => {
  it("is undirected and ignores self-loops and malformed edges", () => {
    const adj = buildAdjacency([
      { from: "a", to: "b" },
      { from: "b", to: "b" }, // self loop ignored
      // @ts-expect-error malformed
      null,
      // @ts-expect-error malformed
      { from: 1, to: 2 },
    ]);
    expect(adj.get("a")?.has("b")).toBe(true);
    expect(adj.get("b")?.has("a")).toBe(true); // undirected
    expect(adj.get("b")?.has("b")).toBe(false);
  });

  it("returns empty map for undefined edges", () => {
    expect(buildAdjacency(undefined).size).toBe(0);
  });
});

describe("bfsDistances", () => {
  it("computes hop distances over an undirected graph", () => {
    const adj = buildAdjacency([
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "c", to: "d" },
    ]);
    const dist = bfsDistances(adj, "a");
    expect(dist.get("a")).toBe(0);
    expect(dist.get("b")).toBe(1);
    expect(dist.get("c")).toBe(2);
    expect(dist.get("d")).toBe(3);
  });

  it("omits unreachable nodes and returns empty when source absent", () => {
    const adj = buildAdjacency([
      { from: "a", to: "b" },
      { from: "x", to: "y" },
    ]);
    const dist = bfsDistances(adj, "a");
    expect(dist.has("x")).toBe(false);
    expect(bfsDistances(adj, "missing").size).toBe(0);
  });
});

describe("hopProximity", () => {
  it("decays geometrically per hop (base 0.6), bounded", () => {
    expect(hopProximity(0)).toBe(1);
    expect(hopProximity(1)).toBeCloseTo(0.6, 10); // direct import beats path-share (~0.5)
    expect(hopProximity(2)).toBeCloseTo(0.36, 10);
    expect(hopProximity(-1)).toBe(0);
    expect(hopProximity(Number.NaN)).toBe(0);
  });
});

describe("pathProximity", () => {
  it("same directory scores 1", () => {
    expect(pathProximity("src/a/x.ts", "src/a/y.ts")).toBe(1);
  });

  it("both at root score 1", () => {
    expect(pathProximity("a.ts", "b.ts")).toBe(1);
  });

  it("decreases with diverging directory chains", () => {
    const near = pathProximity("src/a/b/x.ts", "src/a/c/y.ts"); // share src/a
    const far = pathProximity("src/a/b/x.ts", "other/p/q/y.ts"); // share nothing
    expect(near).toBeGreaterThan(far);
    expect(far).toBe(0);
  });
});
