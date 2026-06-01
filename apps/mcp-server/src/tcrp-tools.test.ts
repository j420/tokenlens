/**
 * MCP wiring tests for the TCRP tools (F2 tool_audit, F4 qpd_report).
 *
 * These assert that the safety guarantees of the underlying cores survive the
 * MCP boundary: protected tools are never recommended for removal, and a
 * quality-failing model is never recommended for a switch. They also pin the
 * JSON response shape clients depend on.
 */

import { describe, expect, it } from "vitest";
import { handleToolAudit, handleQpdReport } from "./tcrp-tools.js";
import type { ModelAggregate } from "@prune/qpd-bench";

describe("tool_audit MCP handler (F2)", () => {
  it("returns a parseable report and flags an idle bloated MCP tool", () => {
    const json = handleToolAudit({
      tools: [
        { name: "github_pr", server: "github", definitionTokens: 500 },
        { name: "jira_create", server: "jira", definitionTokens: 900 },
      ],
      usage: {
        windowDays: 30,
        sessionsInWindow: 60,
        invocations: { github_pr: 40 },
        lastUsedAgeDays: { github_pr: 0.5, jira_create: Infinity },
        sessionsLoadingTool: { github_pr: 60, jira_create: 60 },
      },
    });
    const r = JSON.parse(json);
    const jira = r.entries.find((e: { name: string }) => e.name === "jira_create");
    const gh = r.entries.find((e: { name: string }) => e.name === "github_pr");
    expect(jira.recommendRemoval).toBe(true);
    expect(gh.recommendRemoval).toBe(false);
    expect(r.recoverableTokensPerWeek).toBeGreaterThan(0);
    expect(r.recommendationCount).toBe(1);
  });

  it("NEVER recommends removing a critical-allowlist tool across the boundary", () => {
    const json = handleToolAudit({
      tools: [{ name: "Read", server: "builtin", definitionTokens: 400 }],
      usage: {
        windowDays: 30,
        sessionsInWindow: 60,
        invocations: {},
        lastUsedAgeDays: { Read: Infinity },
        sessionsLoadingTool: { Read: 60 },
      },
    });
    const r = JSON.parse(json);
    expect(r.entries[0].recommendRemoval).toBe(false);
    expect(r.entries[0].utility).toBe("critical");
  });

  it("respects a custom critical_allowlist", () => {
    const json = handleToolAudit({
      tools: [{ name: "deploy", server: "ci", definitionTokens: 700 }],
      usage: {
        windowDays: 30,
        sessionsInWindow: 60,
        invocations: {},
        lastUsedAgeDays: { deploy: Infinity },
        sessionsLoadingTool: { deploy: 60 },
      },
      critical_allowlist: ["deploy"],
    });
    const r = JSON.parse(json);
    expect(r.entries[0].recommendRemoval).toBe(false);
  });

  it("returns an error object for malformed input", () => {
    const r = JSON.parse(handleToolAudit({ tools: undefined as never, usage: undefined as never }));
    expect(r.error).toBeTruthy();
  });
});

describe("qpd_report MCP handler (F4)", () => {
  function agg(
    model: string,
    n: number,
    ar: number,
    cost: number,
    tpr: number | null = null
  ): ModelAggregate {
    return {
      model,
      clusterId: "refactor-ts",
      n,
      acceptedCount: Math.round(n * ar),
      acceptanceRate: ar,
      testPassRate: tpr,
      testN: tpr === null ? 0 : n,
      testPassedCount: tpr === null ? 0 : Math.round(n * tpr),
      meanCost: cost,
      totalCost: cost * n,
      qpdRaw: cost > 0 ? ar / cost : Infinity,
    };
  }

  it("recommends a cheaper, quality-equivalent model and reports the frontier", () => {
    const json = handleQpdReport({
      baseline: agg("opus", 500, 0.92, 0.1),
      candidates: [agg("sonnet", 500, 0.9, 0.02), agg("haiku", 500, 0.71, 0.004)],
    });
    const r = JSON.parse(json);
    expect(r.best.model).toBe("sonnet");
    expect(r.best.projectedSavingsPct).toBeGreaterThan(70);
    expect(r.paretoFrontier).toContain("haiku"); // cheapest, on frontier
  });

  it("NEVER recommends a quality-failing model across the boundary", () => {
    const json = handleQpdReport({
      baseline: agg("opus", 500, 0.92, 0.1),
      candidates: [agg("haiku", 500, 0.71, 0.004)], // 21pp AR drop
    });
    const r = JSON.parse(json);
    expect(r.best).toBeNull(); // stay on baseline
    const haiku = r.recommendations.find((x: { model: string }) => x.model === "haiku");
    expect(haiku.recommended).toBe(false);
    expect(haiku.gates.ar).toBe(false);
  });

  it("exposes per-gate pass/fail for the trust UX", () => {
    const json = handleQpdReport({
      baseline: agg("opus", 500, 0.92, 0.1),
      candidates: [agg("sonnet", 500, 0.9, 0.02)],
    });
    const r = JSON.parse(json);
    const s = r.recommendations[0];
    expect(s.gates).toHaveProperty("ar");
    expect(s.gates).toHaveProperty("tpr");
    expect(s.gates).toHaveProperty("cost");
    expect(s.gates).toHaveProperty("sampleSize");
  });

  it("returns an error object for malformed input", () => {
    const r = JSON.parse(
      handleQpdReport({ baseline: undefined as never, candidates: undefined as never })
    );
    expect(r.error).toBeTruthy();
  });
});
