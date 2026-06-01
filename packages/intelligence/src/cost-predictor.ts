/**
 * Predictive Cost Estimator
 *
 * Uses statistical regression to predict request costs based on:
 * - task_type: refactor, debug, test, feature, unknown
 * - model: claude-sonnet-4-5, gpt-4, etc.
 * - estimated context size (tokens_in from similar past requests)
 * - repo identifier
 * - session depth (turn number)
 * - hour of day
 *
 * The model uses weighted linear regression with features encoded as
 * one-hot vectors for categorical variables.
 */

import { getModelPricingByName } from "@prune/shared";

// Minimum events required for reliable predictions
export const MIN_EVENTS_FOR_PREDICTION = 1000;

// Feature types
export type TaskType = "refactor" | "debug" | "test" | "feature" | "unknown";

export interface PredictionInput {
  taskType: TaskType;
  model: string;
  estimatedContextTokens: number;
  repoIdentifier: string | null;
  sessionDepth: number; // turn number
  hourOfDay: number; // 0-23
}

export interface PredictionResult {
  predictedCostUsd: number;
  confidenceIntervalLow: number;
  confidenceIntervalHigh: number;
  confidence: number; // 0-1
  basedOnEvents: number;
  reason: string;
}

export interface ModelWeights {
  // Base intercept
  intercept: number;
  // Coefficient for context tokens (per 1000 tokens)
  contextCoef: number;
  // Coefficient for session depth
  sessionDepthCoef: number;
  // Hour of day coefficients (peak hours cost more)
  hourCoefs: Record<number, number>;
  // Task type coefficients
  taskCoefs: Record<TaskType, number>;
  // Model-specific coefficients
  modelCoefs: Record<string, number>;
  // Repo-specific adjustments
  repoCoefs: Record<string, number>;
  // Statistics
  meanAbsoluteError: number;
  r2Score: number;
  eventCount: number;
  lastTrainedAt: string;
}

// Default weights before training (based on rough heuristics)
const DEFAULT_WEIGHTS: ModelWeights = {
  intercept: 0.05, // Base cost ~$0.05
  contextCoef: 0.02, // $0.02 per 1000 tokens
  sessionDepthCoef: 0.01, // Cost tends to increase with depth
  hourCoefs: {
    // Working hours tend to have larger requests
    9: 0.02,
    10: 0.03,
    11: 0.03,
    14: 0.03,
    15: 0.02,
  },
  taskCoefs: {
    refactor: 0.15, // Refactors tend to be expensive
    debug: 0.10,
    test: 0.08,
    feature: 0.12,
    unknown: 0.05,
  },
  modelCoefs: {
    "claude-sonnet-4-5-20250929": 0.0,
    "claude-3-5-sonnet-20241022": 0.0,
    "claude-3-haiku-20240307": -0.08, // Haiku is cheaper
    "gpt-4o": 0.02,
    "gpt-4o-mini": -0.05,
    "gpt-4-turbo": 0.05,
  },
  repoCoefs: {},
  meanAbsoluteError: 0.15,
  r2Score: 0,
  eventCount: 0,
  lastTrainedAt: new Date(0).toISOString(),
};

// In-memory model weights (would be persisted in production)
let currentWeights: ModelWeights = { ...DEFAULT_WEIGHTS };

/**
 * Training data point
 */
export interface TrainingDataPoint {
  taskType: TaskType;
  model: string;
  tokensIn: number;
  tokensOut: number;
  repoIdentifier: string | null;
  sessionDepth: number;
  hourOfDay: number;
  actualCostUsd: number;
}

/**
 * Set model weights (used when loading from database)
 */
export function setModelWeights(weights: ModelWeights): void {
  currentWeights = weights;
}

/**
 * Get current model weights
 */
export function getModelWeights(): ModelWeights {
  return { ...currentWeights };
}

/**
 * Check if we have enough data for predictions
 */
export function hasEnoughDataForPrediction(): boolean {
  return currentWeights.eventCount >= MIN_EVENTS_FOR_PREDICTION;
}

/**
 * Predict cost for a request
 */
export function predictCost(input: PredictionInput): PredictionResult {
  // If we don't have enough data, return a simple estimate with low confidence
  if (!hasEnoughDataForPrediction()) {
    const simpleEstimate = getSimpleCostEstimate(input);
    return {
      predictedCostUsd: simpleEstimate,
      confidenceIntervalLow: simpleEstimate * 0.3,
      confidenceIntervalHigh: simpleEstimate * 3.0,
      confidence: 0.1,
      basedOnEvents: currentWeights.eventCount,
      reason: `Not enough data yet (${currentWeights.eventCount}/${MIN_EVENTS_FOR_PREDICTION} events). Predictions improve with usage.`,
    };
  }

  const w = currentWeights;

  // Start with intercept
  let predicted = w.intercept;

  // Add context size contribution (per 1000 tokens)
  predicted += (input.estimatedContextTokens / 1000) * w.contextCoef;

  // Add session depth contribution
  predicted += input.sessionDepth * w.sessionDepthCoef;

  // Add hour of day contribution
  const hourCoef = w.hourCoefs[input.hourOfDay] ?? 0;
  predicted += hourCoef;

  // Add task type contribution
  const taskCoef = w.taskCoefs[input.taskType] ?? w.taskCoefs.unknown;
  predicted += taskCoef;

  // Add model contribution
  const modelCoef = w.modelCoefs[input.model] ?? 0;
  predicted += modelCoef;

  // Add repo-specific adjustment if available
  if (input.repoIdentifier) {
    const repoCoef = w.repoCoefs[input.repoIdentifier] ?? 0;
    predicted += repoCoef;
  }

  // Ensure non-negative
  predicted = Math.max(0.01, predicted);

  // Calculate confidence interval based on model's MAE
  const mae = w.meanAbsoluteError;
  const confidenceFactor = 1.96; // 95% confidence
  const intervalWidth = mae * confidenceFactor;

  // Confidence based on R2 score and event count
  const confidence = Math.min(
    0.95,
    Math.max(0.3, w.r2Score * 0.7 + Math.min(w.eventCount / 10000, 0.3))
  );

  return {
    predictedCostUsd: Math.round(predicted * 100) / 100,
    confidenceIntervalLow: Math.max(0.01, Math.round((predicted - intervalWidth) * 100) / 100),
    confidenceIntervalHigh: Math.round((predicted + intervalWidth) * 100) / 100,
    confidence,
    basedOnEvents: w.eventCount,
    reason: `Based on ${w.eventCount.toLocaleString()} similar requests`,
  };
}

/**
 * Simple cost estimate using model pricing (fallback when no ML model)
 */
function getSimpleCostEstimate(input: PredictionInput): number {
  // Get model pricing from the shared single source.
  const pricing = getModelPricingByName(input.model);

  // Estimate input cost
  const inputCost = (input.estimatedContextTokens / 1_000_000) * pricing.input;

  // Estimate output tokens as roughly 20% of input for most tasks
  const estimatedOutputTokens = Math.ceil(input.estimatedContextTokens * 0.2);
  const outputCost = (estimatedOutputTokens / 1_000_000) * pricing.output;

  // Apply task type multiplier
  const taskMultipliers: Record<TaskType, number> = {
    refactor: 1.5,
    debug: 1.3,
    test: 1.2,
    feature: 1.4,
    unknown: 1.0,
  };

  const multiplier = taskMultipliers[input.taskType] ?? 1.0;

  return (inputCost + outputCost) * multiplier;
}

/**
 * Train the model on historical data
 * Uses simple weighted linear regression
 */
export function trainModel(data: TrainingDataPoint[]): ModelWeights {
  if (data.length < 100) {
    // Not enough data, keep defaults but update count
    return {
      ...DEFAULT_WEIGHTS,
      eventCount: data.length,
      lastTrainedAt: new Date().toISOString(),
    };
  }

  // Calculate feature means for normalization
  const contextMean = data.reduce((sum, d) => sum + d.tokensIn, 0) / data.length;
  const depthMean = data.reduce((sum, d) => sum + d.sessionDepth, 0) / data.length;
  const costMean = data.reduce((sum, d) => sum + d.actualCostUsd, 0) / data.length;

  // Calculate variances
  const contextVar = data.reduce((sum, d) => sum + Math.pow(d.tokensIn - contextMean, 2), 0) / data.length;
  const depthVar = data.reduce((sum, d) => sum + Math.pow(d.sessionDepth - depthMean, 2), 0) / data.length;

  // Calculate correlations with cost
  const contextCostCov = data.reduce(
    (sum, d) => sum + (d.tokensIn - contextMean) * (d.actualCostUsd - costMean),
    0
  ) / data.length;

  const depthCostCov = data.reduce(
    (sum, d) => sum + (d.sessionDepth - depthMean) * (d.actualCostUsd - costMean),
    0
  ) / data.length;

  // Simple regression coefficients
  const contextCoef = contextVar > 0 ? (contextCostCov / contextVar) * 1000 : DEFAULT_WEIGHTS.contextCoef;
  const sessionDepthCoef = depthVar > 0 ? depthCostCov / depthVar : DEFAULT_WEIGHTS.sessionDepthCoef;

  // Calculate task type averages
  const taskCoefs: Record<TaskType, number> = {
    refactor: 0,
    debug: 0,
    test: 0,
    feature: 0,
    unknown: 0,
  };

  const taskCounts: Record<TaskType, number> = {
    refactor: 0,
    debug: 0,
    test: 0,
    feature: 0,
    unknown: 0,
  };

  for (const d of data) {
    const residual = d.actualCostUsd - (contextCoef * d.tokensIn / 1000 + sessionDepthCoef * d.sessionDepth);
    taskCoefs[d.taskType] += residual;
    taskCounts[d.taskType]++;
  }

  for (const task of Object.keys(taskCoefs) as TaskType[]) {
    if (taskCounts[task] > 0) {
      taskCoefs[task] = taskCoefs[task] / taskCounts[task];
    } else {
      taskCoefs[task] = DEFAULT_WEIGHTS.taskCoefs[task];
    }
  }

  // Calculate model coefficients
  const modelCoefs: Record<string, number> = {};
  const modelCounts: Record<string, number> = {};
  const modelResiduals: Record<string, number> = {};

  for (const d of data) {
    const taskCoef = taskCoefs[d.taskType] ?? 0;
    const residual = d.actualCostUsd - (contextCoef * d.tokensIn / 1000 + sessionDepthCoef * d.sessionDepth + taskCoef);
    if (!modelResiduals[d.model]) {
      modelResiduals[d.model] = 0;
      modelCounts[d.model] = 0;
    }
    modelResiduals[d.model] += residual;
    modelCounts[d.model]++;
  }

  for (const model of Object.keys(modelResiduals)) {
    modelCoefs[model] = modelResiduals[model] / modelCounts[model];
  }

  // Calculate hour coefficients
  const hourCoefs: Record<number, number> = {};
  const hourCounts: Record<number, number> = {};
  const hourResiduals: Record<number, number> = {};

  for (const d of data) {
    const taskCoef = taskCoefs[d.taskType] ?? 0;
    const modelCoef = modelCoefs[d.model] ?? 0;
    const residual = d.actualCostUsd - (
      contextCoef * d.tokensIn / 1000 +
      sessionDepthCoef * d.sessionDepth +
      taskCoef +
      modelCoef
    );
    if (!hourResiduals[d.hourOfDay]) {
      hourResiduals[d.hourOfDay] = 0;
      hourCounts[d.hourOfDay] = 0;
    }
    hourResiduals[d.hourOfDay] += residual;
    hourCounts[d.hourOfDay]++;
  }

  for (const hour of Object.keys(hourResiduals).map(Number)) {
    if (hourCounts[hour] >= 10) {
      hourCoefs[hour] = hourResiduals[hour] / hourCounts[hour];
    }
  }

  // Calculate repo coefficients
  const repoCoefs: Record<string, number> = {};
  const repoCounts: Record<string, number> = {};
  const repoResiduals: Record<string, number> = {};

  for (const d of data) {
    if (!d.repoIdentifier) continue;
    const taskCoef = taskCoefs[d.taskType] ?? 0;
    const modelCoef = modelCoefs[d.model] ?? 0;
    const hourCoef = hourCoefs[d.hourOfDay] ?? 0;
    const residual = d.actualCostUsd - (
      contextCoef * d.tokensIn / 1000 +
      sessionDepthCoef * d.sessionDepth +
      taskCoef +
      modelCoef +
      hourCoef
    );
    if (!repoResiduals[d.repoIdentifier]) {
      repoResiduals[d.repoIdentifier] = 0;
      repoCounts[d.repoIdentifier] = 0;
    }
    repoResiduals[d.repoIdentifier] += residual;
    repoCounts[d.repoIdentifier]++;
  }

  for (const repo of Object.keys(repoResiduals)) {
    if (repoCounts[repo] >= 20) {
      repoCoefs[repo] = repoResiduals[repo] / repoCounts[repo];
    }
  }

  // Calculate intercept (mean of remaining residuals)
  let interceptSum = 0;
  for (const d of data) {
    const taskCoef = taskCoefs[d.taskType] ?? 0;
    const modelCoef = modelCoefs[d.model] ?? 0;
    const hourCoef = hourCoefs[d.hourOfDay] ?? 0;
    const repoCoef = d.repoIdentifier ? (repoCoefs[d.repoIdentifier] ?? 0) : 0;
    const predicted =
      contextCoef * d.tokensIn / 1000 +
      sessionDepthCoef * d.sessionDepth +
      taskCoef +
      modelCoef +
      hourCoef +
      repoCoef;
    interceptSum += d.actualCostUsd - predicted;
  }
  const intercept = interceptSum / data.length;

  // Calculate model quality metrics
  let ssRes = 0;
  let ssTot = 0;
  let maeSum = 0;

  for (const d of data) {
    const taskCoef = taskCoefs[d.taskType] ?? 0;
    const modelCoef = modelCoefs[d.model] ?? 0;
    const hourCoef = hourCoefs[d.hourOfDay] ?? 0;
    const repoCoef = d.repoIdentifier ? (repoCoefs[d.repoIdentifier] ?? 0) : 0;
    const predicted =
      intercept +
      contextCoef * d.tokensIn / 1000 +
      sessionDepthCoef * d.sessionDepth +
      taskCoef +
      modelCoef +
      hourCoef +
      repoCoef;
    const residual = d.actualCostUsd - predicted;
    ssRes += residual * residual;
    ssTot += Math.pow(d.actualCostUsd - costMean, 2);
    maeSum += Math.abs(residual);
  }

  const r2Score = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  const meanAbsoluteError = maeSum / data.length;

  const weights: ModelWeights = {
    intercept,
    contextCoef,
    sessionDepthCoef,
    hourCoefs,
    taskCoefs,
    modelCoefs,
    repoCoefs,
    meanAbsoluteError,
    r2Score,
    eventCount: data.length,
    lastTrainedAt: new Date().toISOString(),
  };

  // Update current weights
  currentWeights = weights;

  return weights;
}

/**
 * Format prediction for display
 */
export function formatPrediction(result: PredictionResult): string {
  if (result.confidence < 0.3) {
    return result.reason;
  }

  const formatted = `$${result.predictedCostUsd.toFixed(2)} \u00B1 $${(result.confidenceIntervalHigh - result.predictedCostUsd).toFixed(2)}`;
  return `${formatted} (${Math.round(result.confidence * 100)}% confidence)`;
}
