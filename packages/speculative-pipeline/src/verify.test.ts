import { describe, expect, it } from "vitest";

import { verifyResult } from "./verify.js";

describe("verifyResult", () => {
  it("authoritative only on byte-equality", () => {
    const r = verifyResult("file contents\n", "file contents\n");
    expect(r.authoritative).toBe(true);
    expect(r.similarity).toBe(1);
  });

  it("non-authoritative when bytes differ even slightly", () => {
    const r = verifyResult("file contents\n", "file contents \n");
    expect(r.authoritative).toBe(false);
  });

  it("reports a graded similarity for near-misses (telemetry)", () => {
    const r = verifyResult("the quick brown fox", "the quick brown dog");
    expect(r.authoritative).toBe(false);
    expect(r.similarity).toBeGreaterThan(0);
    expect(r.similarity).toBeLessThan(1);
    expect(typeof r.strategy).toBe("string");
  });

  it("a high-similarity-but-non-identical result is still NOT authoritative", () => {
    // One trailing space → stale content → must not substitute.
    const a = "export const x = 1;";
    const b = "export const x = 1; ";
    const r = verifyResult(a, b);
    expect(r.authoritative).toBe(false);
  });
});
