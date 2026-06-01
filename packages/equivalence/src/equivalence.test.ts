import { describe, expect, it } from "vitest";
import {
  astEquivalent,
  byteEqual,
  equivalent,
  extractSymbols,
  fingerprint,
  levenshtein,
  looksLikeCode,
  normalizedLevenshtein,
  symbolCoverage,
  textEquivalent,
} from "./index.js";

describe("text equivalence", () => {
  it("levenshtein matches known distances", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "abc")).toBe(0);
    expect(levenshtein("flaw", "lawn")).toBe(2);
  });

  it("normalizedLevenshtein is in [0,1]", () => {
    expect(normalizedLevenshtein("abc", "abc")).toBe(0);
    expect(normalizedLevenshtein("abc", "xyz")).toBe(1);
    expect(normalizedLevenshtein("kitten", "sitting")).toBeCloseTo(3 / 7, 5);
  });

  it("textEquivalent honors the threshold", () => {
    const close = textEquivalent(
      "The quick brown fox jumps.",
      "The quick brown fox jumps!",
      0.05
    );
    expect(close.equivalent).toBe(true);
    const far = textEquivalent("hello world", "goodbye everyone", 0.05);
    expect(far.equivalent).toBe(false);
  });
});

describe("AST structural equivalence", () => {
  it("ignores comments and whitespace", () => {
    const a = `function add(x: number, y: number) { return x + y; }`;
    const b = `
      // sum two numbers
      function add(x: number, y: number) {
        return x + y; // result
      }
    `;
    const r = astEquivalent(a, b, { identifierMode: "literal" });
    expect(r.parsedBoth).toBe(true);
    expect(r.equivalent).toBe(true);
  });

  it("alpha-renaming: equivalent under consistent identifier swap", () => {
    const a = `function add(x: number, y: number) { return x + y; }`;
    const b = `function add(a: number, b: number) { return a + b; }`;
    expect(astEquivalent(a, b, { identifierMode: "alpha" }).equivalent).toBe(
      true
    );
    // Strict mode sees different identifier text.
    expect(astEquivalent(a, b, { identifierMode: "literal" }).equivalent).toBe(
      false
    );
  });

  it("inconsistent renaming is NOT equivalent under alpha mode", () => {
    const a = `function add(x: number, y: number) { return x + y; }`;
    // y used where x should be — not a consistent renaming.
    const b = `function add(a: number, b: number) { return b + a; }`;
    expect(astEquivalent(a, b, { identifierMode: "alpha" }).equivalent).toBe(
      false
    );
  });

  it("changing a literal value is NEVER equivalent", () => {
    const a = `const timeout = 1000;`;
    const b = `const timeout = 2000;`;
    expect(astEquivalent(a, b, { identifierMode: "alpha" }).equivalent).toBe(
      false
    );
  });

  it("changing a string literal is NEVER equivalent", () => {
    const a = `const msg = "hello";`;
    const b = `const msg = "goodbye";`;
    expect(astEquivalent(a, b).equivalent).toBe(false);
  });

  it("different structure is not equivalent but yields graded similarity", () => {
    const a = `function f() { return 1; }`;
    const b = `class C { method() { return 1; } extra() {} }`;
    const r = astEquivalent(a, b);
    expect(r.equivalent).toBe(false);
    expect(r.similarity).toBeGreaterThanOrEqual(0);
    expect(r.similarity).toBeLessThan(1);
  });

  it("fingerprint preserves literal values but renames identifiers", () => {
    const fp = fingerprint(`const x = 42; const y = "hi";`, {
      identifierMode: "alpha",
    });
    expect(fp.tokens).toContain("num:42");
    expect(fp.tokens).toContain('str:hi');
    expect(fp.tokens).toContain("id#0");
    expect(fp.tokens).toContain("id#1");
  });

  it("reports syntax errors and lets caller fall back", () => {
    const r = astEquivalent(`function f( {`, `function f() {}`);
    expect(r.parsedBoth).toBe(false);
  });
});

describe("symbol coverage", () => {
  it("extracts identifier-like symbols and drops stopwords", () => {
    const syms = extractSymbols("the AuthService handles login and logout");
    expect(syms.has("AuthService")).toBe(true);
    expect(syms.has("login")).toBe(true);
    expect(syms.has("logout")).toBe(true);
    expect(syms.has("the")).toBe(false);
    expect(syms.has("and")).toBe(false);
  });

  it("full coverage when candidate contains all reference symbols", () => {
    const r = symbolCoverage(
      "AuthService login logout refresh",
      "class AuthService { login() {} logout() {} refresh() {} }"
    );
    expect(r.coverage).toBe(1);
    expect(r.equivalent).toBe(true);
  });

  it("flags missing symbols below threshold", () => {
    const r = symbolCoverage(
      "alpha beta gamma delta epsilon",
      "alpha beta gamma",
      0.97
    );
    expect(r.coverage).toBeCloseTo(0.6, 5);
    expect(r.equivalent).toBe(false);
    expect(r.missing).toContain("delta");
    expect(r.missing).toContain("epsilon");
  });

  it("empty reference is vacuously covered", () => {
    expect(symbolCoverage("", "anything").coverage).toBe(1);
  });
});

describe("byte equality", () => {
  it("is the strict relation F3 relies on", () => {
    expect(byteEqual("abc", "abc").equivalent).toBe(true);
    expect(byteEqual("abc", "abc ").equivalent).toBe(false);
    expect(byteEqual("abc", "abc ").similarity).toBe(0);
  });
});

describe("dispatcher", () => {
  it("short-circuits identical strings to byte", () => {
    const r = equivalent("same", "same");
    expect(r.strategy).toBe("byte");
    expect(r.equivalent).toBe(true);
  });

  it("routes code to AST", () => {
    const a = `function add(x: number, y: number) { return x + y; }`;
    const b = `function add(p: number, q: number) { return p + q; }`;
    const r = equivalent(a, b, { asCode: true });
    expect(r.strategy).toBe("ast");
    expect(r.equivalent).toBe(true);
  });

  it("routes prose to text", () => {
    const r = equivalent(
      "This function returns the sum of its inputs.",
      "This function returns the sum of its inputs!",
      { asCode: false }
    );
    expect(["text", "byte"]).toContain(r.strategy);
    expect(r.equivalent).toBe(true);
  });

  it("falls back to coverage for distant mixed content", () => {
    const r = equivalent(
      "alpha beta gamma delta epsilon zeta eta theta",
      "completely different prose with none of those words",
      { asCode: false }
    );
    expect(r.strategy).toBe("coverage");
    expect(r.equivalent).toBe(false);
  });

  it("looksLikeCode detects code and prose", () => {
    expect(looksLikeCode("export function f() { return 1; }")).toBe(true);
    expect(looksLikeCode("Just a plain English sentence about cats.")).toBe(
      false
    );
  });
});
