import { describe, expect, it } from "vitest";
import { assessEditAmplification } from "./amplification.js";

function file(lines: number, marker = "x"): string {
  const out: string[] = [];
  for (let i = 0; i < lines; i++) out.push(`const value_${i} = compute_${i}(${marker}, ${i * 7});`);
  return out.join("\n");
}

describe("assessEditAmplification — fail-safe inputs", () => {
  it("returns neutral for non-string input", () => {
    for (const bad of [undefined, null, 42, {}, []]) {
      const r = assessEditAmplification(bad as unknown, "x");
      expect(r.amplified).toBe(false);
      expect(r.advice).toBeNull();
    }
  });

  it("returns neutral for identical content", () => {
    const r = assessEditAmplification("same", "same");
    expect(r.amplified).toBe(false);
  });
});

describe("assessEditAmplification — amplification detection", () => {
  it("flags a whole-file rewrite that makes a one-line change", () => {
    const original = file(300);
    const proposed = original.replace("const value_150", "const value_150_RENAMED");
    const r = assessEditAmplification(original, proposed);
    expect(r.amplified).toBe(true);
    expect(r.recommendation).toBe("diff");
    expect(r.savedTokens).toBeGreaterThan(0);
    expect(r.rewriteTokens).toBeGreaterThan(r.diffTokens);
    expect(r.ratio).toBeGreaterThan(3);
    expect(r.advice).toMatch(/targeted edit/);
  });

  it("does NOT flag a small file (rewrite is cheap anyway)", () => {
    const original = file(5);
    const proposed = original.replace("value_2", "value_2b");
    const r = assessEditAmplification(original, proposed);
    expect(r.amplified).toBe(false);
  });

  it("does NOT flag a genuine large change (most lines moved)", () => {
    const original = file(300);
    const proposed = file(300, "y"); // every line differs
    const r = assessEditAmplification(original, proposed);
    expect(r.amplified).toBe(false); // enforcer recommends rewrite; not amplification
  });
});

describe("assessEditAmplification — deterministic & real counts", () => {
  it("same inputs yield an identical report", () => {
    const a = file(120);
    const b = a.replace("value_60", "value_60c");
    expect(assessEditAmplification(a, b)).toEqual(assessEditAmplification(a, b));
  });
});
