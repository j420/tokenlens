import { describe, expect, it } from "vitest";
import {
  auditToolDefinitions,
  buildUsageWindow,
  DEFAULT_CRITICAL_ALLOWLIST,
  type SessionToolObservation,
  type ToolDefinitionInfo,
  type ToolUsageWindow,
} from "./tool-def-auditor.js";

function tool(
  name: string,
  server: string,
  definitionTokens: number,
  protectedFlag = false
): ToolDefinitionInfo {
  return { name, server, definitionTokens, protected: protectedFlag };
}

function window(overrides: Partial<ToolUsageWindow>): ToolUsageWindow {
  return {
    windowDays: 30,
    sessionsInWindow: 60,
    invocations: {},
    lastUsedAgeDays: {},
    sessionsLoadingTool: {},
    ...overrides,
  };
}

describe("auditToolDefinitions", () => {
  it("never recommends removing a critical-allowlist tool, even if unused", () => {
    const tools = [tool("Read", "builtin", 400)];
    const report = auditToolDefinitions(
      tools,
      window({
        invocations: {},
        lastUsedAgeDays: { Read: Infinity },
        sessionsLoadingTool: { Read: 60 },
      })
    );
    const read = report.entries.find((e) => e.name === "Read")!;
    expect(read.utility).toBe("critical");
    expect(read.recommendRemoval).toBe(false);
  });

  it("never recommends removing an explicitly protected tool", () => {
    const tools = [tool("notion_search", "notion", 600, /*protected*/ true)];
    const report = auditToolDefinitions(
      tools,
      window({
        invocations: {},
        lastUsedAgeDays: { notion_search: 90 },
        sessionsLoadingTool: { notion_search: 60 },
      })
    );
    const t = report.entries.find((e) => e.name === "notion_search")!;
    expect(t.utility).toBe("critical");
    expect(t.recommendRemoval).toBe(false);
  });

  it("classifies a frequently-used tool as high utility", () => {
    const tools = [tool("github_pr", "github", 500)];
    const report = auditToolDefinitions(
      tools,
      window({
        windowDays: 30,
        invocations: { github_pr: 40 }, // ~9.3/week
        lastUsedAgeDays: { github_pr: 0.5 },
        sessionsLoadingTool: { github_pr: 60 },
      })
    );
    const t = report.entries.find((e) => e.name === "github_pr")!;
    expect(t.utility).toBe("high");
    expect(t.recommendRemoval).toBe(false);
  });

  it("flags an idle bloated tool as waste and recommends removal", () => {
    const tools = [tool("jira_create", "jira", 800)];
    const report = auditToolDefinitions(
      tools,
      window({
        windowDays: 30,
        sessionsInWindow: 60,
        invocations: {}, // never used
        lastUsedAgeDays: { jira_create: Infinity },
        sessionsLoadingTool: { jira_create: 60 },
      })
    );
    const t = report.entries.find((e) => e.name === "jira_create")!;
    expect(t.utility).toBe("waste");
    expect(t.recommendRemoval).toBe(true);
    expect(report.recommendationCount).toBe(1);
    // 60 sessions / (30/7) weeks = 14 sessions/week * 800 tokens * (1-0) = 11200
    expect(t.wastedTokensPerWeek).toBeCloseTo((60 / (30 / 7)) * 800, 0);
    expect(report.recoverableTokensPerWeek).toBeCloseTo(t.wastedTokensPerWeek, 5);
  });

  it("classifies an occasionally-used tool as low utility (no recommendation)", () => {
    const tools = [tool("slack_post", "slack", 300)];
    const report = auditToolDefinitions(
      tools,
      window({
        windowDays: 30,
        invocations: { slack_post: 2 }, // ~0.47/week — between 0.1 and 1
        lastUsedAgeDays: { slack_post: 5 },
        sessionsLoadingTool: { slack_post: 60 },
      })
    );
    const t = report.entries.find((e) => e.name === "slack_post")!;
    expect(t.utility).toBe("low");
    expect(t.recommendRemoval).toBe(false);
  });

  it("does not classify a recently-used-but-rare tool as waste", () => {
    // Below low threshold in frequency, but used 2 days ago ⇒ not idle.
    const tools = [tool("rare_tool", "x", 500)];
    const report = auditToolDefinitions(
      tools,
      window({
        windowDays: 60,
        invocations: { rare_tool: 1 }, // ~0.12/week
        lastUsedAgeDays: { rare_tool: 2 },
        sessionsLoadingTool: { rare_tool: 100 },
      })
    );
    const t = report.entries.find((e) => e.name === "rare_tool")!;
    // freq ~0.117 >= 0.1 ⇒ low, not waste.
    expect(t.utility).toBe("low");
  });

  it("suppresses recommendations under the new-install guard", () => {
    const tools = [tool("jira_create", "jira", 800)];
    const report = auditToolDefinitions(
      tools,
      window({
        windowDays: 5, // < 14-day guard
        sessionsInWindow: 10,
        invocations: {},
        lastUsedAgeDays: { jira_create: Infinity },
        sessionsLoadingTool: { jira_create: 10 },
      })
    );
    const t = report.entries.find((e) => e.name === "jira_create")!;
    expect(t.utility).toBe("waste");
    expect(t.recommendRemoval).toBe(false); // guarded
    expect(report.newInstallGuardActive).toBe(true);
    expect(t.rationale).toContain("guard");
  });

  it("sorts recommended removals first by waste magnitude", () => {
    const tools = [
      tool("small_idle", "a", 100),
      tool("big_idle", "b", 2000),
      tool("Read", "builtin", 400),
    ];
    const report = auditToolDefinitions(
      tools,
      window({
        windowDays: 30,
        sessionsInWindow: 60,
        invocations: {},
        lastUsedAgeDays: { small_idle: Infinity, big_idle: Infinity },
        sessionsLoadingTool: { small_idle: 60, big_idle: 60, Read: 60 },
      })
    );
    expect(report.entries[0].name).toBe("big_idle");
    expect(report.entries[1].name).toBe("small_idle");
  });

  it("computes total definition tokens (the fixed per-request tax)", () => {
    const tools = [tool("a", "x", 100), tool("b", "y", 250), tool("c", "z", 50)];
    const report = auditToolDefinitions(tools, window({}));
    expect(report.totalDefinitionTokens).toBe(400);
  });

  it("default allowlist covers the essential built-ins", () => {
    for (const name of ["Read", "Write", "Edit", "Bash", "Grep"]) {
      expect(DEFAULT_CRITICAL_ALLOWLIST).toContain(name);
    }
  });
});

describe("buildUsageWindow", () => {
  it("aggregates invocations, availability, and recency across sessions", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const obs: SessionToolObservation[] = [
      {
        sessionId: "s1",
        timestamp: "2026-05-02T00:00:00Z", // 30 days ago
        toolsAvailable: ["github_pr", "jira_create"],
        toolsInvoked: { github_pr: 3 },
      },
      {
        sessionId: "s2",
        timestamp: "2026-05-31T00:00:00Z", // 1 day ago
        toolsAvailable: ["github_pr", "jira_create"],
        toolsInvoked: { github_pr: 2 },
      },
    ];
    const w = buildUsageWindow(obs, now);
    expect(w.sessionsInWindow).toBe(2);
    expect(w.invocations.github_pr).toBe(5);
    expect(w.invocations.jira_create ?? 0).toBe(0);
    expect(w.sessionsLoadingTool.github_pr).toBe(2);
    expect(w.sessionsLoadingTool.jira_create).toBe(2);
    // last use of github_pr ~1 day ago
    expect(w.lastUsedAgeDays.github_pr).toBeCloseTo(1, 1);
    expect(w.windowDays).toBeCloseTo(30, 0);
  });

  it("handles empty observations", () => {
    const w = buildUsageWindow([]);
    expect(w.sessionsInWindow).toBe(0);
    expect(w.windowDays).toBe(0);
  });

  it("end-to-end: idle MCP tool surfaces as a removal recommendation", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const obs: SessionToolObservation[] = [];
    // 40 sessions over 30 days; github_pr used, jira_create never.
    for (let i = 0; i < 40; i++) {
      const day = 1 + Math.floor((i / 40) * 29);
      obs.push({
        sessionId: `s${i}`,
        timestamp: `2026-05-${String(day).padStart(2, "0")}T12:00:00Z`,
        toolsAvailable: ["github_pr", "jira_create"],
        toolsInvoked: { github_pr: 2 },
      });
    }
    const w = buildUsageWindow(obs, now);
    const report = auditToolDefinitions(
      [tool("github_pr", "github", 500), tool("jira_create", "jira", 900)],
      w
    );
    const jira = report.entries.find((e) => e.name === "jira_create")!;
    const gh = report.entries.find((e) => e.name === "github_pr")!;
    expect(jira.recommendRemoval).toBe(true);
    expect(gh.recommendRemoval).toBe(false);
  });
});
