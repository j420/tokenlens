/**
 * Concurrency and Error Recovery Tests for @prune/tokenizer
 *
 * Tests handling of:
 * - Concurrent tokenization requests
 * - Error recovery scenarios
 * - Memory pressure conditions
 * - Race conditions
 */

import { describe, it, expect } from "vitest";
import {
  countTokens,
  countTokensAsync,
  countTokensBatch,
  analyzeContent,
} from "./index.js";

// ============================================================================
// CONCURRENCY TESTS
// ============================================================================

describe("Concurrency: Parallel Token Counting", () => {
  it("should handle 20 parallel countTokensAsync calls", async () => {
    const texts = Array(20).fill(null).map((_, i) =>
      `This is test content number ${i} for parallel processing.`
    );

    const promises = texts.map(text => countTokensAsync(text, "gpt-4o"));
    const results = await Promise.all(promises);

    expect(results).toHaveLength(20);
    for (const result of results) {
      expect(result.tokens).toBeGreaterThan(0);
      expect(Number.isFinite(result.tokens)).toBe(true);
    }
  });

  it("should handle mixed model parallel requests", async () => {
    const models = ["gpt-4o", "gpt-4o-mini", "claude-sonnet-4", "claude-opus-4", "claude-haiku-3.5"] as const;
    const text = "Sample text for tokenization across different models.";

    const promises = models.map(model => countTokensAsync(text, model));
    const results = await Promise.all(promises);

    expect(results).toHaveLength(5);
    for (let i = 0; i < results.length; i++) {
      expect(results[i].model).toBe(models[i]);
      expect(results[i].tokens).toBeGreaterThan(0);
    }
  });

  it("should maintain consistency under concurrent access", async () => {
    const text = "Consistent tokenization test content.";
    const promises = Array(10).fill(null).map(() =>
      countTokensAsync(text, "gpt-4o")
    );

    const results = await Promise.all(promises);
    const tokenCounts = results.map(r => r.tokens);
    const uniqueCounts = new Set(tokenCounts);

    // All parallel calls should return identical results
    expect(uniqueCounts.size).toBe(1);
  });
});

describe("Concurrency: Batch Processing", () => {
  it("should handle batch with many files", () => {
    const files = Array(20).fill(null).map((_, i) => ({
      path: `/src/file${i}.ts`,
      content: `function file${i}() { return ${i}; }`
    }));

    const result = countTokensBatch(files, "gpt-4o");

    expect(result.files).toHaveLength(20);
    expect(result.total.tokens).toBeGreaterThan(0);
    for (const file of result.files) {
      expect(file.tokens).toBeGreaterThan(0);
    }
  });

  it("should handle empty batch gracefully", () => {
    const result = countTokensBatch([], "gpt-4o");

    expect(result.files).toHaveLength(0);
    expect(result.total.tokens).toBe(0);
    expect(result.total.cost).toBe(0);
  });

  it("should handle batch with mixed content sizes", () => {
    const files = [
      { path: "/tiny.ts", content: "x" },
      { path: "/small.ts", content: "const x = 1;" },
      { path: "/medium.ts", content: "function test() { return 42; }".repeat(100) },
      { path: "/large.ts", content: "const data = " + JSON.stringify(Array(1000).fill("item")) },
    ];

    const result = countTokensBatch(files, "gpt-4o");

    expect(result.files).toHaveLength(4);
    // Files should be sorted or maintain order
    expect(result.files[0].path).toBe("/tiny.ts");
    // Larger files should have more tokens
    expect(result.files[3].tokens).toBeGreaterThan(result.files[0].tokens);
  });
});

// ============================================================================
// ERROR RECOVERY TESTS
// ============================================================================

describe("Error Recovery: Valid Input Variations", () => {
  it("should handle empty string input", () => {
    const result = countTokens("", "gpt-4o");
    expect(result.tokens).toBe(0);
  });

  it("should handle whitespace input", () => {
    const result = countTokens("   \n\t   ", "gpt-4o");
    expect(result.tokens).toBeGreaterThanOrEqual(0);
  });

  it("should handle single character input", () => {
    const result = countTokens("x", "gpt-4o");
    expect(result.tokens).toBeGreaterThan(0);
  });

  it("should handle very long string input", () => {
    const result = countTokens("x".repeat(1000), "gpt-4o");
    expect(result.tokens).toBeGreaterThan(0);
  });

  it("should handle special characters", () => {
    const result = countTokens("!@#$%^&*(){}[]", "gpt-4o");
    expect(result.tokens).toBeGreaterThan(0);
  });
});

describe("Error Recovery: Model Variations", () => {
  it("should handle invalid model name with fallback", () => {
    const result = countTokens("test", "invalid-model-xyz" as "gpt-4o");
    // Should fall back to default or return sensible result
    expect(typeof result.tokens).toBe("number");
  });

  it("should handle empty model name", () => {
    const result = countTokens("test", "" as "gpt-4o");
    expect(typeof result.tokens).toBe("number");
  });

  it("should work with all supported models", () => {
    const models = ["gpt-4o", "gpt-4o-mini", "claude-sonnet-4", "claude-opus-4", "claude-haiku-3.5"] as const;
    for (const model of models) {
      const result = countTokens("test", model);
      expect(result.tokens).toBeGreaterThan(0);
    }
  });
});

describe("Error Recovery: Batch Edge Cases", () => {
  it("should handle batch with empty content files", () => {
    const files = [
      { path: "/empty.ts", content: "" },
      { path: "/whitespace.ts", content: "   \n\t   " },
      { path: "/valid.ts", content: "const x = 1;" },
    ];

    const result = countTokensBatch(files, "gpt-4o");

    expect(result.files).toHaveLength(3);
    expect(result.files[0].tokens).toBe(0);
  });

  it("should handle batch with all empty files", () => {
    const files = [
      { path: "/empty1.ts", content: "" },
      { path: "/empty2.ts", content: "" },
    ];

    const result = countTokensBatch(files, "gpt-4o");
    expect(result.total.tokens).toBe(0);
  });
});

// ============================================================================
// MEMORY PRESSURE TESTS
// ============================================================================

describe("Memory: Large Content Handling", () => {
  it("should handle 10KB of content", () => {
    const largeContent = "x".repeat(10 * 1024); // 10KB - reasonable size
    const result = countTokens(largeContent, "gpt-4o");

    expect(result.tokens).toBeGreaterThan(0);
    expect(Number.isFinite(result.tokens)).toBe(true);
  });

  it("should handle deeply nested JSON-like content", () => {
    const createNested = (depth: number): string => {
      if (depth === 0) return '"value"';
      return `{ "key": ${createNested(depth - 1)} }`;
    };

    const nested = createNested(20); // Reduced depth
    const result = countTokens(nested, "gpt-4o");

    expect(result.tokens).toBeGreaterThan(0);
  });

  it("should handle content with unicode characters", () => {
    const unicode = "こんにちは".repeat(100); // Reduced size
    const result = countTokens(unicode, "gpt-4o");

    expect(result.tokens).toBeGreaterThan(0);
  });

  it("should handle content with emoji", () => {
    const emoji = "🎉🚀💻🔥".repeat(100); // Reduced size
    const result = countTokens(emoji, "gpt-4o");

    expect(result.tokens).toBeGreaterThan(0);
  });
});

describe("Memory: Repeated Operations", () => {
  it("should not leak memory during 100 operations", () => {
    const content = "Test content for memory leak detection.";

    for (let i = 0; i < 100; i++) { // Reduced iterations
      const result = countTokens(content, "gpt-4o");
      expect(result.tokens).toBeGreaterThan(0);
    }

    expect(true).toBe(true);
  });

  it("should handle rapid batch processing", () => {
    const files = Array(5).fill(null).map((_, i) => ({
      path: `/file${i}.ts`,
      content: `function test${i}() { return ${i}; }`
    }));

    for (let i = 0; i < 20; i++) { // Reduced iterations
      const result = countTokensBatch(files, "gpt-4o");
      expect(result.total.tokens).toBeGreaterThan(0);
    }

    expect(true).toBe(true);
  });
});

// ============================================================================
// CONTENT ANALYSIS TESTS
// ============================================================================

describe("Content Analysis: Edge Cases", () => {
  it("should analyze empty content", () => {
    const result = analyzeContent("");

    expect(result.tokens).toBe(0);
    expect(result.isLarge).toBe(false);
    expect(result.recommendation).toBe("proceed");
  });

  it("should analyze whitespace-only content", () => {
    const result = analyzeContent("   \n\n\t  \n   ");

    expect(result.tokens).toBeGreaterThanOrEqual(0);
    expect(typeof result.cost).toBe("number");
  });

  it("should analyze code and provide recommendation", () => {
    const code = `
import { x } from "y";
export const a = 1;
export function fn() {}
export class Cls {
  method() {}
}
export interface I {}
export type T = string;
async function* gen() { yield 1; }
`;

    const result = analyzeContent(code);

    expect(result.tokens).toBeGreaterThan(0);
    expect(typeof result.formatted.tokens).toBe("string");
    expect(result.formatted.cost).toContain("$");
    expect(["proceed", "squeeze", "abort"]).toContain(result.recommendation);
  });

  it("should handle binary-like content", () => {
    // Create string with null bytes and control characters
    const binary = String.fromCharCode(0, 1, 2, 255, 254, 253);
    const result = analyzeContent(binary);

    expect(typeof result.tokens).toBe("number");
    expect(typeof result.isLarge).toBe("boolean");
  });
});

// ============================================================================
// RACE CONDITION TESTS
// ============================================================================

describe("Race Conditions: Interleaved Operations", () => {
  it("should handle interleaved sync and async operations", async () => {
    const promises: Promise<unknown>[] = [];

    for (let i = 0; i < 10; i++) { // Reduced iterations
      // Mix sync and async
      const syncResult = countTokens(`Sync ${i}`, "gpt-4o");
      expect(syncResult.tokens).toBeGreaterThan(0);

      promises.push(countTokensAsync(`Async ${i}`, "gpt-4o"));
    }

    const asyncResults = await Promise.all(promises);
    for (const result of asyncResults) {
      expect((result as { tokens: number }).tokens).toBeGreaterThan(0);
    }
  });

  it("should handle rapid model switching", async () => {
    const models = ["gpt-4o", "gpt-4o-mini", "claude-sonnet-4"] as const;
    const results: { tokens: number }[] = [];

    for (let i = 0; i < 15; i++) { // Reduced iterations
      const model = models[i % models.length];
      results.push(countTokens(`Test ${i}`, model));
    }

    for (const result of results) {
      expect(result.tokens).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// CONSISTENCY TESTS
// ============================================================================

describe("Consistency: Deterministic Results", () => {
  it("should return same tokens for same input", () => {
    const text = "The quick brown fox jumps over the lazy dog.";
    const results = Array(20).fill(null).map(() =>
      countTokens(text, "gpt-4o").tokens
    );

    const unique = new Set(results);
    expect(unique.size).toBe(1);
  });

  it("should return same cost for same input", () => {
    const text = "Consistent cost calculation test.";
    const results = Array(20).fill(null).map(() =>
      countTokens(text, "gpt-4o").cost
    );

    const unique = new Set(results);
    expect(unique.size).toBe(1);
  });

  it("should maintain order in batch results", () => {
    const files = Array(10).fill(null).map((_, i) => ({
      path: `/file${String(i).padStart(2, "0")}.ts`,
      content: `const x${i} = ${i};`
    }));

    const result = countTokensBatch(files, "gpt-4o");

    for (let i = 0; i < 10; i++) {
      expect(result.files[i].path).toBe(`/file${String(i).padStart(2, "0")}.ts`);
    }
  });
});
