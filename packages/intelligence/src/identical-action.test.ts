import { describe, it, expect } from "vitest";
import {
  evaluateIdenticalActionLoop,
  canonicalKey,
  type ActionObservation,
} from "./identical-action.js";

function obs(turn: number, tool: string, input: unknown, resultSha: string): ActionObservation {
  return { turn, tool, input, resultSha };
}

describe("evaluateIdenticalActionLoop", () => {
  it("blocks when the same (tool,input,result) recurs minRepetitions times", () => {
    const observations = [
      obs(1, "Bash", { command: "npm test" }, "sha-fail"),
      obs(2, "Bash", { command: "npm test" }, "sha-fail"),
      obs(3, "Bash", { command: "npm test" }, "sha-fail"),
    ];
    const d = evaluateIdenticalActionLoop(observations, { minRepetitions: 3 });
    expect(d.shouldBlock).toBe(true);
    expect(d.tool).toBe("Bash");
    expect(d.repetitions).toBe(3);
    expect(d.resultSha).toBe("sha-fail");
    expect(d.turns).toEqual([1, 2, 3]);
    expect(d.reason).toContain("no progress");
  });

  it("does NOT block when results differ (real progress was made)", () => {
    const observations = [
      obs(1, "Read", { file_path: "auth.ts" }, "sha-v1"),
      obs(2, "Read", { file_path: "auth.ts" }, "sha-v2"), // file changed
      obs(3, "Read", { file_path: "auth.ts" }, "sha-v3"),
    ];
    const d = evaluateIdenticalActionLoop(observations, { minRepetitions: 3 });
    expect(d.shouldBlock).toBe(false);
  });

  it("does NOT block when inputs differ", () => {
    const observations = [
      obs(1, "Read", { file_path: "auth.ts" }, "sha-x"),
      obs(2, "Read", { file_path: "user.ts" }, "sha-x"),
      obs(3, "Read", { file_path: "db.ts" }, "sha-x"),
    ];
    const d = evaluateIdenticalActionLoop(observations, { minRepetitions: 3 });
    expect(d.shouldBlock).toBe(false);
  });

  it("treats key-reordered inputs as identical (canonicalization)", () => {
    const observations = [
      obs(1, "Grep", { pattern: "x", path: "auth.ts" }, "sha-0"),
      obs(2, "Grep", { path: "auth.ts", pattern: "x" }, "sha-0"),
      obs(3, "Grep", { pattern: "x", path: "auth.ts" }, "sha-0"),
    ];
    const d = evaluateIdenticalActionLoop(observations, { minRepetitions: 3 });
    expect(d.shouldBlock).toBe(true);
    expect(d.repetitions).toBe(3);
  });

  it("does not block below the repetition threshold", () => {
    const observations = [
      obs(1, "Bash", { command: "ls" }, "sha-a"),
      obs(2, "Bash", { command: "ls" }, "sha-a"),
    ];
    expect(evaluateIdenticalActionLoop(observations, { minRepetitions: 3 }).shouldBlock).toBe(
      false
    );
  });

  it("picks the worst offender across multiple loops", () => {
    const observations = [
      obs(1, "Read", { file_path: "a.ts" }, "ra"),
      obs(2, "Read", { file_path: "a.ts" }, "ra"),
      obs(3, "Read", { file_path: "a.ts" }, "ra"),
      obs(4, "Bash", { command: "npm test" }, "rb"),
      obs(5, "Bash", { command: "npm test" }, "rb"),
      obs(6, "Bash", { command: "npm test" }, "rb"),
      obs(7, "Bash", { command: "npm test" }, "rb"),
    ];
    const d = evaluateIdenticalActionLoop(observations, { minRepetitions: 3 });
    expect(d.tool).toBe("Bash");
    expect(d.repetitions).toBe(4);
  });

  it("respects the window — old identical calls outside it don't count", () => {
    const observations = [
      obs(1, "Bash", { command: "x" }, "r"),
      obs(2, "Bash", { command: "x" }, "r"),
      obs(3, "Read", { file_path: "z.ts" }, "rz"),
      obs(4, "Read", { file_path: "z.ts" }, "rz"),
    ];
    // window=2 keeps only turns 3,4 → only 2 identical reads → below threshold
    const d = evaluateIdenticalActionLoop(observations, { minRepetitions: 3, window: 2 });
    expect(d.shouldBlock).toBe(false);
  });

  it("is total on garbage input", () => {
    expect(evaluateIdenticalActionLoop(null).shouldBlock).toBe(false);
    expect(evaluateIdenticalActionLoop(undefined).shouldBlock).toBe(false);
    expect(evaluateIdenticalActionLoop("nope" as unknown).shouldBlock).toBe(false);
    expect(
      evaluateIdenticalActionLoop([{ turn: "x" }, null, 5] as unknown).shouldBlock
    ).toBe(false);
  });

  it("is deterministic", () => {
    const observations = [
      obs(1, "Bash", { command: "t" }, "r"),
      obs(2, "Bash", { command: "t" }, "r"),
      obs(3, "Bash", { command: "t" }, "r"),
    ];
    expect(evaluateIdenticalActionLoop(observations)).toEqual(
      evaluateIdenticalActionLoop(observations)
    );
  });
});

describe("canonicalKey", () => {
  it("is stable under key reordering", () => {
    expect(canonicalKey({ a: 1, b: 2 })).toBe(canonicalKey({ b: 2, a: 1 }));
  });

  it("distinguishes different values", () => {
    expect(canonicalKey({ a: 1 })).not.toBe(canonicalKey({ a: 2 }));
  });

  it("handles nested objects and arrays deterministically", () => {
    expect(canonicalKey({ x: [{ b: 1, a: 2 }] })).toBe(canonicalKey({ x: [{ a: 2, b: 1 }] }));
  });

  it("is total on a cyclic structure", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(typeof canonicalKey(a)).toBe("string");
  });

  it("handles primitives", () => {
    expect(canonicalKey("auth.ts")).toBe('"auth.ts"');
    expect(canonicalKey(null)).toBe("null");
    expect(canonicalKey(42)).toBe("42");
  });
});
