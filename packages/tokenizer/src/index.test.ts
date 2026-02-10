/**
 * Tokenizer Package Comprehensive Test Suite
 *
 * 25+ test cases covering:
 * - Token counting accuracy
 * - Model-specific tokenization
 * - Cost estimation
 * - Batch processing
 * - Edge cases and error handling
 */

import { describe, it, expect } from "vitest";
import {
  countTokens,
  countTokensAsync,
  countTokensBatch,
  estimateCost,
  analyzeContent,
  isLargeContext,
} from "./index.js";

// ============================================================================
// Token Counting Tests
// ============================================================================

describe("countTokens", () => {
  describe("Basic Functionality", () => {
    it("should count tokens for simple text", () => {
      const result = countTokens("Hello, world!", "gpt-4o");
      expect(result.tokens).toBeGreaterThan(0);
      expect(result.tokens).toBeLessThan(10);
    });

    it("should count tokens for code", () => {
      const code = `
function add(a: number, b: number): number {
  return a + b;
}`;
      const result = countTokens(code, "gpt-4o");
      expect(result.tokens).toBeGreaterThan(10);
    });

    it("should return 0 for empty string", () => {
      const result = countTokens("", "gpt-4o");
      expect(result.tokens).toBe(0);
    });

    it("should return cost with token count", () => {
      const result = countTokens("Test content", "gpt-4o");
      expect(result.cost).toBeGreaterThanOrEqual(0);
    });

    it("should handle whitespace-only content", () => {
      const result = countTokens("   \n\t  ", "gpt-4o");
      expect(result.tokens).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Model-Specific Tokenization", () => {
    it("should work with gpt-4o", () => {
      const result = countTokens("Test", "gpt-4o");
      expect(result.tokens).toBeGreaterThan(0);
    });

    it("should work with gpt-4o-mini", () => {
      const result = countTokens("Test", "gpt-4o-mini");
      expect(result.tokens).toBeGreaterThan(0);
    });

    it("should work with claude-sonnet-4", () => {
      const result = countTokens("Test", "claude-sonnet-4");
      expect(result.tokens).toBeGreaterThan(0);
    });

    it("should work with claude-opus-4", () => {
      const result = countTokens("Test", "claude-opus-4");
      expect(result.tokens).toBeGreaterThan(0);
    });

    it("should work with claude-haiku-3.5", () => {
      const result = countTokens("Test", "claude-haiku-3.5");
      expect(result.tokens).toBeGreaterThan(0);
    });

    it("should give consistent results for same input", () => {
      const text = "Consistent tokenization test";
      const result1 = countTokens(text, "gpt-4o");
      const result2 = countTokens(text, "gpt-4o");
      expect(result1.tokens).toBe(result2.tokens);
    });
  });

  describe("Content Types", () => {
    it("should count tokens for TypeScript code", () => {
      const code = `
interface User {
  id: string;
  name: string;
}

export class UserService {
  async findUser(id: string): Promise<User | null> {
    return null;
  }
}`;
      const result = countTokens(code, "gpt-4o");
      expect(result.tokens).toBeGreaterThan(20);
    });

    it("should count tokens for Python code", () => {
      const code = `
def calculate_total(items):
    return sum(item.price for item in items)

class ShoppingCart:
    def __init__(self):
        self.items = []
`;
      const result = countTokens(code, "gpt-4o");
      expect(result.tokens).toBeGreaterThan(15);
    });

    it("should count tokens for JSON", () => {
      const json = JSON.stringify({
        user: { id: "123", name: "Test", email: "test@example.com" },
        settings: { theme: "dark", language: "en" }
      }, null, 2);
      const result = countTokens(json, "gpt-4o");
      expect(result.tokens).toBeGreaterThan(20);
    });

    it("should count tokens for markdown", () => {
      const markdown = `
# Heading 1

This is a paragraph with **bold** and *italic* text.

- List item 1
- List item 2

\`\`\`javascript
const x = 1;
\`\`\`
`;
      const result = countTokens(markdown, "gpt-4o");
      expect(result.tokens).toBeGreaterThan(20);
    });
  });

  describe("Edge Cases", () => {
    it("should handle Unicode characters", () => {
      const text = "Hello, こんにちは, Привет, مرحبا!";
      const result = countTokens(text, "gpt-4o");
      expect(result.tokens).toBeGreaterThan(0);
    });

    it("should handle emojis", () => {
      const text = "Hello 👋 World 🌍 Test 🧪";
      const result = countTokens(text, "gpt-4o");
      expect(result.tokens).toBeGreaterThan(0);
    });

    it("should handle special characters", () => {
      const text = "Special: @#$%^&*()[]{}|;':\",./<>?`~";
      const result = countTokens(text, "gpt-4o");
      expect(result.tokens).toBeGreaterThan(0);
    });

    it("should handle very long words", () => {
      const longWord = "a".repeat(1000);
      const result = countTokens(longWord, "gpt-4o");
      expect(result.tokens).toBeGreaterThan(0);
    });

    it("should handle newlines and tabs", () => {
      const text = "Line1\nLine2\tTabbed\rCarriage";
      const result = countTokens(text, "gpt-4o");
      expect(result.tokens).toBeGreaterThan(0);
    });
  });
});

// ============================================================================
// Async Token Counting Tests
// ============================================================================

describe("countTokensAsync", () => {
  it("should return same result as sync version", async () => {
    const text = "Async test content";
    const syncResult = countTokens(text, "gpt-4o");
    const asyncResult = await countTokensAsync(text, "gpt-4o");
    expect(asyncResult.tokens).toBe(syncResult.tokens);
  });

  it("should handle concurrent calls", async () => {
    const texts = ["Text 1", "Text 2", "Text 3", "Text 4", "Text 5"];
    const results = await Promise.all(
      texts.map(t => countTokensAsync(t, "gpt-4o"))
    );
    expect(results.length).toBe(5);
    results.forEach(r => expect(r.tokens).toBeGreaterThan(0));
  });
});

// ============================================================================
// Batch Processing Tests
// ============================================================================

describe("countTokensBatch", () => {
  it("should count tokens for multiple files", () => {
    const files = [
      { path: "a.ts", content: "const a = 1;" },
      { path: "b.ts", content: "const b = 2;" },
      { path: "c.ts", content: "const c = 3;" },
    ];
    const result = countTokensBatch(files, "gpt-4o");

    expect(result.files.length).toBe(3);
    expect(result.total.tokens).toBeGreaterThan(0);
  });

  it("should calculate correct totals", () => {
    const files = [
      { path: "a.ts", content: "const a = 1;" },
      { path: "b.ts", content: "const b = 2;" },
    ];
    const result = countTokensBatch(files, "gpt-4o");

    const sumTokens = result.files.reduce((sum, f) => sum + f.tokens, 0);
    expect(sumTokens).toBe(result.total.tokens);
  });

  it("should calculate per-file token distribution", () => {
    const files = [
      { path: "large.ts", content: "x".repeat(100) },
      { path: "small.ts", content: "y" },
    ];
    const result = countTokensBatch(files, "gpt-4o");

    // Verify large file has more tokens
    expect(result.files[0].tokens).toBeGreaterThan(result.files[1].tokens);
  });

  it("should handle empty file list", () => {
    const result = countTokensBatch([], "gpt-4o");
    expect(result.files.length).toBe(0);
    expect(result.total.tokens).toBe(0);
  });

  it("should handle files with empty content", () => {
    const files = [
      { path: "empty.ts", content: "" },
      { path: "full.ts", content: "const x = 1;" },
    ];
    const result = countTokensBatch(files, "gpt-4o");

    expect(result.files.length).toBe(2);
    expect(result.files[0].tokens).toBe(0);
    expect(result.files[1].tokens).toBeGreaterThan(0);
  });

  it("should handle large number of files efficiently", () => {
    const files = Array(100).fill(null).map((_, i) => ({
      path: `file${i}.ts`,
      content: `export const value${i} = ${i};`
    }));

    const start = performance.now();
    const result = countTokensBatch(files, "gpt-4o");
    const elapsed = performance.now() - start;

    expect(result.files.length).toBe(100);
    expect(elapsed).toBeLessThan(5000); // Should complete within 5 seconds
  });
});

// ============================================================================
// Cost Estimation Tests
// ============================================================================

describe("estimateCost", () => {
  it("should calculate cost for gpt-4o input", () => {
    const cost = estimateCost(1000, "gpt-4o");
    expect(cost).toBeGreaterThan(0);
  });

  it("should calculate higher cost for more tokens", () => {
    const cost1000 = estimateCost(1000, "gpt-4o");
    const cost10000 = estimateCost(10000, "gpt-4o");
    expect(cost10000).toBeGreaterThan(cost1000);
  });

  it("should return 0 for 0 tokens", () => {
    const cost = estimateCost(0, "gpt-4o");
    expect(cost).toBe(0);
  });

  it("should work with different models", () => {
    const models = ["gpt-4o", "gpt-4o-mini", "claude-sonnet-4", "claude-opus-4"];
    models.forEach(model => {
      const cost = estimateCost(1000, model);
      expect(cost).toBeGreaterThanOrEqual(0);
    });
  });

  it("should calculate more expensive for claude-opus-4 than gpt-4o-mini", () => {
    const opusCost = estimateCost(1000, "claude-opus-4");
    const miniCost = estimateCost(1000, "gpt-4o-mini");
    expect(opusCost).toBeGreaterThan(miniCost);
  });
});

// ============================================================================
// Content Analysis Tests
// ============================================================================

describe("analyzeContent", () => {
  it("should return comprehensive analysis", () => {
    const content = "function test() { return true; }";
    const analysis = analyzeContent(content, "gpt-4o");

    expect(analysis.tokens).toBeGreaterThan(0);
    expect(analysis.cost).toBeGreaterThanOrEqual(0);
    expect(analysis.recommendation).toBeDefined();
  });

  it("should recommend 'proceed' for small content", () => {
    const content = "const x = 1;";
    const analysis = analyzeContent(content, "gpt-4o", 10000);

    expect(analysis.recommendation).toBe("proceed");
  });

  it("should recommend 'compress' for medium content", () => {
    // Create content that exceeds threshold but not by much
    const content = "x".repeat(50000);
    const analysis = analyzeContent(content, "gpt-4o", 1000);

    expect(["compress", "abort"]).toContain(analysis.recommendation);
  });
});

// ============================================================================
// Threshold Detection Tests
// ============================================================================

describe("isLargeContext", () => {
  it("should return false for small content", () => {
    const content = "const x = 1;";
    expect(isLargeContext(content, "gpt-4o")).toBe(false);
  });

  it("should return true for large content", () => {
    const content = "x".repeat(100000);
    expect(isLargeContext(content, "gpt-4o")).toBe(true);
  });

  it("should use custom threshold", () => {
    const content = "x".repeat(100);
    expect(isLargeContext(content, "gpt-4o", 10)).toBe(true);
    expect(isLargeContext(content, "gpt-4o", 1000)).toBe(false);
  });
});

// ============================================================================
// Performance Tests
// ============================================================================

describe("Performance", () => {
  it("should count tokens quickly for medium content", () => {
    const content = "function test() { return 1; }".repeat(100);

    const start = performance.now();
    countTokens(content, "gpt-4o");
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(100); // Should complete in under 100ms
  });

  it("should count tokens for large content within reasonable time", () => {
    const content = "x".repeat(100000);

    const start = performance.now();
    countTokens(content, "gpt-4o");
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(5000); // Should complete in under 5 seconds
  });
});
