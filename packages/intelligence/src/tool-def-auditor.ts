/**
 * F2 — Tool-Definition Auditor.
 *
 * Every MCP tool ships a JSON schema that occupies the system prompt on EVERY
 * request, whether or not the tool is ever called. Teams routinely load dozens
 * of servers and use a handful of their tools; the rest is fixed per-request
 * tax. This auditor measures that tax and flags tools the agent demonstrably
 * never invokes.
 *
 * QUALITY INVARIANT (mechanical, not statistical). Removing the definition of
 * a tool the agent never invokes cannot change the agent's behavior — the
 * action was never taken. The only risk is an unrepresentative audit window
 * (a tool used quarterly looking idle this month), which is handled by (a) a
 * conservative idle threshold, (b) a protected critical allowlist that is
 * NEVER recommended for removal, and (c) the human confirming each removal.
 * This module recommends; it never edits config itself.
 *
 * Pure by design: it consumes a usage window + a tool registry and returns a
 * report. The caller adapts persistence rows into these shapes and counts
 * definition tokens via @prune/tokenizer.
 */

/** A tool the agent had available, with the cost of its definition. */
export interface ToolDefinitionInfo {
  name: string;
  /** MCP server (or "builtin") the tool belongs to. */
  server: string;
  /** Tokens the tool's JSON schema contributes to the system prompt. */
  definitionTokens: number;
  /** Explicitly protected by the user; never recommended for removal. */
  protected?: boolean;
}

/** Aggregated usage over a rolling window. Built from event history. */
export interface ToolUsageWindow {
  windowDays: number;
  sessionsInWindow: number;
  /** toolName → number of invocations in the window. */
  invocations: Record<string, number>;
  /** toolName → days since last invocation (Infinity if never). */
  lastUsedAgeDays: Record<string, number>;
  /** toolName → number of sessions in which the tool was AVAILABLE. */
  sessionsLoadingTool: Record<string, number>;
}

export type ToolUtility = "critical" | "high" | "low" | "waste";

export interface ToolAuditEntry {
  name: string;
  server: string;
  definitionTokens: number;
  invocations: number;
  invocationsPerWeek: number;
  lastUsedAgeDays: number;
  utility: ToolUtility;
  /** Estimated tokens wasted per week carrying this definition. */
  wastedTokensPerWeek: number;
  /** True only for "waste" tools past the new-install guard. */
  recommendRemoval: boolean;
  rationale: string;
}

export interface ToolAuditReport {
  windowDays: number;
  sessionsInWindow: number;
  entries: ToolAuditEntry[];
  /** Sum of wastedTokensPerWeek over recommended-removal tools. */
  recoverableTokensPerWeek: number;
  /** Sum of all definition tokens (the fixed per-request tax). */
  totalDefinitionTokens: number;
  /** Number of tools recommended for removal. */
  recommendationCount: number;
  /** True when the window is too short to surface recommendations. */
  newInstallGuardActive: boolean;
}

export interface ToolAuditOptions {
  /**
   * Tools that must never be recommended for removal regardless of usage.
   * Defaults to the essential built-in agent tools.
   */
  criticalAllowlist?: string[];
  /** invocations/week ≥ this ⇒ "high" utility. Default 1. */
  highUtilityPerWeek?: number;
  /** invocations/week ≥ this (but < high) ⇒ "low" utility. Default 0.1. */
  lowUtilityPerWeek?: number;
  /** Idle age (days) required before a low-use tool is "waste". Default 30. */
  wasteIdleDays?: number;
  /** Minimum window length before recommendations surface. Default 14. */
  minWindowDays?: number;
}

export const DEFAULT_CRITICAL_ALLOWLIST = [
  "Read",
  "Write",
  "Edit",
  "MultiEdit",
  "Bash",
  "Glob",
  "Grep",
  "LS",
  "NotebookEdit",
  "Task",
];

/**
 * Audit a tool registry against an observed usage window.
 */
export function auditToolDefinitions(
  tools: ToolDefinitionInfo[],
  usage: ToolUsageWindow,
  options: ToolAuditOptions = {}
): ToolAuditReport {
  const allowlist = new Set(
    options.criticalAllowlist ?? DEFAULT_CRITICAL_ALLOWLIST
  );
  const highPerWeek = options.highUtilityPerWeek ?? 1;
  const lowPerWeek = options.lowUtilityPerWeek ?? 0.1;
  const wasteIdleDays = options.wasteIdleDays ?? 30;
  const minWindowDays = options.minWindowDays ?? 14;

  const windowWeeks = Math.max(usage.windowDays / 7, 1e-9);
  const sessionsPerWeek = usage.sessionsInWindow / windowWeeks;
  const newInstallGuardActive = usage.windowDays < minWindowDays;

  const entries: ToolAuditEntry[] = tools.map((tool) => {
    const invocations = usage.invocations[tool.name] ?? 0;
    const lastUsedAgeDays = usage.lastUsedAgeDays[tool.name] ?? Infinity;
    const sessionsLoading = usage.sessionsLoadingTool[tool.name] ?? 0;
    const invocationsPerWeek = invocations / windowWeeks;

    // Fraction of sessions (in which the tool was available) that actually
    // used it, capped at 1. Drives the wasted-token estimate.
    const invocationRatePerSession =
      sessionsLoading > 0
        ? Math.min(1, invocations / sessionsLoading)
        : 0;
    const wastedTokensPerWeek =
      sessionsPerWeek * tool.definitionTokens * (1 - invocationRatePerSession);

    const isProtected = tool.protected || allowlist.has(tool.name);

    let utility: ToolUtility;
    if (isProtected) {
      utility = "critical";
    } else if (invocationsPerWeek >= highPerWeek) {
      utility = "high";
    } else if (
      invocationsPerWeek < lowPerWeek &&
      lastUsedAgeDays > wasteIdleDays
    ) {
      utility = "waste";
    } else {
      utility = "low";
    }

    const recommendRemoval =
      utility === "waste" && !newInstallGuardActive && !isProtected;

    return {
      name: tool.name,
      server: tool.server,
      definitionTokens: tool.definitionTokens,
      invocations,
      invocationsPerWeek,
      lastUsedAgeDays,
      utility,
      wastedTokensPerWeek,
      recommendRemoval,
      rationale: buildRationale(
        utility,
        invocations,
        lastUsedAgeDays,
        tool.definitionTokens,
        isProtected,
        newInstallGuardActive
      ),
    };
  });

  // Sort: recommended removals first (largest waste), then by utility.
  entries.sort((a, b) => {
    if (a.recommendRemoval !== b.recommendRemoval) {
      return a.recommendRemoval ? -1 : 1;
    }
    return b.wastedTokensPerWeek - a.wastedTokensPerWeek;
  });

  const recoverableTokensPerWeek = entries
    .filter((e) => e.recommendRemoval)
    .reduce((sum, e) => sum + e.wastedTokensPerWeek, 0);
  const totalDefinitionTokens = tools.reduce(
    (sum, t) => sum + t.definitionTokens,
    0
  );

  return {
    windowDays: usage.windowDays,
    sessionsInWindow: usage.sessionsInWindow,
    entries,
    recoverableTokensPerWeek,
    totalDefinitionTokens,
    recommendationCount: entries.filter((e) => e.recommendRemoval).length,
    newInstallGuardActive,
  };
}

/**
 * Adapter helper: build a ToolUsageWindow from a flat list of per-session
 * tool-availability + invocation observations. Keeps the auditor itself
 * agnostic to the persistence schema.
 */
export interface SessionToolObservation {
  sessionId: string;
  /** ISO timestamp of the session. */
  timestamp: string;
  /** Tools that were available (loaded) in this session. */
  toolsAvailable: string[];
  /** Tools actually invoked, with counts. */
  toolsInvoked: Record<string, number>;
}

export function buildUsageWindow(
  observations: SessionToolObservation[],
  now: Date = new Date()
): ToolUsageWindow {
  const invocations: Record<string, number> = {};
  const lastUsed: Record<string, number> = {};
  const sessionsLoadingTool: Record<string, number> = {};
  let earliest = now.getTime();

  for (const obs of observations) {
    const ts = new Date(obs.timestamp).getTime();
    if (ts < earliest) earliest = ts;
    const ageDays = (now.getTime() - ts) / 86_400_000;

    for (const tool of obs.toolsAvailable) {
      sessionsLoadingTool[tool] = (sessionsLoadingTool[tool] ?? 0) + 1;
    }
    for (const [tool, count] of Object.entries(obs.toolsInvoked)) {
      invocations[tool] = (invocations[tool] ?? 0) + count;
      if (count > 0) {
        lastUsed[tool] = Math.min(lastUsed[tool] ?? Infinity, ageDays);
      }
    }
  }

  const windowDays = Math.max(
    (now.getTime() - earliest) / 86_400_000,
    observations.length > 0 ? 0.0001 : 0
  );

  return {
    windowDays,
    sessionsInWindow: observations.length,
    invocations,
    lastUsedAgeDays: lastUsed,
    sessionsLoadingTool,
  };
}

function buildRationale(
  utility: ToolUtility,
  invocations: number,
  lastUsedAgeDays: number,
  definitionTokens: number,
  isProtected: boolean,
  guardActive: boolean
): string {
  if (isProtected) {
    return "Protected (critical allowlist) — never recommended for removal.";
  }
  if (utility === "high") {
    return `Actively used (${invocations} invocations in window).`;
  }
  if (utility === "low") {
    return `Used occasionally (${invocations} invocations). Surfaced for review; no proactive recommendation.`;
  }
  // waste
  const ageStr =
    lastUsedAgeDays === Infinity
      ? "never used in window"
      : `last used ${Math.round(lastUsedAgeDays)} days ago`;
  const base = `${ageStr}; ${definitionTokens} tokens of definition carried on every request.`;
  if (guardActive) {
    return base + " New-install guard active — not recommended yet.";
  }
  return base + " Recommend disabling to recover the per-request tax.";
}
