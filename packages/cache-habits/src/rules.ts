/**
 * The 12 cache-habit rules. Each carries a stable id (CH-NNN) that never
 * changes once shipped. Rule message templates are deterministic — same
 * inputs always produce the same string, pinned by tests.
 *
 * Discipline:
 *   - No regex. Field walks only.
 *   - No model call.
 *   - Deterministic templated messages (PII-safe; never includes user content).
 *   - Returns null when the rule does NOT fire (no waste reported).
 *   - When pricing data is missing, message reports tokens only and sets
 *     `estimatedWasteUsd: null` — never fabricates a number.
 *
 * Source for the published-habit list (each rule cites the specific source
 * in its `citation` field):
 *   - Anthropic prompt-caching docs (cache breakpoint, min prefix, TTL):
 *     5m write 1.25x, 1h write 2.0x, read 0.1x; min cacheable 1024 (Sonnet
 *     4.5/4.6) / 4096 (Opus 4.5). Verified against platform.claude.com
 *     prompt-caching + pricing docs, 2026-06-03.
 *   - Anthropic engineering post "Effective context engineering for AI agents".
 *   - `agent-sdk-adapter/cache-planner.ts` soundness rules (declared
 *     volatility, byte-stable prefix).
 */

import type { LintFinding, ProposedAction, Rule, SessionSnapshot } from "./types.js";
import {
  cacheInvestmentLossUsd,
  cacheReadSavingsPerReadUsd,
  cacheWriteCostUsd,
  freshInputCostUsd,
  minCacheablePrefix,
  minutesBetween,
  ttlSeconds,
  TTL_BREAK_EVEN_READS_PER_HOUR,
} from "./cache-econ.js";

/**
 * Minimum completed turns before CH-014 advises a stateless→stateful transport
 * migration. Below this, the re-communication tax has not yet accumulated
 * enough for the latency-for-price trade to be worth raising.
 */
const TRANSPORT_ADVICE_MIN_TURNS = 8;

// ---------------------------------------------------------------------------
// Helpers shared by multiple rules.
// ---------------------------------------------------------------------------

function modelFamilyOf(model: string): string {
  const m = model.toLowerCase();
  if (m.includes("sonnet")) return "sonnet";
  if (m.includes("opus")) return "opus";
  if (m.includes("haiku")) return "haiku";
  if (m.includes("gpt-4o-mini")) return "gpt-4o-mini";
  if (m.includes("gpt-4o")) return "gpt-4o";
  return "other";
}

function formatUsd(n: number | null): string {
  if (n === null) return "unknown cost";
  if (n === 0) return "$0.0000";
  if (n < 0.0001) return "<$0.0001";
  return `$${n.toFixed(4)}`;
}

function formatTokens(n: number): string {
  return n.toLocaleString("en-US");
}

// ---------------------------------------------------------------------------
// CH-001 — Mid-session model switch invalidates the entire cached prefix.
// ---------------------------------------------------------------------------

const CH_001: Rule = {
  id: "CH-001",
  name: "mid_session_model_switch",
  description:
    "Switching models mid-session invalidates the cached prefix; the new model rebuilds cache from scratch.",
  defaultSeverity: "warn",
  citation:
    "Anthropic prompt-caching docs: cache is scoped per (model, byte-identical prefix). " +
    "Mirrored in agent-sdk-adapter/cache-planner.ts soundness rules.",
  run(action, snapshot): LintFinding | null {
    if (action.model === snapshot.currentModel) return null;
    const loss = cacheInvestmentLossUsd(
      snapshot.cacheCreationTokensSoFar,
      snapshot.currentTtl,
      snapshot.currentModel
    );
    return {
      ruleId: "CH-001",
      ruleName: "mid_session_model_switch",
      severity: "warn",
      message:
        `Model switch ${snapshot.currentModel} → ${action.model} will invalidate ` +
        `~${formatTokens(snapshot.cacheCreationTokensSoFar)} tokens of cache investment ` +
        `(~${formatUsd(loss)} of cache-write cost will be re-paid on the new model).`,
      suggestion:
        `Keep the active model for this session, or start a fresh session with ${action.model} ` +
        `if the model change is intentional.`,
      estimatedWasteUsd: loss,
      estimatedWasteTokens: snapshot.cacheCreationTokensSoFar,
      signal: {
        previousModel: snapshot.currentModel,
        newModel: action.model,
        cacheCreationTokensLost: snapshot.cacheCreationTokensSoFar,
        ttl: snapshot.currentTtl,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// CH-002 — System prompt below the minimum cacheable prefix.
// ---------------------------------------------------------------------------

const CH_002: Rule = {
  id: "CH-002",
  name: "system_prompt_too_small",
  description:
    "System prompt below the model's minimum cacheable prefix means no cache breakpoint can sit there.",
  defaultSeverity: "info",
  citation:
    "Anthropic prompt-caching docs: minimum cacheable prefix is 1024 tokens (Sonnet) " +
    "or 4096 tokens (Opus, Haiku). Source mirrored in cache-planner.ts:DEFAULT_MIN_CACHEABLE_TOKENS.",
  run(action, snapshot): LintFinding | null {
    // Use the proposed action's family. Snapshot family is irrelevant — the
    // PROPOSED action is what will fire and what determines the min prefix.
    const min = minCacheablePrefix(action.modelFamily);
    // Prefer the proposed new system-prompt token count if changing it;
    // otherwise the snapshot's known count.
    const sysTokens =
      action.changes.systemPromptTokens !== null
        ? action.changes.systemPromptTokens
        : snapshot.systemPromptTokens;
    if (sysTokens === null) return null; // never fabricate a count.
    if (sysTokens >= min) return null;
    return {
      ruleId: "CH-002",
      ruleName: "system_prompt_too_small",
      severity: "info",
      message:
        `System prompt is ${formatTokens(sysTokens)} tokens; the ${action.modelFamily} ` +
        `family requires at least ${formatTokens(min)} tokens for cache eligibility. ` +
        `No cache breakpoint can sit on a prefix this small; the session will pay full ` +
        `input rate on every turn.`,
      suggestion:
        `Extend the system prompt past ${formatTokens(min)} tokens, or place the cache ` +
        `breakpoint after a stable user-message block large enough to clear the minimum.`,
      estimatedWasteUsd: null,
      estimatedWasteTokens: null,
      signal: {
        systemPromptTokens: sysTokens,
        minCacheable: min,
        modelFamily: action.modelFamily,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// CH-003 — Large clipboard paste should have been a file-read.
// ---------------------------------------------------------------------------

const CH_003: Rule = {
  id: "CH-003",
  name: "large_clipboard_paste",
  description:
    "Pasting a large block into chat instead of using a file-read tool prevents session-memory deduplication on subsequent turns.",
  defaultSeverity: "warn",
  citation:
    "Prune's own Session Memory Deduplication (apps/extension/src/token-saver.ts): " +
    "file-read results are deduplicated across turns, whereas a pasted block is fresh " +
    "user content re-billed every turn it stays in the prefix. The mechanism is the " +
    "in-repo feature; the principle (prefer file-reads over pastes) is general.",
  run(action, _snapshot): LintFinding | null {
    const min = minCacheablePrefix(action.modelFamily);
    // Aggregate paste tokens from caller-declared blocks; the linter never
    // sniffs the prompt body.
    let pasteTokens = 0;
    for (const block of action.prompt.pastedBlocks) {
      // Only count clipboard / url pastes — file-source pastes are
      // legitimate (the host already file-read on the user's behalf).
      if (block.source === "clipboard" || block.source === "url" || block.source === "unknown") {
        pasteTokens += Math.max(0, block.tokens);
      }
    }
    if (pasteTokens < min) return null;
    // Estimate: pasted content becomes fresh-input cost on this turn, plus
    // would have to be re-paid every turn it remains in the prefix.
    const writeCost = cacheWriteCostUsd(pasteTokens, action.ttl, action.model);
    return {
      ruleId: "CH-003",
      ruleName: "large_clipboard_paste",
      severity: "warn",
      message:
        `Detected ${formatTokens(pasteTokens)} pasted tokens (${action.prompt.pastedBlocks.length} ` +
        `block(s)). A file-read tool would let later turns hit the session-memory dedupe path; ` +
        `pasting forces fresh-input cost (~${formatUsd(writeCost)} on this turn alone).`,
      suggestion:
        `Save the content to a file in the workspace and reference it by path. Subsequent turns ` +
        `will reuse the prior read instead of re-paying for the content.`,
      estimatedWasteUsd: writeCost,
      estimatedWasteTokens: pasteTokens,
      signal: {
        pasteTokens,
        blockCount: action.prompt.pastedBlocks.length,
        minCacheable: min,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// CH-004 — Idle gap exceeds the active TTL; cached prefix expired.
// ---------------------------------------------------------------------------

const CH_004: Rule = {
  id: "CH-004",
  name: "idle_exceeds_ttl",
  description:
    "Idle gap exceeded the active TTL; the cached prefix expired and the next turn will rewrite it at the write-multiplier rate.",
  defaultSeverity: "warn",
  citation:
    "Anthropic prompt-caching docs: 5m and 1h TTLs are wall-clock; once elapsed " +
    "without a read, the cache row is evicted and the next request rewrites at " +
    "1.25× (5m) or 2.00× (1h) input rate.",
  run(action, snapshot): LintFinding | null {
    const ttlSec = ttlSeconds(snapshot.currentTtl);
    if (ttlSec === null) return null;
    const gapMin = minutesBetween(snapshot.lastTurnAt, action.now);
    if (gapMin === null) return null;
    if (gapMin * 60 <= ttlSec) return null;
    // Cost: rewrite the prefix at the active TTL's write multiplier.
    const rewriteCost = cacheWriteCostUsd(
      snapshot.cacheCreationTokensSoFar,
      snapshot.currentTtl,
      snapshot.currentModel
    );
    return {
      ruleId: "CH-004",
      ruleName: "idle_exceeds_ttl",
      severity: "warn",
      message:
        `Idle gap ${gapMin.toFixed(1)}m exceeded ${snapshot.currentTtl} TTL on ` +
        `${snapshot.currentModel}; cached prefix (~${formatTokens(snapshot.cacheCreationTokensSoFar)} ` +
        `tokens) expired. Next turn rewrites at ${snapshot.currentTtl === "1h" ? "2.00×" : "1.25×"} ` +
        `input rate (~${formatUsd(rewriteCost)}).`,
      suggestion:
        snapshot.currentTtl === "5m"
          ? `Consider 1h TTL for this session if you expect frequent context-switches; ` +
            `break-even is ${TTL_BREAK_EVEN_READS_PER_HOUR} reads/hour.`
          : `Keep the session warm with periodic short interactions, or accept the rewrite cost.`,
      estimatedWasteUsd: rewriteCost,
      estimatedWasteTokens: snapshot.cacheCreationTokensSoFar,
      signal: {
        idleMinutes: gapMin,
        ttl: snapshot.currentTtl,
        cacheCreationTokensLost: snapshot.cacheCreationTokensSoFar,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// CH-005 — Tool-list order changed mid-session.
// ---------------------------------------------------------------------------

const CH_005: Rule = {
  id: "CH-005",
  name: "tool_list_reorder",
  description:
    "Tool-list order is part of the cached prefix; reordering invalidates the cache from the tools block onward.",
  defaultSeverity: "warn",
  citation:
    "Anthropic prompt-caching docs: the tools array is part of the byte-identical " +
    "prefix; reordering changes the bytes and busts cache. Mirrored in cache-planner.ts.",
  run(action, snapshot): LintFinding | null {
    if (action.changes.toolListOrderHash === null) return null;
    if (snapshot.toolListOrderHash === null) return null;
    if (action.changes.toolListOrderHash === snapshot.toolListOrderHash) return null;
    const loss = cacheInvestmentLossUsd(
      snapshot.cacheCreationTokensSoFar,
      snapshot.currentTtl,
      snapshot.currentModel
    );
    return {
      ruleId: "CH-005",
      ruleName: "tool_list_reorder",
      severity: "warn",
      message:
        `Tool-list order changed; the cached prefix (~${formatTokens(snapshot.cacheCreationTokensSoFar)} ` +
        `tokens, ~${formatUsd(loss)}) will rewrite on the next turn.`,
      suggestion:
        `Define the tool catalog at session start and keep its order stable. If a tool must be added ` +
        `mid-session, append it (don't insert) to preserve the prefix.`,
      estimatedWasteUsd: loss,
      estimatedWasteTokens: snapshot.cacheCreationTokensSoFar,
      signal: {
        previousHash: snapshot.toolListOrderHash,
        newHash: action.changes.toolListOrderHash,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// CH-006 — System prompt content changed mid-session.
// ---------------------------------------------------------------------------

const CH_006: Rule = {
  id: "CH-006",
  name: "system_prompt_mutation",
  description:
    "System prompt is part of the cached prefix; changing it invalidates everything before the next breakpoint.",
  defaultSeverity: "warn",
  citation:
    "Anthropic prompt-caching docs: system prompt sits in the cached prefix; any " +
    "byte change invalidates downstream cache. Mirrored in cache-planner.ts " +
    "soundness rule #1 (stable → volatile is a hard boundary).",
  run(action, snapshot): LintFinding | null {
    // Detection: the caller-supplied changes.systemPromptTokens is non-null
    // AND differs from snapshot.systemPromptTokens. The linter does not
    // compare strings — that's the host's job.
    if (action.changes.systemPromptTokens === null) return null;
    if (snapshot.systemPromptTokens === null) return null;
    if (action.changes.systemPromptTokens === snapshot.systemPromptTokens) return null;
    const loss = cacheInvestmentLossUsd(
      snapshot.cacheCreationTokensSoFar,
      snapshot.currentTtl,
      snapshot.currentModel
    );
    return {
      ruleId: "CH-006",
      ruleName: "system_prompt_mutation",
      severity: "warn",
      message:
        `System prompt size changed ${formatTokens(snapshot.systemPromptTokens)} → ` +
        `${formatTokens(action.changes.systemPromptTokens)} tokens; cached prefix ` +
        `(~${formatTokens(snapshot.cacheCreationTokensSoFar)} tokens, ~${formatUsd(loss)}) invalidated.`,
      suggestion:
        `Move volatile additions to a user-message block after the cache breakpoint, ` +
        `keeping the system prompt byte-stable across the session.`,
      estimatedWasteUsd: loss,
      estimatedWasteTokens: snapshot.cacheCreationTokensSoFar,
      signal: {
        previousSystemPromptTokens: snapshot.systemPromptTokens,
        newSystemPromptTokens: action.changes.systemPromptTokens,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// CH-007 — MCP servers added or removed mid-session.
// ---------------------------------------------------------------------------

const CH_007: Rule = {
  id: "CH-007",
  name: "mcp_server_mutation",
  description:
    "Adding or removing an MCP server mid-session changes the tools block and busts cache.",
  defaultSeverity: "warn",
  citation:
    "Anthropic prompt-caching docs: tool definitions are part of the cached prefix. " +
    "Mirrored in Phase 6 plan (this file) §A.1 — the Anthropic on-demand tool-search " +
    "feature deferred this loading, but a mid-session add/remove still invalidates.",
  run(action, snapshot): LintFinding | null {
    const added = action.changes.mcpServersAdded;
    const removed = action.changes.mcpServersRemoved;
    if (added.length === 0 && removed.length === 0) return null;
    const loss = cacheInvestmentLossUsd(
      snapshot.cacheCreationTokensSoFar,
      snapshot.currentTtl,
      snapshot.currentModel
    );
    const parts: string[] = [];
    if (added.length > 0) parts.push(`added ${added.length} server(s): ${added.join(", ")}`);
    if (removed.length > 0) parts.push(`removed ${removed.length} server(s): ${removed.join(", ")}`);
    return {
      ruleId: "CH-007",
      ruleName: "mcp_server_mutation",
      severity: "warn",
      message:
        `MCP catalog mutation — ${parts.join("; ")}. Cached prefix ` +
        `(~${formatTokens(snapshot.cacheCreationTokensSoFar)} tokens, ~${formatUsd(loss)}) ` +
        `invalidated by the tools-block change.`,
      suggestion:
        `Configure MCP servers at session start. If you need a server mid-session, also ` +
        `accept the cache-rebuild cost on the next turn.`,
      estimatedWasteUsd: loss,
      estimatedWasteTokens: snapshot.cacheCreationTokensSoFar,
      signal: {
        added: Array.from(added),
        removed: Array.from(removed),
        previousServers: Array.from(snapshot.mcpServers),
      },
    };
  },
};

// ---------------------------------------------------------------------------
// CH-008 — TTL tier switched mid-session.
// ---------------------------------------------------------------------------

const CH_008: Rule = {
  id: "CH-008",
  name: "ttl_tier_switch",
  description:
    "Switching between 5m and 1h TTL mid-session causes a cache rewrite at the new tier's write multiplier.",
  defaultSeverity: "warn",
  citation:
    "Anthropic prompt-caching: TTL tier is part of the cache entry. Switching tiers " +
    "writes a new cache row at the new tier's write multiplier (1.25× → 2.00× or " +
    "2.00× → 1.25×). Mirrored in agent-sdk-adapter/ttl-amortization.ts.",
  run(action, snapshot): LintFinding | null {
    if (action.ttl === snapshot.currentTtl) return null;
    if (action.ttl === "none" || snapshot.currentTtl === "none") return null;
    const rewriteCost = cacheWriteCostUsd(
      snapshot.cacheCreationTokensSoFar,
      action.ttl,
      action.model
    );
    return {
      ruleId: "CH-008",
      ruleName: "ttl_tier_switch",
      severity: "warn",
      message:
        `TTL tier ${snapshot.currentTtl} → ${action.ttl}; cached prefix ` +
        `(~${formatTokens(snapshot.cacheCreationTokensSoFar)} tokens) rewrites at ` +
        `${action.ttl === "1h" ? "2.00×" : "1.25×"} input rate (~${formatUsd(rewriteCost)}).`,
      suggestion:
        `Decide TTL at session start. Break-even for 1h vs 5m is ` +
        `${TTL_BREAK_EVEN_READS_PER_HOUR} reads/hour — see ttl-amortization.ts.`,
      estimatedWasteUsd: rewriteCost,
      estimatedWasteTokens: snapshot.cacheCreationTokensSoFar,
      signal: {
        previousTtl: snapshot.currentTtl,
        newTtl: action.ttl,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// CH-009 — Reasoning-effort dial raised mid-session.
// ---------------------------------------------------------------------------

const CH_009: Rule = {
  id: "CH-009",
  name: "reasoning_effort_raised",
  description:
    "Raising the reasoning-effort dial increases output thinking-token volume — roughly an order of magnitude from the lowest to the highest setting — billed at the output rate.",
  defaultSeverity: "info",
  citation:
    "Reasoning-effort levels scale thinking-token volume across roughly minimal≈0.1 → " +
    "xhigh≈0.95 of the effort ratio (OpenRouter reasoning-tokens doc; verified 2026-06-03), " +
    "i.e. ~an order of magnitude across the dial, billed at the output rate. (NOTE: the " +
    "separate, widely-cited TokenMix '50×' figure is the premium-vs-budget MODEL tokens/$ " +
    "gap, NOT the effort dial — do not conflate.) Mirrored in §A.2: B.3 Reasoning-Effort " +
    "Auto-Router is the Tier-1 build that automates this per-task.",
  run(action, snapshot): LintFinding | null {
    if (action.changes.reasoningEffort === null) return null;
    const next = action.changes.reasoningEffort;
    const prev = snapshot.reasoningEffort ?? "standard";
    if (next === prev) return null;
    const order = ["standard", "high", "xhigh", "max"] as const;
    const prevIdx = order.indexOf(prev);
    const nextIdx = order.indexOf(next);
    if (nextIdx <= prevIdx) return null;
    return {
      ruleId: "CH-009",
      ruleName: "reasoning_effort_raised",
      severity: "info",
      message:
        `Reasoning effort ${prev} → ${next}; output thinking-tokens scale with the dial ` +
        `(roughly an order of magnitude across the full range), billed at the output rate.`,
      suggestion:
        `Verify this turn warrants the dial increase. If most turns need high effort, ` +
        `the B.3 Reasoning-Effort Auto-Router (Phase 8 Tier-1) handles per-task selection.`,
      estimatedWasteUsd: null,
      estimatedWasteTokens: null,
      signal: {
        previousEffort: prev,
        newEffort: next,
        rungsRaised: nextIdx - prevIdx,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// CH-010 — Temperature changed mid-session.
// ---------------------------------------------------------------------------

const CH_010: Rule = {
  id: "CH-010",
  name: "temperature_change",
  description:
    "Temperature is not part of the cached prefix, but a mid-session change usually indicates session-config drift that compromises reproducibility.",
  defaultSeverity: "info",
  citation:
    "Anthropic API: temperature is a request parameter, not part of the cached " +
    "prefix bytes. This rule is an ADVISORY about session-config stability, not " +
    "a cache invalidation. Mirrored in Phase 7 hard rules (deterministic config).",
  run(action, snapshot): LintFinding | null {
    if (action.changes.temperature === null) return null;
    const prev = snapshot.temperature;
    const next = action.changes.temperature;
    if (prev === undefined) return null;
    if (prev === next) return null;
    return {
      ruleId: "CH-010",
      ruleName: "temperature_change",
      severity: "info",
      message:
        `Temperature ${prev} → ${next} mid-session. Not a cache invalidation, but flags ` +
        `that this session's sampling is no longer reproducible from the prior turns.`,
      suggestion:
        `Decide temperature at session start. For deterministic agent loops, prefer ` +
        `temperature 0 throughout; for exploration, use a higher value end-to-end.`,
      estimatedWasteUsd: null,
      estimatedWasteTokens: null,
      signal: { previousTemperature: prev, newTemperature: next },
    };
  },
};

// ---------------------------------------------------------------------------
// CH-011 — Pasted block with caller-undeclared source.
// ---------------------------------------------------------------------------

const CH_011: Rule = {
  id: "CH-011",
  name: "pasted_block_unknown_source",
  description:
    "A pasted block whose source the host cannot vouch for is treated as volatile; if it sits before a cache breakpoint, downstream cache is invalidated.",
  defaultSeverity: "warn",
  citation:
    "Mirrors cache-planner.ts soundness rule #2: volatility is DECLARED by the caller. " +
    "An 'unknown' source is, by construction, not declared stable.",
  run(action, _snapshot): LintFinding | null {
    const unknown = action.prompt.pastedBlocks.filter((b) => b.source === "unknown");
    if (unknown.length === 0) return null;
    const total = unknown.reduce((sum, b) => sum + Math.max(0, b.tokens), 0);
    return {
      ruleId: "CH-011",
      ruleName: "pasted_block_unknown_source",
      severity: "warn",
      message:
        `${unknown.length} pasted block(s) totalling ${formatTokens(total)} tokens have ` +
        `source = "unknown". Cannot be placed before a cache breakpoint — would be ` +
        `treated as volatile (cache-planner soundness rule #2).`,
      suggestion:
        `Have the host tag the paste source (clipboard / url / file). Anything unknown ` +
        `goes after the breakpoint in the volatile region.`,
      estimatedWasteUsd: null,
      estimatedWasteTokens: total,
      signal: { unknownBlockCount: unknown.length, unknownTokens: total },
    };
  },
};

// ---------------------------------------------------------------------------
// CH-012 — Compound cache-investment loss (multiple mutations in one action).
// ---------------------------------------------------------------------------

const CH_012: Rule = {
  id: "CH-012",
  name: "compound_cache_loss",
  description:
    "Multiple cache-busting mutations in a single action compound the loss; warn aggressively when total investment at risk exceeds a threshold.",
  defaultSeverity: "warn",
  citation:
    "Composite check. Composes CH-001/005/006/007/008 — when ≥2 fire in the same " +
    "action and the cumulative cache investment exceeds the minimum cacheable prefix, " +
    "this rule surfaces the total dollar value at risk so the user sees the compounded picture.",
  run(action, snapshot): LintFinding | null {
    let mutations = 0;
    const fired: string[] = [];
    if (action.model !== snapshot.currentModel) {
      mutations++;
      fired.push("model");
    }
    if (
      action.changes.systemPromptTokens !== null &&
      snapshot.systemPromptTokens !== null &&
      action.changes.systemPromptTokens !== snapshot.systemPromptTokens
    ) {
      mutations++;
      fired.push("systemPrompt");
    }
    if (
      action.changes.toolListOrderHash !== null &&
      snapshot.toolListOrderHash !== null &&
      action.changes.toolListOrderHash !== snapshot.toolListOrderHash
    ) {
      mutations++;
      fired.push("toolList");
    }
    if (
      action.changes.mcpServersAdded.length > 0 ||
      action.changes.mcpServersRemoved.length > 0
    ) {
      mutations++;
      fired.push("mcpServers");
    }
    if (action.ttl !== snapshot.currentTtl && action.ttl !== "none" && snapshot.currentTtl !== "none") {
      mutations++;
      fired.push("ttl");
    }
    if (mutations < 2) return null;
    const min = minCacheablePrefix(action.modelFamily);
    if (snapshot.cacheCreationTokensSoFar < min) return null;
    // Loss is computed on the *destination* (post-mutation) TTL when TTL is
    // among the mutations; otherwise the current TTL.
    const lossTtl = fired.includes("ttl") ? action.ttl : snapshot.currentTtl;
    const lossModel = fired.includes("model") ? action.model : snapshot.currentModel;
    const loss = cacheInvestmentLossUsd(snapshot.cacheCreationTokensSoFar, lossTtl, lossModel);
    return {
      ruleId: "CH-012",
      ruleName: "compound_cache_loss",
      severity: "warn",
      message:
        `Compound cache-busting action: ${mutations} mutations (${fired.join(", ")}) ` +
        `in one send. Total cache investment at risk: ${formatTokens(snapshot.cacheCreationTokensSoFar)} ` +
        `tokens (~${formatUsd(loss)}).`,
      suggestion:
        `Land mutations one at a time so the per-turn cache rebuild is bounded, or batch ` +
        `them and accept the full rebuild as a known cost.`,
      estimatedWasteUsd: loss,
      estimatedWasteTokens: snapshot.cacheCreationTokensSoFar,
      signal: { mutationCount: mutations, fired, minCacheable: min },
    };
  },
};

// ---------------------------------------------------------------------------
// CH-013 — Transport regression: a stateful→stateless silent fallback.
// (List3 M7-2 "transport-regression-sentinel".)
// ---------------------------------------------------------------------------

const CH_013: Rule = {
  id: "CH-013",
  name: "transport_regression",
  description:
    "A stateful (server-side/WebSocket) transport silently fell back to stateless HTTP " +
    "(reconnect / SDK retry), so the whole conversation history is re-transmitted and " +
    "re-billed at full input rate — the transport-tier analogue of the 1h→5m TTL regression.",
  defaultSeverity: "warn",
  citation:
    "List3 M7-2. Prices ONLY the VERIFIED stateless fallback (full input rate × " +
    "caller-supplied re-billed history tokens), so the warning is sound even if the " +
    "stateful-transport billing mechanic (List3 M7-1, `unverified`) never confirms. " +
    "Complementary to CH-014 (opposite trigger direction).",
  run(action, snapshot): LintFinding | null {
    // Fire only on a CONFIRMED stateful→stateless transition the host declared.
    if (snapshot.transport !== "stateful") return null;
    if (action.changes.transport !== "stateless") return null;

    // History size is caller-supplied; null ⇒ we know it regressed but cannot
    // size it, and we never fabricate a token/cost number.
    const historyTokens =
      typeof snapshot.historyTokens === "number" && snapshot.historyTokens > 0
        ? snapshot.historyTokens
        : null;
    const reBillUsd =
      historyTokens === null ? null : freshInputCostUsd(historyTokens, action.model);

    const sizeClause =
      historyTokens === null
        ? `The conversation history will now be re-sent every turn (size unknown — ` +
          `host did not supply a history token count).`
        : `~${formatTokens(historyTokens)} tokens of history will be re-sent every turn at ` +
          `full input rate (~${formatUsd(reBillUsd)} per turn).`;

    return {
      ruleId: "CH-013",
      ruleName: "transport_regression",
      severity: "warn",
      message:
        `Transport regressed stateful → stateless. ${sizeClause} A stateful transport had been ` +
        `retaining this history server-side; the fallback resumes the per-turn "communication tax".`,
      suggestion:
        `Re-establish the stateful/WebSocket transport (reconnect with session resume) so history ` +
        `stops being re-transmitted, or accept the per-turn re-billing for the rest of the session.`,
      estimatedWasteUsd: reBillUsd,
      estimatedWasteTokens: historyTokens,
      signal: {
        previousTransport: snapshot.transport,
        newTransport: action.changes.transport,
        historyTokens,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// CH-014 — Stateful-transport advisor on a long stateless session.
// (List3 M7-1 "stateful-transport-advisor"; saving is UNVERIFIED ⇒ contingent.)
// ---------------------------------------------------------------------------

const CH_014: Rule = {
  id: "CH-014",
  name: "stateful_transport_advisor",
  description:
    "On a long stateless session the growing stable prefix is re-sent and re-billed every turn. " +
    "Advises migrating to a stateful/WebSocket transport so history stops being re-transmitted.",
  defaultSeverity: "info",
  citation:
    "List3 M7-1. The stateful-transport billing benefit is `unverified` (needs a primary " +
    "OpenAI Realtime/Responses billing doc), so this reports the OBSERVED re-communicated " +
    "tokens as a fact and emits NO dollar saving — `estimatedWasteUsd` stays null and " +
    "`signal.contingent` is true until the caller supplies the stateful per-turn rate.",
  run(action, snapshot): LintFinding | null {
    // The session is (and stays) stateless — not a regression this turn (that's
    // CH-013's job; a stateful→stateless transition leaves snapshot.transport
    // = "stateful", so this short-circuits and the two never double-fire).
    if (snapshot.transport !== "stateless") return null;
    if (snapshot.turnsSoFar < TRANSPORT_ADVICE_MIN_TURNS) return null;

    const historyTokens =
      typeof snapshot.historyTokens === "number" && snapshot.historyTokens > 0
        ? snapshot.historyTokens
        : null;
    if (historyTokens === null) return null; // need a real re-communicated volume
    const minPrefix = minCacheablePrefix(action.modelFamily);
    if (historyTokens < minPrefix) return null;

    return {
      ruleId: "CH-014",
      ruleName: "stateful_transport_advisor",
      severity: "info",
      message:
        `Long stateless session (${snapshot.turnsSoFar} turns) is re-communicating ` +
        `~${formatTokens(historyTokens)} tokens of stable history every turn. A stateful/` +
        `WebSocket transport would retain it server-side. (Dollar saving is contingent on the ` +
        `provider's stateful per-turn billing, which is unverified — not estimated here.)`,
      suggestion:
        `If this provider/SDK offers a stateful transport, consider it for long sessions to drop ` +
        `the per-turn re-transmission; confirm the stateful billing rate before relying on a saving.`,
      estimatedWasteUsd: null, // never a saving on an unverified mechanic
      estimatedWasteTokens: historyTokens, // observed re-communicated volume (a fact)
      signal: {
        transport: snapshot.transport,
        turnsSoFar: snapshot.turnsSoFar,
        reCommunicatedTokens: historyTokens,
        minPrefix,
        contingent: true,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Public registry. Stable order; ids are the source of truth.
// ---------------------------------------------------------------------------

export const CACHE_HABIT_RULES: readonly Rule[] = [
  CH_001,
  CH_002,
  CH_003,
  CH_004,
  CH_005,
  CH_006,
  CH_007,
  CH_008,
  CH_009,
  CH_010,
  CH_011,
  CH_012,
  CH_013,
  CH_014,
] as const;

/** Lookup by id. Returns undefined for unknown ids. */
export function getRule(id: string): Rule | undefined {
  return CACHE_HABIT_RULES.find((r) => r.id === id);
}

// Internal helper for tests / linter callers that want per-rule access.
export const _RULES = {
  CH_001,
  CH_002,
  CH_003,
  CH_004,
  CH_005,
  CH_006,
  CH_007,
  CH_008,
  CH_009,
  CH_010,
  CH_011,
  CH_012,
  CH_013,
  CH_014,
};

// Tiny re-export for the formatter helpers that the test suite uses to pin
// deterministic message templates.
export { cacheReadSavingsPerReadUsd };

// Also export the family classifier — host scripts use it when they don't
// already have a typed ModelFamily.
export { modelFamilyOf };
