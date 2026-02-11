import { describe, it, expect } from "vitest";
import {
  estimateCost,
  formatCost,
  formatTokens,
  getLanguageFromPath,
  MODEL_PRICING,
} from "./index.js";

// ============================================================================
// EXTREME BOUNDARY CONDITIONS
// ============================================================================

describe("Boundary Conditions", () => {
  describe("Token Count Extremes", () => {
    it("should handle zero tokens", () => {
      expect(estimateCost(0, "gpt-4o", "input")).toBe(0);
      expect(estimateCost(0, "gpt-4o", "output")).toBe(0);
    });

    it("should handle single token", () => {
      const cost = estimateCost(1, "gpt-4o", "input");
      expect(cost).toBeGreaterThan(0);
      expect(cost).toBeLessThan(0.0001);
    });

    it("should handle MAX_SAFE_INTEGER tokens without overflow", () => {
      const maxTokens = Number.MAX_SAFE_INTEGER;
      const cost = estimateCost(maxTokens, "gpt-4o", "input");
      expect(Number.isFinite(cost)).toBe(true);
      expect(cost).toBeGreaterThan(0);
    });

    it("should handle 1 billion tokens", () => {
      const cost = estimateCost(1_000_000_000, "gpt-4o", "input");
      expect(cost).toBeCloseTo(2500); // 1B tokens at $2.5/M
    });

    it("should handle 100 billion tokens", () => {
      const cost = estimateCost(100_000_000_000, "gpt-4o", "input");
      expect(cost).toBeCloseTo(250000); // 100B tokens at $2.5/M
    });
  });

  describe("Cost Formatting Extremes", () => {
    it("should format extremely small costs", () => {
      const formatted = formatCost(0.000001);
      expect(formatted).toContain("$");
    });

    it("should format zero cost", () => {
      const formatted = formatCost(0);
      expect(formatted).toContain("$");
      expect(formatted).toContain("0");
    });

    it("should format very large costs", () => {
      const formatted = formatCost(999999.99);
      expect(formatted).toContain("$999999.99");
    });

    it("should format costs at boundary", () => {
      // Test boundary between cents and dollars formatting
      expect(formatCost(0.00999999)).toMatch(/\$|c/);
      expect(formatCost(0.01)).toBe("$0.01");
      expect(formatCost(0.01001)).toBe("$0.01");
    });
  });

  describe("Token Formatting Extremes", () => {
    it("should format zero tokens", () => {
      expect(formatTokens(0)).toBe("0");
    });

    it("should format boundary values precisely", () => {
      expect(formatTokens(999)).toBe("999");
      expect(formatTokens(1000)).toBe("1.0K");
      expect(formatTokens(1001)).toBe("1.0K");
      expect(formatTokens(999999)).toBe("1000.0K");
      expect(formatTokens(1000000)).toBe("1.0M");
      expect(formatTokens(1000001)).toBe("1.0M");
    });

    it("should handle very large token counts", () => {
      expect(formatTokens(1000000000)).toBe("1000.0M");
      expect(formatTokens(999999999999)).toMatch(/M$/);
    });
  });
});

// ============================================================================
// STRING HANDLING EDGE CASES
// ============================================================================

describe("String Handling Edge Cases", () => {
  describe("Language Detection", () => {
    it("should handle empty string path", () => {
      expect(getLanguageFromPath("")).toBeNull();
    });

    it("should handle path with only extension", () => {
      expect(getLanguageFromPath(".ts")).toBe("typescript");
      expect(getLanguageFromPath(".py")).toBe("python");
    });

    it("should handle very long paths", () => {
      const longPath = "/a".repeat(1000) + "/file.ts";
      expect(getLanguageFromPath(longPath)).toBe("typescript");
    });

    it("should handle paths with special characters", () => {
      expect(getLanguageFromPath("/path/with spaces/file.ts")).toBe("typescript");
      expect(getLanguageFromPath("/path/with-dashes/file.py")).toBe("python");
      expect(getLanguageFromPath("/path/with_underscores/file.go")).toBe("go");
    });

    it("should handle unicode paths", () => {
      expect(getLanguageFromPath("/路径/文件.ts")).toBe("typescript");
      expect(getLanguageFromPath("/путь/файл.py")).toBe("python");
    });

    it("should handle paths with multiple extensions", () => {
      expect(getLanguageFromPath("file.test.spec.ts")).toBe("typescript");
      expect(getLanguageFromPath("file.d.ts")).toBe("typescript");
      expect(getLanguageFromPath("file.min.js")).toBe("javascript");
    });

    it("should handle Windows-style paths", () => {
      expect(getLanguageFromPath("C:\\Users\\test\\file.ts")).toBe("typescript");
      expect(getLanguageFromPath("D:\\project\\src\\main.py")).toBe("python");
    });
  });
});

// ============================================================================
// MODEL PRICING EDGE CASES
// ============================================================================

describe("Model Pricing Edge Cases", () => {
  it("should handle model names with version strings", () => {
    // Test that specific version models work
    expect(MODEL_PRICING["gpt-4o"]).toBeDefined();
    expect(MODEL_PRICING["claude-3-haiku"]).toBeDefined();
  });

  it("should not have NaN or Infinity prices", () => {
    for (const [model, pricing] of Object.entries(MODEL_PRICING)) {
      expect(Number.isFinite(pricing.input)).toBe(true);
      expect(Number.isFinite(pricing.output)).toBe(true);
      expect(Number.isNaN(pricing.input)).toBe(false);
      expect(Number.isNaN(pricing.output)).toBe(false);
    }
  });

  it("should have consistent pricing hierarchy", () => {
    // Opus should be more expensive than Sonnet
    const opusInput = MODEL_PRICING["claude-opus-4"]?.input ?? 0;
    const sonnetInput = MODEL_PRICING["claude-sonnet-4"]?.input ?? 0;
    const haikuInput = MODEL_PRICING["claude-haiku-3.5"]?.input ?? 0;

    expect(opusInput).toBeGreaterThan(sonnetInput);
    expect(sonnetInput).toBeGreaterThan(haikuInput);
  });
});

// ============================================================================
// CONCURRENT/PARALLEL SAFETY
// ============================================================================

describe("Concurrent Access Safety", () => {
  it("should handle multiple concurrent cost calculations", async () => {
    const promises = Array(100)
      .fill(null)
      .map((_, i) => Promise.resolve(estimateCost(1000 * i, "gpt-4o", "input")));

    const results = await Promise.all(promises);

    results.forEach((result, i) => {
      expect(result).toBeCloseTo((1000 * i / 1_000_000) * 2.5);
    });
  });

  it("should handle rapid sequential format calls", () => {
    const results: string[] = [];
    for (let i = 0; i < 1000; i++) {
      results.push(formatCost(Math.random() * 100));
    }
    expect(results).toHaveLength(1000);
    results.forEach((r) => expect(r).toContain("$"));
  });
});

// ============================================================================
// NUMERIC PRECISION
// ============================================================================

describe("Numeric Precision", () => {
  it("should maintain precision for small costs", () => {
    // 1 token at $2.5/M should be $0.0000025
    const cost = estimateCost(1, "gpt-4o", "input");
    expect(cost).toBeCloseTo(0.0000025, 10);
  });

  it("should not accumulate floating point errors", () => {
    // Calculate cost 1000 times and sum
    let total = 0;
    for (let i = 0; i < 1000; i++) {
      total += estimateCost(1000, "gpt-4o", "input");
    }
    // Should be close to 1M tokens worth
    const expected = estimateCost(1000000, "gpt-4o", "input");
    expect(total).toBeCloseTo(expected, 5);
  });

  it("should handle decimal token counts", () => {
    const cost1 = estimateCost(1000.1, "gpt-4o", "input");
    const cost2 = estimateCost(1000.9, "gpt-4o", "input");
    expect(cost2).toBeGreaterThan(cost1);
  });
});

// ============================================================================
// OBJECT STRUCTURE CHECKS
// ============================================================================

describe("Object Structure", () => {
  it("should have MODEL_PRICING as a valid object", () => {
    expect(typeof MODEL_PRICING).toBe("object");
    expect(MODEL_PRICING).not.toBeNull();
    expect(Object.keys(MODEL_PRICING).length).toBeGreaterThan(0);
  });

  it("should have consistent pricing structure for all models", () => {
    for (const [_model, pricing] of Object.entries(MODEL_PRICING)) {
      expect(pricing).toHaveProperty("input");
      expect(pricing).toHaveProperty("output");
      expect(typeof pricing.input).toBe("number");
      expect(typeof pricing.output).toBe("number");
    }
  });
});
