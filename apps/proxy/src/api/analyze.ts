import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import type { Logger } from "pino";
import {
  analyzeContext,
  generatePruneSuggestion,
  quickAnalyze,
  type ContextAnalysis,
  type PruneSuggestion,
} from "@prune/intelligence";
import type { AuthContext } from "../middleware/auth.js";

type Variables = {
  correlationId: string;
  logger: Logger;
  auth?: AuthContext;
};

export const analyzeRouter = new Hono<{ Variables: Variables }>();

// Schema for analyze request
const analyzeSchema = z.object({
  prompt: z.string().min(1, "Prompt is required"),
  context: z.string(),
  request_id: z.string().optional(),
  options: z
    .object({
      timeout_ms: z.number().max(1000).default(50),
      include_details: z.boolean().default(false),
    })
    .optional(),
});

export type AnalyzeRequest = z.infer<typeof analyzeSchema>;

// Response types
export interface AnalyzeResponse {
  request_id: string;
  analysis: ContextAnalysis | null;
  suggestion: PruneSuggestion | null;
  processing_time_ms: number;
  skipped: boolean;
  skip_reason?: string;
}

/**
 * POST /api/v1/analyze/context
 *
 * Analyzes the context for a request and returns a prune suggestion if warranted.
 * This endpoint is designed to be fast (<50ms) for pre-flight analysis.
 *
 * If context is small or analysis takes too long, returns null values.
 */
analyzeRouter.post(
  "/context",
  zValidator("json", analyzeSchema),
  async (c) => {
    const startTime = performance.now();
    const reqLogger = c.get("logger");
    const body = c.req.valid("json");
    const requestId = body.request_id ?? uuidv4();
    const timeoutMs = body.options?.timeout_ms ?? 50;

    reqLogger.debug({ requestId, promptLength: body.prompt.length, contextLength: body.context.length }, "Analyzing context");

    // Quick analyze with timeout - returns null if context is small or takes too long
    const analysis = await quickAnalyze(body.prompt, body.context, timeoutMs);
    const processingTime = performance.now() - startTime;

    if (!analysis) {
      reqLogger.debug({ requestId, processingTime }, "Context analysis skipped (small context or timeout)");
      return c.json<AnalyzeResponse>({
        request_id: requestId,
        analysis: null,
        suggestion: null,
        processing_time_ms: Math.round(processingTime * 100) / 100,
        skipped: true,
        skip_reason: "Context too small or analysis timed out",
      });
    }

    // Generate suggestion if warranted
    const suggestion = generatePruneSuggestion(requestId, analysis);

    reqLogger.info(
      {
        requestId,
        processingTime,
        totalTokens: analysis.totalTokens,
        relevantTokens: analysis.relevantTokens,
        noiseTokens: analysis.noiseTokens,
        hasSuggestion: suggestion !== null,
      },
      "Context analysis complete"
    );

    const response: AnalyzeResponse = {
      request_id: requestId,
      analysis: body.options?.include_details ? analysis : null,
      suggestion,
      processing_time_ms: Math.round(processingTime * 100) / 100,
      skipped: false,
    };

    return c.json(response);
  }
);

/**
 * POST /api/v1/analyze/full
 *
 * Performs a full context analysis without timeout constraints.
 * Use this for detailed analysis rather than pre-flight checks.
 */
analyzeRouter.post(
  "/full",
  zValidator("json", analyzeSchema),
  async (c) => {
    const startTime = performance.now();
    const reqLogger = c.get("logger");
    const body = c.req.valid("json");
    const requestId = body.request_id ?? uuidv4();

    reqLogger.debug({ requestId }, "Performing full context analysis");

    // Full analysis without timeout
    const analysis = analyzeContext(body.prompt, body.context);
    const suggestion = generatePruneSuggestion(requestId, analysis);
    const processingTime = performance.now() - startTime;

    reqLogger.info(
      {
        requestId,
        processingTime,
        totalTokens: analysis.totalTokens,
        relevantTokens: analysis.relevantTokens,
        noiseTokens: analysis.noiseTokens,
        blockCount: analysis.blocks.length,
        hasSuggestion: suggestion !== null,
      },
      "Full context analysis complete"
    );

    return c.json({
      request_id: requestId,
      analysis,
      suggestion,
      processing_time_ms: Math.round(processingTime * 100) / 100,
    });
  }
);
