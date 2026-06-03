/**
 * Unicode / large-input robustness for the equivalence relations. Distances
 * must stay in [0,1], nothing may crash or NaN, and the one normalization
 * limitation must fail in the SAFE direction (false-different, never
 * false-equivalent).
 */

import { describe, expect, it } from "vitest";
import {
  byteEqual,
  normalizedLevenshtein,
  symbolCoverage,
  textEquivalent,
} from "./index.js";

describe("Unicode text distance stays well-formed", () => {
  const pairs: Array<[string, string]> = [
    ["café", "cafe"],
    ["🎉🎊", "🎉🎈"],
    ["日本語", "日本X"],
    ["", ""],
    ["abc", ""],
    ["Ωμέγα", "Ωμεγα"],
  ];
  for (const [a, b] of pairs) {
    it(`distance in [0,1]: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`, () => {
      const d = normalizedLevenshtein(a, b);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
      expect(Number.isNaN(d)).toBe(false);
    });
  }
});

describe("Unicode identifiers in coverage", () => {
  it("matches accented identifiers exactly", () => {
    expect(symbolCoverage("hängé café", "hängé café").coverage).toBe(1);
  });
});

describe("normalization limitation fails in the SAFE direction", () => {
  it("NFC vs NFD of the same glyph are byte-different (false-different, safe)", () => {
    const nfc = "é".normalize("NFC");
    const nfd = "é".normalize("NFD");
    // Different bytes ⇒ not equal. This NEVER masks a regression (the only
    // error that matters); it can at most under-credit a cosmetic difference.
    expect(byteEqual(nfc, nfd).equivalent).toBe(false);
  });
});

describe("large inputs do not blow up", () => {
  it("5k identical chars are equivalent", () => {
    expect(textEquivalent("a".repeat(5000), "a".repeat(5000)).equivalent).toBe(
      true
    );
  });
  it("5k vs 5k with a 1-char diff stays just under the threshold", () => {
    const a = "a".repeat(5000);
    const b = "a".repeat(4999) + "b";
    const r = textEquivalent(a, b, 0.05);
    expect(r.equivalent).toBe(true); // 1/5000 well under 5%
    expect(Number.isFinite(r.distance)).toBe(true);
  });
});
