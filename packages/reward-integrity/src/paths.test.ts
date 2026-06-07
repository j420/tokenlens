import { describe, expect, it } from "vitest";
import {
  isGraderPath,
  isTestFilePath,
  normalizePath,
  scriptKindForPath,
  segments,
} from "./paths.js";

describe("normalizePath", () => {
  it("converts backslashes and strips trailing slash without regex", () => {
    expect(normalizePath("a\\b\\c")).toBe("a/b/c");
    expect(normalizePath("a/b/")).toBe("a/b");
    expect(normalizePath("/")).toBe("/");
  });
});

describe("segments", () => {
  it("splits into non-empty segments", () => {
    expect(segments("/a//b/c/")).toEqual(["a", "b", "c"]);
  });
});

describe("isTestFilePath", () => {
  it("matches standard suffixes", () => {
    expect(isTestFilePath("src/auth.test.ts")).toBe(true);
    expect(isTestFilePath("src/auth.spec.tsx")).toBe(true);
    expect(isTestFilePath("src/Auth.Test.JS")).toBe(true); // case-insensitive
  });

  it("matches __tests__ directories", () => {
    expect(isTestFilePath("pkg/__tests__/auth.ts")).toBe(true);
  });

  it("rejects ordinary source files", () => {
    expect(isTestFilePath("src/auth.ts")).toBe(false);
    expect(isTestFilePath("src/contest.ts")).toBe(false);
  });

  it("honours extra suffixes", () => {
    expect(isTestFilePath("src/auth_test.ts", ["_test.ts"])).toBe(true);
  });
});

describe("isGraderPath", () => {
  it("matches exact and segment-aligned suffixes", () => {
    expect(isGraderPath("repo/eval/grader.ts", ["eval/grader.ts"])).toBe(true);
    expect(isGraderPath("eval/grader.ts", ["eval/grader.ts"])).toBe(true);
  });

  it("does NOT match a non-aligned suffix", () => {
    expect(isGraderPath("repo/xgrader.ts", ["grader.ts"])).toBe(false);
  });

  it("returns false with no configured graders", () => {
    expect(isGraderPath("anything.ts", [])).toBe(false);
  });

  it("normalizes backslashes on both sides", () => {
    expect(isGraderPath("repo\\eval\\grader.ts", ["eval/grader.ts"])).toBe(true);
  });
});

describe("scriptKindForPath", () => {
  it("maps extensions", () => {
    expect(scriptKindForPath("a.tsx")).toBe("tsx");
    expect(scriptKindForPath("a.jsx")).toBe("jsx");
    expect(scriptKindForPath("a.mjs")).toBe("js");
    expect(scriptKindForPath("a.ts")).toBe("ts");
    expect(scriptKindForPath("a.unknown")).toBe("ts");
  });
});
