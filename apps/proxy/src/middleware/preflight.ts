import type { Context, Next } from "hono";
import type { Logger } from "pino";
import { v4 as uuidv4 } from "uuid";
import {
  quickAnalyze,
  generatePruneSuggestion,
  predictCost,
  hasEnoughDataForPrediction,
  type PruneSuggestion,
  type PredictionResult,
  type TaskType,
} from "@prune/intelligence";
import type { AuthContext } from "./auth.js";

// Cost prediction info attached to context
export interface CostPredictionInfo {
  predictedCostUsd: number;
  confidenceIntervalLow: number;
  confidenceIntervalHigh: number;
  confidence: number;
  formatted: string;
  hasEnoughData: boolean;
}

// Base variables type for pre-flight analysis
// The auth field is optional here since we add it after auth middleware runs
type PreflightVariables = {
  correlationId: string;
  logger: Logger;
  auth?: AuthContext;
  pruneSuggestion?: PruneSuggestion;
  costPrediction?: CostPredictionInfo;
  preflightAnalysis?: {
    totalTokens: number;
    relevantTokens: number;
    noiseTokens: number;
    processingTimeMs: number;
  };
};

interface PreflightOptions {
  /** Enable pre-flight analysis (default: true) */
  enabled?: boolean;
  /** Timeout in milliseconds for quick analysis (default: 50) */
  timeoutMs?: number;
  /** Minimum context size to trigger analysis (default: 2000 tokens) */
  minContextTokens?: number;
  /** Enable cost prediction (default: true) */
  enableCostPrediction?: boolean;
}

/**
 * Pre-flight analysis middleware
 *
 * Performs fast context analysis before proxying requests.
 * If the analysis suggests pruning, attaches the suggestion to the context
 * for later use (e.g., sending via WebSocket).
 *
 * This middleware is designed to add <50ms latency to requests.
 */
export function preflightAnalysis(options: PreflightOptions = {}) {
  const { enabled = true, timeoutMs = 50, enableCostPrediction = true } = options;

  return async (c: Context<{ Variables: PreflightVariables }>, next: Next) => {
    if (!enabled) {
      return next();
    }

    const reqLogger = c.get("logger");
    const requestId = c.get("correlationId") ?? uuidv4();

    // Try to extract prompt and context from request body
    // This works for both Anthropic and OpenAI formats
    let prompt = "";
    let context = "";
    let model = "unknown";
    let sessionDepth = 1;

    try {
      const body = await c.req.json();

      // Extract model from request
      if (body.model) {
        model = body.model;
      }

      // Estimate session depth from message count
      if (body.messages && Array.isArray(body.messages)) {
        sessionDepth = Math.ceil(body.messages.length / 2);
      }

      // Anthropic format: messages array
      if (body.messages && Array.isArray(body.messages)) {
        const messages = body.messages;
        const lastUserMessage = [...messages].reverse().find(
          (m: { role: string; content: unknown }) => m.role === "user"
        );

        if (lastUserMessage) {
          // User message can be string or array of content blocks
          if (typeof lastUserMessage.content === "string") {
            prompt = lastUserMessage.content;
          } else if (Array.isArray(lastUserMessage.content)) {
            // Extract text from content blocks
            prompt = lastUserMessage.content
              .filter((c: { type: string }) => c.type === "text")
              .map((c: { text: string }) => c.text)
              .join("\n");
          }
        }

        // Build context from all previous messages
        const contextMessages = messages.slice(0, -1);
        context = contextMessages
          .map((m: { role: string; content: unknown }) => {
            if (typeof m.content === "string") {
              return `[${m.role}]: ${m.content}`;
            } else if (Array.isArray(m.content)) {
              return m.content
                .filter((c: { type: string }) => c.type === "text")
                .map((c: { text: string }) => `[${m.role}]: ${c.text}`)
                .join("\n");
            }
            return "";
          })
          .join("\n\n");

        // Also include system prompt if present
        if (body.system) {
          if (typeof body.system === "string") {
            context = `[system]: ${body.system}\n\n${context}`;
          } else if (Array.isArray(body.system)) {
            const sysText = body.system
              .filter((s: { type: string }) => s.type === "text")
              .map((s: { text: string }) => s.text)
              .join("\n");
            context = `[system]: ${sysText}\n\n${context}`;
          }
        }
      }
    } catch {
      // If we can't parse the body, skip analysis
      reqLogger.debug("Could not parse request body for pre-flight analysis");
      return next();
    }

    // Skip if no meaningful prompt or context
    if (!prompt || context.length < 1000) {
      return next();
    }

    const startTime = performance.now();

    try {
      const analysis = await quickAnalyze(prompt, context, timeoutMs);
      const processingTime = performance.now() - startTime;

      if (analysis) {
        const suggestion = generatePruneSuggestion(requestId, analysis);

        // Attach to context for later use
        c.set("preflightAnalysis", {
          totalTokens: analysis.totalTokens,
          relevantTokens: analysis.relevantTokens,
          noiseTokens: analysis.noiseTokens,
          processingTimeMs: Math.round(processingTime * 100) / 100,
        });

        if (suggestion) {
          c.set("pruneSuggestion", suggestion);
          reqLogger.info(
            {
              requestId,
              totalTokens: analysis.totalTokens,
              noisePercent: Math.round(
                (analysis.noiseTokens / analysis.totalTokens) * 100
              ),
              estimatedSavings: suggestion.estimated_savings_usd,
              processingTime,
            },
            "Pre-flight analysis suggests pruning"
          );
        } else {
          reqLogger.debug(
            {
              requestId,
              totalTokens: analysis.totalTokens,
              processingTime,
            },
            "Pre-flight analysis complete, no pruning suggested"
          );
        }

        // Generate cost prediction if enabled
        if (enableCostPrediction && analysis) {
          try {
            const taskType = inferTaskType(prompt);
            const prediction = predictCost({
              taskType,
              model,
              estimatedContextTokens: analysis.totalTokens,
              repoIdentifier: null, // Would be extracted from task_metadata in real impl
              sessionDepth,
              hourOfDay: new Date().getHours(),
            });

            // Only attach prediction if we have enough confidence
            if (prediction.confidence >= 0.3 || !hasEnoughDataForPrediction()) {
              const formatted = hasEnoughDataForPrediction()
                ? `$${prediction.predictedCostUsd.toFixed(2)} \u00B1 $${(prediction.confidenceIntervalHigh - prediction.predictedCostUsd).toFixed(2)}`
                : prediction.reason;

              c.set("costPrediction", {
                predictedCostUsd: prediction.predictedCostUsd,
                confidenceIntervalLow: prediction.confidenceIntervalLow,
                confidenceIntervalHigh: prediction.confidenceIntervalHigh,
                confidence: prediction.confidence,
                formatted,
                hasEnoughData: hasEnoughDataForPrediction(),
              });

              reqLogger.debug(
                {
                  requestId,
                  predictedCost: prediction.predictedCostUsd,
                  confidence: prediction.confidence,
                },
                "Cost prediction generated"
              );
            }
          } catch (predErr) {
            reqLogger.debug({ err: predErr }, "Cost prediction failed");
          }
        }
      }
    } catch (err) {
      // Don't block the request on analysis errors
      reqLogger.warn({ err }, "Pre-flight analysis failed");
    }

    return next();
  };
}

/**
 * Infer task type from prompt text.
 */
function inferTaskType(prompt: string): TaskType {
  const lower = prompt.toLowerCase();

  if (
    lower.includes("refactor") ||
    lower.includes("restructure") ||
    lower.includes("reorganize") ||
    lower.includes("clean up")
  ) {
    return "refactor";
  }

  if (
    lower.includes("debug") ||
    lower.includes("fix") ||
    lower.includes("bug") ||
    lower.includes("error") ||
    lower.includes("issue")
  ) {
    return "debug";
  }

  if (
    lower.includes("test") ||
    lower.includes("spec") ||
    lower.includes("coverage")
  ) {
    return "test";
  }

  if (
    lower.includes("add") ||
    lower.includes("implement") ||
    lower.includes("create") ||
    lower.includes("build") ||
    lower.includes("feature")
  ) {
    return "feature";
  }

  return "unknown";
}

// Export types for use in providers
export type { PruneSuggestion, PredictionResult };

/**
 * Get prune suggestion from context (if available)
 * Uses generic type to work with any context that has pruneSuggestion
 */
export function getPruneSuggestion<T extends { pruneSuggestion?: PruneSuggestion }>(
  c: Context<{ Variables: T }>
): PruneSuggestion | undefined {
  return c.get("pruneSuggestion") as PruneSuggestion | undefined;
}

/**
 * Get pre-flight analysis results from context (if available)
 */
export function getPreflightAnalysis<T extends { preflightAnalysis?: PreflightVariables["preflightAnalysis"] }>(
  c: Context<{ Variables: T }>
): PreflightVariables["preflightAnalysis"] | undefined {
  return c.get("preflightAnalysis") as PreflightVariables["preflightAnalysis"] | undefined;
}

/**
 * Get cost prediction from context (if available)
 */
export function getCostPrediction<T extends { costPrediction?: CostPredictionInfo }>(
  c: Context<{ Variables: T }>
): CostPredictionInfo | undefined {
  return c.get("costPrediction") as CostPredictionInfo | undefined;
}
