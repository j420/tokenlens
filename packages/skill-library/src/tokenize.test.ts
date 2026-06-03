import { describe, expect, it } from "vitest";

import { jaccard, tokenizeIntent } from "./tokenize.js";

describe("tokenizeIntent", () => {
  it("lowercases, dedups, and sorts terms", () => {
    expect(tokenizeIntent("Refactor refactor REFACTOR auth")).toEqual(["auth", "refactor"]);
  });

  it("drops tokens shorter than 3 chars", () => {
    expect(tokenizeIntent("go to db")).toEqual([]);
  });

  it("drops stop words", () => {
    expect(tokenizeIntent("add a new endpoint for the invoices")).toEqual([
      "endpoint",
      "invoices",
      "new",
    ]);
  });

  it("splits on punctuation without regex artifacts", () => {
    expect(tokenizeIntent("fix(auth): handle null-token edge_case")).toEqual([
      "auth",
      "case",
      "edge",
      "fix",
      "handle",
      "null",
      "token",
    ]);
  });

  it("handles empty input", () => {
    expect(tokenizeIntent("")).toEqual([]);
  });

  it("preserves digits inside terms", () => {
    expect(tokenizeIntent("migrate to v2 schema oauth2")).toEqual([
      "migrate",
      "oauth2",
      "schema",
    ]);
  });

  it("is deterministic", () => {
    const p = "implement the rate limiter before auth middleware";
    expect(tokenizeIntent(p)).toEqual(tokenizeIntent(p));
  });
});

describe("jaccard", () => {
  it("returns 1 for identical sets", () => {
    expect(jaccard(["a", "b", "c"], ["c", "b", "a"]).similarity).toBe(1);
  });

  it("returns 0 for disjoint sets", () => {
    expect(jaccard(["a", "b"], ["c", "d"]).similarity).toBe(0);
  });

  it("computes the standard ratio", () => {
    // {a,b,c} vs {b,c,d}: inter=2, union=4 → 0.5
    const r = jaccard(["a", "b", "c"], ["b", "c", "d"]);
    expect(r.similarity).toBe(0.5);
    expect(r.intersection).toEqual(["b", "c"]);
  });

  it("returns 0 for two empty sets", () => {
    expect(jaccard([], []).similarity).toBe(0);
  });

  it("is symmetric", () => {
    const a = ["x", "y", "z", "w"];
    const b = ["y", "z"];
    expect(jaccard(a, b).similarity).toBe(jaccard(b, a).similarity);
  });
});
