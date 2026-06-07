import { describe, expect, it } from "vitest";

import { lint, listRules } from "./linter.js";
import { buildAction, buildSnapshot } from "./test-helpers.js";
import { CACHE_HABIT_RULES } from "./rules.js";

describe("lint() runner", () => {
  it("returns verdict 'info' with empty findings on a clean action", () => {
    const r = lint(buildAction(), buildSnapshot());
    expect(r.verdict).toBe("info");
    expect(r.findings).toEqual([]);
    expect(r.totalEstimatedWasteUsd).toBe(0);
    expect(r.totalEstimatedWasteTokens).toBe(0);
    expect(r.skipped).toEqual([]);
  });

  it("escalates verdict to 'warn' when a single warn-rule fires", () => {
    const r = lint(
      buildAction({ model: "claude-haiku-3.5", modelFamily: "haiku" }),
      buildSnapshot({ currentModel: "claude-sonnet-4-5-20250929" })
    );
    expect(r.verdict).toBe("warn");
    expect(r.findings.find((f) => f.ruleId === "CH-001")).toBeDefined();
  });

  it("escalates verdict to 'block' when an override promotes a rule to block", () => {
    const r = lint(
      buildAction({ model: "claude-haiku-3.5", modelFamily: "haiku" }),
      buildSnapshot({ currentModel: "claude-sonnet-4-5-20250929" }),
      { severityOverrides: { "CH-001": "block" } }
    );
    expect(r.verdict).toBe("block");
    expect(r.findings.find((f) => f.ruleId === "CH-001")!.severity).toBe("block");
  });

  it("suppresses rules listed in options.suppress", () => {
    const r = lint(
      buildAction({ model: "claude-haiku-3.5", modelFamily: "haiku" }),
      buildSnapshot({ currentModel: "claude-sonnet-4-5-20250929" }),
      { suppress: ["CH-001", "CH-012"] }
    );
    expect(r.findings.find((f) => f.ruleId === "CH-001")).toBeUndefined();
    expect(r.skipped).toContain("CH-001");
    expect(r.skipped).toContain("CH-012");
  });

  it("aggregates totals across multiple findings", () => {
    const r = lint(
      buildAction({
        model: "claude-haiku-3.5",
        modelFamily: "haiku",
        ttl: "1h",
        pastedBlocks: [{ tokens: 5_000, source: "clipboard" }],
      }),
      buildSnapshot({
        currentModel: "claude-sonnet-4-5-20250929",
        currentTtl: "5m",
        cacheCreationTokensSoFar: 8_000,
      })
    );
    expect(r.findings.length).toBeGreaterThanOrEqual(3);
    expect(r.totalEstimatedWasteTokens).toBeGreaterThan(0);
  });

  it("is deterministic — same input twice yields identical report", () => {
    const a = buildAction({ model: "claude-haiku-3.5", modelFamily: "haiku" });
    const s = buildSnapshot();
    const r1 = lint(a, s);
    const r2 = lint(a, s);
    expect(r1).toEqual(r2);
  });

  it("fail-safe: a throwing rule is skipped, others continue", () => {
    // Monkey-patch a rule temporarily.
    const original = CACHE_HABIT_RULES[0]!.run;
    (CACHE_HABIT_RULES[0] as unknown as { run: () => never }).run = () => {
      throw new Error("simulated bug");
    };
    try {
      const r = lint(
        buildAction({ model: "claude-haiku-3.5", modelFamily: "haiku" }),
        buildSnapshot({ currentModel: "claude-sonnet-4-5-20250929" })
      );
      expect(r.skipped).toContain(CACHE_HABIT_RULES[0]!.id);
      // Other rules still fired.
      expect(r.findings.length).toBeGreaterThan(0);
    } finally {
      (CACHE_HABIT_RULES[0] as unknown as { run: typeof original }).run = original;
    }
  });
});

describe("listRules()", () => {
  it("exposes all 14 stable IDs in order", () => {
    const ids = listRules().map((r) => r.id);
    expect(ids).toEqual([
      "CH-001",
      "CH-002",
      "CH-003",
      "CH-004",
      "CH-005",
      "CH-006",
      "CH-007",
      "CH-008",
      "CH-009",
      "CH-010",
      "CH-011",
      "CH-012",
      "CH-013",
      "CH-014",
    ]);
  });

  it("every rule has non-empty id, name, description, citation, severity", () => {
    for (const r of listRules()) {
      expect(r.id.length).toBeGreaterThan(0);
      expect(r.name.length).toBeGreaterThan(0);
      expect(r.description.length).toBeGreaterThan(0);
      expect(r.citation.length).toBeGreaterThan(0);
      expect(["info", "warn", "block"]).toContain(r.defaultSeverity);
    }
  });
});
