import type { Context, Next } from "hono";
import type { Logger } from "pino";
import { v4 as uuidv4 } from "uuid";
import {
  quickAnalyze,
  generatePruneSuggestion,
  type PruneSuggestion,
} from "@prune/intelligence";
import type { AuthContext } from "./auth.js";

// Base variables type for pre-flight analysis
// The auth field is optional here since we add it after auth middleware runs
type PreflightVariables = {
  correlationId: string;
  logger: Logger;
  auth?: AuthContext;
  pruneSuggestion?: PruneSuggestion;
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
  const { enabled = true, timeoutMs = 50 } = options;

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

    try {
      const body = await c.req.json();

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
      }
    } catch (err) {
      // Don't block the request on analysis errors
      reqLogger.warn({ err }, "Pre-flight analysis failed");
    }

    return next();
  };
}

// Export the prune suggestion type for use in providers
export type { PruneSuggestion };

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
