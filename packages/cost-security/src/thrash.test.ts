import { describe, expect, it } from "vitest";
import { detectThrash } from "./thrash.js";

describe("detectThrash — fail-safe input handling", () => {
  it("returns ok for non-array / garbage input without throwing", () => {
    for (const bad of [undefined, null, 42, {}, "x", true]) {
      const r = detectThrash(bad as unknown);
      expect(r.verdict).toBe("ok");
      expect(r.findings).toEqual([]);
    }
  });

  it("skips malformed events and keeps well-formed ones", () => {
    const r = detectThrash([
      { turn: 1, path: "a.ts", sha: "AAA" },
      { turn: 2, path: "a.ts" }, // missing sha — skipped
      { nope: true }, // garbage — skipped
      { turn: 3, path: "a.ts", sha: "BBB" },
    ]);
    expect(r.verdict).toBe("ok"); // only 2 valid states, no oscillation
  });
});

describe("detectThrash — oscillation detection", () => {
  it("flags an A->B->A->B edit loop", () => {
    const timeline = [
      { turn: 1, path: "auth.ts", sha: "A" },
      { turn: 2, path: "auth.ts", sha: "B" },
      { turn: 3, path: "auth.ts", sha: "A" }, // return 1
      { turn: 4, path: "auth.ts", sha: "B" }, // return 2
    ];
    const r = detectThrash(timeline);
    expect(r.verdict).toBe("warn");
    expect(r.findings).toHaveLength(1);
    const f = r.findings[0]!;
    expect(f.path).toBe("auth.ts");
    expect(f.cycles).toBe(2);
    expect(f.distinctStates).toBe(2);
    expect(f.edits).toBe(4);
    expect(f.wastedEdits).toBe(2);
  });

  it("does NOT flag genuine monotonic progress (all distinct states)", () => {
    const timeline = [
      { turn: 1, path: "x.ts", sha: "A" },
      { turn: 2, path: "x.ts", sha: "B" },
      { turn: 3, path: "x.ts", sha: "C" },
      { turn: 4, path: "x.ts", sha: "D" },
    ];
    expect(detectThrash(timeline).verdict).toBe("ok");
  });

  it("does NOT count an immediately-repeated identical edit as a cycle", () => {
    const timeline = [
      { turn: 1, path: "x.ts", sha: "A" },
      { turn: 2, path: "x.ts", sha: "A" }, // idempotent no-op, not an oscillation
      { turn: 3, path: "x.ts", sha: "B" },
    ];
    expect(detectThrash(timeline).verdict).toBe("ok");
  });

  it("respects minCycles", () => {
    const timeline = [
      { turn: 1, path: "x.ts", sha: "A" },
      { turn: 2, path: "x.ts", sha: "B" },
      { turn: 3, path: "x.ts", sha: "A" }, // 1 return only
    ];
    expect(detectThrash(timeline, { minCycles: 2 }).verdict).toBe("ok");
    expect(detectThrash(timeline, { minCycles: 1 }).verdict).toBe("warn");
  });

  it("handles multiple files independently and orders worst-first", () => {
    const timeline = [
      { turn: 1, path: "a.ts", sha: "A" },
      { turn: 2, path: "a.ts", sha: "B" },
      { turn: 3, path: "a.ts", sha: "A" },
      { turn: 4, path: "b.ts", sha: "X" },
      { turn: 5, path: "b.ts", sha: "Y" },
      { turn: 6, path: "b.ts", sha: "X" },
      { turn: 7, path: "b.ts", sha: "Y" },
      { turn: 8, path: "b.ts", sha: "X" },
    ];
    const r = detectThrash(timeline, { minCycles: 1 });
    expect(r.findings).toHaveLength(2);
    expect(r.findings[0]!.path).toBe("b.ts"); // more cycles, listed first
    expect(r.findings[0]!.cycles).toBeGreaterThan(r.findings[1]!.cycles);
  });
});

describe("detectThrash — deterministic", () => {
  it("same timeline yields an identical report", () => {
    const t = [
      { turn: 1, path: "x.ts", sha: "A" },
      { turn: 2, path: "x.ts", sha: "B" },
      { turn: 3, path: "x.ts", sha: "A" },
      { turn: 4, path: "x.ts", sha: "B" },
    ];
    expect(detectThrash(t)).toEqual(detectThrash(t));
  });
});
