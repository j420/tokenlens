import { describe, it, expect } from "vitest";
import {
  estimateTokenCount,
  isCodeFile,
  tokenize,
  extractCodeTerms,
} from "./tokenizer.js";

describe("estimateTokenCount", () => {
  it("estimates tokens for regular text", () => {
    const text = "Hello world, this is a test.";
    // ~28 chars / 4 chars per token = ~7 tokens
    const count = estimateTokenCount(text);
    expect(count).toBeGreaterThan(5);
    expect(count).toBeLessThan(15);
  });

  it("estimates tokens for code (more tokens per char)", () => {
    const code = "function hello() { return 'world'; }";
    const codeCount = estimateTokenCount(code, true);
    const textCount = estimateTokenCount(code, false);
    // Code should have more tokens (3 chars/token vs 4)
    expect(codeCount).toBeGreaterThan(textCount);
  });

  it("returns 0 for empty string", () => {
    expect(estimateTokenCount("")).toBe(0);
  });

  it("handles unicode text", () => {
    const text = "こんにちは世界";
    const count = estimateTokenCount(text);
    expect(count).toBeGreaterThan(0);
  });
});

describe("isCodeFile", () => {
  it("identifies JavaScript files", () => {
    expect(isCodeFile("app.js")).toBe(true);
    expect(isCodeFile("index.jsx")).toBe(true);
  });

  it("identifies TypeScript files", () => {
    expect(isCodeFile("app.ts")).toBe(true);
    expect(isCodeFile("component.tsx")).toBe(true);
  });

  it("identifies Python files", () => {
    expect(isCodeFile("script.py")).toBe(true);
  });

  it("identifies common code files", () => {
    expect(isCodeFile("main.go")).toBe(true);
    expect(isCodeFile("lib.rs")).toBe(true);
    expect(isCodeFile("app.java")).toBe(true);
    expect(isCodeFile("helper.rb")).toBe(true);
  });

  it("identifies markdown as code file (for context purposes)", () => {
    // Note: .md is considered code for context purposes
    expect(isCodeFile("readme.md")).toBe(true);
  });

  it("returns false for unknown extensions", () => {
    expect(isCodeFile("config.txt")).toBe(false);
    expect(isCodeFile("image.png")).toBe(false);
    expect(isCodeFile("document.docx")).toBe(false);
  });
});

describe("tokenize", () => {
  it("splits text into words", () => {
    const tokens = tokenize("Hello world test");
    expect(tokens).toContain("hello");
    expect(tokens).toContain("world");
    expect(tokens).toContain("test");
  });

  it("converts to lowercase", () => {
    const tokens = tokenize("Hello WORLD Test");
    expect(tokens).toContain("hello");
    expect(tokens).toContain("world");
    expect(tokens).toContain("test");
  });

  it("handles special characters", () => {
    const tokens = tokenize("hello-world test_case");
    expect(tokens.length).toBeGreaterThan(0);
  });

  it("filters out short tokens", () => {
    const tokens = tokenize("a I the an test");
    expect(tokens).toContain("test");
    expect(tokens).not.toContain("a");
    expect(tokens).not.toContain("i");
  });
});

describe("extractCodeTerms", () => {
  it("extracts and splits function names from camelCase", () => {
    const code = "function calculateTotal() { return sum; }";
    const terms = extractCodeTerms(code);
    // Splits camelCase into parts
    expect(terms).toContain("calculate");
    expect(terms).toContain("total");
    expect(terms).toContain("sum");
  });

  it("extracts and splits variable names from camelCase", () => {
    const code = "const userName = 'test';";
    const terms = extractCodeTerms(code);
    // Splits camelCase into parts
    expect(terms).toContain("user");
    expect(terms).toContain("name");
    expect(terms).toContain("test");
  });

  it("extracts and splits class names from PascalCase", () => {
    const code = "class UserService { }";
    const terms = extractCodeTerms(code);
    // Splits PascalCase into parts
    expect(terms).toContain("user");
    expect(terms).toContain("service");
  });

  it("filters out common keywords", () => {
    const code = "const function return if else";
    const terms = extractCodeTerms(code);
    expect(terms).not.toContain("const");
    expect(terms).not.toContain("function");
    expect(terms).not.toContain("return");
  });

  it("handles snake_case", () => {
    const code = "const user_name = 'test';";
    const terms = extractCodeTerms(code);
    expect(terms.some((t) => t.includes("user"))).toBe(true);
  });
});
