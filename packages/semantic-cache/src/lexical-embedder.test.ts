import { describe, expect, it } from "vitest";
import { LexicalEmbedder, cosine } from "./lexical-embedder.js";

describe("LexicalEmbedder — deterministic", () => {
  it("same input → byte-identical vector", () => {
    const e = new LexicalEmbedder();
    const a = e.embed("hello world");
    const b = e.embed("hello world");
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("different instances with same options produce identical vectors", () => {
    const a = new LexicalEmbedder().embed("alpha beta");
    const b = new LexicalEmbedder().embed("alpha beta");
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});

describe("LexicalEmbedder — shape", () => {
  it("default dim is 256", () => {
    const e = new LexicalEmbedder();
    expect(e.dim).toBe(256);
    expect(e.embed("x").length).toBe(256);
  });

  it("custom dim respected (power of two)", () => {
    const e = new LexicalEmbedder({ dim: 1024 });
    expect(e.dim).toBe(1024);
    expect(e.embed("x").length).toBe(1024);
  });

  it("invalid dim falls through to default", () => {
    const e = new LexicalEmbedder({ dim: -1 });
    expect(e.dim).toBe(256);
  });

  it("invalid n falls through to default", () => {
    const e = new LexicalEmbedder({ n: 0 });
    const v = e.embed("test");
    expect(v.length).toBe(256);
  });
});

describe("LexicalEmbedder — empty / boundary", () => {
  it("empty string yields all-zero vector", () => {
    const e = new LexicalEmbedder();
    const v = e.embed("");
    for (let i = 0; i < v.length; i++) expect(v[i]).toBe(0);
  });

  it("non-string input yields all-zero vector", () => {
    const e = new LexicalEmbedder();
    const v = e.embed(null as never);
    for (let i = 0; i < v.length; i++) expect(v[i]).toBe(0);
  });

  it("shorter-than-n input is embedded as a single gram", () => {
    const e = new LexicalEmbedder({ n: 5 });
    const v = e.embed("hi");
    // Not all zeros — single gram contributed
    let nonzero = 0;
    for (let i = 0; i < v.length; i++) if (v[i] !== 0) nonzero += 1;
    expect(nonzero).toBeGreaterThan(0);
  });
});

describe("LexicalEmbedder — L2 normalization", () => {
  it("non-empty vector has L2 norm ≈ 1", () => {
    const e = new LexicalEmbedder();
    const v = e.embed("the quick brown fox jumps over the lazy dog");
    let sq = 0;
    for (let i = 0; i < v.length; i++) sq += v[i]! * v[i]!;
    expect(Math.abs(Math.sqrt(sq) - 1)).toBeLessThan(1e-5);
  });
});

describe("LexicalEmbedder — similarity properties", () => {
  it("self-similarity = 1", () => {
    const e = new LexicalEmbedder();
    const v = e.embed("identical text");
    expect(cosine(v, v)).toBeCloseTo(1, 5);
  });

  it("similar prompts → high similarity", () => {
    const e = new LexicalEmbedder();
    const a = e.embed("write a function that reverses a string");
    const b = e.embed("write a function that reverses the string");
    // One-word swap on a 38-char string ⇒ ~10% of the trigrams change.
    // We require materially better than chance similarity (well above 0.5)
    // but stop short of pinning >0.9 (sensitive to n-gram length).
    expect(cosine(a, b)).toBeGreaterThan(0.85);
  });

  it("dissimilar prompts → low similarity", () => {
    const e = new LexicalEmbedder();
    const a = e.embed("write a function that reverses a string");
    const b = e.embed("calculate the eigenvalues of a 4x4 matrix");
    expect(cosine(a, b)).toBeLessThan(0.5);
  });

  it("case-insensitivity (same shape ⇒ same vector)", () => {
    const e = new LexicalEmbedder();
    const a = e.embed("Hello World");
    const b = e.embed("hello world");
    expect(cosine(a, b)).toBeCloseTo(1, 5);
  });

  it("whitespace collapse: extra spaces don't change the embedding", () => {
    const e = new LexicalEmbedder();
    const a = e.embed("foo  bar");
    const b = e.embed("foo bar");
    expect(cosine(a, b)).toBeCloseTo(1, 5);
  });
});

describe("cosine", () => {
  it("returns 0 for mismatched dims", () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([1, 0, 0]);
    expect(cosine(a, b)).toBe(0);
  });

  it("clamps numerical noise to [-1, 1]", () => {
    const a = new Float32Array([1.0001, 0]);
    const b = new Float32Array([1, 0]);
    const c = cosine(a, b);
    expect(c).toBeLessThanOrEqual(1);
    expect(c).toBeGreaterThanOrEqual(-1);
  });

  it("orthogonal vectors yield 0", () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([0, 1]);
    expect(cosine(a, b)).toBe(0);
  });

  it("anti-parallel vectors yield -1", () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([-1, 0]);
    expect(cosine(a, b)).toBe(-1);
  });
});
