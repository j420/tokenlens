import { describe, it, expect } from "vitest";
import {
  getModelPricing,
  calculateCost,
  formatCost,
  formatTokens,
  isModelPriced,
  isModelPricedByName,
  getModelPricingStrict,
  getModelPricingStrictByName,
  DEFAULT_PRICING,
} from "./pricing.js";
import type { Provider } from "./schemas/event.js";

describe("strict pricing API (unknown model → null, never a default)", () => {
  it("isModelPriced is true for a real (provider, model), false for unknown", () => {
    expect(isModelPriced("anthropic", "claude-sonnet-4-20250514")).toBe(true);
    expect(isModelPriced("openai", "gpt-4o")).toBe(true);
    expect(isModelPriced("openai", "totally-made-up")).toBe(false);
    // A real model under the WRONG provider is NOT priced (the bypass class).
    expect(isModelPriced("google", "gpt-4o")).toBe(false);
  });

  it("isModelPricedByName checks the flat table", () => {
    expect(isModelPricedByName("gpt-4o")).toBe(true);
    expect(isModelPricedByName("nope")).toBe(false);
    expect(isModelPricedByName("")).toBe(false);
  });

  it("getModelPricingStrict returns real pricing or null — never DEFAULT_PRICING", () => {
    expect(getModelPricingStrict("openai", "gpt-4o")).not.toBeNull();
    expect(getModelPricingStrict("openai", "unknown-x")).toBeNull();
    expect(getModelPricingStrict("google", "gpt-4o")).toBeNull(); // wrong provider
    expect(getModelPricingStrictByName("unknown-x")).toBeNull();
  });

  it("the back-compat getModelPricing STILL returns DEFAULT_PRICING for unknown (documented)", () => {
    expect(getModelPricing("openai", "unknown-x")).toBe(DEFAULT_PRICING);
    // ...while the strict variant refuses to fabricate.
    expect(getModelPricingStrict("openai", "unknown-x")).toBeNull();
  });
});

// ============================================================================
// GET MODEL PRICING TESTS
// ============================================================================

describe("getModelPricing", () => {
  describe("Anthropic models", () => {
    it("should return pricing for Claude Opus 4", () => {
      const pricing = getModelPricing("anthropic", "claude-opus-4-20250514");
      expect(pricing.input).toBe(15);
      expect(pricing.output).toBe(75);
      expect(pricing.cached_input).toBe(1.875);
    });

    it("should return pricing for Claude Sonnet 4", () => {
      const pricing = getModelPricing("anthropic", "claude-sonnet-4-20250514");
      expect(pricing.input).toBe(3);
      expect(pricing.output).toBe(15);
      expect(pricing.cached_input).toBe(0.375);
    });

    it("should return pricing for Claude 3.5 Sonnet", () => {
      const pricing = getModelPricing("anthropic", "claude-3-5-sonnet-20241022");
      expect(pricing.input).toBe(3);
      expect(pricing.output).toBe(15);
    });

    it("should return pricing for Claude 3.5 Haiku", () => {
      const pricing = getModelPricing("anthropic", "claude-3-5-haiku-20241022");
      expect(pricing.input).toBe(0.8);
      expect(pricing.output).toBe(4);
    });

    it("should return pricing for Claude 3 Opus", () => {
      const pricing = getModelPricing("anthropic", "claude-3-opus-20240229");
      expect(pricing.input).toBe(15);
      expect(pricing.output).toBe(75);
    });

    it("should return pricing for Claude 3 Haiku", () => {
      const pricing = getModelPricing("anthropic", "claude-3-haiku-20240307");
      expect(pricing.input).toBe(0.25);
      expect(pricing.output).toBe(1.25);
    });
  });

  describe("OpenAI models", () => {
    it("should return pricing for GPT-4o", () => {
      const pricing = getModelPricing("openai", "gpt-4o");
      expect(pricing.input).toBe(2.5);
      expect(pricing.output).toBe(10);
      expect(pricing.cached_input).toBe(1.25);
    });

    it("should return pricing for GPT-4o-mini", () => {
      const pricing = getModelPricing("openai", "gpt-4o-mini");
      expect(pricing.input).toBe(0.15);
      expect(pricing.output).toBe(0.6);
      expect(pricing.cached_input).toBe(0.075);
    });

    it("should return pricing for GPT-4 Turbo", () => {
      const pricing = getModelPricing("openai", "gpt-4-turbo");
      expect(pricing.input).toBe(10);
      expect(pricing.output).toBe(30);
    });

    it("should return pricing for GPT-4", () => {
      const pricing = getModelPricing("openai", "gpt-4");
      expect(pricing.input).toBe(30);
      expect(pricing.output).toBe(60);
    });

    it("should return pricing for o1 models", () => {
      const o1 = getModelPricing("openai", "o1");
      expect(o1.input).toBe(15);
      expect(o1.output).toBe(60);
      expect(o1.cached_input).toBe(7.5);

      const o1Mini = getModelPricing("openai", "o1-mini");
      expect(o1Mini.input).toBe(3);
      expect(o1Mini.output).toBe(12);
    });

    it("should return pricing for o3-mini", () => {
      const pricing = getModelPricing("openai", "o3-mini");
      expect(pricing.input).toBe(1.1);
      expect(pricing.output).toBe(4.4);
      expect(pricing.cached_input).toBe(0.55);
    });

    it("should return pricing for GPT-3.5 Turbo", () => {
      const pricing = getModelPricing("openai", "gpt-3.5-turbo");
      expect(pricing.input).toBe(0.5);
      expect(pricing.output).toBe(1.5);
    });
  });

  describe("Google models", () => {
    it("should return pricing for Gemini 2.0 Flash", () => {
      const pricing = getModelPricing("google", "gemini-2.0-flash");
      expect(pricing.input).toBe(0.1);
      expect(pricing.output).toBe(0.4);
    });

    it("should return pricing for Gemini 2.0 Flash experimental (free)", () => {
      const pricing = getModelPricing("google", "gemini-2.0-flash-exp");
      expect(pricing.input).toBe(0);
      expect(pricing.output).toBe(0);
    });

    it("should return pricing for Gemini 1.5 Pro", () => {
      const pricing = getModelPricing("google", "gemini-1.5-pro");
      expect(pricing.input).toBe(1.25);
      expect(pricing.output).toBe(5);
    });

    it("should return pricing for Gemini 1.5 Flash", () => {
      const pricing = getModelPricing("google", "gemini-1.5-flash");
      expect(pricing.input).toBe(0.075);
      expect(pricing.output).toBe(0.3);
    });

    it("should return pricing for Gemini 1.0 Pro", () => {
      const pricing = getModelPricing("google", "gemini-1.0-pro");
      expect(pricing.input).toBe(0.5);
      expect(pricing.output).toBe(1.5);
    });
  });

  describe("default pricing for unknown models", () => {
    it("should return default pricing for unknown Anthropic model", () => {
      const pricing = getModelPricing("anthropic", "claude-future-model");
      expect(pricing.input).toBe(3);
      expect(pricing.output).toBe(15);
    });

    it("should return default pricing for unknown OpenAI model", () => {
      const pricing = getModelPricing("openai", "gpt-5-unknown");
      expect(pricing.input).toBe(3);
      expect(pricing.output).toBe(15);
    });

    it("should return default pricing for unknown Google model", () => {
      const pricing = getModelPricing("google", "gemini-unknown");
      expect(pricing.input).toBe(3);
      expect(pricing.output).toBe(15);
    });
  });
});

// ============================================================================
// CALCULATE COST TESTS
// ============================================================================

describe("calculateCost", () => {
  describe("basic cost calculations", () => {
    it("should calculate cost for input and output tokens", () => {
      // 100K input at $2.5/M + 50K output at $10/M = $0.25 + $0.50 = $0.75
      const cost = calculateCost("openai", "gpt-4o", 100_000, 50_000);
      expect(cost).toBeCloseTo(0.75);
    });

    it("should calculate cost with zero tokens", () => {
      const cost = calculateCost("openai", "gpt-4o", 0, 0);
      expect(cost).toBe(0);
    });

    it("should calculate cost for input only", () => {
      const cost = calculateCost("openai", "gpt-4o", 1_000_000, 0);
      expect(cost).toBeCloseTo(2.5);
    });

    it("should calculate cost for output only", () => {
      const cost = calculateCost("openai", "gpt-4o", 0, 1_000_000);
      expect(cost).toBeCloseTo(10);
    });
  });

  describe("cached token calculations", () => {
    it("should reduce cost for cached tokens", () => {
      // 100K total input, 50K cached
      // Non-cached: 50K at $2.5/M = $0.125
      // Cached: 50K at $1.25/M = $0.0625
      // Output: 0
      // Total: $0.1875
      const cost = calculateCost("openai", "gpt-4o", 100_000, 0, 50_000);
      expect(cost).toBeCloseTo(0.1875);
    });

    it("should handle all tokens being cached", () => {
      // 100K input, 100K cached
      // Non-cached: 0
      // Cached: 100K at $1.25/M = $0.125
      const cost = calculateCost("openai", "gpt-4o", 100_000, 0, 100_000);
      expect(cost).toBeCloseTo(0.125);
    });

    it("should handle more cached than input (edge case)", () => {
      // Non-cached should be 0, not negative
      const cost = calculateCost("openai", "gpt-4o", 50_000, 0, 100_000);
      // Non-cached = max(0, 50000 - 100000) = 0
      // Cached = 100000 at $1.25/M = $0.125
      expect(cost).toBeCloseTo(0.125);
    });

    it("should use input price when cached_input not available", () => {
      // GPT-4 Turbo doesn't have cached pricing
      const cost = calculateCost("openai", "gpt-4-turbo", 100_000, 0, 50_000);
      // Non-cached: 50K at $10/M = $0.5
      // Cached: 50K at $10/M (fallback to input) = $0.5
      // Total: $1.0
      expect(cost).toBeCloseTo(1.0);
    });
  });

  describe("model-specific calculations", () => {
    it("should calculate cost for Claude Opus 4", () => {
      // 100K input at $15/M + 50K output at $75/M = $1.5 + $3.75 = $5.25
      const cost = calculateCost("anthropic", "claude-opus-4-20250514", 100_000, 50_000);
      expect(cost).toBeCloseTo(5.25);
    });

    it("should calculate cost for Claude 3 Haiku (cheapest)", () => {
      // 1M input at $0.25/M + 500K output at $1.25/M = $0.25 + $0.625 = $0.875
      const cost = calculateCost("anthropic", "claude-3-haiku-20240307", 1_000_000, 500_000);
      expect(cost).toBeCloseTo(0.875);
    });

    it("should calculate cost for free tier models", () => {
      const cost = calculateCost("google", "gemini-2.0-flash-exp", 1_000_000, 500_000);
      expect(cost).toBe(0);
    });
  });

  describe("large scale calculations", () => {
    it("should handle millions of tokens", () => {
      // 10M input at $2.5/M + 5M output at $10/M = $25 + $50 = $75
      const cost = calculateCost("openai", "gpt-4o", 10_000_000, 5_000_000);
      expect(cost).toBeCloseTo(75);
    });

    it("should handle billions of tokens", () => {
      // 1B input at $2.5/M = $2500
      const cost = calculateCost("openai", "gpt-4o", 1_000_000_000, 0);
      expect(cost).toBeCloseTo(2500);
    });
  });

  describe("edge cases", () => {
    it("should handle decimal token counts", () => {
      const cost = calculateCost("openai", "gpt-4o", 1000.5, 500.5);
      expect(cost).toBeGreaterThan(0);
    });

    it("should handle unknown models with default pricing", () => {
      const cost = calculateCost("openai", "unknown-model", 100_000, 50_000);
      // Default: $3/M input, $15/M output
      expect(cost).toBeCloseTo(1.05); // 0.3 + 0.75
    });
  });
});

// ============================================================================
// FORMAT COST TESTS (from pricing.ts)
// ============================================================================

describe("formatCost (pricing module)", () => {
  it("should format costs >= $0.01 with 2 decimal places", () => {
    expect(formatCost(1.23)).toBe("$1.23");
    expect(formatCost(0.50)).toBe("$0.50");
    expect(formatCost(0.01)).toBe("$0.01");
  });

  it("should format costs < $0.01 with 4 decimal places", () => {
    expect(formatCost(0.009)).toBe("$0.0090");
    expect(formatCost(0.001)).toBe("$0.0010");
    expect(formatCost(0.0001)).toBe("$0.0001");
  });

  it("should format zero", () => {
    expect(formatCost(0)).toBe("$0.0000");
  });

  it("should format large costs", () => {
    expect(formatCost(100.00)).toBe("$100.00");
    expect(formatCost(1000.99)).toBe("$1000.99");
  });
});

// ============================================================================
// FORMAT TOKENS TESTS (from pricing.ts)
// ============================================================================

describe("formatTokens (pricing module)", () => {
  describe("millions", () => {
    it("should format >= 1M tokens", () => {
      expect(formatTokens(1_000_000)).toBe("1.0M");
      expect(formatTokens(2_500_000)).toBe("2.5M");
      expect(formatTokens(10_000_000)).toBe("10.0M");
    });
  });

  describe("thousands", () => {
    it("should format >= 1K but < 1M tokens", () => {
      expect(formatTokens(1_000)).toBe("1.0K");
      expect(formatTokens(50_000)).toBe("50.0K");
      expect(formatTokens(999_999)).toBe("1000.0K");
    });
  });

  describe("raw numbers", () => {
    it("should format < 1K tokens as raw number", () => {
      expect(formatTokens(0)).toBe("0");
      expect(formatTokens(500)).toBe("500");
      expect(formatTokens(999)).toBe("999");
    });
  });
});

// ============================================================================
// PRICING CONSISTENCY TESTS
// ============================================================================

describe("Pricing Consistency", () => {
  const providers: Provider[] = ["anthropic", "openai", "google"];

  it("output price should be >= input price for all models", () => {
    const modelsToCheck = [
      { provider: "anthropic" as Provider, model: "claude-opus-4-20250514" },
      { provider: "anthropic" as Provider, model: "claude-sonnet-4-20250514" },
      { provider: "anthropic" as Provider, model: "claude-3-haiku-20240307" },
      { provider: "openai" as Provider, model: "gpt-4o" },
      { provider: "openai" as Provider, model: "gpt-4o-mini" },
      { provider: "openai" as Provider, model: "o1" },
      { provider: "google" as Provider, model: "gemini-1.5-pro" },
      { provider: "google" as Provider, model: "gemini-1.5-flash" },
    ];

    for (const { provider, model } of modelsToCheck) {
      const pricing = getModelPricing(provider, model);
      expect(pricing.output).toBeGreaterThanOrEqual(pricing.input);
    }
  });

  it("cached input price should be <= input price when defined", () => {
    const modelsWithCaching = [
      { provider: "anthropic" as Provider, model: "claude-opus-4-20250514" },
      { provider: "anthropic" as Provider, model: "claude-sonnet-4-20250514" },
      { provider: "openai" as Provider, model: "gpt-4o" },
      { provider: "openai" as Provider, model: "o1" },
    ];

    for (const { provider, model } of modelsWithCaching) {
      const pricing = getModelPricing(provider, model);
      if (pricing.cached_input !== undefined) {
        expect(pricing.cached_input).toBeLessThanOrEqual(pricing.input);
      }
    }
  });

  it("all prices should be non-negative", () => {
    const modelsToCheck = [
      { provider: "anthropic" as Provider, model: "claude-opus-4-20250514" },
      { provider: "openai" as Provider, model: "gpt-4o" },
      { provider: "google" as Provider, model: "gemini-2.0-flash-exp" },
    ];

    for (const { provider, model } of modelsToCheck) {
      const pricing = getModelPricing(provider, model);
      expect(pricing.input).toBeGreaterThanOrEqual(0);
      expect(pricing.output).toBeGreaterThanOrEqual(0);
      if (pricing.cached_input !== undefined) {
        expect(pricing.cached_input).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
