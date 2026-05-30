import { NextRequest, NextResponse } from "next/server";
import { getModelPricingByName } from "@prune/shared";

export const runtime = "edge";

type TaskType = "refactor" | "debug" | "test" | "feature" | "unknown";

function inferTaskType(description: string): TaskType {
  const lower = description.toLowerCase();

  if (lower.includes("refactor") || lower.includes("restructure") || lower.includes("clean up")) {
    return "refactor";
  }
  if (lower.includes("debug") || lower.includes("fix") || lower.includes("bug") || lower.includes("error")) {
    return "debug";
  }
  if (lower.includes("test") || lower.includes("spec") || lower.includes("coverage")) {
    return "test";
  }
  if (lower.includes("add") || lower.includes("implement") || lower.includes("create") || lower.includes("feature")) {
    return "feature";
  }
  return "unknown";
}

function predictCost(params: {
  taskType: TaskType;
  model: string;
  estimatedContextTokens: number;
}) {
  const pricing = getModelPricingByName(params.model);

  // Estimate input cost
  const inputCost = (params.estimatedContextTokens / 1_000_000) * pricing.input;

  // Estimate output tokens based on task type
  const outputMultipliers: Record<TaskType, number> = {
    refactor: 0.4,
    debug: 0.3,
    test: 0.35,
    feature: 0.5,
    unknown: 0.25,
  };

  const estimatedOutputTokens = Math.ceil(
    params.estimatedContextTokens * outputMultipliers[params.taskType]
  );
  const outputCost = (estimatedOutputTokens / 1_000_000) * pricing.output;

  // Task type cost multiplier (some tasks are more iterative)
  const taskMultipliers: Record<TaskType, number> = {
    refactor: 1.3,
    debug: 1.5,
    test: 1.2,
    feature: 1.4,
    unknown: 1.0,
  };

  const baseCost = (inputCost + outputCost) * taskMultipliers[params.taskType];

  // Add confidence interval (±30% for simple model)
  const uncertainty = 0.3;

  return {
    predictedCostUsd: Math.round(baseCost * 100) / 100,
    confidenceIntervalLow: Math.round(baseCost * (1 - uncertainty) * 100) / 100,
    confidenceIntervalHigh: Math.round(baseCost * (1 + uncertainty) * 100) / 100,
    confidence: 0.7, // Simple model has moderate confidence
    estimatedOutputTokens,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      task_description,
      task_type,
      model,
      estimated_context_tokens,
    } = body;

    if (!task_description || !model) {
      return NextResponse.json(
        { error: "Missing required fields: task_description, model" },
        { status: 400 }
      );
    }

    const taskType = task_type ?? inferTaskType(task_description);
    const contextTokens = estimated_context_tokens ?? Math.ceil(task_description.length / 4);

    const prediction = predictCost({
      taskType,
      model,
      estimatedContextTokens: contextTokens,
    });

    const formatted =
      `$${prediction.predictedCostUsd.toFixed(2)} ± $${(prediction.confidenceIntervalHigh - prediction.predictedCostUsd).toFixed(2)}`;

    return NextResponse.json({
      prediction: {
        estimated_cost_usd: prediction.predictedCostUsd,
        confidence_interval: {
          low: prediction.confidenceIntervalLow,
          high: prediction.confidenceIntervalHigh,
        },
        confidence: prediction.confidence,
        formatted,
      },
      input: {
        task_type: taskType,
        model,
        estimated_context_tokens: contextTokens,
        estimated_output_tokens: prediction.estimatedOutputTokens,
      },
      model_info: {
        has_enough_data: true,
        reason: "Simple cost estimation based on model pricing and task type",
      },
    });
  } catch (error) {
    console.error("Prediction error:", error);
    return NextResponse.json(
      { error: "Prediction failed", message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
