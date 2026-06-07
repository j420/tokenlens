/**
 * Adversarial probes for the cache-habits linter.
 *
 * Each test pins a non-obvious failure mode: a malformed input, a corner
 * case in cost math, an interaction between rules. The goal is to catch
 * regressions that the per-rule tests in rules.test.ts wouldn't surface.
 *
 * Phase 7 hard rule #5: every feature ships an adversarial probe suite.
 */

import { describe, expect, it } from "vitest";

import { lint } from "./linter.js";
import {
  cacheInvestmentLossUsd,
  cacheReadSavingsPerReadUsd,
  cacheWriteCostUsd,
  minutesBetween,
  minCacheablePrefix,
  ttlSeconds,
} from "./cache-econ.js";
import { buildAction, buildSnapshot } from "./test-helpers.js";
import { _RULES, modelFamilyOf } from "./rules.js";

describe("edge — cost math returns null instead of fabricating", () => {
  it("cacheWriteCostUsd returns null for unknown model (strict, no fabrication)", () => {
    expect(cacheWriteCostUsd(1000, "5m", "some-vendor-xyz-model")).toBeNull();
  });

  it("cacheWriteCostUsd returns priced value for a known model", () => {
    // claude-sonnet-4-5-20250929: input=$3/1M, write_mult=1.25 → 0.00375 USD/1k.
    expect(
      cacheWriteCostUsd(1000, "5m", "claude-sonnet-4-5-20250929")
    ).toBeCloseTo(0.00375, 8);
  });

  it("cacheWriteCostUsd returns null for ttl='none'", () => {
    expect(cacheWriteCostUsd(1000, "none", "claude-sonnet-4-5-20250929")).toBeNull();
  });

  it("cacheWriteCostUsd handles zero tokens", () => {
    expect(cacheWriteCostUsd(0, "5m", "claude-sonnet-4-5-20250929")).toBe(0);
  });

  it("cacheInvestmentLossUsd matches cacheWriteCostUsd by construction", () => {
    expect(cacheInvestmentLossUsd(500, "5m", "claude-sonnet-4-5-20250929")).toBe(
      cacheWriteCostUsd(500, "5m", "claude-sonnet-4-5-20250929")
    );
  });

  it("cacheReadSavingsPerReadUsd returns null when cached_input is missing", () => {
    // gpt-4 (no cached_input field in pricing) — verify the function
    // refuses to fabricate.
    expect(cacheReadSavingsPerReadUsd(1000, "gpt-4-turbo")).toBeNull();
  });

  it("minutesBetween returns null on invalid timestamps", () => {
    expect(minutesBetween("not-an-iso", "2026-06-03T12:00:00.000Z")).toBeNull();
    expect(minutesBetween("2026-06-03T12:00:00.000Z", "not-an-iso")).toBeNull();
  });

  it("minutesBetween treats earlierIso=null as null result (no fabrication)", () => {
    expect(minutesBetween(null, "2026-06-03T12:00:00.000Z")).toBeNull();
  });

  it("ttlSeconds returns null for 'none'", () => {
    expect(ttlSeconds("none")).toBeNull();
  });

  it("minCacheablePrefix uses conservative 4096 default for unknown family", () => {
    expect(minCacheablePrefix("alpaca")).toBe(4096);
  });

  it("modelFamilyOf classifies the model lineup", () => {
    expect(modelFamilyOf("claude-sonnet-4-5-20250929")).toBe("sonnet");
    expect(modelFamilyOf("claude-opus-4-5-20251101")).toBe("opus");
    expect(modelFamilyOf("claude-3-5-haiku-20241022")).toBe("haiku");
    expect(modelFamilyOf("gpt-4o-mini")).toBe("gpt-4o-mini");
    expect(modelFamilyOf("gpt-4o")).toBe("gpt-4o");
    expect(modelFamilyOf("some-other-model")).toBe("other");
  });
});

describe("edge — rules under pathological inputs", () => {
  it("CH-001 handles zero cache investment without fabricating waste", () => {
    const f = _RULES.CH_001.run(
      buildAction({ model: "claude-haiku-3.5", modelFamily: "haiku" }),
      buildSnapshot({ cacheCreationTokensSoFar: 0 })
    );
    expect(f).not.toBeNull();
    expect(f!.estimatedWasteTokens).toBe(0);
    expect(f!.estimatedWasteUsd).toBe(0);
  });

  it("CH-003 ignores zero-token paste blocks", () => {
    const f = _RULES.CH_003.run(
      buildAction({ pastedBlocks: [{ tokens: 0, source: "clipboard" }] }),
      buildSnapshot()
    );
    expect(f).toBeNull();
  });

  it("CH-004 handles same-millisecond timestamps without divide-by-zero", () => {
    const f = _RULES.CH_004.run(
      buildAction({ now: "2026-06-03T12:00:00.000Z" }),
      buildSnapshot({ lastTurnAt: "2026-06-03T12:00:00.000Z" })
    );
    expect(f).toBeNull(); // 0 gap < TTL
  });

  it("CH-007 fires when add+remove happen in the same turn", () => {
    const f = _RULES.CH_007.run(
      buildAction({
        mcpServersAdded: ["new-server"],
        mcpServersRemoved: ["old-server"],
      }),
      buildSnapshot()
    );
    expect(f).not.toBeNull();
    expect((f!.signal["added"] as string[]).length).toBe(1);
    expect((f!.signal["removed"] as string[]).length).toBe(1);
  });

  it("CH-009 does not fire when both old and new are the same level", () => {
    const f = _RULES.CH_009.run(
      buildAction({ changeReasoningEffort: "max" }),
      buildSnapshot({ reasoningEffort: "max" })
    );
    expect(f).toBeNull();
  });

  it("CH-012 fires when 3+ mutations happen together (compounding)", () => {
    const f = _RULES.CH_012.run(
      buildAction({
        model: "claude-haiku-3.5",
        modelFamily: "haiku",
        ttl: "1h",
        changeSystemPromptTokens: 3000,
        mcpServersAdded: ["slack"],
      }),
      buildSnapshot({
        currentModel: "claude-sonnet-4-5-20250929",
        currentTtl: "5m",
        systemPromptTokens: 2048,
        cacheCreationTokensSoFar: 10_000,
      })
    );
    expect(f).not.toBeNull();
    expect((f!.signal["mutationCount"] as number) >= 3).toBe(true);
  });
});

describe("edge — runner contract", () => {
  it("severityOverrides for an unfired rule has no effect", () => {
    const r = lint(buildAction(), buildSnapshot(), {
      severityOverrides: { "CH-001": "block" },
    });
    expect(r.verdict).toBe("info");
    expect(r.findings.length).toBe(0);
  });

  it("suppressing all rules yields empty findings and verdict 'info'", () => {
    const r = lint(
      buildAction({ model: "claude-haiku-3.5", modelFamily: "haiku" }),
      buildSnapshot({ currentModel: "claude-sonnet-4-5-20250929" }),
      { suppress: [
        "CH-001", "CH-002", "CH-003", "CH-004", "CH-005", "CH-006",
        "CH-007", "CH-008", "CH-009", "CH-010", "CH-011", "CH-012",
        "CH-013", "CH-014",
      ] }
    );
    expect(r.findings).toEqual([]);
    expect(r.verdict).toBe("info");
    expect(r.skipped.length).toBe(14);
  });

  it("multiple rules firing produces ordered, non-overlapping findings", () => {
    const r = lint(
      buildAction({
        model: "claude-haiku-3.5",
        modelFamily: "haiku",
        ttl: "1h",
        pastedBlocks: [{ tokens: 5_000, source: "clipboard" }],
        changeSystemPromptTokens: 3000,
      }),
      buildSnapshot({
        currentModel: "claude-sonnet-4-5-20250929",
        currentTtl: "5m",
        systemPromptTokens: 2048,
        cacheCreationTokensSoFar: 10_000,
      })
    );
    const ids = r.findings.map((f) => f.ruleId);
    expect(ids).toContain("CH-001");
    expect(ids).toContain("CH-003");
    expect(ids).toContain("CH-006");
    expect(ids).toContain("CH-008");
    expect(ids).toContain("CH-012");
    // No duplicates.
    expect(new Set(ids).size).toBe(ids.length);
  });
});
