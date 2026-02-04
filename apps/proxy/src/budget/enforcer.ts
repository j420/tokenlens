/**
 * Budget Enforcement Module
 *
 * Checks budget rules before forwarding requests and enforces:
 * - Per-developer daily caps
 * - Per-project monthly budgets
 * - Model downgrade rules
 * - Near-budget warnings
 */

import { db, budgetRules, budgetUsage, events, teams, users } from "@prune/db";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { publishBurnAlert } from "../stream/publisher.js";

// Model downgrade mapping
const MODEL_DOWNGRADES: Record<string, string> = {
  // Anthropic
  "claude-sonnet-4-20250514": "claude-3-haiku-20240307",
  "claude-3-5-sonnet-20241022": "claude-3-haiku-20240307",
  "claude-3-opus-20240229": "claude-3-5-sonnet-20241022",
  // OpenAI
  "gpt-4o": "gpt-4o-mini",
  "gpt-4-turbo": "gpt-4o-mini",
  "gpt-4": "gpt-4o-mini",
  // Google
  "gemini-1.5-pro": "gemini-1.5-flash",
  "gemini-pro": "gemini-1.5-flash",
};

export interface BudgetCheckResult {
  allowed: boolean;
  blocked: boolean;
  downgraded: boolean;
  originalModel?: string;
  newModel?: string;
  error?: {
    type: "daily_budget_exceeded" | "project_budget_exceeded" | "team_budget_exceeded";
    message: string;
    budget: number;
    spent: number;
  };
  warning?: {
    type: "budget_warning";
    message: string;
    percentUsed: number;
    budget: number;
    spent: number;
  };
}

/**
 * Check all applicable budget rules for a request
 */
export async function checkBudget(params: {
  userId: string;
  teamId: string | null;
  model: string;
  projectName?: string | null;
  sessionId: string;
  estimatedCostUsd: number;
}): Promise<BudgetCheckResult> {
  const { userId, teamId, model, projectName, sessionId, estimatedCostUsd } = params;

  // No team = no budget enforcement
  if (!teamId) {
    return { allowed: true, blocked: false, downgraded: false };
  }

  try {
    // Get all applicable budget rules for this team
    const rules = await db
      .select()
      .from(budgetRules)
      .where(and(eq(budgetRules.team_id, teamId), eq(budgetRules.enabled, true)));

    if (rules.length === 0) {
      return { allowed: true, blocked: false, downgraded: false };
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    let result: BudgetCheckResult = { allowed: true, blocked: false, downgraded: false };

    for (const rule of rules) {
      // Determine the period for this rule
      const periodStart = rule.budget_type === "daily_developer" ? todayStart : monthStart;

      // Check if this rule applies to this user/project
      if (rule.budget_type === "daily_developer" && rule.user_id && rule.user_id !== userId) {
        continue; // Rule is for a specific user, not this one
      }
      if (rule.budget_type === "monthly_project" && rule.project_name && rule.project_name !== projectName) {
        continue; // Rule is for a specific project, not this one
      }

      // Get current spend for this period
      const spendResult = await db
        .select({ totalSpend: sql<number>`COALESCE(SUM(${events.estimated_cost_usd}), 0)` })
        .from(events)
        .where(
          and(
            rule.budget_type === "daily_developer" || rule.budget_type === "monthly_project"
              ? eq(events.user_id, userId)
              : eq(events.team_id, teamId),
            eq(events.team_id, teamId),
            gte(events.timestamp, periodStart),
            rule.project_name
              ? sql`${events.task_metadata}->>'repo' = ${rule.project_name}`
              : sql`1=1`
          )
        );

      const currentSpend = Number(spendResult[0]?.totalSpend) || 0;
      const projectedSpend = currentSpend + estimatedCostUsd;
      const percentUsed = (currentSpend / rule.limit_usd) * 100;

      // Check if budget would be exceeded
      if (projectedSpend > rule.limit_usd) {
        if (rule.action === "block") {
          result = {
            allowed: false,
            blocked: true,
            downgraded: false,
            error: {
              type: rule.budget_type === "daily_developer"
                ? "daily_budget_exceeded"
                : rule.budget_type === "monthly_project"
                  ? "project_budget_exceeded"
                  : "team_budget_exceeded",
              message: getBudgetExceededMessage(rule.budget_type, rule.limit_usd, currentSpend),
              budget: rule.limit_usd,
              spent: currentSpend,
            },
          };
          return result;
        }
      }

      // Check downgrade threshold
      if (
        rule.action === "downgrade" &&
        rule.downgrade_threshold_percent &&
        rule.downgrade_model &&
        percentUsed >= rule.downgrade_threshold_percent
      ) {
        const newModel = rule.downgrade_model || MODEL_DOWNGRADES[model];
        if (newModel && newModel !== model) {
          result.downgraded = true;
          result.originalModel = model;
          result.newModel = newModel;

          // Emit notification about the downgrade
          await emitDowngradeNotification(sessionId, userId, model, newModel, percentUsed, rule.limit_usd);
        }
      }

      // Check warning threshold
      if (rule.warn_at_percent && percentUsed >= rule.warn_at_percent && percentUsed < 100) {
        result.warning = {
          type: "budget_warning",
          message: `You've used ${percentUsed.toFixed(0)}% of your ${rule.name} budget ($${currentSpend.toFixed(2)} of $${rule.limit_usd.toFixed(2)})`,
          percentUsed,
          budget: rule.limit_usd,
          spent: currentSpend,
        };

        // Emit budget warning alert
        await emitBudgetWarning(sessionId, userId, teamId, rule.name, percentUsed, rule.limit_usd, currentSpend);
      }
    }

    return result;
  } catch (err) {
    logger.error({ err, userId, teamId }, "Budget check failed - allowing request");
    // On error, allow the request through (fail-open)
    return { allowed: true, blocked: false, downgraded: false };
  }
}

function getBudgetExceededMessage(
  budgetType: string,
  limit: number,
  spent: number
): string {
  switch (budgetType) {
    case "daily_developer":
      return `Your daily AI budget of $${limit.toFixed(2)} has been reached (spent: $${spent.toFixed(2)}). Contact your team admin or wait until tomorrow.`;
    case "monthly_project":
      return `This project's monthly budget of $${limit.toFixed(2)} has been reached (spent: $${spent.toFixed(2)}). Contact your team admin.`;
    case "monthly_team":
      return `Your team's monthly budget of $${limit.toFixed(2)} has been reached (spent: $${spent.toFixed(2)}). Contact your team admin.`;
    default:
      return `Budget limit of $${limit.toFixed(2)} exceeded.`;
  }
}

async function emitDowngradeNotification(
  sessionId: string,
  userId: string,
  originalModel: string,
  newModel: string,
  percentUsed: number,
  budgetLimit: number
): Promise<void> {
  publishBurnAlert({
    alertId: `downgrade-${Date.now()}`,
    sessionId,
    pattern: "budget_warning",
    severity: "info",
    tokensWasted: 0,
    costWastedUsd: 0,
    fileInvolved: null,
    occurrences: 1,
    messageTitle: "Model downgraded",
    messageBody: `Switched from ${originalModel} to ${newModel} because you've used ${percentUsed.toFixed(0)}% of your budget ($${budgetLimit.toFixed(2)}). This saves ~80% per request.`,
    suggestions: [
      { label: "View Budget", action: "view_details", detail: "Check your team's budget settings" },
      { label: "Dismiss", action: "dismiss", detail: "" },
    ],
    cooldownSeconds: 300,
  });
}

async function emitBudgetWarning(
  sessionId: string,
  userId: string,
  teamId: string,
  ruleName: string,
  percentUsed: number,
  budgetLimit: number,
  spent: number
): Promise<void> {
  // Don't spam warnings - check cooldown
  const cooldownKey = `budget_warning:${userId}:${ruleName}`;
  // In production, use Redis for cooldown tracking

  publishBurnAlert({
    alertId: `budget-warning-${Date.now()}`,
    sessionId,
    pattern: "budget_warning",
    severity: "warning",
    tokensWasted: 0,
    costWastedUsd: 0,
    fileInvolved: null,
    occurrences: 1,
    messageTitle: "Budget warning",
    messageBody: `You've used ${percentUsed.toFixed(0)}% of your ${ruleName} budget ($${spent.toFixed(2)} of $${budgetLimit.toFixed(2)}).`,
    suggestions: [
      { label: "View Budget", action: "view_details", detail: "Check your budget in settings" },
      { label: "Dismiss", action: "dismiss", detail: "" },
    ],
    cooldownSeconds: 1800, // 30 minute cooldown for budget warnings
  });

  // Send Slack notification if configured
  await sendSlackBudgetAlert(teamId, userId, ruleName, percentUsed, budgetLimit, spent);
}

/**
 * Send budget alert to Slack webhook
 */
async function sendSlackBudgetAlert(
  teamId: string,
  userId: string,
  ruleName: string,
  percentUsed: number,
  budgetLimit: number,
  spent: number
): Promise<void> {
  try {
    const team = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
    const webhookUrl = team[0]?.slack_webhook_url;

    if (!webhookUrl) return;

    const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const userName = user[0]?.name || user[0]?.email || "Unknown";

    const payload = {
      text: `Budget Alert: ${ruleName}`,
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: `⚠️ Budget Alert: ${ruleName}`, emoji: true },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Developer:*\n${userName}` },
            { type: "mrkdwn", text: `*Budget:*\n${ruleName}` },
            { type: "mrkdwn", text: `*Used:*\n${percentUsed.toFixed(0)}%` },
            { type: "mrkdwn", text: `*Spent:*\n$${spent.toFixed(2)} / $${budgetLimit.toFixed(2)}` },
          ],
        },
      ],
    };

    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    logger.error({ err, teamId }, "Failed to send Slack budget alert");
  }
}

/**
 * Update budget usage after a request is processed
 */
export async function updateBudgetUsage(params: {
  userId: string;
  teamId: string | null;
  costUsd: number;
  tokenCount: number;
}): Promise<void> {
  const { userId, teamId, costUsd, tokenCount } = params;

  if (!teamId) return;

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    // Get all applicable rules
    const rules = await db
      .select()
      .from(budgetRules)
      .where(and(eq(budgetRules.team_id, teamId), eq(budgetRules.enabled, true)));

    for (const rule of rules) {
      const periodStart = rule.budget_type === "daily_developer" ? todayStart : monthStart;
      const periodEnd = rule.budget_type === "daily_developer" ? todayEnd : monthEnd;

      // Upsert usage record
      const existingUsage = await db
        .select()
        .from(budgetUsage)
        .where(
          and(
            eq(budgetUsage.rule_id, rule.id),
            rule.budget_type === "daily_developer" ? eq(budgetUsage.user_id, userId) : sql`1=1`,
            gte(budgetUsage.period_start, periodStart),
            lte(budgetUsage.period_end, periodEnd)
          )
        )
        .limit(1);

      if (existingUsage.length > 0) {
        await db
          .update(budgetUsage)
          .set({
            spent_usd: sql`${budgetUsage.spent_usd} + ${costUsd}`,
            token_count: sql`${budgetUsage.token_count} + ${tokenCount}`,
            request_count: sql`${budgetUsage.request_count} + 1`,
            updated_at: now,
          })
          .where(eq(budgetUsage.id, existingUsage[0]!.id));
      } else {
        await db.insert(budgetUsage).values({
          rule_id: rule.id,
          user_id: rule.budget_type === "daily_developer" ? userId : null,
          period_start: periodStart,
          period_end: periodEnd,
          spent_usd: costUsd,
          token_count: tokenCount,
          request_count: 1,
        });
      }
    }
  } catch (err) {
    logger.error({ err }, "Failed to update budget usage");
  }
}
