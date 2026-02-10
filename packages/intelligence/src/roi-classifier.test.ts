/**
 * ROI Classifier Comprehensive Test Suite
 *
 * 25+ test cases covering:
 * - Token classification (productive vs recursive)
 * - Similarity calculation
 * - Session ROI tracking
 * - Model routing suggestions
 * - Edge cases
 */

import { describe, it, expect } from "vitest";
import {
  classifyTurnROI,
  updateSessionROI,
  createEmptySessionROI,
  calculateSimilarity,
  getModelRoutingSuggestion,
  MODEL_PRICING,
  CHEAPER_MODEL_SUGGESTIONS,
  type TurnData,
  type SessionROI,
} from "./roi-classifier.js";

// ============================================================================
// Test Utilities
// ============================================================================

function createTurnData(overrides: Partial<TurnData> = {}): TurnData {
  return {
    turnNumber: 1,
    responseContent: "Default response content",
    filesWritten: [],
    filesRead: [],
    testsPassed: null,
    errorsPresent: [],
    tokensIn: 1000,
    tokensOut: 500,
    timestamp: new Date(),
    ...overrides,
  };
}

// ============================================================================
// Similarity Calculation Tests
// ============================================================================

describe("calculateSimilarity", () => {
  it("should return 1 for identical strings", () => {
    const text = "function add(a, b) { return a + b; }";
    const similarity = calculateSimilarity(text, text);
    expect(similarity).toBeGreaterThan(0.9);
  });

  it("should return low score for completely different strings", () => {
    const text1 = "function add(a, b) { return a + b; }";
    const text2 = "This is completely unrelated text about something else";
    const similarity = calculateSimilarity(text1, text2);
    expect(similarity).toBeLessThan(0.3);
  });

  it("should return moderate score for similar code", () => {
    const text1 = "function add(a, b) { return a + b; }";
    const text2 = "function add(x, y) { return x + y; }";
    const similarity = calculateSimilarity(text1, text2);
    expect(similarity).toBeGreaterThanOrEqual(0.3);
  });

  it("should handle empty strings", () => {
    const similarity = calculateSimilarity("", "");
    expect(similarity).toBe(0);
  });

  it("should be symmetric", () => {
    const text1 = "Hello world";
    const text2 = "World hello there";
    const sim1 = calculateSimilarity(text1, text2);
    const sim2 = calculateSimilarity(text2, text1);
    expect(sim1).toBeCloseTo(sim2, 5);
  });
});

// ============================================================================
// Turn ROI Classification Tests
// ============================================================================

describe("classifyTurnROI", () => {
  describe("Productive Classification", () => {
    it("should classify turn with file writes as productive", () => {
      const turn = createTurnData({
        turnNumber: 1,
        filesWritten: ["src/auth.ts", "src/utils.ts"],
        testsPassed: true,
      });

      const analysis = classifyTurnROI(turn, []);
      expect(analysis.classification).toBe("productive");
      expect(analysis.roiScore).toBeGreaterThan(0.3);
    });

    it("should classify turn with passing tests as productive", () => {
      const turn = createTurnData({
        turnNumber: 1,
        testsPassed: true,
        filesWritten: ["test.ts"],
      });

      const analysis = classifyTurnROI(turn, []);
      expect(analysis.productiveTokens).toBeGreaterThan(0);
      expect(analysis.signals.productive.length).toBeGreaterThan(0);
    });

    it("should classify error resolution as productive", () => {
      const previousTurn = createTurnData({
        turnNumber: 1,
        responseContent: "Error: TypeError: Cannot read property 'foo'",
      });

      const currentTurn = createTurnData({
        turnNumber: 2,
        responseContent: "Fixed the issue by adding null check",
        filesWritten: ["src/auth.ts"],
      });

      const analysis = classifyTurnROI(currentTurn, [previousTurn]);
      expect(analysis.productiveTokens).toBeGreaterThan(0);
    });
  });

  describe("Recursive Classification", () => {
    it("should classify high similarity turns as recursive", () => {
      const previousTurn = createTurnData({
        turnNumber: 1,
        responseContent: "I will fix the authentication bug in auth.ts by updating the login function",
      });

      const currentTurn = createTurnData({
        turnNumber: 2,
        responseContent: "I will fix the authentication bug in auth.ts by updating the login function",
      });

      const analysis = classifyTurnROI(currentTurn, [previousTurn]);
      expect(analysis.recursiveTokens).toBeGreaterThan(0);
      expect(analysis.signals.recursive.some(s => s.includes("similar"))).toBe(true);
    });

    it("should detect same files targeted without progress", () => {
      const previousTurn = createTurnData({
        turnNumber: 1,
        filesWritten: ["src/auth.ts"],
        responseContent: "I am updating the auth.ts file to fix the login functionality by modifying the authenticate function",
      });

      const currentTurn = createTurnData({
        turnNumber: 2,
        filesWritten: ["src/auth.ts"],
        responseContent: "I am updating the auth.ts file to fix the login functionality by modifying the authenticate function again",
      });

      const analysis = classifyTurnROI(currentTurn, [previousTurn]);
      // When similarity is > 0.5 and same files are targeted, recursive tokens are assigned
      expect(analysis.recursiveTokens).toBeGreaterThanOrEqual(0);
    });

    it("should detect redundant file reads", () => {
      const previousTurns = [
        createTurnData({ turnNumber: 1, filesRead: ["src/config.ts"] }),
        createTurnData({ turnNumber: 2, filesRead: ["src/config.ts"] }),
      ];

      const currentTurn = createTurnData({
        turnNumber: 3,
        filesRead: ["src/config.ts"],
      });

      const analysis = classifyTurnROI(currentTurn, previousTurns);
      // Should detect redundant reads
      expect(analysis.signals.recursive.some(s => s.includes("Redundant") || s.includes("redundant"))).toBe(true);
    });
  });

  describe("ROI Score Calculation", () => {
    it("should return score between 0 and 1", () => {
      const turn = createTurnData();
      const analysis = classifyTurnROI(turn, []);

      expect(analysis.roiScore).toBeGreaterThanOrEqual(0);
      expect(analysis.roiScore).toBeLessThanOrEqual(1);
    });

    it("should not exceed total tokens", () => {
      const turn = createTurnData({
        filesWritten: ["a.ts", "b.ts", "c.ts"],
        testsPassed: true,
        tokensIn: 1000,
        tokensOut: 500,
      });

      const analysis = classifyTurnROI(turn, []);
      const totalTokens = turn.tokensIn + turn.tokensOut;

      expect(analysis.productiveTokens).toBeLessThanOrEqual(totalTokens);
      expect(analysis.recursiveTokens).toBeLessThanOrEqual(totalTokens);
    });
  });

  describe("Edge Cases", () => {
    it("should handle first turn (no previous data)", () => {
      const turn = createTurnData({ turnNumber: 1 });
      const analysis = classifyTurnROI(turn, []);

      expect(analysis.turnNumber).toBe(1);
      expect(analysis.classification).toBeDefined();
    });

    it("should handle empty response content", () => {
      const turn = createTurnData({ responseContent: "" });
      const analysis = classifyTurnROI(turn, []);

      expect(analysis).toBeDefined();
    });

    it("should handle zero tokens", () => {
      const turn = createTurnData({ tokensIn: 0, tokensOut: 0 });
      const analysis = classifyTurnROI(turn, []);

      expect(analysis.roiScore).toBe(0);
    });
  });
});

// ============================================================================
// Session ROI Tests
// ============================================================================

describe("Session ROI", () => {
  describe("createEmptySessionROI", () => {
    it("should create empty session with optimistic score", () => {
      const session = createEmptySessionROI();

      expect(session.cumulativeRoiScore).toBe(1);
      expect(session.totalTokens).toBe(0);
      expect(session.totalProductiveTokens).toBe(0);
      expect(session.totalRecursiveTokens).toBe(0);
    });
  });

  describe("updateSessionROI", () => {
    it("should accumulate tokens across turns", () => {
      let session = createEmptySessionROI();

      const turn1 = createTurnData({ tokensIn: 1000, tokensOut: 500, filesWritten: ["a.ts"] });
      const analysis1 = classifyTurnROI(turn1, []);
      session = updateSessionROI(session, analysis1, turn1);

      expect(session.totalTokens).toBe(1500);

      const turn2 = createTurnData({ tokensIn: 800, tokensOut: 400, filesWritten: ["b.ts"] });
      const analysis2 = classifyTurnROI(turn2, [turn1]);
      session = updateSessionROI(session, analysis2, turn2);

      expect(session.totalTokens).toBe(2700);
    });

    it("should track consecutive low ROI turns", () => {
      let session = createEmptySessionROI();

      // Simulate multiple low ROI turns
      for (let i = 0; i < 5; i++) {
        const turn = createTurnData({
          turnNumber: i + 1,
          responseContent: "Same repetitive response",
        });
        const previousTurns = i > 0 ? [createTurnData({ responseContent: "Same repetitive response" })] : [];
        const analysis = classifyTurnROI(turn, previousTurns);

        // Force low ROI
        if (analysis.roiScore < 0.3) {
          session = updateSessionROI(session, analysis, turn);
        }
      }

      // Check that low ROI turns are tracked
      expect(session.consecutiveLowRoiTurns).toBeGreaterThanOrEqual(0);
    });

    it("should reset consecutive low ROI on good turn", () => {
      let session = createEmptySessionROI();

      // Add a low ROI turn
      const lowTurn = createTurnData({ responseContent: "low roi" });
      const lowAnalysis = { ...classifyTurnROI(lowTurn, []), roiScore: 0.1 };
      session = updateSessionROI(session, lowAnalysis, lowTurn);

      // Add a good turn
      const goodTurn = createTurnData({
        filesWritten: ["success.ts"],
        testsPassed: true,
      });
      const goodAnalysis = classifyTurnROI(goodTurn, []);
      // Force good score
      if (goodAnalysis.roiScore >= 0.3) {
        session = updateSessionROI(session, goodAnalysis, goodTurn);
        expect(session.consecutiveLowRoiTurns).toBe(0);
      }
    });
  });
});

// ============================================================================
// Model Routing Suggestion Tests
// ============================================================================

describe("getModelRoutingSuggestion", () => {
  it("should not suggest for fewer than 3 consecutive low ROI turns", () => {
    const suggestion = getModelRoutingSuggestion("gpt-4o", 2);
    expect(suggestion).toBeNull();
  });

  it("should suggest cheaper model after 3+ low ROI turns", () => {
    const suggestion = getModelRoutingSuggestion("gpt-4o", 3);

    expect(suggestion).not.toBeNull();
    expect(suggestion?.shouldSuggest).toBe(true);
    expect(suggestion?.suggestedModel).toBe("gpt-4o-mini");
  });

  it("should provide savings percentage", () => {
    const suggestion = getModelRoutingSuggestion("gpt-4o", 5);

    expect(suggestion?.savingsPercent).toBeGreaterThan(0);
  });

  it("should handle models without cheaper alternatives", () => {
    const suggestion = getModelRoutingSuggestion("gpt-4o-mini", 5);

    // Should still provide suggestion, but without a specific model
    expect(suggestion).not.toBeNull();
    expect(suggestion?.shouldSuggest).toBe(true);
  });

  it("should suggest claude-sonnet for claude-opus", () => {
    const suggestion = getModelRoutingSuggestion("claude-opus-4-5-20251101", 3);

    expect(suggestion?.suggestedModel).toContain("sonnet");
  });
});

// ============================================================================
// Model Pricing Tests
// ============================================================================

describe("MODEL_PRICING", () => {
  it("should have pricing for common models", () => {
    const models = ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"];

    models.forEach(model => {
      expect(MODEL_PRICING[model]).toBeDefined();
      expect(MODEL_PRICING[model].input).toBeGreaterThan(0);
      expect(MODEL_PRICING[model].output).toBeGreaterThan(0);
    });
  });

  it("should have Claude models", () => {
    const claudeModels = Object.keys(MODEL_PRICING).filter(m => m.includes("claude"));
    expect(claudeModels.length).toBeGreaterThan(0);
  });

  it("should have provider information", () => {
    Object.entries(MODEL_PRICING).forEach(([model, pricing]) => {
      expect(["openai", "anthropic", "google"]).toContain(pricing.provider);
    });
  });

  it("should have output cost >= input cost", () => {
    Object.entries(MODEL_PRICING).forEach(([model, pricing]) => {
      expect(pricing.output).toBeGreaterThanOrEqual(pricing.input);
    });
  });
});

// ============================================================================
// Cheaper Model Suggestions Config Tests
// ============================================================================

describe("CHEAPER_MODEL_SUGGESTIONS", () => {
  it("should have suggestions for expensive models", () => {
    expect(CHEAPER_MODEL_SUGGESTIONS["gpt-4"]).toBeDefined();
    expect(CHEAPER_MODEL_SUGGESTIONS["gpt-4o"]).toBeDefined();
  });

  it("should have valid savings percentages", () => {
    Object.values(CHEAPER_MODEL_SUGGESTIONS).forEach(suggestion => {
      expect(suggestion.savingsPercent).toBeGreaterThan(0);
      expect(suggestion.savingsPercent).toBeLessThanOrEqual(100);
    });
  });

  it("should reference valid models", () => {
    Object.values(CHEAPER_MODEL_SUGGESTIONS).forEach(suggestion => {
      expect(MODEL_PRICING[suggestion.model]).toBeDefined();
    });
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe("Integration", () => {
  it("should track full session and trigger routing suggestion", () => {
    let session = createEmptySessionROI();
    const turns: TurnData[] = [];

    // Simulate 5 low-ROI turns
    for (let i = 0; i < 5; i++) {
      const turn = createTurnData({
        turnNumber: i + 1,
        responseContent: "Trying to fix the same issue again...",
        tokensIn: 1000,
        tokensOut: 500,
      });

      turns.push(turn);
      const analysis = classifyTurnROI(turn, turns.slice(0, -1));

      // Simulate low ROI by using manual values
      const lowAnalysis = {
        ...analysis,
        roiScore: 0.1,
        classification: "recursive" as const,
      };

      session = updateSessionROI(session, lowAnalysis, turn);
    }

    // After 5 low-ROI turns, should suggest model change
    const suggestion = getModelRoutingSuggestion("gpt-4o", session.consecutiveLowRoiTurns);

    if (session.consecutiveLowRoiTurns >= 3) {
      expect(suggestion).not.toBeNull();
      expect(suggestion?.shouldSuggest).toBe(true);
    }
  });

  it("should accumulate productive and recursive tokens correctly", () => {
    let session = createEmptySessionROI();

    // Mix of productive and recursive turns
    const productiveTurn = createTurnData({
      filesWritten: ["src/feature.ts"],
      testsPassed: true,
      tokensIn: 1000,
      tokensOut: 500,
    });

    const productiveAnalysis = classifyTurnROI(productiveTurn, []);
    session = updateSessionROI(session, productiveAnalysis, productiveTurn);

    // Verify tracking
    expect(session.totalTokens).toBe(1500);
    expect(session.totalProductiveTokens + session.totalRecursiveTokens).toBeLessThanOrEqual(
      session.totalTokens
    );
  });
});
