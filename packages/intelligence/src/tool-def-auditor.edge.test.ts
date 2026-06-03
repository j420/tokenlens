/**
 * Degenerate-input robustness for F2. Empty registries, zero-token tools,
 * zero-length windows, duplicate names, and invocations for unknown tools must
 * never crash, never divide by zero, and never recommend removing a tool we
 * lack the evidence to judge.
 */

import { describe, expect, it } from "vitest";
import {
  auditToolDefinitions,
  buildUsageWindow,
  type ToolUsageWindow,
} from "./tool-def-auditor.js";

const emptyWindow: ToolUsageWindow = {
  windowDays: 30,
  sessionsInWindow: 60,
  invocations: {},
  lastUsedAgeDays: {},
  sessionsLoadingTool: {},
};

describe("F2 empty / degenerate inputs", () => {
  it("empty registry ⇒ empty report, zero recoverable", () => {
    const r = auditToolDefinitions([], emptyWindow);
    expect(r.entries).toHaveLength(0);
    expect(r.recoverableTokensPerWeek).toBe(0);
    expect(r.totalDefinitionTokens).toBe(0);
    expect(r.recommendationCount).toBe(0);
  });

  it("windowDays=0 does not divide by zero and activates the new-install guard", () => {
    const r = auditToolDefinitions(
      [{ name: "t", server: "s", definitionTokens: 500 }],
      { ...emptyWindow, windowDays: 0, sessionsInWindow: 0 }
    );
    expect(Number.isFinite(r.entries[0].wastedTokensPerWeek)).toBe(true);
    expect(Number.isFinite(r.entries[0].invocationsPerWeek)).toBe(true);
    expect(r.newInstallGuardActive).toBe(true);
    expect(r.entries[0].recommendRemoval).toBe(false);
  });

  it("zero-token tool yields zero waste", () => {
    const r = auditToolDefinitions(
      [{ name: "t", server: "s", definitionTokens: 0 }],
      {
        ...emptyWindow,
        lastUsedAgeDays: { t: Infinity },
        sessionsLoadingTool: { t: 60 },
      }
    );
    expect(r.entries[0].wastedTokensPerWeek).toBe(0);
  });

  it("invocations for a tool not in the registry are ignored", () => {
    const r = auditToolDefinitions(
      [{ name: "known", server: "s", definitionTokens: 100 }],
      {
        ...emptyWindow,
        invocations: { ghost: 50 },
        lastUsedAgeDays: { ghost: 1 },
        sessionsLoadingTool: { known: 60, ghost: 60 },
      }
    );
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].name).toBe("known");
  });

  it("a tool never loaded (sessionsLoadingTool=0) does not divide by zero", () => {
    const r = auditToolDefinitions(
      [{ name: "t", server: "s", definitionTokens: 300 }],
      { ...emptyWindow, lastUsedAgeDays: { t: Infinity } } // no sessionsLoadingTool entry
    );
    expect(Number.isFinite(r.entries[0].wastedTokensPerWeek)).toBe(true);
  });
});

describe("F2 buildUsageWindow robustness", () => {
  it("empty observations ⇒ zero window", () => {
    const w = buildUsageWindow([]);
    expect(w.sessionsInWindow).toBe(0);
    expect(w.windowDays).toBe(0);
  });

  it("a single observation produces a finite (tiny) window, not zero-division", () => {
    const w = buildUsageWindow([
      {
        sessionId: "s1",
        timestamp: new Date().toISOString(),
        toolsAvailable: ["a"],
        toolsInvoked: { a: 1 },
      },
    ]);
    expect(Number.isFinite(w.windowDays)).toBe(true);
    const r = auditToolDefinitions(
      [{ name: "a", server: "x", definitionTokens: 100 }],
      w
    );
    expect(Number.isFinite(r.entries[0].wastedTokensPerWeek)).toBe(true);
  });

  it("duplicate tool availability across sessions accumulates correctly", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const w = buildUsageWindow(
      [
        {
          sessionId: "s1",
          timestamp: "2026-05-20T00:00:00Z",
          toolsAvailable: ["a", "a"], // pathological duplicate within a session
          toolsInvoked: { a: 2 },
        },
      ],
      now
    );
    // Duplicates are counted as listed; the auditor still produces finite math.
    expect(w.sessionsLoadingTool.a).toBe(2);
    expect(w.invocations.a).toBe(2);
  });
});
