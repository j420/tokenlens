/**
 * Cost Predictor Comprehensive Test Suite
 *
 * 20+ test cases covering:
 * - Cost prediction
 * - Model training
 * - Edge cases
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  predictCost,
  trainModel,
  formatPrediction,
  setModelWeights,
  getModelWeights,
  hasEnoughDataForPrediction,
  MIN_EVENTS_FOR_PREDICTION,
  type PredictionInput,
  type PredictionResult,
  type ModelWeights,
  type TrainingDataPoint,
  type TaskType,
} from "./cost-predictor.js";

// ============================================================================
// Test Utilities
// ============================================================================

function createPredictionInput(overrides: Partial<PredictionInput> = {}): PredictionInput {
  return {
    taskType: "feature",
    model: "claude-sonnet-4-5-20250929",
    estimatedContextTokens: 5000,
    repoIdentifier: "test/repo",
    sessionDepth: 3,
    hourOfDay: 14,
    ...overrides,
  };
}

function createTrainingDataPoint(overrides: Partial<TrainingDataPoint> = {}): TrainingDataPoint {
  return {
    taskType: "feature",
    model: "claude-sonnet-4-5-20250929",
    tokensIn: 5000,
    tokensOut: 1000,
    repoIdentifier: "test/repo",
    sessionDepth: 3,
    hourOfDay: 14,
    actualCostUsd: 0.05,
    ...overrides,
  };
}

// ============================================================================
// Prediction Tests
// ============================================================================

describe("predictCost", () => {
  describe("Basic Predictions", () => {
    it("should return prediction result", () => {
      const input = createPredictionInput();
      const result = predictCost(input);

      expect(result).toBeDefined();
      expect(result.predictedCostUsd).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it("should include confidence intervals", () => {
      const input = createPredictionInput();
      const result = predictCost(input);

      expect(result.confidenceIntervalLow).toBeDefined();
      expect(result.confidenceIntervalHigh).toBeDefined();
      expect(result.confidenceIntervalLow).toBeLessThanOrEqual(result.predictedCostUsd);
      expect(result.confidenceIntervalHigh).toBeGreaterThanOrEqual(result.predictedCostUsd);
    });

    it("should include reason", () => {
      const input = createPredictionInput();
      const result = predictCost(input);

      expect(result.reason).toBeDefined();
      expect(typeof result.reason).toBe("string");
      expect(result.reason.length).toBeGreaterThan(0);
    });
  });

  describe("Context Size Impact", () => {
    it("should predict higher cost for more context tokens", () => {
      const small = createPredictionInput({ estimatedContextTokens: 1000 });
      const large = createPredictionInput({ estimatedContextTokens: 50000 });

      const smallResult = predictCost(small);
      const largeResult = predictCost(large);

      expect(largeResult.predictedCostUsd).toBeGreaterThanOrEqual(smallResult.predictedCostUsd);
    });
  });

  describe("Task Type Variations", () => {
    const taskTypes: TaskType[] = ["refactor", "debug", "test", "feature", "unknown"];

    taskTypes.forEach(taskType => {
      it(`should handle ${taskType} task type`, () => {
        const input = createPredictionInput({ taskType });
        const result = predictCost(input);
        expect(result.predictedCostUsd).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe("Model Variations", () => {
    it("should handle claude-sonnet model", () => {
      const input = createPredictionInput({ model: "claude-sonnet-4-5-20250929" });
      const result = predictCost(input);
      expect(result.predictedCostUsd).toBeGreaterThanOrEqual(0);
    });

    it("should handle gpt-4o model", () => {
      const input = createPredictionInput({ model: "gpt-4o" });
      const result = predictCost(input);
      expect(result.predictedCostUsd).toBeGreaterThanOrEqual(0);
    });

    it("should handle unknown model gracefully", () => {
      const input = createPredictionInput({ model: "unknown-model-123" });
      const result = predictCost(input);
      expect(result.predictedCostUsd).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Session Depth Impact", () => {
    it("should handle varying session depths", () => {
      const shallow = createPredictionInput({ sessionDepth: 1 });
      const deep = createPredictionInput({ sessionDepth: 20 });

      const shallowResult = predictCost(shallow);
      const deepResult = predictCost(deep);

      // Both should produce valid results
      expect(shallowResult.predictedCostUsd).toBeGreaterThanOrEqual(0);
      expect(deepResult.predictedCostUsd).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Hour of Day Impact", () => {
    it("should handle all hours of day", () => {
      for (let hour = 0; hour < 24; hour++) {
        const input = createPredictionInput({ hourOfDay: hour });
        const result = predictCost(input);
        expect(result.predictedCostUsd).toBeGreaterThanOrEqual(0);
      }
    });
  });
});

// ============================================================================
// Model Training Tests
// ============================================================================

describe("trainModel", () => {
  it("should return model weights", () => {
    const data = Array(200).fill(null).map((_, i) =>
      createTrainingDataPoint({
        tokensIn: 1000 * (i % 10 + 1),
        actualCostUsd: 0.01 * (i % 10 + 1),
      })
    );

    const weights = trainModel(data);

    expect(weights).toBeDefined();
    expect(weights.intercept).toBeDefined();
    expect(weights.contextCoef).toBeDefined();
    expect(weights.eventCount).toBe(200);
  });

  it("should handle insufficient training data", () => {
    const data = [createTrainingDataPoint()];
    const weights = trainModel(data);

    expect(weights).toBeDefined();
    expect(weights.eventCount).toBe(1);
  });

  it("should update lastTrainedAt timestamp", () => {
    const data = Array(200).fill(null).map(() => createTrainingDataPoint());
    const before = new Date();
    const weights = trainModel(data);
    const after = new Date();

    const trainedAt = new Date(weights.lastTrainedAt);
    expect(trainedAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(trainedAt.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
  });
});

// ============================================================================
// Model Weights Management Tests
// ============================================================================

describe("Model Weights Management", () => {
  it("should get model weights", () => {
    const weights = getModelWeights();
    expect(weights).toBeDefined();
    expect(weights.intercept).toBeDefined();
  });

  it("should set and get model weights", () => {
    const originalWeights = getModelWeights();

    const customWeights: ModelWeights = {
      ...originalWeights,
      intercept: 0.1,
      contextCoef: 0.05,
    };

    setModelWeights(customWeights);
    const newWeights = getModelWeights();

    expect(newWeights.intercept).toBe(0.1);
    expect(newWeights.contextCoef).toBe(0.05);

    // Restore original
    setModelWeights(originalWeights);
  });
});

// ============================================================================
// Formatting Tests
// ============================================================================

describe("formatPrediction", () => {
  it("should format prediction result", () => {
    const result: PredictionResult = {
      predictedCostUsd: 0.15,
      confidenceIntervalLow: 0.10,
      confidenceIntervalHigh: 0.20,
      confidence: 0.75,
      basedOnEvents: 5000,
      reason: "Based on historical data",
    };

    const formatted = formatPrediction(result);

    expect(typeof formatted).toBe("string");
    expect(formatted.length).toBeGreaterThan(0);
  });

  it("should handle low confidence", () => {
    const result: PredictionResult = {
      predictedCostUsd: 0.05,
      confidenceIntervalLow: 0.01,
      confidenceIntervalHigh: 0.15,
      confidence: 0.1,
      basedOnEvents: 100,
      reason: "Not enough data yet",
    };

    const formatted = formatPrediction(result);
    expect(formatted).toContain("Not enough");
  });

  it("should include cost in formatted output", () => {
    const result: PredictionResult = {
      predictedCostUsd: 0.50,
      confidenceIntervalLow: 0.40,
      confidenceIntervalHigh: 0.60,
      confidence: 0.8,
      basedOnEvents: 10000,
      reason: "Based on 10,000 events",
    };

    const formatted = formatPrediction(result);
    expect(formatted).toContain("$");
  });
});

// ============================================================================
// Constants Tests
// ============================================================================

describe("Constants", () => {
  it("should have reasonable MIN_EVENTS_FOR_PREDICTION", () => {
    expect(MIN_EVENTS_FOR_PREDICTION).toBeGreaterThan(0);
    expect(typeof MIN_EVENTS_FOR_PREDICTION).toBe("number");
  });
});

// ============================================================================
// Edge Cases Tests
// ============================================================================

describe("Edge Cases", () => {
  it("should handle zero context tokens", () => {
    const input = createPredictionInput({ estimatedContextTokens: 0 });
    const result = predictCost(input);
    expect(result.predictedCostUsd).toBeGreaterThanOrEqual(0);
  });

  it("should handle null repo identifier", () => {
    const input = createPredictionInput({ repoIdentifier: null });
    const result = predictCost(input);
    expect(result.predictedCostUsd).toBeGreaterThanOrEqual(0);
  });

  it("should handle zero session depth", () => {
    const input = createPredictionInput({ sessionDepth: 0 });
    const result = predictCost(input);
    expect(result.predictedCostUsd).toBeGreaterThanOrEqual(0);
  });

  it("should handle very large context", () => {
    const input = createPredictionInput({ estimatedContextTokens: 1000000 });
    const result = predictCost(input);
    expect(result.predictedCostUsd).toBeGreaterThan(0);
    expect(Number.isFinite(result.predictedCostUsd)).toBe(true);
  });

  it("should handle midnight hour", () => {
    const input = createPredictionInput({ hourOfDay: 0 });
    const result = predictCost(input);
    expect(result.predictedCostUsd).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe("Integration", () => {
  it("should produce consistent results for same input", () => {
    const input = createPredictionInput();

    const result1 = predictCost(input);
    const result2 = predictCost(input);

    expect(result1.predictedCostUsd).toBe(result2.predictedCostUsd);
    expect(result1.confidence).toBe(result2.confidence);
  });

  it("should check if enough data for prediction", () => {
    const hasEnough = hasEnoughDataForPrediction();
    expect(typeof hasEnough).toBe("boolean");
  });
});
