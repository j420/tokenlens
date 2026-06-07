import { describe, expect, it } from "vitest";

import { _RULES } from "./rules.js";
import { buildAction, buildSnapshot } from "./test-helpers.js";

describe("CH-001 mid_session_model_switch", () => {
  const rule = _RULES.CH_001;

  it("fires when proposed model differs from snapshot", () => {
    const f = rule.run(
      buildAction({ model: "claude-haiku-3.5", modelFamily: "haiku" }),
      buildSnapshot({ currentModel: "claude-sonnet-4-5-20250929", cacheCreationTokensSoFar: 10_000 })
    );
    expect(f).not.toBeNull();
    expect(f!.ruleId).toBe("CH-001");
    expect(f!.severity).toBe("warn");
    expect(f!.estimatedWasteTokens).toBe(10_000);
    expect(f!.signal["previousModel"]).toBe("claude-sonnet-4-5-20250929");
    expect(f!.signal["newModel"]).toBe("claude-haiku-3.5");
  });

  it("does not fire when model is unchanged", () => {
    expect(rule.run(buildAction(), buildSnapshot())).toBeNull();
  });

  it("computes waste as cache_creation × input × write_multiplier", () => {
    // 10_000 tokens × $15/1M (opus input) × 1.25 = $0.1875
    const f = rule.run(
      buildAction({ model: "claude-opus-4-5-20251101", modelFamily: "opus" }),
      buildSnapshot({
        currentModel: "claude-opus-4-5-20251101",
        cacheCreationTokensSoFar: 10_000,
      })
    );
    // Same model — should not fire.
    expect(f).toBeNull();
  });

  it("returns deterministic message for same inputs", () => {
    const a = buildAction({ model: "claude-haiku-3.5" });
    const s = buildSnapshot();
    expect(rule.run(a, s)!.message).toBe(rule.run(a, s)!.message);
  });
});

describe("CH-002 system_prompt_too_small", () => {
  const rule = _RULES.CH_002;

  it("fires for Sonnet when prompt below 1024 tokens", () => {
    const f = rule.run(
      buildAction({ modelFamily: "sonnet" }),
      buildSnapshot({ systemPromptTokens: 800 })
    );
    expect(f).not.toBeNull();
    expect(f!.signal["minCacheable"]).toBe(1024);
    expect(f!.signal["systemPromptTokens"]).toBe(800);
  });

  it("fires for Opus when prompt below 4096 tokens", () => {
    const f = rule.run(
      buildAction({ modelFamily: "opus" }),
      buildSnapshot({ systemPromptTokens: 3000 })
    );
    expect(f).not.toBeNull();
    expect(f!.signal["minCacheable"]).toBe(4096);
  });

  it("does not fire when prompt meets minimum", () => {
    expect(
      rule.run(buildAction({ modelFamily: "sonnet" }), buildSnapshot({ systemPromptTokens: 1500 }))
    ).toBeNull();
  });

  it("uses the proposed CHANGE if specified, not the snapshot", () => {
    const f = rule.run(
      buildAction({ modelFamily: "sonnet", changeSystemPromptTokens: 500 }),
      buildSnapshot({ systemPromptTokens: 4000 })
    );
    expect(f).not.toBeNull();
    expect(f!.signal["systemPromptTokens"]).toBe(500);
  });

  it("does not fire when systemPromptTokens is unknown (no fabrication)", () => {
    expect(
      rule.run(buildAction(), buildSnapshot({ systemPromptTokens: null }))
    ).toBeNull();
  });
});

describe("CH-003 large_clipboard_paste", () => {
  const rule = _RULES.CH_003;

  it("fires on clipboard paste >= min cacheable", () => {
    const f = rule.run(
      buildAction({
        pastedBlocks: [{ tokens: 1500, source: "clipboard" }],
        modelFamily: "sonnet",
      }),
      buildSnapshot()
    );
    expect(f).not.toBeNull();
    expect(f!.signal["pasteTokens"]).toBe(1500);
  });

  it("ignores file-source pastes (host has done the file-read)", () => {
    expect(
      rule.run(
        buildAction({ pastedBlocks: [{ tokens: 50_000, source: "file" }] }),
        buildSnapshot()
      )
    ).toBeNull();
  });

  it("aggregates multiple clipboard blocks", () => {
    const f = rule.run(
      buildAction({
        pastedBlocks: [
          { tokens: 700, source: "clipboard" },
          { tokens: 700, source: "url" },
        ],
        modelFamily: "sonnet",
      }),
      buildSnapshot()
    );
    expect(f).not.toBeNull();
    expect(f!.signal["pasteTokens"]).toBe(1400);
  });

  it("does not fire below the threshold", () => {
    expect(
      rule.run(
        buildAction({ pastedBlocks: [{ tokens: 200, source: "clipboard" }] }),
        buildSnapshot()
      )
    ).toBeNull();
  });

  it("ignores negative paste-token claims (no fabrication, no underflow)", () => {
    expect(
      rule.run(
        buildAction({ pastedBlocks: [{ tokens: -999, source: "clipboard" }] }),
        buildSnapshot()
      )
    ).toBeNull();
  });
});

describe("CH-004 idle_exceeds_ttl", () => {
  const rule = _RULES.CH_004;

  it("fires when gap > 5 minutes on 5m TTL", () => {
    const f = rule.run(
      buildAction({ now: "2026-06-03T12:10:00.000Z" }),
      buildSnapshot({ currentTtl: "5m", lastTurnAt: "2026-06-03T12:00:00.000Z" })
    );
    expect(f).not.toBeNull();
    expect((f!.signal["idleMinutes"] as number) > 5).toBe(true);
  });

  it("fires when gap > 1 hour on 1h TTL", () => {
    const f = rule.run(
      buildAction({ now: "2026-06-03T13:30:00.000Z" }),
      buildSnapshot({ currentTtl: "1h", lastTurnAt: "2026-06-03T12:00:00.000Z" })
    );
    expect(f).not.toBeNull();
  });

  it("does not fire inside the TTL window", () => {
    expect(
      rule.run(
        buildAction({ now: "2026-06-03T12:04:00.000Z" }),
        buildSnapshot({ currentTtl: "5m", lastTurnAt: "2026-06-03T12:00:00.000Z" })
      )
    ).toBeNull();
  });

  it("does not fire when ttl is 'none'", () => {
    expect(
      rule.run(
        buildAction({ now: "2026-06-03T15:00:00.000Z" }),
        buildSnapshot({ currentTtl: "none", lastTurnAt: "2026-06-03T12:00:00.000Z" })
      )
    ).toBeNull();
  });

  it("does not fire when lastTurnAt is null (no fabrication)", () => {
    expect(rule.run(buildAction(), buildSnapshot({ lastTurnAt: null }))).toBeNull();
  });

  it("treats backwards-in-time gap as 0", () => {
    const f = rule.run(
      buildAction({ now: "2026-06-03T11:00:00.000Z" }),
      buildSnapshot({ currentTtl: "5m", lastTurnAt: "2026-06-03T12:00:00.000Z" })
    );
    expect(f).toBeNull(); // 0 gap < TTL
  });
});

describe("CH-005 tool_list_reorder", () => {
  const rule = _RULES.CH_005;

  it("fires when proposed tool-list hash differs from snapshot", () => {
    const f = rule.run(
      buildAction({ changeToolListOrderHash: "hash-B" }),
      buildSnapshot({ toolListOrderHash: "hash-A", cacheCreationTokensSoFar: 5_000 })
    );
    expect(f).not.toBeNull();
    expect(f!.signal["previousHash"]).toBe("hash-A");
    expect(f!.signal["newHash"]).toBe("hash-B");
  });

  it("does not fire when the proposed hash matches snapshot", () => {
    expect(
      rule.run(
        buildAction({ changeToolListOrderHash: "hash-A" }),
        buildSnapshot({ toolListOrderHash: "hash-A" })
      )
    ).toBeNull();
  });

  it("does not fire when no hash change is proposed", () => {
    expect(rule.run(buildAction(), buildSnapshot())).toBeNull();
  });

  it("does not fire when snapshot hash is null (cannot prove a change)", () => {
    expect(
      rule.run(
        buildAction({ changeToolListOrderHash: "hash-B" }),
        buildSnapshot({ toolListOrderHash: null })
      )
    ).toBeNull();
  });
});

describe("CH-006 system_prompt_mutation", () => {
  const rule = _RULES.CH_006;

  it("fires when system prompt token count changes", () => {
    const f = rule.run(
      buildAction({ changeSystemPromptTokens: 2500 }),
      buildSnapshot({ systemPromptTokens: 2048 })
    );
    expect(f).not.toBeNull();
    expect(f!.signal["previousSystemPromptTokens"]).toBe(2048);
    expect(f!.signal["newSystemPromptTokens"]).toBe(2500);
  });

  it("does not fire when the new count equals snapshot", () => {
    expect(
      rule.run(
        buildAction({ changeSystemPromptTokens: 2048 }),
        buildSnapshot({ systemPromptTokens: 2048 })
      )
    ).toBeNull();
  });

  it("does not fire when no change is proposed", () => {
    expect(rule.run(buildAction(), buildSnapshot())).toBeNull();
  });
});

describe("CH-007 mcp_server_mutation", () => {
  const rule = _RULES.CH_007;

  it("fires on server add", () => {
    const f = rule.run(
      buildAction({ mcpServersAdded: ["slack"] }),
      buildSnapshot()
    );
    expect(f).not.toBeNull();
    expect((f!.signal["added"] as string[])).toEqual(["slack"]);
  });

  it("fires on server remove", () => {
    const f = rule.run(
      buildAction({ mcpServersRemoved: ["postgres"] }),
      buildSnapshot()
    );
    expect(f).not.toBeNull();
    expect((f!.signal["removed"] as string[])).toEqual(["postgres"]);
  });

  it("does not fire when no servers change", () => {
    expect(rule.run(buildAction(), buildSnapshot())).toBeNull();
  });
});

describe("CH-008 ttl_tier_switch", () => {
  const rule = _RULES.CH_008;

  it("fires on 5m → 1h switch", () => {
    const f = rule.run(
      buildAction({ ttl: "1h" }),
      buildSnapshot({ currentTtl: "5m" })
    );
    expect(f).not.toBeNull();
  });

  it("fires on 1h → 5m switch", () => {
    const f = rule.run(
      buildAction({ ttl: "5m" }),
      buildSnapshot({ currentTtl: "1h" })
    );
    expect(f).not.toBeNull();
  });

  it("does not fire on same tier", () => {
    expect(rule.run(buildAction(), buildSnapshot())).toBeNull();
  });

  it("does not fire when one side is 'none'", () => {
    expect(
      rule.run(buildAction({ ttl: "none" }), buildSnapshot({ currentTtl: "5m" }))
    ).toBeNull();
  });
});

describe("CH-009 reasoning_effort_raised", () => {
  const rule = _RULES.CH_009;

  it("fires when effort is raised", () => {
    const f = rule.run(
      buildAction({ changeReasoningEffort: "high" }),
      buildSnapshot({ reasoningEffort: "standard" })
    );
    expect(f).not.toBeNull();
    expect(f!.signal["rungsRaised"]).toBe(1);
  });

  it("does not fire when effort is lowered", () => {
    expect(
      rule.run(
        buildAction({ changeReasoningEffort: "standard" }),
        buildSnapshot({ reasoningEffort: "max" })
      )
    ).toBeNull();
  });

  it("does not fire when effort is unchanged", () => {
    expect(
      rule.run(
        buildAction({ changeReasoningEffort: "high" }),
        buildSnapshot({ reasoningEffort: "high" })
      )
    ).toBeNull();
  });

  it("treats missing snapshot effort as 'standard'", () => {
    const f = rule.run(
      buildAction({ changeReasoningEffort: "high" }),
      buildSnapshot()
    );
    expect(f).not.toBeNull();
    expect(f!.signal["previousEffort"]).toBe("standard");
  });
});

describe("CH-010 temperature_change", () => {
  const rule = _RULES.CH_010;

  it("fires on temperature change", () => {
    const f = rule.run(
      buildAction({ changeTemperature: 0.9 }),
      buildSnapshot({ temperature: 0 })
    );
    expect(f).not.toBeNull();
  });

  it("does not fire when snapshot temperature is undefined", () => {
    expect(
      rule.run(buildAction({ changeTemperature: 0.7 }), buildSnapshot())
    ).toBeNull();
  });
});

describe("CH-011 pasted_block_unknown_source", () => {
  const rule = _RULES.CH_011;

  it("fires when any block has source = 'unknown'", () => {
    const f = rule.run(
      buildAction({ pastedBlocks: [{ tokens: 200, source: "unknown" }] }),
      buildSnapshot()
    );
    expect(f).not.toBeNull();
    expect(f!.signal["unknownTokens"]).toBe(200);
  });

  it("does not fire when all blocks have declared sources", () => {
    expect(
      rule.run(
        buildAction({
          pastedBlocks: [
            { tokens: 200, source: "clipboard" },
            { tokens: 200, source: "file" },
          ],
        }),
        buildSnapshot()
      )
    ).toBeNull();
  });
});

describe("CH-012 compound_cache_loss", () => {
  const rule = _RULES.CH_012;

  it("fires when ≥2 mutations land in one action and investment is meaningful", () => {
    const f = rule.run(
      buildAction({
        model: "claude-haiku-3.5",
        modelFamily: "haiku",
        ttl: "1h",
      }),
      buildSnapshot({
        currentModel: "claude-sonnet-4-5-20250929",
        currentTtl: "5m",
        cacheCreationTokensSoFar: 8_000, // above 4096 (haiku min)
      })
    );
    expect(f).not.toBeNull();
    expect((f!.signal["mutationCount"] as number) >= 2).toBe(true);
    expect((f!.signal["fired"] as string[]).includes("model")).toBe(true);
    expect((f!.signal["fired"] as string[]).includes("ttl")).toBe(true);
  });

  it("does not fire on a single mutation", () => {
    expect(
      rule.run(
        buildAction({ model: "claude-haiku-3.5", modelFamily: "haiku" }),
        buildSnapshot({ currentModel: "claude-sonnet-4-5-20250929" })
      )
    ).toBeNull();
  });

  it("does not fire when investment is below min cacheable prefix", () => {
    expect(
      rule.run(
        buildAction({ model: "claude-haiku-3.5", modelFamily: "haiku", ttl: "1h" }),
        buildSnapshot({
          currentModel: "claude-sonnet-4-5-20250929",
          currentTtl: "5m",
          cacheCreationTokensSoFar: 500, // below 4096
        })
      )
    ).toBeNull();
  });
});

describe("CH-013 transport_regression", () => {
  const rule = _RULES.CH_013;

  it("fires on a stateful→stateless transition and prices the re-send at input rate", () => {
    const f = rule.run(
      buildAction({ model: "claude-sonnet-4-5-20250929", changeTransport: "stateless" }),
      buildSnapshot({ transport: "stateful", historyTokens: 20_000 })
    );
    expect(f).not.toBeNull();
    expect(f!.ruleId).toBe("CH-013");
    expect(f!.severity).toBe("warn");
    expect(f!.estimatedWasteTokens).toBe(20_000);
    // 20_000 tokens × $3 / 1M input rate = $0.06 (verified stateless rate).
    expect(f!.estimatedWasteUsd).toBeCloseTo(0.06);
    expect(f!.signal["previousTransport"]).toBe("stateful");
    expect(f!.signal["newTransport"]).toBe("stateless");
  });

  it("fires but reports null cost when history size is unknown (never fabricates)", () => {
    const f = rule.run(
      buildAction({ model: "claude-sonnet-4-5-20250929", changeTransport: "stateless" }),
      buildSnapshot({ transport: "stateful", historyTokens: null })
    );
    expect(f).not.toBeNull();
    expect(f!.estimatedWasteUsd).toBeNull();
    expect(f!.estimatedWasteTokens).toBeNull();
    expect(f!.message).toContain("size unknown");
  });

  it("does not fire without a stateful→stateless transition", () => {
    // already stateless, no change
    expect(
      rule.run(
        buildAction({ changeTransport: null }),
        buildSnapshot({ transport: "stateless", historyTokens: 20_000 })
      )
    ).toBeNull();
    // stateful staying stateful
    expect(
      rule.run(
        buildAction({ changeTransport: null }),
        buildSnapshot({ transport: "stateful", historyTokens: 20_000 })
      )
    ).toBeNull();
    // transport unknown (host never declared it) → dormant
    expect(
      rule.run(
        buildAction({ changeTransport: "stateless" }),
        buildSnapshot({ transport: undefined, historyTokens: 20_000 })
      )
    ).toBeNull();
  });
});

describe("CH-014 stateful_transport_advisor", () => {
  const rule = _RULES.CH_014;

  it("advises on a long stateless session and emits NO dollar saving (contingent)", () => {
    const f = rule.run(
      buildAction({ model: "claude-sonnet-4-5-20250929", modelFamily: "sonnet" }),
      buildSnapshot({ transport: "stateless", turnsSoFar: 10, historyTokens: 20_000 })
    );
    expect(f).not.toBeNull();
    expect(f!.ruleId).toBe("CH-014");
    expect(f!.severity).toBe("info");
    expect(f!.estimatedWasteUsd).toBeNull(); // never a saving on an unverified mechanic
    expect(f!.estimatedWasteTokens).toBe(20_000); // observed re-communicated volume (fact)
    expect(f!.signal["contingent"]).toBe(true);
    expect(f!.signal["reCommunicatedTokens"]).toBe(20_000);
  });

  it("does not fire below the turn floor", () => {
    expect(
      rule.run(
        buildAction({ modelFamily: "sonnet" }),
        buildSnapshot({ transport: "stateless", turnsSoFar: 3, historyTokens: 20_000 })
      )
    ).toBeNull();
  });

  it("does not fire when re-communicated history is below the min cacheable prefix", () => {
    expect(
      rule.run(
        buildAction({ modelFamily: "sonnet" }),
        buildSnapshot({ transport: "stateless", turnsSoFar: 20, historyTokens: 500 })
      )
    ).toBeNull();
  });

  it("does not fire when history size is unknown, or transport isn't stateless", () => {
    expect(
      rule.run(
        buildAction({ modelFamily: "sonnet" }),
        buildSnapshot({ transport: "stateless", turnsSoFar: 20, historyTokens: null })
      )
    ).toBeNull();
    expect(
      rule.run(
        buildAction({ modelFamily: "sonnet" }),
        buildSnapshot({ transport: "stateful", turnsSoFar: 20, historyTokens: 20_000 })
      )
    ).toBeNull();
  });

  it("CH-013 and CH-014 never double-fire on the same transition turn", () => {
    // On the regression turn snapshot.transport is still 'stateful', so CH-014
    // short-circuits while CH-013 fires.
    const action = buildAction({ model: "claude-sonnet-4-5-20250929", changeTransport: "stateless" });
    const snapshot = buildSnapshot({ transport: "stateful", turnsSoFar: 20, historyTokens: 20_000 });
    expect(_RULES.CH_013.run(action, snapshot)).not.toBeNull();
    expect(_RULES.CH_014.run(action, snapshot)).toBeNull();
  });
});
