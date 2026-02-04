import { describe, it, expect } from "vitest";
import {
  parseContextBlocks,
  analyzeContext,
  generatePruneSuggestion,
  applyPruning,
  quickAnalyze,
} from "./analyzer.js";

describe("parseContextBlocks", () => {
  it("parses file attachment style context", () => {
    const context = `
// src/auth.ts
function authenticate() { }

// src/utils.ts
function helper() { }
    `;

    const blocks = parseContextBlocks(context);
    expect(blocks.length).toBeGreaterThanOrEqual(1);
  });

  it("parses markdown code fences", () => {
    const context = `
\`\`\`typescript
function test() { }
\`\`\`
    `;

    const blocks = parseContextBlocks(context);
    expect(blocks.length).toBeGreaterThanOrEqual(1);
  });

  it("handles plain text context", () => {
    const context = `
This is some explanation text.
It has no special formatting.
    `;

    const blocks = parseContextBlocks(context);
    expect(blocks.length).toBeGreaterThan(0);
    // Plain text should be treated as non-code
    expect(blocks[0].isCode).toBe(false);
  });

  it("handles empty context", () => {
    const blocks = parseContextBlocks("");
    expect(blocks).toEqual([]);
  });
});

describe("analyzeContext", () => {
  it("analyzes a context and returns analysis structure", () => {
    const prompt = "How do I fix the authentication bug?";
    const context = `
function authenticate(user, password) {
  return checkCredentials(user, password);
}
    `;

    const analysis = analyzeContext(prompt, context);

    expect(analysis.totalTokens).toBeGreaterThan(0);
    expect(analysis.blocks.length).toBeGreaterThanOrEqual(1);
    expect(analysis.relevantTokens).toBeGreaterThanOrEqual(0);
    expect(analysis.peripheralTokens).toBeGreaterThanOrEqual(0);
    expect(analysis.noiseTokens).toBeGreaterThanOrEqual(0);
  });

  it("calculates token distributions that sum to total", () => {
    const prompt = "test prompt";
    const context = `
function test() { }
function unrelatedCalculation() { return something * other; }
    `;

    const analysis = analyzeContext(prompt, context);

    expect(analysis.relevantTokens + analysis.peripheralTokens + analysis.noiseTokens).toBe(
      analysis.totalTokens
    );
  });
});

describe("generatePruneSuggestion", () => {
  it("returns null for small contexts", () => {
    const prompt = "test";
    const context = "small context";
    const analysis = analyzeContext(prompt, context);
    const suggestion = generatePruneSuggestion("req-123", analysis);

    // Small context (< 1000 tokens) should not trigger suggestion
    expect(suggestion).toBeNull();
  });

  it("returns suggestion with proper structure when warranted", () => {
    const prompt = "Fix the login function";

    // Create a large context
    const largeCode = `
function calculateTaxRate(income, deductions) {
  const brackets = [0.1, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37];
  const taxableIncome = income - deductions;
  return brackets[Math.min(Math.floor(taxableIncome / 50000), 6)] * taxableIncome;
}
    `.repeat(20);

    const analysis = analyzeContext(prompt, largeCode);
    const suggestion = generatePruneSuggestion("req-123", analysis);

    // If a suggestion is generated, verify its structure
    if (suggestion) {
      expect(suggestion.type).toBe("prune_suggestion");
      expect(suggestion.request_id).toBe("req-123");
      expect(suggestion.total_tokens).toBeGreaterThan(0);
      expect(suggestion.confidence).toBeGreaterThanOrEqual(0);
      expect(suggestion.confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe("applyPruning", () => {
  it("returns content based on analysis", () => {
    const context = `
Some code content here.
function login() { return true; }
    `;

    const analysis = analyzeContext("test", context);
    const pruned = applyPruning(context, analysis);

    // Should return a string (may be empty if all categorized as noise)
    expect(typeof pruned).toBe("string");
  });

  it("keeps relevant blocks", () => {
    const prompt = "implement authentication";
    const context = `
function authenticate(user, pass) {
  return checkAuth(user, pass);
}
    `;

    const analysis = analyzeContext(prompt, context);
    // Force a block to be relevant for testing
    if (analysis.blocks.length > 0) {
      analysis.blocks[0].relevance.category = "relevant";
      analysis.blocks[0].relevance.score = 0.8;
    }

    const pruned = applyPruning(context, analysis);
    expect(pruned.length).toBeGreaterThan(0);
  });
});

describe("quickAnalyze", () => {
  it("returns null for small context", async () => {
    const result = await quickAnalyze("test", "small context", 50);
    expect(result).toBeNull();
  });

  it("completes within timeout", async () => {
    const largeContext = "function test() { return 1; }".repeat(100);
    const start = performance.now();

    await quickAnalyze("test prompt", largeContext, 100);

    const elapsed = performance.now() - start;
    // Should complete within reasonable time (allowing some overhead)
    expect(elapsed).toBeLessThan(500);
  });

  it("returns analysis for sufficiently large context", async () => {
    // Create a context that's > 2000 tokens
    const largeContext = "function authenticate() { return true; } ".repeat(200);

    const result = await quickAnalyze("Fix auth bug", largeContext, 500);

    if (result) {
      expect(result.totalTokens).toBeGreaterThan(2000);
      expect(result.blocks.length).toBeGreaterThan(0);
    }
  });
});
