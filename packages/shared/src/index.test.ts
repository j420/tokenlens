import { describe, it, expect } from "vitest";
import {
  MODEL_PRICING,
  estimateCost,
  formatCost,
  formatTokens,
  getLanguageFromPath,
  LANGUAGE_EXTENSIONS,
  DEFAULT_CONFIG,
  type Provider,
  type SqueezeTier,
  type SupportedLanguage,
} from "./index.js";

// ============================================================================
// MODEL PRICING TESTS
// ============================================================================

describe("MODEL_PRICING", () => {
  describe("pricing data integrity", () => {
    it("should have all expected OpenAI models", () => {
      const openaiModels = ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o1", "o1-mini", "o3-mini"];
      for (const model of openaiModels) {
        expect(MODEL_PRICING[model]).toBeDefined();
        expect(MODEL_PRICING[model].input).toBeGreaterThan(0);
        expect(MODEL_PRICING[model].output).toBeGreaterThan(0);
      }
    });

    it("should have all expected Anthropic models", () => {
      const anthropicModels = [
        "claude-opus-4",
        "claude-sonnet-4",
        "claude-haiku-3.5",
        "claude-3-opus",
        "claude-3-sonnet",
        "claude-3-haiku",
      ];
      for (const model of anthropicModels) {
        expect(MODEL_PRICING[model]).toBeDefined();
        expect(MODEL_PRICING[model].input).toBeGreaterThan(0);
        expect(MODEL_PRICING[model].output).toBeGreaterThan(0);
      }
    });

    it("should have output prices higher than input prices for all models", () => {
      for (const [model, pricing] of Object.entries(MODEL_PRICING)) {
        expect(pricing.output).toBeGreaterThanOrEqual(pricing.input);
      }
    });

    it("should have reasonable price ranges", () => {
      for (const [model, pricing] of Object.entries(MODEL_PRICING)) {
        // Input prices should be between 0.1 and 50 per 1M tokens
        expect(pricing.input).toBeGreaterThanOrEqual(0.1);
        expect(pricing.input).toBeLessThanOrEqual(50);
        // Output prices should be between 0.5 and 100 per 1M tokens
        expect(pricing.output).toBeGreaterThanOrEqual(0.5);
        expect(pricing.output).toBeLessThanOrEqual(100);
      }
    });
  });

  describe("model pricing tiers", () => {
    it("should have claude-opus-4 as most expensive Anthropic model", () => {
      expect(MODEL_PRICING["claude-opus-4"].input).toBeGreaterThan(
        MODEL_PRICING["claude-sonnet-4"].input
      );
      expect(MODEL_PRICING["claude-opus-4"].input).toBeGreaterThan(
        MODEL_PRICING["claude-haiku-3.5"].input
      );
    });

    it("should have gpt-4o as more expensive than gpt-4o-mini", () => {
      expect(MODEL_PRICING["gpt-4o"].input).toBeGreaterThan(
        MODEL_PRICING["gpt-4o-mini"].input
      );
    });

    it("should have o1 as more expensive than o1-mini", () => {
      expect(MODEL_PRICING["o1"].input).toBeGreaterThan(
        MODEL_PRICING["o1-mini"].input
      );
    });
  });
});

// ============================================================================
// COST ESTIMATION TESTS
// ============================================================================

describe("estimateCost", () => {
  describe("basic calculations", () => {
    it("should calculate input cost correctly for gpt-4o", () => {
      // 1M tokens at $2.5/M = $2.5
      expect(estimateCost(1_000_000, "gpt-4o", "input")).toBeCloseTo(2.5);
    });

    it("should calculate output cost correctly for gpt-4o", () => {
      // 1M tokens at $10/M = $10
      expect(estimateCost(1_000_000, "gpt-4o", "output")).toBeCloseTo(10);
    });

    it("should calculate cost for fractional tokens", () => {
      // 500K tokens at $2.5/M = $1.25
      expect(estimateCost(500_000, "gpt-4o", "input")).toBeCloseTo(1.25);
    });

    it("should calculate cost for small token counts", () => {
      // 1000 tokens at $2.5/M = $0.0025
      expect(estimateCost(1000, "gpt-4o", "input")).toBeCloseTo(0.0025);
    });

    it("should return 0 for 0 tokens", () => {
      expect(estimateCost(0, "gpt-4o", "input")).toBe(0);
    });
  });

  describe("model-specific costs", () => {
    it("should use claude-opus-4 pricing", () => {
      expect(estimateCost(1_000_000, "claude-opus-4", "input")).toBeCloseTo(15);
      expect(estimateCost(1_000_000, "claude-opus-4", "output")).toBeCloseTo(75);
    });

    it("should use gpt-4o-mini pricing", () => {
      expect(estimateCost(1_000_000, "gpt-4o-mini", "input")).toBeCloseTo(0.15);
      expect(estimateCost(1_000_000, "gpt-4o-mini", "output")).toBeCloseTo(0.6);
    });

    it("should use o3-mini pricing", () => {
      expect(estimateCost(1_000_000, "o3-mini", "input")).toBeCloseTo(1.1);
      expect(estimateCost(1_000_000, "o3-mini", "output")).toBeCloseTo(4.4);
    });
  });

  describe("fallback behavior", () => {
    it("should fall back to gpt-4o pricing for unknown models", () => {
      expect(estimateCost(1_000_000, "unknown-model", "input")).toBeCloseTo(2.5);
    });

    it("should fall back to gpt-4o pricing for empty model string", () => {
      expect(estimateCost(1_000_000, "", "input")).toBeCloseTo(2.5);
    });
  });

  describe("edge cases", () => {
    it("should handle very large token counts", () => {
      // 1B tokens at $2.5/M = $2500
      expect(estimateCost(1_000_000_000, "gpt-4o", "input")).toBeCloseTo(2500);
    });

    it("should handle negative tokens (returns negative cost)", () => {
      // This is technically invalid input, but function should still work
      const result = estimateCost(-1000, "gpt-4o", "input");
      expect(result).toBeLessThan(0);
    });

    it("should handle decimal token counts", () => {
      expect(estimateCost(1000.5, "gpt-4o", "input")).toBeCloseTo(0.00250125);
    });
  });
});

// ============================================================================
// FORMAT COST TESTS
// ============================================================================

describe("formatCost", () => {
  describe("dollar formatting", () => {
    it("should format costs >= $0.01 as dollars", () => {
      expect(formatCost(1.23)).toBe("$1.23");
      expect(formatCost(0.50)).toBe("$0.50");
      expect(formatCost(10.00)).toBe("$10.00");
      expect(formatCost(0.01)).toBe("$0.01");
    });

    it("should round to 2 decimal places for dollar amounts", () => {
      expect(formatCost(1.235)).toBe("$1.24");
      expect(formatCost(1.234)).toBe("$1.23");
    });
  });

  describe("cents formatting", () => {
    it("should format costs < $0.01 as cents", () => {
      expect(formatCost(0.009)).toBe("$0.90c");
      expect(formatCost(0.001)).toBe("$0.10c");
      expect(formatCost(0.0001)).toBe("$0.01c");
    });

    it("should handle very small costs", () => {
      expect(formatCost(0.00001)).toBe("$0.00c");
    });
  });

  describe("edge cases", () => {
    it("should format zero correctly", () => {
      expect(formatCost(0)).toBe("$0.00c");
    });

    it("should format very large amounts correctly", () => {
      expect(formatCost(1000.99)).toBe("$1000.99");
    });
  });
});

// ============================================================================
// FORMAT TOKENS TESTS
// ============================================================================

describe("formatTokens", () => {
  describe("millions", () => {
    it("should format >= 1M as M", () => {
      expect(formatTokens(1_000_000)).toBe("1.0M");
      expect(formatTokens(2_500_000)).toBe("2.5M");
      expect(formatTokens(10_000_000)).toBe("10.0M");
    });

    it("should round to 1 decimal place", () => {
      expect(formatTokens(1_234_567)).toBe("1.2M");
      expect(formatTokens(1_999_999)).toBe("2.0M");
    });
  });

  describe("thousands", () => {
    it("should format >= 1K but < 1M as K", () => {
      expect(formatTokens(1_000)).toBe("1.0K");
      expect(formatTokens(2_500)).toBe("2.5K");
      expect(formatTokens(999_999)).toBe("1000.0K");
    });

    it("should round to 1 decimal place", () => {
      expect(formatTokens(1_234)).toBe("1.2K");
      expect(formatTokens(9_999)).toBe("10.0K");
    });
  });

  describe("raw numbers", () => {
    it("should format < 1K as raw number", () => {
      expect(formatTokens(0)).toBe("0");
      expect(formatTokens(1)).toBe("1");
      expect(formatTokens(500)).toBe("500");
      expect(formatTokens(999)).toBe("999");
    });
  });

  describe("edge cases", () => {
    it("should handle boundary values", () => {
      expect(formatTokens(999)).toBe("999");
      expect(formatTokens(1000)).toBe("1.0K");
      expect(formatTokens(999999)).toBe("1000.0K");
      expect(formatTokens(1000000)).toBe("1.0M");
    });
  });
});

// ============================================================================
// LANGUAGE DETECTION TESTS
// ============================================================================

describe("getLanguageFromPath", () => {
  describe("TypeScript extensions", () => {
    it("should detect .ts files", () => {
      expect(getLanguageFromPath("file.ts")).toBe("typescript");
    });

    it("should detect .tsx files", () => {
      expect(getLanguageFromPath("component.tsx")).toBe("typescript");
    });

    it("should detect .mts files", () => {
      expect(getLanguageFromPath("module.mts")).toBe("typescript");
    });

    it("should detect .cts files", () => {
      expect(getLanguageFromPath("commonjs.cts")).toBe("typescript");
    });
  });

  describe("JavaScript extensions", () => {
    it("should detect .js files", () => {
      expect(getLanguageFromPath("file.js")).toBe("javascript");
    });

    it("should detect .jsx files", () => {
      expect(getLanguageFromPath("component.jsx")).toBe("javascript");
    });

    it("should detect .mjs files", () => {
      expect(getLanguageFromPath("module.mjs")).toBe("javascript");
    });

    it("should detect .cjs files", () => {
      expect(getLanguageFromPath("commonjs.cjs")).toBe("javascript");
    });
  });

  describe("Python extensions", () => {
    it("should detect .py files", () => {
      expect(getLanguageFromPath("script.py")).toBe("python");
    });
  });

  describe("Go extensions", () => {
    it("should detect .go files", () => {
      expect(getLanguageFromPath("main.go")).toBe("go");
    });
  });

  describe("Rust extensions", () => {
    it("should detect .rs files", () => {
      expect(getLanguageFromPath("lib.rs")).toBe("rust");
    });
  });

  describe("Java extensions", () => {
    it("should detect .java files", () => {
      expect(getLanguageFromPath("Main.java")).toBe("java");
    });
  });

  describe("C/C++ extensions", () => {
    it("should detect .c files", () => {
      expect(getLanguageFromPath("main.c")).toBe("c");
    });

    it("should detect .h files", () => {
      expect(getLanguageFromPath("header.h")).toBe("c");
    });

    it("should detect .cpp files", () => {
      expect(getLanguageFromPath("main.cpp")).toBe("cpp");
    });

    it("should detect .cc files", () => {
      expect(getLanguageFromPath("main.cc")).toBe("cpp");
    });

    it("should detect .cxx files", () => {
      expect(getLanguageFromPath("main.cxx")).toBe("cpp");
    });

    it("should detect .hpp files", () => {
      expect(getLanguageFromPath("header.hpp")).toBe("cpp");
    });
  });

  describe("paths with directories", () => {
    it("should extract extension from full path", () => {
      expect(getLanguageFromPath("/home/user/project/src/file.ts")).toBe("typescript");
      expect(getLanguageFromPath("./relative/path/file.py")).toBe("python");
      expect(getLanguageFromPath("C:\\Users\\project\\file.go")).toBe("go");
    });
  });

  describe("unknown extensions", () => {
    it("should return null for unknown extensions", () => {
      expect(getLanguageFromPath("file.txt")).toBeNull();
      expect(getLanguageFromPath("file.md")).toBeNull();
      expect(getLanguageFromPath("file.json")).toBeNull();
      expect(getLanguageFromPath("file.yaml")).toBeNull();
    });

    it("should return null for files without extensions", () => {
      expect(getLanguageFromPath("Makefile")).toBeNull();
      expect(getLanguageFromPath("Dockerfile")).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("should handle files with multiple dots", () => {
      expect(getLanguageFromPath("file.test.ts")).toBe("typescript");
      expect(getLanguageFromPath("file.spec.tsx")).toBe("typescript");
    });

    it("should handle hidden files", () => {
      expect(getLanguageFromPath(".eslintrc.js")).toBe("javascript");
    });

    it("should be case-sensitive", () => {
      expect(getLanguageFromPath("file.TS")).toBeNull();
      expect(getLanguageFromPath("file.Ts")).toBeNull();
    });
  });
});

// ============================================================================
// LANGUAGE EXTENSIONS MAPPING TESTS
// ============================================================================

describe("LANGUAGE_EXTENSIONS", () => {
  it("should map all TypeScript variants to typescript", () => {
    expect(LANGUAGE_EXTENSIONS[".ts"]).toBe("typescript");
    expect(LANGUAGE_EXTENSIONS[".tsx"]).toBe("typescript");
    expect(LANGUAGE_EXTENSIONS[".mts"]).toBe("typescript");
    expect(LANGUAGE_EXTENSIONS[".cts"]).toBe("typescript");
  });

  it("should map all JavaScript variants to javascript", () => {
    expect(LANGUAGE_EXTENSIONS[".js"]).toBe("javascript");
    expect(LANGUAGE_EXTENSIONS[".jsx"]).toBe("javascript");
    expect(LANGUAGE_EXTENSIONS[".mjs"]).toBe("javascript");
    expect(LANGUAGE_EXTENSIONS[".cjs"]).toBe("javascript");
  });

  it("should have all expected languages", () => {
    const languages = new Set(Object.values(LANGUAGE_EXTENSIONS));
    expect(languages).toContain("typescript");
    expect(languages).toContain("javascript");
    expect(languages).toContain("python");
    expect(languages).toContain("go");
    expect(languages).toContain("rust");
    expect(languages).toContain("java");
    expect(languages).toContain("cpp");
    expect(languages).toContain("c");
  });
});

// ============================================================================
// DEFAULT CONFIG TESTS
// ============================================================================

describe("DEFAULT_CONFIG", () => {
  it("should have all required fields", () => {
    expect(DEFAULT_CONFIG).toHaveProperty("defaultTier");
    expect(DEFAULT_CONFIG).toHaveProperty("autoSqueezeThreshold");
    expect(DEFAULT_CONFIG).toHaveProperty("showStatusBar");
    expect(DEFAULT_CONFIG).toHaveProperty("showPreflightWarnings");
    expect(DEFAULT_CONFIG).toHaveProperty("preserveTodos");
    expect(DEFAULT_CONFIG).toHaveProperty("preserveTypeHints");
  });

  it("should have reasonable default values", () => {
    expect(DEFAULT_CONFIG.defaultTier).toBe("structural");
    expect(DEFAULT_CONFIG.autoSqueezeThreshold).toBe(10000);
    expect(DEFAULT_CONFIG.showStatusBar).toBe(true);
    expect(DEFAULT_CONFIG.showPreflightWarnings).toBe(true);
    expect(DEFAULT_CONFIG.preserveTodos).toBe(true);
    expect(DEFAULT_CONFIG.preserveTypeHints).toBe(true);
  });

  it("should have valid squeeze tier", () => {
    const validTiers: SqueezeTier[] = ["lossless", "structural", "telegraphic"];
    expect(validTiers).toContain(DEFAULT_CONFIG.defaultTier);
  });

  it("should have positive auto squeeze threshold", () => {
    expect(DEFAULT_CONFIG.autoSqueezeThreshold).toBeGreaterThan(0);
  });
});

// ============================================================================
// TYPE GUARDS AND VALIDATION TESTS
// ============================================================================

describe("Type definitions", () => {
  describe("Provider type", () => {
    it("should accept valid providers", () => {
      const providers: Provider[] = ["openai", "anthropic", "google"];
      expect(providers.length).toBe(3);
    });
  });

  describe("SqueezeTier type", () => {
    it("should have three compression levels", () => {
      const tiers: SqueezeTier[] = ["lossless", "structural", "telegraphic"];
      expect(tiers.length).toBe(3);
    });
  });

  describe("SupportedLanguage type", () => {
    it("should include all 8 languages", () => {
      const languages: SupportedLanguage[] = [
        "typescript",
        "javascript",
        "python",
        "go",
        "rust",
        "java",
        "cpp",
        "c",
      ];
      expect(languages.length).toBe(8);
    });
  });
});
