import { Hono } from "hono";
import { z } from "zod";
import type { Logger } from "pino";
import type { AuthContext } from "../middleware/auth.js";
import {
  predictCost,
  hasEnoughDataForPrediction,
  getModelWeights,
  formatPrediction,
  type TaskType,
  type PredictionInput,
} from "@prune/intelligence";

// Variables type for this router
type Variables = {
  auth: AuthContext;
  correlationId: string;
  logger: Logger;
};

export const predictRouter = new Hono<{ Variables: Variables }>();

// Input validation schema
const predictCostInputSchema = z.object({
  task_description: z.string().min(1),
  task_type: z.enum(["refactor", "debug", "test", "feature", "unknown"]).optional(),
  model: z.string().min(1),
  estimated_context_tokens: z.number().int().positive().optional(),
  repo: z.string().optional(),
  session_depth: z.number().int().min(1).optional(),
});

/**
 * POST /api/v1/predict/cost
 *
 * Predict the cost of a request based on task description, model, and metadata.
 */
predictRouter.post("/cost", async (c) => {
  const reqLogger = c.get("logger");
  const auth = c.get("auth");

  // Parse and validate input
  let input: z.infer<typeof predictCostInputSchema>;
  try {
    const body = await c.req.json();
    input = predictCostInputSchema.parse(body);
  } catch (err) {
    return c.json(
      { error: "Invalid input", details: err instanceof z.ZodError ? err.errors : undefined },
      400
    );
  }

  // Infer task type from description if not provided
  const taskType = input.task_type ?? inferTaskType(input.task_description);

  // Estimate context tokens if not provided
  // Rough heuristic: 4 chars per token on average
  const estimatedContextTokens = input.estimated_context_tokens ?? Math.ceil(input.task_description.length / 4);

  // Current hour for time-of-day features
  const hourOfDay = new Date().getHours();

  // Build prediction input
  const predictionInput: PredictionInput = {
    taskType,
    model: input.model,
    estimatedContextTokens,
    repoIdentifier: input.repo ?? null,
    sessionDepth: input.session_depth ?? 1,
    hourOfDay,
  };

  try {
    const result = predictCost(predictionInput);

    reqLogger.info(
      {
        userId: auth.userId,
        taskType,
        model: input.model,
        estimatedTokens: estimatedContextTokens,
        predictedCost: result.predictedCostUsd,
        confidence: result.confidence,
      },
      "Cost prediction generated"
    );

    return c.json({
      prediction: {
        estimated_cost_usd: result.predictedCostUsd,
        confidence_interval: {
          low: result.confidenceIntervalLow,
          high: result.confidenceIntervalHigh,
        },
        confidence: result.confidence,
        formatted: formatPrediction(result),
      },
      input: {
        task_type: taskType,
        model: input.model,
        estimated_context_tokens: estimatedContextTokens,
        repo: input.repo ?? null,
        session_depth: input.session_depth ?? 1,
        hour_of_day: hourOfDay,
      },
      model_info: {
        has_enough_data: hasEnoughDataForPrediction(),
        event_count: result.basedOnEvents,
        reason: result.reason,
      },
    });
  } catch (err) {
    reqLogger.error({ err }, "Cost prediction failed");
    return c.json({ error: "Prediction failed" }, 500);
  }
});

/**
 * GET /api/v1/predict/model-info
 *
 * Get information about the current prediction model.
 */
predictRouter.get("/model-info", async (c) => {
  const weights = getModelWeights();

  return c.json({
    has_enough_data: hasEnoughDataForPrediction(),
    event_count: weights.eventCount,
    mean_absolute_error: weights.meanAbsoluteError,
    r2_score: weights.r2Score,
    last_trained_at: weights.lastTrainedAt,
    task_type_coefficients: weights.taskCoefs,
    model_coefficients: weights.modelCoefs,
  });
});

/**
 * Infer task type from description using keyword matching.
 */
function inferTaskType(description: string): TaskType {
  const lower = description.toLowerCase();

  // Refactor keywords
  if (
    lower.includes("refactor") ||
    lower.includes("restructure") ||
    lower.includes("reorganize") ||
    lower.includes("clean up") ||
    lower.includes("simplify")
  ) {
    return "refactor";
  }

  // Debug keywords
  if (
    lower.includes("debug") ||
    lower.includes("fix") ||
    lower.includes("bug") ||
    lower.includes("error") ||
    lower.includes("issue") ||
    lower.includes("crash") ||
    lower.includes("failing")
  ) {
    return "debug";
  }

  // Test keywords
  if (
    lower.includes("test") ||
    lower.includes("spec") ||
    lower.includes("coverage") ||
    lower.includes("unit test") ||
    lower.includes("integration test")
  ) {
    return "test";
  }

  // Feature keywords
  if (
    lower.includes("add") ||
    lower.includes("implement") ||
    lower.includes("create") ||
    lower.includes("build") ||
    lower.includes("feature") ||
    lower.includes("new")
  ) {
    return "feature";
  }

  return "unknown";
}
