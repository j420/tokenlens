import { Hono } from "hono";
import type { Logger } from "pino";
import { db, events, sessions, alerts, compactionEvents } from "@prune/db";
import { eq, and, gte, sql, desc, count, sum, avg } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import type { AuthContext } from "../middleware/auth.js";

type Variables = {
  correlationId: string;
  logger: Logger;
  auth: AuthContext;
};

export const dashboardRouter = new Hono<{ Variables: Variables }>();

/**
 * GET /api/v1/dashboard/overview
 * Returns aggregated stats for the dashboard overview page
 */
dashboardRouter.get("/overview", async (c) => {
  const auth = c.get("auth");
  const period = c.req.query("period") || "today";
  const reqLogger = c.get("logger") ?? logger;

  try {
    // Calculate date range based on period
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case "week":
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "month":
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default: // today
        startDate = new Date(now.setHours(0, 0, 0, 0));
    }

    // Get total spend and token counts for the period
    const spendResult = await db
      .select({
        totalCost: sum(events.estimated_cost_usd),
        totalTokens: sum(sql`${events.tokens_in} + ${events.tokens_out}`),
        eventCount: count(),
      })
      .from(events)
      .where(
        and(
          eq(events.user_id, auth.userId),
          gte(events.timestamp, startDate)
        )
      );

    // Get session count
    const sessionResult = await db
      .select({ sessionCount: count() })
      .from(sessions)
      .where(
        and(
          eq(sessions.user_id, auth.userId),
          gte(sessions.started_at, startDate)
        )
      );

    // Get waste alerts for calculating ROI and savings
    const alertsResult = await db
      .select({
        alertCount: count(),
        totalWaste: sum(alerts.cost_wasted_usd),
      })
      .from(alerts)
      .innerJoin(sessions, eq(alerts.session_id, sessions.id))
      .where(
        and(
          eq(sessions.user_id, auth.userId),
          gte(alerts.created_at, startDate)
        )
      );

    // Get daily average (30-day lookback)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const avgResult = await db
      .select({
        avgDailyCost: avg(events.estimated_cost_usd),
      })
      .from(events)
      .where(
        and(
          eq(events.user_id, auth.userId),
          gte(events.timestamp, thirtyDaysAgo)
        )
      );

    // Get recent sessions
    const recentSessions = await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.user_id, auth.userId),
          gte(sessions.started_at, startDate)
        )
      )
      .orderBy(desc(sessions.started_at))
      .limit(10);

    // Get chart data (7-day breakdown)
    const chartData = [];
    for (let i = 6; i >= 0; i--) {
      const dayStart = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);

      const dayName = dayStart.toLocaleDateString("en-US", { weekday: "short" });

      const dayResult = await db
        .select({
          totalCost: sum(events.estimated_cost_usd),
        })
        .from(events)
        .where(
          and(
            eq(events.user_id, auth.userId),
            gte(events.timestamp, dayStart),
            sql`${events.timestamp} <= ${dayEnd}`
          )
        );

      const dayAlerts = await db
        .select({
          wasteCost: sum(alerts.cost_wasted_usd),
        })
        .from(alerts)
        .innerJoin(sessions, eq(alerts.session_id, sessions.id))
        .where(
          and(
            eq(sessions.user_id, auth.userId),
            gte(alerts.created_at, dayStart),
            sql`${alerts.created_at} <= ${dayEnd}`
          )
        );

      const totalCost = Number(dayResult[0]?.totalCost) || 0;
      const wasteCost = Number(dayAlerts[0]?.wasteCost) || 0;

      chartData.push({
        date: dayName,
        productive: Math.max(0, totalCost - wasteCost),
        waste: wasteCost,
      });
    }

    const totalCost = Number(spendResult[0]?.totalCost) || 0;
    const totalWaste = Number(alertsResult[0]?.totalWaste) || 0;
    const productiveRoi = totalCost > 0 ? (totalCost - totalWaste) / totalCost : 1;

    return c.json({
      todaySpend: totalCost,
      dailyAverage: Number(avgResult[0]?.avgDailyCost) || 0,
      sessions: sessionResult[0]?.sessionCount || 0,
      productiveRoi,
      pruneSaved: totalWaste * 0.5, // Estimate 50% savings from alerts
      pruneSavedDetails: {
        trims: 0, // Will implement with prune suggestions
        alerts: alertsResult[0]?.alertCount || 0,
      },
      totalEvents: spendResult[0]?.eventCount || 0,
      recentSessions: recentSessions.map((s) => ({
        id: s.id,
        tool: s.tool,
        taskDescription: s.description || "Untitled session",
        tokens: 0, // Would need to aggregate from events
        cost: 0, // Would need to aggregate from events
        roi: 0, // Would need to calculate
        wasteEvents: 0, // Would need to count from alerts
        compactions: 0, // Would need to count from events
        startTime: s.started_at,
      })),
      chartData,
    });
  } catch (err) {
    reqLogger.error({ err }, "Failed to fetch dashboard overview");
    return c.json({ error: "Failed to fetch dashboard data" }, 500);
  }
});

/**
 * GET /api/v1/dashboard/sessions
 * Returns paginated list of sessions
 */
dashboardRouter.get("/sessions", async (c) => {
  const auth = c.get("auth");
  const limit = parseInt(c.req.query("limit") || "20", 10);
  const offset = parseInt(c.req.query("offset") || "0", 10);
  const reqLogger = c.get("logger") ?? logger;

  try {
    const result = await db
      .select()
      .from(sessions)
      .where(eq(sessions.user_id, auth.userId))
      .orderBy(desc(sessions.started_at))
      .limit(limit)
      .offset(offset);

    const totalResult = await db
      .select({ total: count() })
      .from(sessions)
      .where(eq(sessions.user_id, auth.userId));

    return c.json({
      sessions: result.map((s) => ({
        id: s.id,
        tool: s.tool,
        model: s.model,
        taskDescription: s.description,
        startTime: s.started_at,
        endTime: s.ended_at,
      })),
      total: totalResult[0]?.total || 0,
      hasMore: offset + limit < (totalResult[0]?.total || 0),
    });
  } catch (err) {
    reqLogger.error({ err }, "Failed to fetch sessions");
    return c.json({ error: "Failed to fetch sessions" }, 500);
  }
});

/**
 * GET /api/v1/dashboard/session/:id
 * Returns detailed session information with turn-by-turn breakdown
 */
dashboardRouter.get("/session/:id", async (c) => {
  const auth = c.get("auth");
  const sessionId = c.req.param("id");
  const reqLogger = c.get("logger") ?? logger;

  try {
    // Get session
    const sessionResult = await db
      .select()
      .from(sessions)
      .where(
        and(eq(sessions.id, sessionId), eq(sessions.user_id, auth.userId))
      )
      .limit(1);

    const session = sessionResult[0];
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    // Get events for this session (turns)
    const sessionEvents = await db
      .select()
      .from(events)
      .where(eq(events.session_id, sessionId))
      .orderBy(events.timestamp);

    // Get alerts for this session
    const sessionAlerts = await db
      .select()
      .from(alerts)
      .where(eq(alerts.session_id, sessionId))
      .orderBy(alerts.created_at);

    // Calculate totals
    const totalTokens = sessionEvents.reduce(
      (sum, e) => sum + (e.tokens_in || 0) + (e.tokens_out || 0),
      0
    );
    const totalCost = sessionEvents.reduce(
      (sum, e) => sum + (e.estimated_cost_usd || 0),
      0
    );
    const totalWaste = sessionAlerts.reduce(
      (sum, a) => sum + (a.cost_wasted_usd || 0),
      0
    );

    // Build turns from events
    const turns = sessionEvents.map((e, i) => ({
      number: i + 1,
      time: e.timestamp,
      prompt: `Turn ${i + 1}`,
      tokensIn: e.tokens_in || 0,
      tokensOut: e.tokens_out || 0,
      cost: e.estimated_cost_usd || 0,
      roi: e.roi_score || 1,
      status: "clean" as const,
    }));

    // Find compactions
    const compactions = sessionEvents
      .filter((e) => e.compaction_triggered)
      .map((e, i) => ({
        turn: sessionEvents.indexOf(e) + 1,
        time: e.timestamp,
        tokensBefore: e.context_size_before || 0,
        tokensAfter: e.context_size_after || 0,
        lostReferences: [],
      }));

    return c.json({
      id: session.id,
      tool: session.tool,
      model: session.model,
      taskDescription: session.description,
      startTime: session.started_at,
      endTime: session.ended_at,
      totalTokens,
      totalCost,
      roi: totalCost > 0 ? (totalCost - totalWaste) / totalCost : 1,
      productiveCost: totalCost - totalWaste,
      wastedCost: totalWaste,
      wasteBreakdown: sessionAlerts.map((a) => ({
        pattern: a.pattern,
        cost: a.cost_wasted_usd || 0,
      })),
      pruneInterventions: {
        burnAlerts: sessionAlerts.length,
        compactionNotices: compactions.length,
      },
      estimatedSavings: totalWaste * 0.5,
      turns,
      compactions,
    });
  } catch (err) {
    reqLogger.error({ err }, "Failed to fetch session detail");
    return c.json({ error: "Failed to fetch session" }, 500);
  }
});

/**
 * GET /api/v1/dashboard/session/:id/compaction-diff
 * Returns compaction events and lost references for a session
 */
dashboardRouter.get("/session/:id/compaction-diff", async (c) => {
  const auth = c.get("auth");
  const sessionId = c.req.param("id");
  const reqLogger = c.get("logger") ?? logger;

  try {
    // Verify session belongs to user
    const sessionResult = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(eq(sessions.id, sessionId), eq(sessions.user_id, auth.userId))
      )
      .limit(1);

    if (sessionResult.length === 0) {
      return c.json({ error: "Session not found" }, 404);
    }

    // Get compaction events for this session
    const compactionDiffs = await db
      .select()
      .from(compactionEvents)
      .where(eq(compactionEvents.session_id, sessionId))
      .orderBy(desc(compactionEvents.created_at));

    // Format response
    const diffs = compactionDiffs.map((ce) => ({
      id: ce.id,
      turnNumber: ce.turn_number,
      tokensBefore: ce.tokens_before,
      tokensAfter: ce.tokens_after,
      tokensRemoved: ce.tokens_removed,
      overheadCostUsd: ce.overhead_cost_usd,
      lostReferences: ce.lost_references,
      summary: ce.summary,
      createdAt: ce.created_at,
    }));

    // Calculate aggregate stats
    const totalTokensRemoved = compactionDiffs.reduce(
      (sum, ce) => sum + ce.tokens_removed,
      0
    );
    const totalOverheadCost = compactionDiffs.reduce(
      (sum, ce) => sum + ce.overhead_cost_usd,
      0
    );
    const totalLostReferences = compactionDiffs.reduce(
      (sum, ce) => sum + (ce.lost_references?.length ?? 0),
      0
    );

    // Group lost references by category
    const lostByCategory: Record<string, number> = {};
    for (const ce of compactionDiffs) {
      for (const ref of ce.lost_references ?? []) {
        const category = ref.category || "unknown";
        lostByCategory[category] = (lostByCategory[category] ?? 0) + 1;
      }
    }

    return c.json({
      sessionId,
      compactionCount: compactionDiffs.length,
      totalTokensRemoved,
      totalOverheadCostUsd: totalOverheadCost,
      totalLostReferences,
      lostByCategory,
      diffs,
    });
  } catch (err) {
    reqLogger.error({ err }, "Failed to fetch compaction diff");
    return c.json({ error: "Failed to fetch compaction data" }, 500);
  }
});
