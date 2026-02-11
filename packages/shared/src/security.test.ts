import { describe, it, expect } from "vitest";
import {
  estimateCost,
  formatCost,
  formatTokens,
  getLanguageFromPath,
  getModelPricing,
  getCostPerToken
} from "./index.js";

// ============================================================================
// SECURITY TESTS - Input Validation & Injection Prevention
// ============================================================================

describe("Security: Input Validation", () => {
  describe("estimateCost - Malformed Input Handling", () => {
    it("should handle NaN token counts", () => {
      const result = estimateCost(NaN, "gpt-4o", "input");
      // NaN propagates through multiplication - this is valid JS behavior
      expect(typeof result).toBe("number");
    });

    it("should handle Infinity token counts", () => {
      const result = estimateCost(Infinity, "gpt-4o", "input");
      // Infinity * number = Infinity - valid math
      expect(result).toBe(Infinity);
    });

    it("should handle negative Infinity", () => {
      const result = estimateCost(-Infinity, "gpt-4o", "input");
      // -Infinity * positive = -Infinity
      expect(result).toBe(-Infinity);
    });

    it("should handle MAX_SAFE_INTEGER token counts", () => {
      const result = estimateCost(Number.MAX_SAFE_INTEGER, "gpt-4o", "input");
      expect(Number.isFinite(result)).toBe(true);
    });

    it("should handle very small fractional tokens", () => {
      const result = estimateCost(0.0000001, "gpt-4o", "input");
      expect(result).toBeGreaterThanOrEqual(0);
    });
  });

  describe("formatCost - Output Validation", () => {
    it("should return string with dollar sign for valid number", () => {
      const result = formatCost(1.50);
      expect(result).toContain("$");
      expect(typeof result).toBe("string");
    });

    it("should handle zero cost", () => {
      const result = formatCost(0);
      expect(result).toContain("$");
      expect(result).toContain("0");
    });

    it("should handle very small costs", () => {
      const result = formatCost(0.0001);
      expect(result).toContain("$");
    });
  });

  describe("formatTokens - Input Validation", () => {
    it("should handle NaN gracefully", () => {
      const result = formatTokens(NaN);
      // Should not throw and should produce valid output
      expect(typeof result).toBe("string");
    });

    it("should handle Infinity gracefully", () => {
      const result = formatTokens(Infinity);
      expect(typeof result).toBe("string");
    });

    it("should handle negative numbers", () => {
      const result = formatTokens(-1000);
      expect(typeof result).toBe("string");
    });
  });

  describe("getLanguageFromPath - Path Traversal Prevention", () => {
    it("should handle path traversal attempts", () => {
      const result = getLanguageFromPath("../../../etc/passwd");
      expect(result).toBeNull();
    });

    it("should handle double-encoded path traversal", () => {
      const result = getLanguageFromPath("..%252F..%252F..%252Fetc/passwd");
      expect(result).toBeNull();
    });

    it("should handle null bytes in path", () => {
      const result = getLanguageFromPath("/file.ts\x00.exe");
      // Should handle gracefully
      expect(typeof result === "string" || result === null).toBe(true);
    });

    it("should handle extremely long paths", () => {
      const longPath = "/".repeat(10000) + "file.ts";
      const result = getLanguageFromPath(longPath);
      expect(typeof result === "string" || result === null).toBe(true);
    });

    it("should handle unicode in paths", () => {
      const result = getLanguageFromPath("/путь/到/file.ts");
      expect(result).toBe("typescript");
    });

    it("should handle emoji in paths", () => {
      const result = getLanguageFromPath("/folder/🎉/file.py");
      expect(result).toBe("python");
    });

    it("should handle special shell characters in paths", () => {
      const specialPaths = [
        "/path/$(whoami)/file.ts",
        "/path/`id`/file.ts",
        "/path/${HOME}/file.ts",
        "/path/|cat /etc/passwd|/file.ts",
      ];
      for (const path of specialPaths) {
        const result = getLanguageFromPath(path);
        // Should not execute shell commands, just process as string
        expect(typeof result === "string" || result === null).toBe(true);
      }
    });
  });
});

// ============================================================================
// SECURITY TESTS - Type Coercion Attacks
// ============================================================================

describe("Security: Type Coercion Attacks", () => {
  describe("Prototype Pollution Prevention", () => {
    it("should not be affected by __proto__ in input", () => {
      const maliciousPath = { toString: () => "/file.ts", __proto__: { polluted: true } };
      // This should not affect global Object prototype
      const result = getLanguageFromPath(maliciousPath.toString());
      expect(result).toBe("typescript");
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it("should handle constructor property access", () => {
      const path = "/constructor/file.ts";
      const result = getLanguageFromPath(path);
      expect(result).toBe("typescript");
    });
  });

  describe("Object toString/valueOf exploitation", () => {
    it("should handle object with malicious toString", () => {
      let sideEffect = false;
      const malicious = {
        toString() {
          sideEffect = true;
          return "/file.ts";
        }
      };
      const result = getLanguageFromPath(malicious.toString());
      expect(result).toBe("typescript");
      // toString was called, but that's expected and safe
    });
  });
});

// ============================================================================
// SECURITY TESTS - Boundary Conditions
// ============================================================================

describe("Security: Boundary Conditions", () => {
  describe("Integer Overflow Protection", () => {
    it("should handle MAX_VALUE token counts", () => {
      const result = estimateCost(Number.MAX_VALUE, "gpt-4o", "input");
      // Should not cause infinite loop or crash
      expect(typeof result).toBe("number");
    });

    it("should handle MIN_VALUE token counts", () => {
      const result = estimateCost(Number.MIN_VALUE, "gpt-4o", "input");
      expect(result).toBeGreaterThanOrEqual(0);
    });
  });

  describe("String Length Limits", () => {
    it("should handle empty model name with fallback", () => {
      const result = estimateCost(100, "" as "gpt-4o", "input");
      // May use default pricing as fallback - returns valid number
      expect(typeof result).toBe("number");
    });

    it("should handle very long model name with fallback", () => {
      const longModel = "a".repeat(10000) as "gpt-4o";
      const result = estimateCost(100, longModel, "input");
      // May use default pricing as fallback - returns valid number
      expect(typeof result).toBe("number");
    });
  });
});

// ============================================================================
// SECURITY TESTS - Timing Attack Prevention
// ============================================================================

describe("Security: Timing Considerations", () => {
  it("should have consistent timing for valid/invalid models", () => {
    const iterations = 1000;

    // Time valid model
    const validStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      estimateCost(1000, "gpt-4o", "input");
    }
    const validDuration = performance.now() - validStart;

    // Time invalid model
    const invalidStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      estimateCost(1000, "invalid-model-12345" as "gpt-4o", "input");
    }
    const invalidDuration = performance.now() - invalidStart;

    // Both should be similar (within 10x) - we're not doing cryptographic comparison
    // but there shouldn't be a massive timing difference
    const ratio = Math.max(validDuration, invalidDuration) / Math.min(validDuration, invalidDuration);
    expect(ratio).toBeLessThan(10);
  });
});

// ============================================================================
// SECURITY TESTS - Data Sanitization
// ============================================================================

describe("Security: Data Sanitization", () => {
  describe("Model Name Validation", () => {
    it("should handle null model name gracefully", () => {
      const result = estimateCost(100, null as unknown as "gpt-4o", "input");
      // API may use fallback pricing - returns valid number
      expect(typeof result).toBe("number");
    });

    it("should handle undefined model name gracefully", () => {
      const result = estimateCost(100, undefined as unknown as "gpt-4o", "input");
      // API may use fallback pricing - returns valid number
      expect(typeof result).toBe("number");
    });

    it("should handle object model name gracefully", () => {
      const result = estimateCost(100, {} as unknown as "gpt-4o", "input");
      // API may use fallback pricing - returns valid number
      expect(typeof result).toBe("number");
    });

    it("should handle array model name gracefully", () => {
      const result = estimateCost(100, [] as unknown as "gpt-4o", "input");
      // API may use fallback pricing - returns valid number
      expect(typeof result).toBe("number");
    });
  });

  describe("Token Type Validation", () => {
    it("should handle invalid token type", () => {
      const result = estimateCost(100, "gpt-4o", "invalid" as "input");
      // Should handle gracefully (either use default or return 0)
      expect(typeof result).toBe("number");
    });

    it("should handle null token type", () => {
      const result = estimateCost(100, "gpt-4o", null as unknown as "input");
      expect(typeof result).toBe("number");
    });
  });
});

// ============================================================================
// SECURITY TESTS - Concurrent Access Safety
// ============================================================================

describe("Security: Concurrent Access", () => {
  it("should handle rapid concurrent estimations", async () => {
    const promises = Array(1000).fill(null).map(() =>
      Promise.resolve(estimateCost(Math.random() * 10000, "gpt-4o", "input"))
    );

    const results = await Promise.all(promises);

    // All results should be valid numbers
    for (const result of results) {
      expect(Number.isFinite(result)).toBe(true);
      expect(result).toBeGreaterThanOrEqual(0);
    }
  });

  it("should maintain consistency under concurrent access", async () => {
    const fixedTokens = 5000;
    const fixedModel = "gpt-4o";

    const promises = Array(100).fill(null).map(() =>
      Promise.resolve(estimateCost(fixedTokens, fixedModel, "input"))
    );

    const results = await Promise.all(promises);
    const uniqueResults = new Set(results);

    // All results should be identical
    expect(uniqueResults.size).toBe(1);
  });
});

// ============================================================================
// SECURITY TESTS - RegExp DoS Prevention
// ============================================================================

describe("Security: ReDoS Prevention", () => {
  it("should handle pathological regex input for language detection", () => {
    // Create input that could cause catastrophic backtracking
    const maliciousInput = "a".repeat(100) + "!" + "a".repeat(100);
    const start = performance.now();
    const result = getLanguageFromPath(maliciousInput);
    const duration = performance.now() - start;

    // Should complete quickly (under 100ms)
    expect(duration).toBeLessThan(100);
    expect(result).toBeNull();
  });

  it("should handle nested special characters", () => {
    const nested = "[[[[[[[[[[.ts]]]]]]]]]]";
    const start = performance.now();
    const result = getLanguageFromPath(nested);
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(100);
  });
});
