import { Hono } from "hono";
import { v4 as uuidv4 } from "uuid";
import { createHash, randomBytes } from "crypto";
import type { Logger } from "pino";
import {
  db,
  teams,
  teamMembers,
  teamInvites,
  teamApiKeys,
  budgetRules,
  budgetUsage,
  users,
  events,
  sessions,
  alerts,
} from "@prune/db";
import { eq, and, gte, lte, sql, desc, count, sum, avg } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import type { AuthContext } from "../middleware/auth.js";

type Variables = {
  correlationId: string;
  logger: Logger;
  auth: AuthContext;
};

export const teamRouter = new Hono<{ Variables: Variables }>();

// Helper to check if user is team admin
async function isTeamAdmin(userId: string, teamId: string): Promise<boolean> {
  const membership = await db
    .select({ role: teamMembers.role })
    .from(teamMembers)
    .where(and(eq(teamMembers.user_id, userId), eq(teamMembers.team_id, teamId)))
    .limit(1);
  return membership[0]?.role === "admin";
}

// Helper to generate API key
function generateApiKey(prefix: string): { key: string; hash: string; displayPrefix: string } {
  const randomPart = randomBytes(24).toString("base64url");
  const key = `${prefix}${randomPart}`;
  const hash = createHash("sha256").update(key).digest("hex");
  const displayPrefix = `${prefix}${randomPart.slice(0, 8)}`;
  return { key, hash, displayPrefix };
}

/**
 * POST /api/v1/team
 * Create a new team
 */
teamRouter.post("/", async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json<{ name: string }>();

  try {
    // Create team
    const teamId = uuidv4();
    await db.insert(teams).values({
      id: teamId,
      name: body.name,
    });

    // Add creator as admin
    await db.insert(teamMembers).values({
      team_id: teamId,
      user_id: auth.userId,
      role: "admin",
    });

    // Generate team API key
    const { key, hash, displayPrefix } = generateApiKey("prune_tk_");
    await db.insert(teamApiKeys).values({
      team_id: teamId,
      key_hash: hash,
      key_prefix: displayPrefix,
      name: "Default Team Key",
      created_by: auth.userId,
    });

    return c.json({
      id: teamId,
      name: body.name,
      apiKey: key, // Only returned once at creation
    });
  } catch (err) {
    logger.error({ err }, "Failed to create team");
    return c.json({ error: "Failed to create team" }, 500);
  }
});

/**
 * GET /api/v1/team/:id
 * Get team details
 */
teamRouter.get("/:id", async (c) => {
  const auth = c.get("auth");
  const teamId = c.req.param("id");

  try {
    // Check membership
    const membership = await db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.team_id, teamId), eq(teamMembers.user_id, auth.userId)))
      .limit(1);

    if (membership.length === 0) {
      return c.json({ error: "Not a member of this team" }, 403);
    }

    const team = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
    if (team.length === 0) {
      return c.json({ error: "Team not found" }, 404);
    }

    const members = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: teamMembers.role,
        joined_at: teamMembers.joined_at,
      })
      .from(teamMembers)
      .innerJoin(users, eq(teamMembers.user_id, users.id))
      .where(eq(teamMembers.team_id, teamId));

    return c.json({
      ...team[0],
      members,
      role: membership[0]!.role,
    });
  } catch (err) {
    logger.error({ err }, "Failed to get team");
    return c.json({ error: "Failed to get team" }, 500);
  }
});

/**
 * POST /api/v1/team/:id/invite
 * Invite a member by email
 */
teamRouter.post("/:id/invite", async (c) => {
  const auth = c.get("auth");
  const teamId = c.req.param("id");
  const body = await c.req.json<{ email: string; role?: "admin" | "member" | "viewer" }>();

  try {
    if (!(await isTeamAdmin(auth.userId, teamId))) {
      return c.json({ error: "Only admins can invite members" }, 403);
    }

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await db.insert(teamInvites).values({
      team_id: teamId,
      email: body.email,
      role: body.role || "member",
      invited_by: auth.userId,
      token,
      expires_at: expiresAt,
    });

    return c.json({
      message: "Invite sent",
      inviteLink: `https://delimit.dev/invite/${token}`,
    });
  } catch (err) {
    logger.error({ err }, "Failed to create invite");
    return c.json({ error: "Failed to create invite" }, 500);
  }
});

/**
 * POST /api/v1/team/accept-invite/:token
 * Accept a team invite
 */
teamRouter.post("/accept-invite/:token", async (c) => {
  const auth = c.get("auth");
  const token = c.req.param("token");

  try {
    const invite = await db
      .select()
      .from(teamInvites)
      .where(eq(teamInvites.token, token))
      .limit(1);

    if (invite.length === 0) {
      return c.json({ error: "Invalid invite" }, 404);
    }

    const inv = invite[0]!;
    if (inv.accepted_at) {
      return c.json({ error: "Invite already used" }, 400);
    }
    if (inv.expires_at < new Date()) {
      return c.json({ error: "Invite expired" }, 400);
    }

    // Check email matches
    const user = await db.select().from(users).where(eq(users.id, auth.userId)).limit(1);
    if (user[0]?.email !== inv.email) {
      return c.json({ error: "Invite is for a different email" }, 403);
    }

    // Add to team
    await db.insert(teamMembers).values({
      team_id: inv.team_id,
      user_id: auth.userId,
      role: inv.role,
    });

    // Mark invite as accepted
    await db
      .update(teamInvites)
      .set({ accepted_at: new Date() })
      .where(eq(teamInvites.id, inv.id));

    return c.json({ message: "Joined team successfully", teamId: inv.team_id });
  } catch (err) {
    logger.error({ err }, "Failed to accept invite");
    return c.json({ error: "Failed to accept invite" }, 500);
  }
});

/**
 * POST /api/v1/team/:id/budget
 * Create a budget rule
 */
teamRouter.post("/:id/budget", async (c) => {
  const auth = c.get("auth");
  const teamId = c.req.param("id");
  const body = await c.req.json<{
    name: string;
    budget_type: "daily_developer" | "monthly_project" | "monthly_team";
    limit_usd: number;
    action?: "block" | "warn" | "downgrade";
    user_id?: string;
    project_name?: string;
    downgrade_model?: string;
    downgrade_threshold_percent?: number;
    warn_at_percent?: number;
  }>();

  try {
    if (!(await isTeamAdmin(auth.userId, teamId))) {
      return c.json({ error: "Only admins can create budgets" }, 403);
    }

    const ruleId = uuidv4();
    await db.insert(budgetRules).values({
      id: ruleId,
      team_id: teamId,
      name: body.name,
      budget_type: body.budget_type,
      limit_usd: body.limit_usd,
      action: body.action || "block",
      user_id: body.user_id,
      project_name: body.project_name,
      downgrade_model: body.downgrade_model,
      downgrade_threshold_percent: body.downgrade_threshold_percent,
      warn_at_percent: body.warn_at_percent || 80,
    });

    return c.json({ id: ruleId, message: "Budget rule created" });
  } catch (err) {
    logger.error({ err }, "Failed to create budget rule");
    return c.json({ error: "Failed to create budget rule" }, 500);
  }
});

/**
 * GET /api/v1/team/:id/budgets
 * List budget rules
 */
teamRouter.get("/:id/budgets", async (c) => {
  const auth = c.get("auth");
  const teamId = c.req.param("id");

  try {
    const membership = await db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.team_id, teamId), eq(teamMembers.user_id, auth.userId)))
      .limit(1);

    if (membership.length === 0) {
      return c.json({ error: "Not a member of this team" }, 403);
    }

    const rules = await db
      .select()
      .from(budgetRules)
      .where(eq(budgetRules.team_id, teamId))
      .orderBy(desc(budgetRules.created_at));

    return c.json({ rules });
  } catch (err) {
    logger.error({ err }, "Failed to list budget rules");
    return c.json({ error: "Failed to list budget rules" }, 500);
  }
});

/**
 * PUT /api/v1/team/:id/budget/:ruleId
 * Update a budget rule
 */
teamRouter.put("/:id/budget/:ruleId", async (c) => {
  const auth = c.get("auth");
  const teamId = c.req.param("id");
  const ruleId = c.req.param("ruleId");
  const body = await c.req.json<Partial<{
    name: string;
    limit_usd: number;
    action: "block" | "warn" | "downgrade";
    enabled: boolean;
    warn_at_percent: number;
  }>>();

  try {
    if (!(await isTeamAdmin(auth.userId, teamId))) {
      return c.json({ error: "Only admins can update budgets" }, 403);
    }

    await db
      .update(budgetRules)
      .set({ ...body, updated_at: new Date() })
      .where(and(eq(budgetRules.id, ruleId), eq(budgetRules.team_id, teamId)));

    return c.json({ message: "Budget rule updated" });
  } catch (err) {
    logger.error({ err }, "Failed to update budget rule");
    return c.json({ error: "Failed to update budget rule" }, 500);
  }
});

/**
 * PUT /api/v1/team/:id/slack
 * Update Slack webhook URL
 */
teamRouter.put("/:id/slack", async (c) => {
  const auth = c.get("auth");
  const teamId = c.req.param("id");
  const body = await c.req.json<{ webhook_url: string }>();

  try {
    if (!(await isTeamAdmin(auth.userId, teamId))) {
      return c.json({ error: "Only admins can update Slack settings" }, 403);
    }

    await db
      .update(teams)
      .set({ slack_webhook_url: body.webhook_url, updated_at: new Date() })
      .where(eq(teams.id, teamId));

    return c.json({ message: "Slack webhook updated" });
  } catch (err) {
    logger.error({ err }, "Failed to update Slack webhook");
    return c.json({ error: "Failed to update Slack webhook" }, 500);
  }
});

/**
 * GET /api/v1/team/:id/dashboard
 * Team dashboard data (following CLAUDE.md spec)
 */
teamRouter.get("/:id/dashboard", async (c) => {
  const auth = c.get("auth");
  const teamId = c.req.param("id");

  try {
    // Check membership
    const membership = await db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.team_id, teamId), eq(teamMembers.user_id, auth.userId)))
      .limit(1);

    if (membership.length === 0) {
      return c.json({ error: "Not a member of this team" }, 403);
    }

    // Get date ranges
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const daysRemaining = Math.ceil((monthEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    // This month's spend
    const spendResult = await db
      .select({
        totalCost: sum(events.estimated_cost_usd),
        totalTokens: sum(sql`${events.tokens_in} + ${events.tokens_out}`),
      })
      .from(events)
      .where(and(eq(events.team_id, teamId), gte(events.timestamp, monthStart)));

    // Get team budget (if any)
    const teamBudget = await db
      .select()
      .from(budgetRules)
      .where(
        and(
          eq(budgetRules.team_id, teamId),
          eq(budgetRules.budget_type, "monthly_team"),
          eq(budgetRules.enabled, true)
        )
      )
      .limit(1);

    // Waste this month
    const wasteResult = await db
      .select({ totalWaste: sum(alerts.cost_wasted_usd) })
      .from(alerts)
      .where(and(eq(alerts.team_id, teamId), gte(alerts.created_at, monthStart)));

    const totalSpend = Number(spendResult[0]?.totalCost) || 0;
    const totalWaste = Number(wasteResult[0]?.totalWaste) || 0;
    const budget = teamBudget[0]?.limit_usd || null;
    const budgetUsedPercent = budget ? (totalSpend / budget) * 100 : 0;

    // Team ROI
    const roiResult = await db
      .select({ avgRoi: avg(sessions.cumulative_roi_score) })
      .from(sessions)
      .where(and(eq(sessions.team_id, teamId), gte(sessions.started_at, monthStart)));

    // By Developer stats
    const developerStats = await db
      .select({
        userId: events.user_id,
        spend: sum(events.estimated_cost_usd),
        tokens: sum(sql`${events.tokens_in} + ${events.tokens_out}`),
        sessionCount: count(sql`DISTINCT ${events.session_id}`),
      })
      .from(events)
      .where(and(eq(events.team_id, teamId), gte(events.timestamp, monthStart)))
      .groupBy(events.user_id);

    // Get user details and calculate tool mix
    const developerDetails = await Promise.all(
      developerStats.map(async (dev) => {
        const user = await db.select().from(users).where(eq(users.id, dev.userId)).limit(1);

        // Get tool mix
        const toolMix = await db
          .select({
            tool: events.tool,
            count: count(),
          })
          .from(events)
          .where(
            and(
              eq(events.team_id, teamId),
              eq(events.user_id, dev.userId),
              gte(events.timestamp, monthStart)
            )
          )
          .groupBy(events.tool);

        // Get ROI
        const devRoi = await db
          .select({ avgRoi: avg(sessions.cumulative_roi_score) })
          .from(sessions)
          .where(
            and(
              eq(sessions.team_id, teamId),
              eq(sessions.user_id, dev.userId),
              gte(sessions.started_at, monthStart)
            )
          );

        // Get waste
        const devWaste = await db
          .select({ totalWaste: sum(alerts.cost_wasted_usd) })
          .from(alerts)
          .where(
            and(
              eq(alerts.team_id, teamId),
              eq(alerts.user_id, dev.userId),
              gte(alerts.created_at, monthStart)
            )
          );

        const totalToolCount = toolMix.reduce((sum, t) => sum + Number(t.count), 0);
        const toolMixFormatted = toolMix.map((t) => ({
          tool: t.tool,
          percent: totalToolCount > 0 ? Math.round((Number(t.count) / totalToolCount) * 100) : 0,
        }));

        return {
          id: dev.userId,
          name: user[0]?.name || user[0]?.email || "Unknown",
          email: user[0]?.email,
          spend: Number(dev.spend) || 0,
          roi: Number(devRoi[0]?.avgRoi) || 1,
          waste: Number(devWaste[0]?.totalWaste) || 0,
          sessions: Number(dev.sessionCount) || 0,
          toolMix: toolMixFormatted,
        };
      })
    );

    // By Project stats
    const projectStats = await db
      .select({
        project: sql<string>`${events.task_metadata}->>'repo'`,
        spend: sum(events.estimated_cost_usd),
      })
      .from(events)
      .where(
        and(
          eq(events.team_id, teamId),
          gte(events.timestamp, monthStart),
          sql`${events.task_metadata}->>'repo' IS NOT NULL`
        )
      )
      .groupBy(sql`${events.task_metadata}->>'repo'`);

    const projectDetails = await Promise.all(
      projectStats.map(async (proj) => {
        // Get ROI for project
        const projRoi = await db
          .select({ avgRoi: avg(sessions.cumulative_roi_score) })
          .from(sessions)
          .innerJoin(events, eq(events.session_id, sessions.id))
          .where(
            and(
              eq(sessions.team_id, teamId),
              gte(sessions.started_at, monthStart),
              sql`${events.task_metadata}->>'repo' = ${proj.project}`
            )
          );

        // Get top waste pattern for project
        const topWaste = await db
          .select({
            pattern: alerts.pattern,
            totalCost: sum(alerts.cost_wasted_usd),
          })
          .from(alerts)
          .innerJoin(events, eq(alerts.event_id, events.id))
          .where(
            and(
              eq(alerts.team_id, teamId),
              gte(alerts.created_at, monthStart),
              sql`${events.task_metadata}->>'repo' = ${proj.project}`
            )
          )
          .groupBy(alerts.pattern)
          .orderBy(desc(sum(alerts.cost_wasted_usd)))
          .limit(1);

        return {
          name: proj.project,
          spend: Number(proj.spend) || 0,
          roi: Number(projRoi[0]?.avgRoi) || 1,
          topWastePattern: topWaste[0]?.pattern || null,
          topWasteCost: Number(topWaste[0]?.totalCost) || 0,
        };
      })
    );

    // Budget rules
    const rules = await db
      .select()
      .from(budgetRules)
      .where(and(eq(budgetRules.team_id, teamId), eq(budgetRules.enabled, true)));

    // Get team info
    const team = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);

    return c.json({
      monthSpend: totalSpend,
      budget,
      budgetUsedPercent,
      daysRemaining,
      teamRoi: Number(roiResult[0]?.avgRoi) || 1,
      totalWaste,
      pruneSaved: totalWaste * 0.5, // Estimate
      developers: developerDetails,
      projects: projectDetails.filter((p) => p.name),
      budgetRules: rules,
      slackWebhook: team[0]?.slack_webhook_url ? "configured" : null,
    });
  } catch (err) {
    logger.error({ err }, "Failed to get team dashboard");
    return c.json({ error: "Failed to get team dashboard" }, 500);
  }
});
