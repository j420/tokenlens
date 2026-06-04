import { describe, it, expect } from "vitest";
import { lint } from "@prune/cache-habits";
import type { NormalizedTurn } from "@prune/telemetry";

import { buildCacheHabitsInputs } from "./cache-habits-inputs.js";

// ---------------------------------------------------------------------------
// Fixtures — minimal NormalizedTurn objects. We only populate the fields the
// adapter reads (model, usage, started/endedAt); the rest are valid empties.
// ---------------------------------------------------------------------------

function turn(opts: Partial<NormalizedTurn> & { turnNumber: number }): NormalizedTurn {
  return {
    turnNumber: opts.turnNumber,
    assistantMessages: opts.assistantMessages ?? [],
    toolUses: opts.toolUses ?? [],
    toolResults: opts.toolResults ?? [],
    usage: opts.usage ?? { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 },
    model: opts.model,
    startedAt: opts.startedAt,
    endedAt: opts.endedAt,
    textContent: opts.textContent ?? "",
    userMessage: opts.userMessage,
    sessionId: opts.sessionId,
  };
}

const SONNET = "claude-sonnet-4-5-20250929";
const OPUS = "claude-opus-4-5";

function warmSonnetView() {
  return {
    turns: [
      turn({
        turnNumber: 1,
        model: SONNET,
        startedAt: "2026-06-04T10:00:00.000Z",
        endedAt: "2026-06-04T10:00:10.000Z",
        usage: { input: 100, output: 50, cacheRead: 2000, cacheCreate: 8000 },
      }),
      turn({
        turnNumber: 2,
        model: SONNET,
        startedAt: "2026-06-04T10:01:00.000Z",
        endedAt: "2026-06-04T10:01:30.000Z",
        usage: { input: 80, output: 40, cacheRead: 5000, cacheCreate: 1000 },
      }),
    ],
  };
}

// ---------------------------------------------------------------------------
// SNAPSHOT derivation
// ---------------------------------------------------------------------------

describe("buildCacheHabitsInputs — snapshot derivation", () => {
  it("derives currentModel from the last turn, sums cache usage, takes last timestamp", () => {
    const { snapshot } = buildCacheHabitsInputs(warmSonnetView(), { model: SONNET });
    expect(snapshot.currentModel).toBe(SONNET);
    expect(snapshot.turnsSoFar).toBe(2);
    expect(snapshot.cacheReadTokensSoFar).toBe(7000); // 2000 + 5000
    expect(snapshot.cacheCreationTokensSoFar).toBe(9000); // 8000 + 1000
    expect(snapshot.lastTurnAt).toBe("2026-06-04T10:01:30.000Z");
  });

  it("never fabricates unknowns: ttl=none, sysTokens=null, toolHash=null, mcp=[]", () => {
    const { snapshot } = buildCacheHabitsInputs(warmSonnetView(), { model: SONNET });
    expect(snapshot.currentTtl).toBe("none");
    expect(snapshot.systemPromptTokens).toBeNull();
    expect(snapshot.toolListOrderHash).toBeNull();
    expect(snapshot.mcpServers).toEqual([]);
    expect(snapshot.reasoningEffort).toBeUndefined();
    expect(snapshot.temperature).toBeUndefined();
  });

  it("propagates host context that the transcript cannot supply", () => {
    const { snapshot } = buildCacheHabitsInputs(
      warmSonnetView(),
      { model: SONNET },
      {
        currentTtl: "5m",
        systemPromptTokens: 1500,
        toolListOrderHash: "hash-A",
        mcpServers: ["fs", "github"],
        reasoningEffort: "standard",
        temperature: 0,
      }
    );
    expect(snapshot.currentTtl).toBe("5m");
    expect(snapshot.systemPromptTokens).toBe(1500);
    expect(snapshot.toolListOrderHash).toBe("hash-A");
    expect(snapshot.mcpServers).toEqual(["fs", "github"]);
    expect(snapshot.reasoningEffort).toBe("standard");
    expect(snapshot.temperature).toBe(0);
  });

  it("falls back to the proposed model when no turn declares one (no spurious switch)", () => {
    const view = { turns: [turn({ turnNumber: 1, usage: { input: 1, output: 1, cacheRead: 0, cacheCreate: 0 } })] };
    const { snapshot } = buildCacheHabitsInputs(view, { model: OPUS });
    expect(snapshot.currentModel).toBe(OPUS);
  });
});

// ---------------------------------------------------------------------------
// CHANGE-DETECTION (the real, testable logic)
// ---------------------------------------------------------------------------

describe("buildCacheHabitsInputs — change-detection", () => {
  it("sets changes to null/[] when nothing differs", () => {
    const { action } = buildCacheHabitsInputs(
      warmSonnetView(),
      {
        model: SONNET,
        systemPromptTokens: 1500,
        toolListOrderHash: "hash-A",
        reasoningEffort: "standard",
        temperature: 0,
      },
      {
        systemPromptTokens: 1500,
        toolListOrderHash: "hash-A",
        reasoningEffort: "standard",
        temperature: 0,
      }
    );
    expect(action.changes.systemPromptTokens).toBeNull();
    expect(action.changes.toolListOrderHash).toBeNull();
    expect(action.changes.reasoningEffort).toBeNull();
    expect(action.changes.temperature).toBeNull();
    expect(action.changes.mcpServersAdded).toEqual([]);
    expect(action.changes.mcpServersRemoved).toEqual([]);
  });

  it("flags a system-prompt token change only when prior is known AND differs", () => {
    const withPrior = buildCacheHabitsInputs(
      warmSonnetView(),
      { model: SONNET, systemPromptTokens: 2000 },
      { systemPromptTokens: 1500 }
    );
    expect(withPrior.action.changes.systemPromptTokens).toBe(2000);

    // Prior unknown ⇒ no fabricated change (cannot prove a mutation).
    const noPrior = buildCacheHabitsInputs(
      warmSonnetView(),
      { model: SONNET, systemPromptTokens: 2000 }
    );
    expect(noPrior.action.changes.systemPromptTokens).toBeNull();
  });

  it("flags a tool-list reorder only when prior hash known AND differs", () => {
    const reorder = buildCacheHabitsInputs(
      warmSonnetView(),
      { model: SONNET, toolListOrderHash: "hash-B" },
      { toolListOrderHash: "hash-A" }
    );
    expect(reorder.action.changes.toolListOrderHash).toBe("hash-B");

    const same = buildCacheHabitsInputs(
      warmSonnetView(),
      { model: SONNET, toolListOrderHash: "hash-A" },
      { toolListOrderHash: "hash-A" }
    );
    expect(same.action.changes.toolListOrderHash).toBeNull();
  });

  it("flags a reasoning-effort change, defaulting active to standard", () => {
    const raised = buildCacheHabitsInputs(
      warmSonnetView(),
      { model: SONNET, reasoningEffort: "high" }
    );
    expect(raised.action.changes.reasoningEffort).toBe("high");

    const unchanged = buildCacheHabitsInputs(
      warmSonnetView(),
      { model: SONNET, reasoningEffort: "standard" }
    );
    expect(unchanged.action.changes.reasoningEffort).toBeNull();
  });

  it("flags a temperature change only when prior temp is known AND differs", () => {
    const changed = buildCacheHabitsInputs(
      warmSonnetView(),
      { model: SONNET, temperature: 0.7 },
      { temperature: 0 }
    );
    expect(changed.action.changes.temperature).toBe(0.7);

    // Prior temp unknown ⇒ no change emitted.
    const noPrior = buildCacheHabitsInputs(
      warmSonnetView(),
      { model: SONNET, temperature: 0.7 }
    );
    expect(noPrior.action.changes.temperature).toBeNull();
  });

  it("computes mcp add/remove as set differences", () => {
    const { action } = buildCacheHabitsInputs(
      warmSonnetView(),
      { model: SONNET, mcpServers: ["fs", "github", "slack"] },
      { mcpServers: ["fs", "github"] }
    );
    expect(action.changes.mcpServersAdded).toEqual(["slack"]);
    expect(action.changes.mcpServersRemoved).toEqual([]);

    const removal = buildCacheHabitsInputs(
      warmSonnetView(),
      { model: SONNET, mcpServers: ["fs"] },
      { mcpServers: ["fs", "github"] }
    );
    expect(removal.action.changes.mcpServersAdded).toEqual([]);
    expect(removal.action.changes.mcpServersRemoved).toEqual(["github"]);
  });

  it("model switch / ttl / now are passed through as top-level fields, not changes", () => {
    const { action } = buildCacheHabitsInputs(
      warmSonnetView(),
      { model: OPUS, ttl: "1h", now: "2026-06-04T11:00:00.000Z" },
      { currentTtl: "5m" }
    );
    expect(action.model).toBe(OPUS);
    expect(action.modelFamily).toBe("opus");
    expect(action.ttl).toBe("1h");
    expect(action.now).toBe("2026-06-04T11:00:00.000Z");
  });

  it("defaults `now` to lastTurnAt (zero idle gap) when host omits a clock", () => {
    const { action } = buildCacheHabitsInputs(warmSonnetView(), { model: SONNET });
    expect(action.now).toBe("2026-06-04T10:01:30.000Z");
  });
});

// ---------------------------------------------------------------------------
// THE PROOF: feed the OUTPUT through lint() and assert the right CH rules fire.
// ---------------------------------------------------------------------------

describe("buildCacheHabitsInputs — lint integration proof", () => {
  it("a model-switch + tool-reorder session fires CH-001, CH-005, and CH-012", () => {
    const { snapshot, action } = buildCacheHabitsInputs(
      warmSonnetView(),
      {
        model: OPUS, // mid-session model switch → CH-001
        toolListOrderHash: "hash-B", // tool-list reorder → CH-005
      },
      {
        currentTtl: "5m",
        toolListOrderHash: "hash-A",
      }
    );

    const report = lint(action, snapshot);
    const fired = report.findings.map((f) => f.ruleId);

    expect(fired).toContain("CH-001"); // mid_session_model_switch
    expect(fired).toContain("CH-005"); // tool_list_reorder
    // CH-012 compound: ≥2 mutations (model + toolList) AND cache investment
    // (9000) ≥ min cacheable for opus family (4096).
    expect(fired).toContain("CH-012");
    expect(report.verdict).toBe("warn");
    // Real cost flows through — CH-001 must carry the summed cache investment.
    const ch001 = report.findings.find((f) => f.ruleId === "CH-001")!;
    expect(ch001.estimatedWasteTokens).toBe(9000);
  });

  it("idle gap beyond the active TTL fires CH-004 from a real timestamp delta", () => {
    const { snapshot, action } = buildCacheHabitsInputs(
      warmSonnetView(),
      {
        model: SONNET, // no switch
        now: "2026-06-04T10:10:00.000Z", // 8.5m after last turn (10:01:30)
      },
      { currentTtl: "5m" } // 5m TTL → 8.5m idle exceeds it
    );
    const report = lint(action, snapshot);
    const fired = report.findings.map((f) => f.ruleId);
    expect(fired).toContain("CH-004"); // idle_exceeds_ttl
    expect(fired).not.toContain("CH-001"); // no model switch
  });

  it("a clean continuation (same everything) fires NOTHING", () => {
    const { snapshot, action } = buildCacheHabitsInputs(
      warmSonnetView(),
      { model: SONNET, ttl: "5m", now: "2026-06-04T10:02:00.000Z" },
      { currentTtl: "5m" }
    );
    const report = lint(action, snapshot);
    expect(report.findings).toEqual([]);
    expect(report.verdict).toBe("info");
  });

  it("MCP add + system-prompt mutation fires CH-007 and CH-006", () => {
    const { snapshot, action } = buildCacheHabitsInputs(
      warmSonnetView(),
      {
        model: SONNET,
        systemPromptTokens: 3000,
        mcpServers: ["fs", "github"],
      },
      {
        systemPromptTokens: 1500,
        mcpServers: ["fs"],
      }
    );
    const report = lint(action, snapshot);
    const fired = report.findings.map((f) => f.ruleId);
    expect(fired).toContain("CH-006"); // system_prompt_mutation
    expect(fired).toContain("CH-007"); // mcp_server_mutation
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL — malformed input must never throw, never fabricate.
// ---------------------------------------------------------------------------

describe("buildCacheHabitsInputs — adversarial robustness", () => {
  it("empty transcript: zero turns, null timestamp, proposed model as current", () => {
    const { snapshot, action } = buildCacheHabitsInputs({ turns: [] }, { model: SONNET });
    expect(snapshot.turnsSoFar).toBe(0);
    expect(snapshot.cacheReadTokensSoFar).toBe(0);
    expect(snapshot.cacheCreationTokensSoFar).toBe(0);
    expect(snapshot.lastTurnAt).toBeNull();
    expect(snapshot.currentModel).toBe(SONNET);
    // now falls back to epoch (deterministic, not a fabricated "now").
    expect(action.now).toBe(new Date(0).toISOString());
  });

  it("tolerates a non-array turns field without throwing", () => {
    const bogus = { turns: undefined as unknown as NormalizedTurn[] };
    expect(() => buildCacheHabitsInputs(bogus, { model: SONNET })).not.toThrow();
    const { snapshot } = buildCacheHabitsInputs(bogus, { model: SONNET });
    expect(snapshot.turnsSoFar).toBe(0);
  });

  it("ignores negative / NaN / non-number usage fields (never goes negative)", () => {
    const view = {
      turns: [
        turn({
          turnNumber: 1,
          model: SONNET,
          usage: {
            input: 0,
            output: 0,
            cacheRead: -100 as number,
            cacheCreate: Number.NaN as number,
          },
        }),
        turn({
          turnNumber: 2,
          model: SONNET,
          usage: { input: 0, output: 0, cacheRead: 500, cacheCreate: 700 },
        }),
      ],
    };
    const { snapshot } = buildCacheHabitsInputs(view, { model: SONNET });
    expect(snapshot.cacheReadTokensSoFar).toBe(500);
    expect(snapshot.cacheCreationTokensSoFar).toBe(700);
  });

  it("de-dupes and ignores non-string entries in mcp set diffs", () => {
    const { action } = buildCacheHabitsInputs(
      warmSonnetView(),
      { model: SONNET, mcpServers: ["fs", "fs", "x", 42 as unknown as string] },
      { mcpServers: ["fs"] }
    );
    expect(action.changes.mcpServersAdded).toEqual(["x"]);
  });

  it("null host context fields are honored as 'unknown' (stay null)", () => {
    const { snapshot, action } = buildCacheHabitsInputs(
      warmSonnetView(),
      { model: SONNET, systemPromptTokens: null, toolListOrderHash: null },
      { systemPromptTokens: null, toolListOrderHash: null }
    );
    expect(snapshot.systemPromptTokens).toBeNull();
    expect(snapshot.toolListOrderHash).toBeNull();
    expect(action.changes.systemPromptTokens).toBeNull();
    expect(action.changes.toolListOrderHash).toBeNull();
  });

  it("unknown model maps to the 'other' family without throwing", () => {
    const { action } = buildCacheHabitsInputs(warmSonnetView(), {
      model: "some-future-model-x",
    });
    expect(action.modelFamily).toBe("other");
  });
});
