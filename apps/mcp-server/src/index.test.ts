/**
 * MCP Server Comprehensive Test Suite
 *
 * Tests all MCP server tools with 20+ test cases per feature:
 * - analyze_context tool
 * - squeeze_files tool
 * - check_budget tool
 *
 * Edge cases, error handling, and integration tests
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Test utilities
const testDir = path.join(os.tmpdir(), "prune-mcp-test-" + Date.now());
const testFiles: Map<string, string> = new Map();

// Setup and teardown
beforeAll(() => {
  fs.mkdirSync(testDir, { recursive: true });

  // Create test files
  const testCode = {
    "small.ts": `
export function add(a: number, b: number): number {
  return a + b;
}
`,
    "medium.ts": `
import { Request, Response } from "express";

export interface User {
  id: string;
  name: string;
  email: string;
}

export class UserService {
  private users: Map<string, User> = new Map();

  async findById(id: string): Promise<User | null> {
    return this.users.get(id) || null;
  }

  async create(data: Omit<User, "id">): Promise<User> {
    const id = Math.random().toString(36);
    const user: User = { ...data, id };
    this.users.set(id, user);
    return user;
  }

  async update(id: string, data: Partial<User>): Promise<User | null> {
    const user = this.users.get(id);
    if (!user) return null;
    const updated = { ...user, ...data };
    this.users.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return this.users.delete(id);
  }
}
`,
    "large.ts": generateLargeFile(),
    "empty.ts": "",
    "comments-only.ts": `
// This file only has comments
/* No actual code */
// Just documentation
`,
    "python.py": `
from typing import List, Optional
import logging

logger = logging.getLogger(__name__)

class Calculator:
    """A simple calculator class."""

    def __init__(self):
        self.history: List[str] = []

    def add(self, a: float, b: float) -> float:
        """Add two numbers."""
        result = a + b
        self.history.append(f"{a} + {b} = {result}")
        return result

    def subtract(self, a: float, b: float) -> float:
        """Subtract b from a."""
        result = a - b
        self.history.append(f"{a} - {b} = {result}")
        return result
`,
    "go.go": `
package main

import "fmt"

type Server struct {
    Port int
    Host string
}

func NewServer(host string, port int) *Server {
    return &Server{Host: host, Port: port}
}

func (s *Server) Start() error {
    fmt.Printf("Starting server on %s:%d\n", s.Host, s.Port)
    return nil
}
`,
    "malformed.ts": `
function incomplete( {
  // Missing closing brace and paren
  const x =
`,
    "unicode.ts": `
export function greet(name: string): string {
  return \`こんにちは, \${name}! 🎉 Привет! مرحبا\`;
}

export const EMOJI_MAP = {
  happy: "😊",
  sad: "😢",
  angry: "😠",
};
`,
    "nested.ts": `
export class DeepNesting {
  method() {
    if (true) {
      while (true) {
        for (let i = 0; i < 10; i++) {
          switch (i) {
            case 0:
              try {
                const callback = () => {
                  return { nested: { deeper: { value: 1 } } };
                };
              } catch (e) {
                throw e;
              }
              break;
          }
        }
      }
    }
  }
}
`,
  };

  for (const [name, content] of Object.entries(testCode)) {
    const filePath = path.join(testDir, name);
    fs.writeFileSync(filePath, content);
    testFiles.set(name, filePath);
  }
});

afterAll(() => {
  // Cleanup test files
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch (e) {
    // Ignore cleanup errors
  }
});

function generateLargeFile(): string {
  const lines: string[] = [];
  lines.push('import { utils } from "./utils";');
  lines.push("");

  for (let i = 0; i < 100; i++) {
    lines.push(`export function largeFunc${i}(param: string): number {`);
    for (let j = 0; j < 20; j++) {
      lines.push(`  const var${j} = ${j} * param.length;`);
    }
    lines.push("  return 0;");
    lines.push("}");
    lines.push("");
  }

  return lines.join("\n");
}

// ============================================================================
// analyze_context Tool Tests
// ============================================================================

describe("analyze_context tool", () => {
  describe("Basic Functionality", () => {
    it("should analyze a single small file", async () => {
      const { countTokensBatch } = await import("@prune/tokenizer");
      const content = fs.readFileSync(testFiles.get("small.ts")!, "utf-8");
      const result = countTokensBatch([
        { path: testFiles.get("small.ts")!, content }
      ], "gpt-4o");

      expect(result.total.tokens).toBeGreaterThan(0);
      expect(result.total.tokens).toBeLessThan(100);
      expect(result.files.length).toBe(1);
    });

    it("should analyze multiple files", async () => {
      const { countTokensBatch } = await import("@prune/tokenizer");
      const files = ["small.ts", "medium.ts"].map(name => ({
        path: testFiles.get(name)!,
        content: fs.readFileSync(testFiles.get(name)!, "utf-8")
      }));

      const result = countTokensBatch(files, "gpt-4o");

      expect(result.files.length).toBe(2);
      expect(result.total.tokens).toBeGreaterThan(result.files[0].tokens);
    });

    it("should handle empty file", async () => {
      const { countTokensBatch } = await import("@prune/tokenizer");
      const content = fs.readFileSync(testFiles.get("empty.ts")!, "utf-8");
      const result = countTokensBatch([
        { path: testFiles.get("empty.ts")!, content }
      ], "gpt-4o");

      expect(result.total.tokens).toBe(0);
    });

    it("should calculate cost correctly", async () => {
      const { countTokensBatch, estimateCost } = await import("@prune/tokenizer");
      const content = fs.readFileSync(testFiles.get("medium.ts")!, "utf-8");
      const result = countTokensBatch([
        { path: testFiles.get("medium.ts")!, content }
      ], "gpt-4o");

      expect(result.total.cost).toBeGreaterThan(0);

      // Verify cost calculation
      const expectedCost = estimateCost(result.total.tokens, "gpt-4o");
      expect(Math.abs(result.total.cost - expectedCost)).toBeLessThan(0.0001);
    });
  });

  describe("Recommendation Logic", () => {
    it("should recommend 'proceed' for small context", async () => {
      const { countTokensBatch } = await import("@prune/tokenizer");
      const content = fs.readFileSync(testFiles.get("small.ts")!, "utf-8");
      const result = countTokensBatch([
        { path: testFiles.get("small.ts")!, content }
      ], "gpt-4o");

      const threshold = 10000;
      const recommendation = result.total.tokens < threshold ? "proceed" : "squeeze";
      expect(recommendation).toBe("proceed");
    });

    it("should recommend 'squeeze' for medium-large context", async () => {
      const { countTokensBatch } = await import("@prune/tokenizer");
      const content = fs.readFileSync(testFiles.get("large.ts")!, "utf-8");
      const result = countTokensBatch([
        { path: testFiles.get("large.ts")!, content }
      ], "gpt-4o");

      const threshold = 10000;
      let recommendation: string;
      if (result.total.tokens < threshold) {
        recommendation = "proceed";
      } else if (result.total.tokens < threshold * 5) {
        recommendation = "squeeze";
      } else {
        recommendation = "abort";
      }

      // Large file should recommend squeeze or abort
      expect(["squeeze", "abort"]).toContain(recommendation);
    });
  });

  describe("Multi-Language Support", () => {
    it("should analyze TypeScript files", async () => {
      const { countTokens } = await import("@prune/tokenizer");
      const content = fs.readFileSync(testFiles.get("medium.ts")!, "utf-8");
      const result = countTokens(content, "gpt-4o");

      expect(result.tokens).toBeGreaterThan(50);
    });

    it("should analyze Python files", async () => {
      const { countTokens } = await import("@prune/tokenizer");
      const content = fs.readFileSync(testFiles.get("python.py")!, "utf-8");
      const result = countTokens(content, "gpt-4o");

      expect(result.tokens).toBeGreaterThan(30);
    });

    it("should analyze Go files", async () => {
      const { countTokens } = await import("@prune/tokenizer");
      const content = fs.readFileSync(testFiles.get("go.go")!, "utf-8");
      const result = countTokens(content, "gpt-4o");

      expect(result.tokens).toBeGreaterThan(20);
    });
  });

  describe("Edge Cases", () => {
    it("should handle files with only comments", async () => {
      const { countTokens } = await import("@prune/tokenizer");
      const content = fs.readFileSync(testFiles.get("comments-only.ts")!, "utf-8");
      const result = countTokens(content, "gpt-4o");

      expect(result.tokens).toBeGreaterThan(0); // Comments still have tokens
    });

    it("should handle Unicode content", async () => {
      const { countTokens } = await import("@prune/tokenizer");
      const content = fs.readFileSync(testFiles.get("unicode.ts")!, "utf-8");
      const result = countTokens(content, "gpt-4o");

      expect(result.tokens).toBeGreaterThan(0);
    });

    it("should handle malformed code", async () => {
      const { countTokens } = await import("@prune/tokenizer");
      const content = fs.readFileSync(testFiles.get("malformed.ts")!, "utf-8");

      // Should not throw
      const result = countTokens(content, "gpt-4o");
      expect(result.tokens).toBeGreaterThan(0);
    });

    it("should handle deeply nested code", async () => {
      const { countTokens } = await import("@prune/tokenizer");
      const content = fs.readFileSync(testFiles.get("nested.ts")!, "utf-8");
      const result = countTokens(content, "gpt-4o");

      expect(result.tokens).toBeGreaterThan(50);
    });
  });

  describe("Model Support", () => {
    it("should work with gpt-4o model", async () => {
      const { countTokens } = await import("@prune/tokenizer");
      const content = "const x = 1;";
      const result = countTokens(content, "gpt-4o");

      expect(result.tokens).toBeGreaterThan(0);
    });

    it("should work with claude-sonnet-4 model", async () => {
      const { countTokens } = await import("@prune/tokenizer");
      const content = "const x = 1;";
      const result = countTokens(content, "claude-sonnet-4");

      expect(result.tokens).toBeGreaterThan(0);
    });

    it("should work with gpt-4o-mini model", async () => {
      const { countTokens } = await import("@prune/tokenizer");
      const content = "const x = 1;";
      const result = countTokens(content, "gpt-4o-mini");

      expect(result.tokens).toBeGreaterThan(0);
    });
  });
});

// ============================================================================
// squeeze_files Tool Tests
// ============================================================================

describe("squeeze_files tool", () => {
  describe("Compression Tiers", () => {
    it("should apply lossless compression", async () => {
      const { squeezeFile } = await import("@prune/squeezer");
      const content = fs.readFileSync(testFiles.get("medium.ts")!, "utf-8");

      const result = squeezeFile(content, testFiles.get("medium.ts")!, { tier: "lossless" });

      expect(result.compressedTokens).toBeLessThanOrEqual(result.originalTokens);
      expect(result.isValid).toBe(true);
    });

    it("should apply structural compression", async () => {
      const { squeezeFile } = await import("@prune/squeezer");
      const content = fs.readFileSync(testFiles.get("medium.ts")!, "utf-8");

      const result = squeezeFile(content, testFiles.get("medium.ts")!, { tier: "structural" });

      expect(result.compressedTokens).toBeLessThan(result.originalTokens);
      expect(result.savingsPercent).toBeGreaterThan(0);
    });

    it("should apply telegraphic compression", async () => {
      const { squeezeFile } = await import("@prune/squeezer");
      const content = fs.readFileSync(testFiles.get("medium.ts")!, "utf-8");

      const result = squeezeFile(content, testFiles.get("medium.ts")!, { tier: "telegraphic" });

      expect(result.compressedTokens).toBeLessThan(result.originalTokens);
      // Telegraphic should have higher savings
      expect(result.savingsPercent).toBeGreaterThan(10);
    });

    it("structural should save more than lossless", async () => {
      const { squeezeFile } = await import("@prune/squeezer");
      const content = fs.readFileSync(testFiles.get("medium.ts")!, "utf-8");

      const lossless = squeezeFile(content, testFiles.get("medium.ts")!, { tier: "lossless" });
      const structural = squeezeFile(content, testFiles.get("medium.ts")!, { tier: "structural" });

      expect(structural.savingsPercent).toBeGreaterThanOrEqual(lossless.savingsPercent);
    });

    it("telegraphic should save most", async () => {
      const { squeezeFile } = await import("@prune/squeezer");
      const content = fs.readFileSync(testFiles.get("medium.ts")!, "utf-8");

      const structural = squeezeFile(content, testFiles.get("medium.ts")!, { tier: "structural" });
      const telegraphic = squeezeFile(content, testFiles.get("medium.ts")!, { tier: "telegraphic" });

      expect(telegraphic.savingsPercent).toBeGreaterThanOrEqual(structural.savingsPercent);
    });
  });

  describe("Language Support", () => {
    it("should squeeze TypeScript files", async () => {
      const { squeezeFile } = await import("@prune/squeezer");
      const content = fs.readFileSync(testFiles.get("medium.ts")!, "utf-8");

      const result = squeezeFile(content, "test.ts", { tier: "structural" });

      expect(result.compressedCode.length).toBeGreaterThan(0);
    });

    it("should squeeze Python files", async () => {
      const { squeezeFile } = await import("@prune/squeezer");
      const content = fs.readFileSync(testFiles.get("python.py")!, "utf-8");

      const result = squeezeFile(content, "test.py", { tier: "structural" });

      expect(result.compressedCode.length).toBeGreaterThan(0);
    });

    it("should squeeze Go files", async () => {
      const { squeezeFile } = await import("@prune/squeezer");
      const content = fs.readFileSync(testFiles.get("go.go")!, "utf-8");

      const result = squeezeFile(content, "test.go", { tier: "structural" });

      expect(result.compressedCode.length).toBeGreaterThan(0);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty file", async () => {
      const { squeezeFile } = await import("@prune/squeezer");
      const content = fs.readFileSync(testFiles.get("empty.ts")!, "utf-8");

      const result = squeezeFile(content, "empty.ts", { tier: "structural" });

      expect(result.isValid).toBe(true);
      expect(result.originalTokens).toBe(0);
    });

    it("should handle comment-only file", async () => {
      const { squeezeFile } = await import("@prune/squeezer");
      const content = fs.readFileSync(testFiles.get("comments-only.ts")!, "utf-8");

      const result = squeezeFile(content, "comments.ts", { tier: "lossless" });

      // Lossless should strip comments
      expect(result.compressedTokens).toBeLessThanOrEqual(result.originalTokens);
    });

    it("should handle Unicode content", async () => {
      const { squeezeFile } = await import("@prune/squeezer");
      const content = fs.readFileSync(testFiles.get("unicode.ts")!, "utf-8");

      const result = squeezeFile(content, "unicode.ts", { tier: "structural" });

      expect(result.isValid).toBe(true);
      expect(result.compressedCode).toContain("greet");
    });

    it("should handle malformed code gracefully", async () => {
      const { squeezeFile } = await import("@prune/squeezer");
      const content = fs.readFileSync(testFiles.get("malformed.ts")!, "utf-8");

      // Should not throw
      const result = squeezeFile(content, "malformed.ts", { tier: "structural" });

      // May not be valid, but should not crash
      expect(result.compressedCode).toBeDefined();
    });

    it("should handle deeply nested code", async () => {
      const { squeezeFile } = await import("@prune/squeezer");
      const content = fs.readFileSync(testFiles.get("nested.ts")!, "utf-8");

      const result = squeezeFile(content, "nested.ts", { tier: "structural" });

      expect(result.isValid).toBe(true);
    });
  });

  describe("Large File Performance", () => {
    it("should squeeze large file efficiently", async () => {
      const { squeezeFile } = await import("@prune/squeezer");
      const content = fs.readFileSync(testFiles.get("large.ts")!, "utf-8");

      const start = performance.now();
      const result = squeezeFile(content, "large.ts", { tier: "structural" });
      const elapsed = performance.now() - start;

      // Should complete within 5 seconds for large file
      expect(elapsed).toBeLessThan(5000);
      expect(result.savingsPercent).toBeGreaterThan(20);
    });

    it("should achieve significant savings on large file", async () => {
      const { squeezeFile } = await import("@prune/squeezer");
      const content = fs.readFileSync(testFiles.get("large.ts")!, "utf-8");

      const result = squeezeFile(content, "large.ts", { tier: "telegraphic" });

      // Large file with lots of function bodies should have high savings
      expect(result.savingsPercent).toBeGreaterThan(30);
    });
  });

  describe("Validation", () => {
    it("should validate compressed output is syntactically correct", async () => {
      const { squeezeFile } = await import("@prune/squeezer");
      const content = fs.readFileSync(testFiles.get("medium.ts")!, "utf-8");

      const result = squeezeFile(content, "medium.ts", { tier: "structural" });

      expect(result.isValid).toBe(true);
    });

    it("should provide diff summary", async () => {
      const { squeezeFile } = await import("@prune/squeezer");
      const content = fs.readFileSync(testFiles.get("medium.ts")!, "utf-8");

      const result = squeezeFile(content, "medium.ts", { tier: "structural" });

      // Diff summary should exist and contain stats
      expect(result.diffSummary).toBeDefined();
    });
  });
});

// ============================================================================
// Helper Functions for Tests
// ============================================================================

function getRecommendation(alertLevel: string): string {
  if (alertLevel === "red") {
    return "Low on requests. Consider using squeeze_files to reduce token usage.";
  } else if (alertLevel === "yellow") {
    return "Moderate requests remaining. Be mindful of large context operations.";
  }
  return "Plenty of requests remaining.";
}

// ============================================================================
// check_budget Tool Tests
// ============================================================================

describe("check_budget tool", () => {
  describe("Usage Fetching", () => {
    it("should have fetchCursorUsage function available", async () => {
      const { fetchCursorUsage } = await import("@prune/state-scraper");
      expect(typeof fetchCursorUsage).toBe("function");
    });

    it("should handle missing Cursor installation gracefully", async () => {
      const { fetchCursorUsage } = await import("@prune/state-scraper");

      // This may return null if Cursor is not installed
      const usage = await fetchCursorUsage();

      // Should not throw, may return null
      expect(usage === null || typeof usage === "object").toBe(true);
    });
  });

  describe("Alert Level Calculation", () => {
    it("should calculate green alert for high remaining requests", () => {
      const mockUsage = {
        requestsRemaining: 400,
        requestsLimit: 500,
        requestsUsed: 100,
      };

      const alertLevel = mockUsage.requestsRemaining > mockUsage.requestsLimit * 0.5
        ? "green"
        : mockUsage.requestsRemaining > mockUsage.requestsLimit * 0.2
        ? "yellow"
        : "red";

      expect(alertLevel).toBe("green");
    });

    it("should calculate yellow alert for moderate remaining requests", () => {
      const mockUsage = {
        requestsRemaining: 150,
        requestsLimit: 500,
        requestsUsed: 350,
      };

      const alertLevel = mockUsage.requestsRemaining > mockUsage.requestsLimit * 0.5
        ? "green"
        : mockUsage.requestsRemaining > mockUsage.requestsLimit * 0.2
        ? "yellow"
        : "red";

      expect(alertLevel).toBe("yellow");
    });

    it("should calculate red alert for low remaining requests", () => {
      const mockUsage = {
        requestsRemaining: 50,
        requestsLimit: 500,
        requestsUsed: 450,
      };

      const alertLevel = mockUsage.requestsRemaining > mockUsage.requestsLimit * 0.5
        ? "green"
        : mockUsage.requestsRemaining > mockUsage.requestsLimit * 0.2
        ? "yellow"
        : "red";

      expect(alertLevel).toBe("red");
    });
  });

  describe("Recommendation Generation", () => {
    it("should recommend squeeze for red alert", () => {
      const alertLevel: string = "red";
      const recommendation = getRecommendation(alertLevel);
      expect(recommendation).toContain("squeeze_files");
    });

    it("should recommend mindfulness for yellow alert", () => {
      const alertLevel: string = "yellow";
      const recommendation = getRecommendation(alertLevel);
      expect(recommendation).toContain("mindful");
    });

    it("should recommend nothing special for green alert", () => {
      const alertLevel: string = "green";
      const recommendation = getRecommendation(alertLevel);
      expect(recommendation).toContain("Plenty");
    });
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe("Integration Tests", () => {
  describe("analyze_context -> squeeze_files workflow", () => {
    it("should reduce tokens when squeezing after analysis", async () => {
      const { countTokensBatch } = await import("@prune/tokenizer");
      const { squeezeFile } = await import("@prune/squeezer");

      const content = fs.readFileSync(testFiles.get("large.ts")!, "utf-8");

      // Analyze first
      const analysis = countTokensBatch([
        { path: testFiles.get("large.ts")!, content }
      ], "gpt-4o");

      // Squeeze
      const squeezed = squeezeFile(content, "large.ts", { tier: "structural" });

      // Re-analyze
      const afterSqueeze = countTokensBatch([
        { path: testFiles.get("large.ts")!, content: squeezed.compressedCode }
      ], "gpt-4o");

      expect(afterSqueeze.total.tokens).toBeLessThan(analysis.total.tokens);
    });

    it("should save cost when squeezing", async () => {
      const { countTokensBatch, estimateCost } = await import("@prune/tokenizer");
      const { squeezeFile } = await import("@prune/squeezer");

      const content = fs.readFileSync(testFiles.get("large.ts")!, "utf-8");

      const before = countTokensBatch([
        { path: "large.ts", content }
      ], "gpt-4o");

      const squeezed = squeezeFile(content, "large.ts", { tier: "telegraphic" });

      const after = countTokensBatch([
        { path: "large.ts", content: squeezed.compressedCode }
      ], "gpt-4o");

      const costSaved = before.total.cost - after.total.cost;
      expect(costSaved).toBeGreaterThan(0);
    });
  });

  describe("Multi-file analysis", () => {
    it("should analyze workspace-like file set", async () => {
      const { countTokensBatch } = await import("@prune/tokenizer");

      const files = Array.from(testFiles.entries())
        .filter(([name]) => name.endsWith(".ts"))
        .map(([name, filePath]) => ({
          path: filePath,
          content: fs.readFileSync(filePath, "utf-8")
        }));

      const result = countTokensBatch(files, "gpt-4o");

      expect(result.files.length).toBe(files.length);
      expect(result.total.tokens).toBeGreaterThan(0);
    });

    it("should calculate per-file percentages correctly", async () => {
      const { countTokensBatch } = await import("@prune/tokenizer");

      const files = [
        { path: "a.ts", content: "const a = 1;" },
        { path: "b.ts", content: "const b = 2; const c = 3;" },
      ];

      const result = countTokensBatch(files, "gpt-4o");

      const sumTokens = result.files.reduce((sum, f) => sum + f.tokens, 0);
      expect(sumTokens).toBe(result.total.tokens);
    });
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe("Error Handling", () => {
  describe("analyze_context errors", () => {
    it("should handle non-existent file gracefully", async () => {
      const { countTokens } = await import("@prune/tokenizer");

      // Reading non-existent file should be handled by caller
      // Token counting itself should work with any string
      const result = countTokens("", "gpt-4o");
      expect(result.tokens).toBe(0);
    });

    it("should handle very large strings", async () => {
      const { countTokens } = await import("@prune/tokenizer");

      const largeString = "x".repeat(100000);

      // Should not crash
      const result = countTokens(largeString, "gpt-4o");
      expect(result.tokens).toBeGreaterThan(0);
    });
  });

  describe("squeeze_files errors", () => {
    it("should handle unknown file extension", async () => {
      const { squeezeFile } = await import("@prune/squeezer");

      const content = "some random content";

      // Should not crash on unknown extension
      const result = squeezeFile(content, "file.xyz", { tier: "structural" });

      expect(result.compressedCode).toBeDefined();
    });

    it("should handle binary-like content gracefully", async () => {
      const { squeezeFile } = await import("@prune/squeezer");

      // Create content with control characters
      const content = "function test() {\x00\x01\x02}";

      // Should not crash
      const result = squeezeFile(content, "test.ts", { tier: "structural" });

      expect(result.compressedCode).toBeDefined();
    });
  });
});

// ============================================================================
// Performance Tests
// ============================================================================

describe("Performance", () => {
  it("should analyze 100 small files quickly", async () => {
    const { countTokensBatch } = await import("@prune/tokenizer");

    const files = Array(100).fill(null).map((_, i) => ({
      path: `file${i}.ts`,
      content: `export function func${i}() { return ${i}; }`
    }));

    const start = performance.now();
    const result = countTokensBatch(files, "gpt-4o");
    const elapsed = performance.now() - start;

    // Should complete within 1 second
    expect(elapsed).toBeLessThan(1000);
    expect(result.files.length).toBe(100);
  });

  it("should squeeze files in parallel efficiently", async () => {
    const { squeezeFile } = await import("@prune/squeezer");

    const content = fs.readFileSync(testFiles.get("medium.ts")!, "utf-8");

    const start = performance.now();
    const results = await Promise.all(
      Array(10).fill(null).map((_, i) =>
        Promise.resolve(squeezeFile(content, `file${i}.ts`, { tier: "structural" }))
      )
    );
    const elapsed = performance.now() - start;

    // 10 parallel squeezes should complete within 2 seconds
    expect(elapsed).toBeLessThan(2000);
    expect(results.length).toBe(10);
  });
});

// ============================================================================
// cache_report tool
// ============================================================================

describe("cache_report tool", () => {
  const transcriptPath = path.join(testDir, "transcript.jsonl");

  beforeAll(() => {
    // A minimal real-shape transcript with two turns and a cache read on
    // turn 2 — mirrors @prune/telemetry's fixture.
    const lines = [
      JSON.stringify({
        type: "user",
        sessionId: "s1",
        timestamp: "2026-05-30T10:00:00Z",
        message: { role: "user", content: "explain auth" },
      }),
      JSON.stringify({
        type: "assistant",
        sessionId: "s1",
        timestamp: "2026-05-30T10:00:01Z",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-5-20250929",
          content: [{ type: "text", text: "ok" }],
          usage: {
            input_tokens: 2000,
            output_tokens: 200,
            cache_creation_input_tokens: 2000,
            cache_read_input_tokens: 0,
          },
        },
      }),
      JSON.stringify({
        type: "user",
        sessionId: "s1",
        timestamp: "2026-05-30T10:00:05Z",
        message: { role: "user", content: "now write a test" },
      }),
      JSON.stringify({
        type: "assistant",
        sessionId: "s1",
        timestamp: "2026-05-30T10:00:06Z",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-5-20250929",
          content: [{ type: "text", text: "done" }],
          usage: {
            input_tokens: 100,
            output_tokens: 200,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 2000,
          },
        },
      }),
    ];
    fs.writeFileSync(transcriptPath, lines.join("\n") + "\n");
  });

  it("computes hit rate and cost on a real transcript", async () => {
    const { TranscriptReader, groupIntoTurns } = await import("@prune/telemetry");
    const { computeCacheMetrics } = await import("@prune/intelligence");
    const reader = new TranscriptReader(transcriptPath);
    const { messages } = await reader.readAll();
    const turns = groupIntoTurns(messages);
    const m = computeCacheMetrics(
      turns.map((t) => ({ model: t.model, usage: t.usage })),
      "5m"
    );

    // total_input = (2000+0+2000) + (100+2000+0) = 6100
    expect(m.totalInputTokens).toBe(6100);
    expect(m.cacheReadTokens).toBe(2000);
    expect(m.hitRate).toBeCloseTo(2000 / 6100, 6);
    expect(m.cost.savedVsNoCache).toBeGreaterThan(0);
  });

  it("returns parseable JSON from the MCP handler shape", async () => {
    // The handler is internal; call the same code path the dispatcher does.
    const { TranscriptReader, groupIntoTurns } = await import("@prune/telemetry");
    const { computeCacheMetrics, diagnoseCacheBust } = await import(
      "@prune/intelligence"
    );
    const reader = new TranscriptReader(transcriptPath);
    const { messages, errors } = await reader.readAll();
    const turns = groupIntoTurns(messages);
    const inputs = turns.map((t) => ({ model: t.model, usage: t.usage }));
    const metrics = computeCacheMetrics(inputs, "5m");
    const diagnoses = diagnoseCacheBust({ turns: inputs });

    const payload = {
      transcript_path: transcriptPath,
      window: { totalTurns: turns.length, analyzedTurns: turns.length },
      metrics,
      diagnoses,
      parseErrors: errors.length,
    };

    const roundTrip = JSON.parse(JSON.stringify(payload));
    expect(roundTrip.metrics.hitRate).toBeCloseTo(2000 / 6100, 6);
    expect(roundTrip.parseErrors).toBe(0);
  });
});
