import { v4 as uuidv4 } from "uuid";
import { db, events, sessions } from "@prune/db";
import { eq, sql } from "drizzle-orm";
import {
  calculateCost,
  type Provider,
  type ToolType,
} from "@prune/shared";
import { logger } from "../lib/logger.js";
import { publishTokenUpdate } from "../stream/publisher.js";
import { enqueueWasteDetection } from "../waste/queue.js";

interface CaptureEventParams {
  sessionId: string;
  userId: string;
  teamId: string | null;
  provider: Provider;
  tool: ToolType;
  model: string;
  tokensIn: number;
  tokensOut: number;
  tokensCached?: number;
  latencyMs: number;
  toolCalls?: string[];
  filesReferenced?: string[];
  contextSizeBefore?: number;
  contextSizeAfter?: number;
  compactionTriggered?: boolean;
  // ROI classification fields
  turnNumber?: number;
  responseContent?: string;
  filesWritten?: string[];
  testsPassed?: boolean | null;
}

/**
 * Capture and store a canonical event.
 * This function is designed to never throw - if anything fails, it logs and returns.
 * The proxy must continue to work even if event capture fails.
 */
export async function captureEvent(params: CaptureEventParams): Promise<void> {
  try {
    const {
      sessionId,
      userId,
      teamId,
      provider,
      model,
      tool,
      tokensIn,
      tokensOut,
      tokensCached = 0,
      latencyMs,
      toolCalls = [],
      filesReferenced = [],
      contextSizeBefore = 0,
      contextSizeAfter = 0,
      compactionTriggered = false,
      turnNumber = 0,
      responseContent,
      filesWritten = [],
      testsPassed = null,
    } = params;

    // Calculate cost
    const estimatedCostUsd = calculateCost(
      provider,
      model,
      tokensIn,
      tokensOut,
      tokensCached
    );

    // Get cumulative session cost and tokens
    const sessionResult = await db
      .select({
        totalCost: sessions.total_cost_usd,
        totalTokensIn: sessions.total_tokens_in,
        totalTokensOut: sessions.total_tokens_out,
      })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    const previousCost = sessionResult[0]?.totalCost ?? 0;
    const previousTokensIn = sessionResult[0]?.totalTokensIn ?? 0;
    const previousTokensOut = sessionResult[0]?.totalTokensOut ?? 0;
    const cumulativeSessionCostUsd = previousCost + estimatedCostUsd;
    const cumulativeSessionTokens =
      previousTokensIn + previousTokensOut + tokensIn + tokensOut;

    // Insert the event
    const eventId = uuidv4();
    await db.insert(events).values({
      id: eventId,
      session_id: sessionId,
      user_id: userId,
      team_id: teamId,
      timestamp: new Date(),
      provider,
      tool,
      model,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      tokens_cached: tokensCached,
      latency_ms: latencyMs,
      estimated_cost_usd: estimatedCostUsd,
      cumulative_session_cost_usd: cumulativeSessionCostUsd,
      tool_calls: toolCalls,
      files_referenced: filesReferenced,
      compaction_triggered: compactionTriggered,
      context_size_before: contextSizeBefore,
      context_size_after: contextSizeAfter,
      waste_flags: [],
      classification: "unknown",
      roi_score: 0,
      task_metadata: { type: "unknown", repo: null, branch: null },
    });

    // Update session totals
    await db
      .update(sessions)
      .set({
        total_tokens_in: sql`${sessions.total_tokens_in} + ${tokensIn}`,
        total_tokens_out: sql`${sessions.total_tokens_out} + ${tokensOut}`,
        total_cost_usd: cumulativeSessionCostUsd,
        event_count: sql`${sessions.event_count} + 1`,
      })
      .where(eq(sessions.id, sessionId));

    logger.info(
      {
        eventId,
        sessionId,
        provider,
        model,
        tokensIn,
        tokensOut,
        estimatedCostUsd,
      },
      "Event captured"
    );

    // Publish token update to WebSocket stream (fire and forget)
    try {
      publishTokenUpdate({
        eventId,
        sessionId,
        cumulativeSessionCostUsd,
        cumulativeSessionTokens,
        turnCost: estimatedCostUsd,
        turnTokens: tokensIn + tokensOut,
        roiScore: null, // ROI classification comes later
        model,
        provider,
      });
    } catch (err) {
      logger.error({ err, eventId }, "Failed to publish token update");
    }

    // Enqueue waste detection job (fire and forget)
    try {
      await enqueueWasteDetection({
        eventId,
        sessionId,
        userId,
        teamId,
        provider,
        model,
        tokensIn,
        tokensOut,
        estimatedCostUsd,
        toolCalls,
        filesReferenced,
        compactionTriggered,
        contextSizeBefore,
        contextSizeAfter,
        // ROI classification fields
        turnNumber,
        responseContent,
        filesWritten,
        testsPassed,
      });
    } catch (err) {
      logger.error({ err, eventId }, "Failed to enqueue waste detection");
    }
  } catch (err) {
    // CRITICAL: Never throw from event capture
    // The proxy must continue to work even if event capture fails
    logger.error({ err, params }, "Failed to capture event - continuing without capture");
  }
}

/**
 * Get or create a session for the user/provider/tool combination.
 * Sessions are grouped by provider and tool, and a new session is created
 * if there's no recent activity (configurable timeout).
 */
export async function getOrCreateSession(params: {
  userId: string;
  teamId: string | null;
  provider: Provider;
  tool: ToolType;
  model: string;
  sessionTimeoutMinutes?: number;
}): Promise<string> {
  const {
    userId,
    teamId,
    provider,
    tool,
    model,
    sessionTimeoutMinutes = 30,
  } = params;

  try {
    // Look for an existing active session
    const cutoff = new Date(Date.now() - sessionTimeoutMinutes * 60 * 1000);

    const existingSession = await db.query.sessions.findFirst({
      where: (s, { eq, and, isNull, gt }) =>
        and(
          eq(s.user_id, userId),
          eq(s.provider, provider),
          eq(s.tool, tool),
          isNull(s.ended_at),
          gt(s.started_at, cutoff)
        ),
      orderBy: (s, { desc }) => [desc(s.started_at)],
    });

    if (existingSession) {
      return existingSession.id;
    }

    // Create a new session
    const sessionId = uuidv4();
    await db.insert(sessions).values({
      id: sessionId,
      user_id: userId,
      team_id: teamId,
      provider,
      tool,
      model,
      started_at: new Date(),
      total_tokens_in: 0,
      total_tokens_out: 0,
      total_cost_usd: 0,
      event_count: 0,
    });

    logger.info(
      { sessionId, userId, provider, tool, model },
      "New session created"
    );

    return sessionId;
  } catch (err) {
    // If session creation fails, generate a random session ID
    // The proxy must continue to work
    logger.error({ err }, "Failed to get/create session - using ephemeral ID");
    return uuidv4();
  }
}
