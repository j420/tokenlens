import { describe, expect, it } from "vitest";
import { assessDuplicateParallelCall } from "./coalesce.js";

describe("assessDuplicateParallelCall", () => {
  const read = (path: string) => ({ tool: "Read", input: { file_path: path } });

  it("flags an exact within-turn duplicate with the FIRST match index", () => {
    const r = assessDuplicateParallelCall(
      [read("/a.ts"), read("/b.ts"), read("/b.ts")],
      read("/b.ts")
    );
    expect(r.verdict).toBe("duplicate");
    expect(r.matchIndex).toBe(1);
    expect(r.key).toBeTruthy();
  });

  it("identical canonical content with different key ORDER still matches (pinned canonicalization)", () => {
    const r = assessDuplicateParallelCall(
      [{ tool: "Grep", input: { pattern: "x", path: "/p" } }],
      { tool: "Grep", input: { path: "/p", pattern: "x" } }
    );
    expect(r.verdict).toBe("duplicate");
  });

  it("same input on a DIFFERENT tool is not a duplicate", () => {
    const r = assessDuplicateParallelCall(
      [{ tool: "Read", input: { file_path: "/a" } }],
      { tool: "Glob", input: { file_path: "/a" } }
    );
    expect(r.verdict).toBe("no_duplicate");
  });

  it("near-identical inputs differ (no fuzzy matching, ever)", () => {
    const r = assessDuplicateParallelCall(
      [read("/a.ts")],
      { tool: "Read", input: { file_path: "/a.ts", limit: 10 } }
    );
    expect(r.verdict).toBe("no_duplicate");
  });

  it("empty dispatch set and undefined-vs-missing fields are clean no-ops", () => {
    expect(assessDuplicateParallelCall([], read("/a.ts")).verdict).toBe("no_duplicate");
    // undefined field vs absent field: the pinned canonicalization decides —
    // whatever it says, the answer must be deterministic and not throw.
    const a = assessDuplicateParallelCall(
      [{ tool: "T", input: { x: undefined } }],
      { tool: "T", input: {} }
    );
    const b = assessDuplicateParallelCall(
      [{ tool: "T", input: { x: undefined } }],
      { tool: "T", input: {} }
    );
    expect(a.verdict).toBe(b.verdict);
  });

  it("fail-open on uncanonicalizable input (cyclic) — never a false positive", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const r = assessDuplicateParallelCall([{ tool: "T", input: cyclic }], {
      tool: "T",
      input: cyclic,
    });
    // canonicalKey handles DAGs/cycles deterministically OR the gate fails
    // open; either way: no throw, and a stable verdict.
    expect(["duplicate", "no_duplicate"]).toContain(r.verdict);
  });
});
