import { describe, it, expect } from "vitest";
import {
  pathComponents,
  tokenizePath,
  tokenizeKeywords,
  jaccard,
} from "./tokenize.js";

describe("pathComponents (structural, no regex)", () => {
  it("splits on / and \\ and drops empties", () => {
    expect(pathComponents("src/auth/login.ts")).toEqual(["src", "auth", "login.ts"]);
    expect(pathComponents("src\\auth\\login.ts")).toEqual(["src", "auth", "login.ts"]);
    expect(pathComponents("//a///b//")).toEqual(["a", "b"]);
    expect(pathComponents("")).toEqual([]);
  });
});

describe("tokenizePath identifier boundaries", () => {
  it("splits camelCase, punctuation, and letter/digit boundaries", () => {
    const t = tokenizePath("src/authService/loginV2.test.ts");
    expect(t).toContain("auth");
    expect(t).toContain("service");
    expect(t).toContain("login");
    expect(t).toContain("v"); // V2 -> v | 2
    expect(t).toContain("2");
    expect(t).toContain("test");
    expect(t).toContain("ts");
  });

  it("treats extension as its own token", () => {
    const t = tokenizePath("a/b/service.ts");
    expect(t).toContain("service");
    expect(t).toContain("ts");
  });

  it("handles unicode components as word chars", () => {
    const t = tokenizePath("src/café/データ.ts");
    expect(t.has("café")).toBe(true);
    expect(t.has("データ")).toBe(true);
    expect(t.has("ts")).toBe(true);
  });
});

describe("tokenizeKeywords", () => {
  it("splits 'authService' and 'auth service' to the same tokens", () => {
    const a = tokenizeKeywords(["authService"]);
    const b = tokenizeKeywords(["auth service"]);
    expect([...a].sort()).toEqual([...b].sort());
    expect(a.has("auth")).toBe(true);
    expect(a.has("service")).toBe(true);
  });

  it("ignores non-string entries without throwing", () => {
    // @ts-expect-error bad input
    const t = tokenizeKeywords(["ok", 5, null, undefined, { x: 1 }]);
    expect(t.has("ok")).toBe(true);
  });
});

describe("jaccard", () => {
  it("is 1 for identical sets, 0 for disjoint, and proportional otherwise", () => {
    expect(jaccard(new Set(["a", "b"]), new Set(["a", "b"]))).toBe(1);
    expect(jaccard(new Set(["a"]), new Set(["b"]))).toBe(0);
    // {a,b} vs {b,c} → inter 1, union 3
    expect(jaccard(new Set(["a", "b"]), new Set(["b", "c"]))).toBeCloseTo(1 / 3, 10);
  });

  it("empty set yields 0 (signal absent)", () => {
    expect(jaccard(new Set(), new Set(["a"]))).toBe(0);
    expect(jaccard(new Set(["a"]), new Set())).toBe(0);
  });
});
