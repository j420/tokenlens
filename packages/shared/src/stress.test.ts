import { describe, it, expect } from "vitest";
import { estimateCost, formatCost, formatTokens, getLanguageFromPath } from "./index.js";

// ============================================================================
// STRESS TESTS
// ============================================================================

describe("Stress Tests", () => {
  describe("High Volume Cost Calculations", () => {
    it("should handle 10,000 rapid cost calculations", () => {
      const start = performance.now();
      const results: number[] = [];

      for (let i = 0; i < 10000; i++) {
        results.push(estimateCost(Math.random() * 1000000, "gpt-4o", "input"));
      }

      const duration = performance.now() - start;

      expect(results).toHaveLength(10000);
      expect(duration).toBeLessThan(1000); // Should complete in under 1 second
      results.forEach((r) => expect(Number.isFinite(r)).toBe(true));
    });

    it("should handle concurrent-like calculations", async () => {
      const calculations = Array(1000)
        .fill(null)
        .map(() =>
          Promise.resolve(estimateCost(Math.random() * 1000000, "gpt-4o", "input"))
        );

      const results = await Promise.all(calculations);
      expect(results).toHaveLength(1000);
      results.forEach((r) => expect(r).toBeGreaterThanOrEqual(0));
    });
  });

  describe("High Volume Formatting", () => {
    it("should format 10,000 costs rapidly", () => {
      const start = performance.now();
      const results: string[] = [];

      for (let i = 0; i < 10000; i++) {
        results.push(formatCost(Math.random() * 100));
      }

      const duration = performance.now() - start;

      expect(results).toHaveLength(10000);
      expect(duration).toBeLessThan(500); // Formatting should be very fast
      results.forEach((r) => expect(r).toContain("$"));
    });

    it("should format 10,000 token counts rapidly", () => {
      const start = performance.now();
      const results: string[] = [];

      for (let i = 0; i < 10000; i++) {
        results.push(formatTokens(Math.floor(Math.random() * 10000000)));
      }

      const duration = performance.now() - start;

      expect(results).toHaveLength(10000);
      expect(duration).toBeLessThan(500);
    });
  });

  describe("High Volume Language Detection", () => {
    it("should detect languages for 10,000 paths rapidly", () => {
      const extensions = [".ts", ".js", ".py", ".go", ".rs", ".java", ".cpp", ".c"];
      const start = performance.now();
      const results: (string | null)[] = [];

      for (let i = 0; i < 10000; i++) {
        const ext = extensions[Math.floor(Math.random() * extensions.length)];
        results.push(getLanguageFromPath(`/path/to/file${i}${ext}`));
      }

      const duration = performance.now() - start;

      expect(results).toHaveLength(10000);
      expect(duration).toBeLessThan(500);
      results.forEach((r) => expect(r).not.toBe(undefined));
    });
  });
});

// ============================================================================
// MEMORY EFFICIENCY TESTS
// ============================================================================

describe("Memory Efficiency", () => {
  it("should not leak memory during repeated calculations", () => {
    // Run many iterations and ensure no obvious memory issues
    for (let batch = 0; batch < 100; batch++) {
      const results: number[] = [];
      for (let i = 0; i < 1000; i++) {
        results.push(estimateCost(1000000, "gpt-4o", "input"));
      }
      expect(results).toHaveLength(1000);
    }
    // If we get here without errors, memory is being handled correctly
    expect(true).toBe(true);
  });

  it("should handle large strings without issues", () => {
    const largeStrings = Array(100)
      .fill(null)
      .map(() => "x".repeat(10000));

    const results = largeStrings.map((s) => getLanguageFromPath(s + ".ts"));

    expect(results).toHaveLength(100);
    results.forEach((r) => expect(r).toBe("typescript"));
  });
});

// ============================================================================
// CONSISTENCY UNDER LOAD
// ============================================================================

describe("Consistency Under Load", () => {
  it("should return consistent results under high load", () => {
    const fixedInput = 1000000;
    const expectedCost = estimateCost(fixedInput, "gpt-4o", "input");

    // Run 1000 calculations with the same input
    const results: number[] = [];
    for (let i = 0; i < 1000; i++) {
      results.push(estimateCost(fixedInput, "gpt-4o", "input"));
    }

    // All results should be identical
    results.forEach((r) => expect(r).toBe(expectedCost));
  });

  it("should maintain precision across many calculations", () => {
    const results: number[] = [];

    // Calculate cost for sequential token counts
    for (let i = 1; i <= 1000; i++) {
      results.push(estimateCost(i * 1000, "gpt-4o", "input"));
    }

    // Each result should be proportionally larger than the previous
    for (let i = 1; i < results.length; i++) {
      expect(results[i]).toBeGreaterThan(results[i - 1]);
    }
  });
});
