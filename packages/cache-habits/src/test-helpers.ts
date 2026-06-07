/**
 * Test-only builders. Pure data-shape constructors with sensible defaults so
 * each test can mutate only the field it cares about. NOT a fixture in the
 * Phase 7 hard-rule #9 sense — these construct minimal typed inputs to
 * exercise pure logic, the same way `sentinel.test.ts` constructs minimal
 * payload strings to exercise pattern detection. Session-transcript fixtures
 * (the ones rule #9 governs) live in `test/fixtures/` and are real captures.
 */

import type {
  CacheTtl,
  ModelFamily,
  ProposedAction,
  SessionSnapshot,
  TransportTier,
} from "./types.js";

export interface ActionOverrides {
  model?: string;
  modelFamily?: ModelFamily;
  ttl?: CacheTtl;
  now?: string;
  promptText?: string;
  pastedBlocks?: ProposedAction["prompt"]["pastedBlocks"];
  changeSystemPromptTokens?: number | null;
  changeToolListOrderHash?: string | null;
  changeReasoningEffort?: ProposedAction["changes"]["reasoningEffort"];
  changeTemperature?: number | null;
  mcpServersAdded?: readonly string[];
  mcpServersRemoved?: readonly string[];
  changeTransport?: TransportTier | null;
}

export interface SnapshotOverrides {
  currentModel?: string;
  currentTtl?: CacheTtl;
  lastTurnAt?: string | null;
  turnsSoFar?: number;
  cacheReadTokensSoFar?: number;
  cacheCreationTokensSoFar?: number;
  systemPromptTokens?: number | null;
  toolListOrderHash?: string | null;
  reasoningEffort?: SessionSnapshot["reasoningEffort"];
  temperature?: number;
  mcpServers?: readonly string[];
  transport?: TransportTier;
  historyTokens?: number | null;
}

export function buildAction(o: ActionOverrides = {}): ProposedAction {
  return {
    modelFamily: o.modelFamily ?? "sonnet",
    model: o.model ?? "claude-sonnet-4-5-20250929",
    ttl: o.ttl ?? "5m",
    prompt: {
      text: o.promptText ?? "How do I fix this bug?",
      pastedBlocks: o.pastedBlocks ?? [],
    },
    changes: {
      systemPromptTokens: o.changeSystemPromptTokens ?? null,
      toolListOrderHash: o.changeToolListOrderHash ?? null,
      reasoningEffort: o.changeReasoningEffort ?? null,
      temperature: o.changeTemperature ?? null,
      mcpServersAdded: o.mcpServersAdded ?? [],
      mcpServersRemoved: o.mcpServersRemoved ?? [],
      transport: o.changeTransport ?? null,
    },
    now: o.now ?? "2026-06-03T12:00:00.000Z",
  };
}

// Helper: explicit-null-aware default. `??` collapses null to default;
// callers that explicitly pass null (to test "unknown" / "missing" handling)
// expect that null to survive. We default ONLY when the key was omitted.
const def = <T>(v: T | undefined, fallback: T): T => (v === undefined ? fallback : v);

export function buildSnapshot(o: SnapshotOverrides = {}): SessionSnapshot {
  return {
    currentModel: def(o.currentModel, "claude-sonnet-4-5-20250929"),
    currentTtl: def(o.currentTtl, "5m"),
    lastTurnAt: def(o.lastTurnAt, "2026-06-03T11:58:00.000Z"),
    turnsSoFar: def(o.turnsSoFar, 3),
    cacheReadTokensSoFar: def(o.cacheReadTokensSoFar, 20_000),
    cacheCreationTokensSoFar: def(o.cacheCreationTokensSoFar, 10_000),
    systemPromptTokens: def(o.systemPromptTokens, 2048),
    toolListOrderHash: def(o.toolListOrderHash, "hash-A"),
    reasoningEffort: o.reasoningEffort,
    temperature: o.temperature,
    mcpServers: def(o.mcpServers, ["postgres", "linear"]),
    transport: o.transport,
    historyTokens: def(o.historyTokens, null),
  };
}
