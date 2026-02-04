import { v4 as uuidv4 } from "uuid";
import { db, events, alerts, sessions, compactionEvents } from "@prune/db";
import { eq, and, gt, desc, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { publishBurnAlert, publishCompactionEvent, publishTokenUpdate } from "../stream/publisher.js";
import type { WasteDetectionJobData } from "./queue.js";
import {
  classifyTurnROI,
  updateSessionROI,
  getModelRoutingSuggestion,
  createEmptySessionROI,
  getSessionBuffer,
  createMessageSummary,
  detectCompaction,
  analyzeCompaction,
  type TurnData,
  type SessionROI,
} from "@prune/intelligence";

// Cooldown tracking (in-memory for now, would use Redis in production)
const alertCooldowns = new Map<string, number>();

// Session ROI tracking (in-memory, would use Redis in production)
const sessionROIState = new Map<string, SessionROI>();

// Turn history for ROI classification (in-memory, would use Redis in production)
const sessionTurnHistory = new Map<string, TurnData[]>();

function getSessionROI(sessionId: string): SessionROI {
  let state = sessionROIState.get(sessionId);
  if (!state) {
    state = createEmptySessionROI();
    sessionROIState.set(sessionId, state);
  }
  return state;
}

function getTurnHistory(sessionId: string): TurnData[] {
  let history = sessionTurnHistory.get(sessionId);
  if (!history) {
    history = [];
    sessionTurnHistory.set(sessionId, history);
  }
  return history;
}

function getCooldownKey(sessionId: string, pattern: string): string {
  return `${sessionId}:${pattern}`;
}

function isOnCooldown(sessionId: string, pattern: string, cooldownSeconds: number): boolean {
  const key = getCooldownKey(sessionId, pattern);
  const lastAlert = alertCooldowns.get(key);
  if (!lastAlert) return false;
  return Date.now() - lastAlert < cooldownSeconds * 1000;
}

function setCooldown(sessionId: string, pattern: string): void {
  const key = getCooldownKey(sessionId, pattern);
  alertCooldowns.set(key, Date.now());
}

/**
 * Run all waste detection patterns for an event
 */
export async function runWasteDetection(data: WasteDetectionJobData): Promise<void> {
  // First, run ROI classification and compaction detection
  const roiResult = await runROIClassification(data);
  await runCompactionAudit(data);

  // Run all detectors in parallel
  await Promise.all([
    detectCircularLoop(data),
    detectRedundantReads(data),
    detectCompactionStorm(data),
    detectZeroAcceptance(data),
    detectMcpBloat(data),
    detectCostAnomaly(data),
    detectLowROI(data, roiResult),
  ]);
}

/**
 * Run ROI classification for the turn
 * Updates session ROI state and event classification
 */
async function runROIClassification(data: WasteDetectionJobData): Promise<{
  roiScore: number;
  classification: "productive" | "recursive" | "unknown";
  consecutiveLowRoiTurns: number;
} | null> {
  try {
    // Build turn data
    const turnData: TurnData = {
      turnNumber: data.turnNumber,
      responseContent: data.responseContent ?? "",
      filesWritten: data.filesWritten ?? [],
      filesRead: data.filesReferenced,
      testsPassed: data.testsPassed ?? null,
      errorsPresent: [], // Would be extracted from response content
      tokensIn: data.tokensIn,
      tokensOut: data.tokensOut,
      timestamp: new Date(),
    };

    // Get previous turns for this session
    const previousTurns = getTurnHistory(data.sessionId);

    // Classify this turn's ROI
    const turnAnalysis = classifyTurnROI(turnData, previousTurns);

    // Update session ROI state
    const sessionROI = getSessionROI(data.sessionId);
    const newSessionROI = updateSessionROI(sessionROI, turnAnalysis, turnData);
    sessionROIState.set(data.sessionId, newSessionROI);

    // Add turn to history (keep last 20 turns)
    previousTurns.push(turnData);
    if (previousTurns.length > 20) {
      previousTurns.shift();
    }

    // Update the event with ROI classification
    await db
      .update(events)
      .set({
        roi_score: turnAnalysis.roiScore,
        classification: turnAnalysis.classification,
      })
      .where(eq(events.id, data.eventId));

    // Update session cumulative ROI
    await db
      .update(sessions)
      .set({
        cumulative_roi_score: newSessionROI.cumulativeRoiScore,
        total_productive_tokens: newSessionROI.totalProductiveTokens,
        total_recursive_tokens: newSessionROI.totalRecursiveTokens,
        consecutive_low_roi_turns: newSessionROI.consecutiveLowRoiTurns,
      })
      .where(eq(sessions.id, data.sessionId));

    // Re-publish token update with ROI score
    const sessionResult = await db
      .select({
        totalCost: sessions.total_cost_usd,
        totalTokensIn: sessions.total_tokens_in,
        totalTokensOut: sessions.total_tokens_out,
      })
      .from(sessions)
      .where(eq(sessions.id, data.sessionId))
      .limit(1);

    const totalCost = sessionResult[0]?.totalCost ?? 0;
    const totalTokens =
      (sessionResult[0]?.totalTokensIn ?? 0) +
      (sessionResult[0]?.totalTokensOut ?? 0);

    publishTokenUpdate({
      eventId: data.eventId,
      sessionId: data.sessionId,
      cumulativeSessionCostUsd: totalCost,
      cumulativeSessionTokens: totalTokens,
      turnCost: data.estimatedCostUsd,
      turnTokens: data.tokensIn + data.tokensOut,
      roiScore: turnAnalysis.roiScore,
      model: data.model,
      provider: data.provider,
    });

    logger.info(
      {
        eventId: data.eventId,
        sessionId: data.sessionId,
        roiScore: turnAnalysis.roiScore,
        classification: turnAnalysis.classification,
        productiveSignals: turnAnalysis.signals.productive.length,
        recursiveSignals: turnAnalysis.signals.recursive.length,
      },
      "ROI classification completed"
    );

    return {
      roiScore: turnAnalysis.roiScore,
      classification: turnAnalysis.classification,
      consecutiveLowRoiTurns: newSessionROI.consecutiveLowRoiTurns,
    };
  } catch (err) {
    logger.error({ err, eventId: data.eventId }, "ROI classification failed");
    return null;
  }
}

/**
 * Run compaction audit if compaction was detected
 */
async function runCompactionAudit(data: WasteDetectionJobData): Promise<void> {
  if (!data.compactionTriggered) {
    return;
  }

  try {
    // Check if this is actually a significant compaction
    const isCompaction = detectCompaction(data.contextSizeBefore, data.contextSizeAfter);
    if (!isCompaction) {
      return;
    }

    // Get the message buffer for this session
    const buffer = getSessionBuffer(data.sessionId);

    // Add current message to buffer (would normally have more content)
    const summary = createMessageSummary(
      data.responseContent ?? "",
      data.turnNumber,
      "assistant"
    );
    buffer.addMessage(summary);

    // Analyze the compaction (estimate cost from model pricing, default $3 per 1M)
    const compactionDiff = analyzeCompaction(
      buffer,
      data.responseContent ?? "", // post-compaction content
      data.turnNumber,
      3 // cost per million tokens
    );

    // Store compaction event in database
    await db.insert(compactionEvents).values({
      id: uuidv4(),
      session_id: data.sessionId,
      user_id: data.userId,
      event_id: data.eventId,
      turn_number: compactionDiff.turnNumber,
      tokens_before: compactionDiff.tokensBefore,
      tokens_after: compactionDiff.tokensAfter,
      tokens_removed: compactionDiff.tokensRemoved,
      overhead_cost_usd: compactionDiff.overheadCostUsd,
      lost_references: compactionDiff.lostReferences.map((ref) => ({
        item: ref.item,
        original_turn: ref.original_turn,
        category: ref.category,
        rawValue: ref.rawValue,
      })),
      summary: compactionDiff.summary,
    });

    // Publish compaction event to WebSocket
    publishCompactionEvent({
      sessionId: data.sessionId,
      turnNumber: compactionDiff.turnNumber,
      tokensBefore: compactionDiff.tokensBefore,
      tokensAfter: compactionDiff.tokensAfter,
      tokensRemoved: compactionDiff.tokensRemoved,
      overheadCostUsd: compactionDiff.overheadCostUsd,
      lostReferences: compactionDiff.lostReferences.map((ref) => ({
        item: ref.item,
        original_turn: ref.original_turn,
        category: ref.category,
      })),
      summary: compactionDiff.summary,
    });

    logger.info(
      {
        sessionId: data.sessionId,
        turnNumber: compactionDiff.turnNumber,
        tokensRemoved: compactionDiff.tokensRemoved,
        lostReferenceCount: compactionDiff.lostReferences.length,
      },
      "Compaction audit completed"
    );
  } catch (err) {
    logger.error({ err, eventId: data.eventId }, "Compaction audit failed");
  }
}

/**
 * Pattern 7: Low ROI Detection
 * Trigger: ROI < 30% for 3+ consecutive turns
 */
async function detectLowROI(
  data: WasteDetectionJobData,
  roiResult: { roiScore: number; classification: string; consecutiveLowRoiTurns: number } | null
): Promise<void> {
  if (!roiResult || roiResult.consecutiveLowRoiTurns < 3) {
    return;
  }

  const COOLDOWN_SECONDS = 300;
  const PATTERN = "low_roi";

  if (isOnCooldown(data.sessionId, PATTERN, COOLDOWN_SECONDS)) {
    return;
  }

  try {
    // Get model routing suggestion
    const routingSuggestion = getModelRoutingSuggestion(
      data.model,
      roiResult.consecutiveLowRoiTurns
    );

    // Calculate wasted tokens from recent low ROI turns
    const sessionROI = getSessionROI(data.sessionId);
    const tokensWasted = sessionROI.totalRecursiveTokens;
    const costWasted = tokensWasted * 0.000003; // Rough estimate

    const suggestions: Array<{ label: string; action: string; detail: string }> = [];

    if (routingSuggestion?.suggestedModel) {
      suggestions.push({
        label: `Switch to ${routingSuggestion.suggestedModel.split("-").pop()}`,
        action: "model_suggestion",
        detail: routingSuggestion.message,
      });
    }

    suggestions.push(
      {
        label: "Compact",
        action: "command_suggestion",
        detail: "Type /compact to clear context",
      },
      { label: "Dismiss", action: "dismiss", detail: "" }
    );

    await createAlert({
      sessionId: data.sessionId,
      userId: data.userId,
      teamId: data.teamId,
      eventId: data.eventId,
      pattern: PATTERN,
      severity: "warning",
      tokensWasted,
      costWastedUsd: costWasted,
      fileInvolved: null,
      occurrences: roiResult.consecutiveLowRoiTurns,
      messageTitle: "Consider a different approach",
      messageBody: `The last ${roiResult.consecutiveLowRoiTurns} turns haven't produced much usable output. This sometimes happens when the task is unclear or the model is exploring different solutions.${routingSuggestion?.suggestedModel ? ` Switching to ${routingSuggestion.suggestedModel} could save ${routingSuggestion.savingsPercent}% while iterating.` : ""}`,
      suggestions,
      cooldownSeconds: COOLDOWN_SECONDS,
    });

    setCooldown(data.sessionId, PATTERN);
  } catch (err) {
    logger.error({ err, pattern: PATTERN }, "Low ROI detection failed");
  }
}

/**
 * Pattern 1: Circular Reasoning Loop
 * Trigger: 3+ code edits to same file with >80% similarity
 */
async function detectCircularLoop(data: WasteDetectionJobData): Promise<void> {
  const COOLDOWN_SECONDS = 300;
  const MIN_OCCURRENCES = 3;
  const PATTERN = "circular_loop";

  if (isOnCooldown(data.sessionId, PATTERN, COOLDOWN_SECONDS)) {
    return;
  }

  try {
    // Get recent events in this session with files_referenced
    const recentEvents = await db
      .select()
      .from(events)
      .where(eq(events.session_id, data.sessionId))
      .orderBy(desc(events.timestamp))
      .limit(10);

    // Group by file and count occurrences
    const fileOccurrences = new Map<string, number>();
    const fileTokens = new Map<string, number>();

    for (const event of recentEvents) {
      const files = event.files_referenced as string[];
      for (const file of files) {
        fileOccurrences.set(file, (fileOccurrences.get(file) ?? 0) + 1);
        fileTokens.set(
          file,
          (fileTokens.get(file) ?? 0) + event.tokens_in + event.tokens_out
        );
      }
    }

    // Find files with 3+ occurrences (potential loops)
    for (const [file, count] of fileOccurrences) {
      if (count >= MIN_OCCURRENCES) {
        const tokensWasted = fileTokens.get(file) ?? 0;
        const costWasted = recentEvents
          .filter((e) => (e.files_referenced as string[]).includes(file))
          .reduce((sum, e) => sum + e.estimated_cost_usd, 0);

        await createAlert({
          sessionId: data.sessionId,
          userId: data.userId,
          teamId: data.teamId,
          eventId: data.eventId,
          pattern: PATTERN,
          severity: "warning",
          tokensWasted,
          costWastedUsd: costWasted,
          fileInvolved: file,
          occurrences: count,
          messageTitle: "Loop detected",
          messageBody: `The model has rewritten ${file} ${count} times with similar edits. ${tokensWasted.toLocaleString()} tokens spent ($${costWasted.toFixed(2)}) with no progress.`,
          suggestions: [
            {
              label: "Switch to Haiku",
              action: "model_suggestion",
              detail: "Type /model and select haiku",
            },
            {
              label: "Compact",
              action: "command_suggestion",
              detail: "Type /compact",
            },
            { label: "Dismiss", action: "dismiss", detail: "" },
          ],
          cooldownSeconds: COOLDOWN_SECONDS,
        });

        setCooldown(data.sessionId, PATTERN);
        break; // Only one alert per detection run
      }
    }
  } catch (err) {
    logger.error({ err, pattern: PATTERN }, "Circular loop detection failed");
  }
}

/**
 * Pattern 2: Redundant File Reads
 * Trigger: Same file in files_referenced 3+ times
 */
async function detectRedundantReads(data: WasteDetectionJobData): Promise<void> {
  const COOLDOWN_SECONDS = 300;
  const MIN_READS = 3;
  const PATTERN = "redundant_reads";

  if (isOnCooldown(data.sessionId, PATTERN, COOLDOWN_SECONDS)) {
    return;
  }

  try {
    // Get all events in this session
    const sessionEvents = await db
      .select()
      .from(events)
      .where(eq(events.session_id, data.sessionId))
      .orderBy(desc(events.timestamp));

    // Count file reads across the session
    const fileReadCounts = new Map<string, number>();
    const fileTokens = new Map<string, number>();

    for (const event of sessionEvents) {
      const files = event.files_referenced as string[];
      for (const file of files) {
        fileReadCounts.set(file, (fileReadCounts.get(file) ?? 0) + 1);
        fileTokens.set(file, (fileTokens.get(file) ?? 0) + event.tokens_in);
      }
    }

    // Find files read 3+ times
    for (const [file, count] of fileReadCounts) {
      if (count >= MIN_READS) {
        const tokensWasted = fileTokens.get(file) ?? 0;
        // Estimate cost (only input tokens for reads)
        const avgCostPerToken = 0.000003; // ~$3 per 1M tokens
        const costWasted = tokensWasted * avgCostPerToken;

        await createAlert({
          sessionId: data.sessionId,
          userId: data.userId,
          teamId: data.teamId,
          eventId: data.eventId,
          pattern: PATTERN,
          severity: "warning",
          tokensWasted,
          costWastedUsd: costWasted,
          fileInvolved: file,
          occurrences: count,
          messageTitle: "Redundant reads",
          messageBody: `The model has re-read ${file} ${count} times this session. The file hasn't changed. ~${(tokensWasted / 1000).toFixed(0)}K tokens wasted ($${costWasted.toFixed(2)}).`,
          suggestions: [{ label: "Dismiss", action: "dismiss", detail: "" }],
          cooldownSeconds: COOLDOWN_SECONDS,
        });

        setCooldown(data.sessionId, PATTERN);
        break;
      }
    }
  } catch (err) {
    logger.error({ err, pattern: PATTERN }, "Redundant reads detection failed");
  }
}

/**
 * Pattern 3: Compaction Storm
 * Trigger: compaction_triggered true 2+ times in 60 minutes
 */
async function detectCompactionStorm(data: WasteDetectionJobData): Promise<void> {
  const COOLDOWN_SECONDS = 300;
  const MIN_COMPACTIONS = 2;
  const TIME_WINDOW_MINUTES = 60;
  const PATTERN = "compaction_storm";

  if (!data.compactionTriggered) {
    return; // Only check when compaction just happened
  }

  if (isOnCooldown(data.sessionId, PATTERN, COOLDOWN_SECONDS)) {
    return;
  }

  try {
    const cutoff = new Date(Date.now() - TIME_WINDOW_MINUTES * 60 * 1000);

    // Count compaction events in the time window
    const compactionEvents = await db
      .select()
      .from(events)
      .where(
        and(
          eq(events.session_id, data.sessionId),
          eq(events.compaction_triggered, true),
          gt(events.timestamp, cutoff)
        )
      );

    if (compactionEvents.length >= MIN_COMPACTIONS) {
      const tokensWasted = compactionEvents.length * 30000; // ~30K per compaction
      const costWasted = compactionEvents.reduce((sum, e) => sum + e.estimated_cost_usd * 0.3, 0);

      await createAlert({
        sessionId: data.sessionId,
        userId: data.userId,
        teamId: data.teamId,
        eventId: data.eventId,
        pattern: PATTERN,
        severity: "warning",
        tokensWasted,
        costWastedUsd: costWasted,
        fileInvolved: null,
        occurrences: compactionEvents.length,
        messageTitle: "Frequent context resets",
        messageBody: `Context has been summarized ${compactionEvents.length} times in the last ${TIME_WINDOW_MINUTES} minutes, adding ~${(tokensWasted / 1000).toFixed(0)}K tokens ($${costWasted.toFixed(2)}) in overhead. This session may be too long for the context window. Starting a fresh session with a clear task description will likely be more effective.`,
        suggestions: [
          { label: "Start fresh session", action: "command_suggestion", detail: "End this session and start a new one with a focused goal" },
          { label: "Dismiss", action: "dismiss", detail: "" },
        ],
        cooldownSeconds: COOLDOWN_SECONDS,
      });

      setCooldown(data.sessionId, PATTERN);
    }
  } catch (err) {
    logger.error({ err, pattern: PATTERN }, "Compaction storm detection failed");
  }
}

/**
 * Pattern 4: Rapid Undo / Zero Acceptance
 * Trigger: >30K tokens in 10 minutes with no persisted file writes
 */
async function detectZeroAcceptance(data: WasteDetectionJobData): Promise<void> {
  const COOLDOWN_SECONDS = 300;
  const TOKEN_THRESHOLD = 30000;
  const TIME_WINDOW_MINUTES = 10;
  const PATTERN = "zero_acceptance";

  if (isOnCooldown(data.sessionId, PATTERN, COOLDOWN_SECONDS)) {
    return;
  }

  try {
    const cutoff = new Date(Date.now() - TIME_WINDOW_MINUTES * 60 * 1000);

    // Get recent events
    const recentEvents = await db
      .select()
      .from(events)
      .where(and(eq(events.session_id, data.sessionId), gt(events.timestamp, cutoff)));

    // Calculate total tokens and check for write tool calls
    const totalTokens = recentEvents.reduce(
      (sum, e) => sum + e.tokens_in + e.tokens_out,
      0
    );
    const hasWrites = recentEvents.some((e) => {
      const toolCalls = e.tool_calls as string[];
      return toolCalls.some(
        (call) =>
          call.includes("write") ||
          call.includes("edit") ||
          call.includes("create")
      );
    });

    if (totalTokens >= TOKEN_THRESHOLD && !hasWrites) {
      const costWasted = recentEvents.reduce((sum, e) => sum + e.estimated_cost_usd, 0);
      const minutesElapsed = Math.round(
        (Date.now() - recentEvents[recentEvents.length - 1]!.timestamp.getTime()) / 60000
      );

      await createAlert({
        sessionId: data.sessionId,
        userId: data.userId,
        teamId: data.teamId,
        eventId: data.eventId,
        pattern: PATTERN,
        severity: "warning",
        tokensWasted: totalTokens,
        costWastedUsd: costWasted,
        fileInvolved: null,
        occurrences: recentEvents.length,
        messageTitle: "No accepted changes",
        messageBody: `${(totalTokens / 1000).toFixed(0)}K tokens used in the last ${minutesElapsed || TIME_WINDOW_MINUTES} minutes ($${costWasted.toFixed(2)}) without any code changes being accepted. Consider breaking the task into smaller pieces or providing a specific example of what you want.`,
        suggestions: [
          {
            label: "Try a faster model",
            action: "model_suggestion",
            detail: "A faster, cheaper model can help with exploratory iteration",
          },
          { label: "Dismiss", action: "dismiss", detail: "" },
        ],
        cooldownSeconds: COOLDOWN_SECONDS,
      });

      setCooldown(data.sessionId, PATTERN);
    }
  } catch (err) {
    logger.error({ err, pattern: PATTERN }, "Zero acceptance detection failed");
  }
}

/**
 * Pattern 5: MCP Overhead Bloat
 * Trigger: Tool call definitions >15% of tokens_in
 */
async function detectMcpBloat(data: WasteDetectionJobData): Promise<void> {
  const COOLDOWN_SECONDS = 300;
  const OVERHEAD_THRESHOLD = 0.15; // 15%
  const PATTERN = "mcp_bloat";

  if (isOnCooldown(data.sessionId, PATTERN, COOLDOWN_SECONDS)) {
    return;
  }

  try {
    // Estimate tool definition overhead from tool_calls
    // Each tool definition is roughly 200-500 tokens
    const estimatedToolOverhead = data.toolCalls.length * 350;
    const overheadRatio = estimatedToolOverhead / data.tokensIn;

    if (overheadRatio > OVERHEAD_THRESHOLD && data.toolCalls.length > 5) {
      const percentOverhead = Math.round(overheadRatio * 100);

      await createAlert({
        sessionId: data.sessionId,
        userId: data.userId,
        teamId: data.teamId,
        eventId: data.eventId,
        pattern: PATTERN,
        severity: "info",
        tokensWasted: estimatedToolOverhead,
        costWastedUsd: estimatedToolOverhead * 0.000003,
        fileInvolved: null,
        occurrences: data.toolCalls.length,
        messageTitle: "High tool overhead",
        messageBody: `MCP tool definitions are consuming ${percentOverhead}% of your context window (${(estimatedToolOverhead / 1000).toFixed(0)}K tokens) before any code or conversation. Consider disabling unused MCP servers for this session.`,
        suggestions: [{ label: "Dismiss", action: "dismiss", detail: "" }],
        cooldownSeconds: COOLDOWN_SECONDS,
      });

      setCooldown(data.sessionId, PATTERN);
    }
  } catch (err) {
    logger.error({ err, pattern: PATTERN }, "MCP bloat detection failed");
  }
}

/**
 * Pattern 6: Statistical Cost Anomaly
 * Trigger: Cost >3x the 30-day rolling average
 */
async function detectCostAnomaly(data: WasteDetectionJobData): Promise<void> {
  const COOLDOWN_SECONDS = 300;
  const ANOMALY_MULTIPLIER = 3;
  const PATTERN = "cost_anomaly";

  if (isOnCooldown(data.sessionId, PATTERN, COOLDOWN_SECONDS)) {
    return;
  }

  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Get historical costs for this user and model
    const historicalEvents = await db
      .select({
        avgCost: sql<number>`AVG(${events.estimated_cost_usd})`,
        stdDev: sql<number>`STDDEV(${events.estimated_cost_usd})`,
      })
      .from(events)
      .where(
        and(
          eq(events.user_id, data.userId),
          eq(events.model, data.model),
          gt(events.timestamp, thirtyDaysAgo)
        )
      );

    const avgCost = historicalEvents[0]?.avgCost ?? 0;
    const stdDev = historicalEvents[0]?.stdDev ?? 0;

    // Skip if not enough history
    if (avgCost === 0) {
      return;
    }

    // Check if current cost is anomalous (>3x average or >3 std devs)
    const isAnomaly =
      data.estimatedCostUsd > avgCost * ANOMALY_MULTIPLIER ||
      (stdDev > 0 && data.estimatedCostUsd > avgCost + 3 * stdDev);

    if (isAnomaly) {
      const multiplier = (data.estimatedCostUsd / avgCost).toFixed(1);

      await createAlert({
        sessionId: data.sessionId,
        userId: data.userId,
        teamId: data.teamId,
        eventId: data.eventId,
        pattern: PATTERN,
        severity: "warning",
        tokensWasted: data.tokensIn + data.tokensOut,
        costWastedUsd: data.estimatedCostUsd - avgCost,
        fileInvolved: null,
        occurrences: 1,
        messageTitle: "Unusual cost spike",
        messageBody: `Last request cost $${data.estimatedCostUsd.toFixed(2)} — your average for similar requests is $${avgCost.toFixed(2)}. That's ${multiplier}x higher than normal.`,
        suggestions: [
          {
            label: "View Details",
            action: "view_details",
            detail: `View session details`,
          },
          { label: "Dismiss", action: "dismiss", detail: "" },
        ],
        cooldownSeconds: COOLDOWN_SECONDS,
      });

      setCooldown(data.sessionId, PATTERN);
    }
  } catch (err) {
    logger.error({ err, pattern: PATTERN }, "Cost anomaly detection failed");
  }
}

/**
 * Create an alert in the database and publish to WebSocket
 */
async function createAlert(params: {
  sessionId: string;
  userId: string;
  teamId: string | null;
  eventId: string;
  pattern: string;
  severity: "warning" | "info";
  tokensWasted: number;
  costWastedUsd: number;
  fileInvolved: string | null;
  occurrences: number;
  messageTitle: string;
  messageBody: string;
  suggestions: Array<{ label: string; action: string; detail: string }>;
  cooldownSeconds: number;
}): Promise<void> {
  const alertId = uuidv4();

  try {
    // Store in database
    await db.insert(alerts).values({
      id: alertId,
      session_id: params.sessionId,
      user_id: params.userId,
      team_id: params.teamId,
      event_id: params.eventId,
      pattern: params.pattern as any,
      severity: params.severity as any,
      tokens_wasted: params.tokensWasted,
      cost_wasted_usd: params.costWastedUsd,
      file_involved: params.fileInvolved,
      occurrences: params.occurrences,
      message_title: params.messageTitle,
      message_body: params.messageBody,
      suggestions: params.suggestions,
      cooldown_seconds: params.cooldownSeconds,
    });

    // Publish to WebSocket stream
    publishBurnAlert({
      alertId,
      sessionId: params.sessionId,
      pattern: params.pattern,
      severity: params.severity,
      tokensWasted: params.tokensWasted,
      costWastedUsd: params.costWastedUsd,
      fileInvolved: params.fileInvolved,
      occurrences: params.occurrences,
      messageTitle: params.messageTitle,
      messageBody: params.messageBody,
      suggestions: params.suggestions,
      cooldownSeconds: params.cooldownSeconds,
    });

    logger.info(
      { alertId, pattern: params.pattern, sessionId: params.sessionId },
      "Waste alert created"
    );
  } catch (err) {
    logger.error({ err, params }, "Failed to create alert");
  }
}
