#!/usr/bin/env node
/**
 * E3 / F9 — Cache-Habits Advisor hook (UserPromptSubmit).
 *
 * Runs the transcript-DERIVABLE subset of the @prune/cache-habits linter
 * before the next turn fires. From a Claude Code UserPromptSubmit payload the
 * only cache-killer the hook can prove is CH-004 (idle gap exceeded the active
 * TTL → the cached prefix expired and this turn rewrites it at the
 * write-multiplier tier). The richer rules (mid-session model switch,
 * tool-list reorder, system-prompt mutation, large paste) need the host's
 * proposed-action diff, which the hook payload does not carry — those run in
 * the editor integration / the cache_habits MCP tool, not here. We run the
 * idle rule and suppress the rest rather than pretend to evaluate inputs we
 * don't have.
 *
 * Gated on f9 being enabled. Shadow/disabled ⇒ pure no-op at the user surface.
 *
 * Config (env vars):
 *   PRUNE_CACHE_TTL        Active cache TTL: "5m" (default), "1h", or "none".
 *   PRUNE_CACHE_HABITS_DISABLED  Set "1" to make this hook a no-op.
 *
 * Never blocks, never throws, never calls a model.
 */

import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { loadCachedSessionView } from "@prune/telemetry";
import { isFeatureEnabled, validateFlags } from "@prune/shared";
import {
  lint,
  modelFamilyOf,
  buildQualityProof as buildCacheHabitsProof,
  CACHE_HABITS_FEATURE_ID,
} from "@prune/cache-habits";

import {
  emitAdditionalContext,
  emitNoop,
  readHookPayload,
  safeRun,
} from "./_runtime.mjs";
import {
  deriveSessionId,
  recordFeatureEventBestEffort,
  stableId,
} from "./_telemetry.mjs";

const FLAG_PATH = join(homedir(), ".prune", "feature-flags.json");

// Every rule EXCEPT CH-004 — the only one derivable from a transcript at
// UserPromptSubmit. Suppressing the rest keeps the hook honest about scope.
const SUPPRESS_NON_IDLE = [
  "CH-001", "CH-002", "CH-003", "CH-005", "CH-006",
  "CH-007", "CH-008", "CH-009", "CH-010", "CH-011", "CH-012",
];

function flagsFromDisk() {
  try {
    return validateFlags(JSON.parse(readFileSync(FLAG_PATH, "utf8")));
  } catch {
    return validateFlags(null);
  }
}

function ttlFromEnv() {
  const v = process.env.PRUNE_CACHE_TTL;
  return v === "1h" || v === "none" ? v : "5m";
}

safeRun(async () => {
  if (process.env.PRUNE_CACHE_HABITS_DISABLED === "1") return emitNoop();
  const payload = await readHookPayload();
  if (!payload.transcript_path) return emitNoop();

  // Measure REAL analysis wall-clock (transcript load → lint). Never fabricated.
  const analysisStart = performance.now();

  const view = await loadCachedSessionView(payload.transcript_path);
  if (view.turns.length < 1) return emitNoop();

  const last = view.turns[view.turns.length - 1];
  // U6 — never fabricate the model. When the transcript doesn't declare one we
  // genuinely don't know it; the unpriced-sentinel "" makes @prune/cache-habits
  // return a NULL cost (honest "unknown cost") instead of pricing the idle-gap
  // waste against a guessed model. CH-001 (model switch) is already suppressed.
  const currentModel =
    typeof last.model === "string" && last.model.length > 0 ? last.model : "";
  const ttl = ttlFromEnv();

  let cacheCreate = 0;
  let cacheRead = 0;
  for (const t of view.turns) {
    cacheCreate += t.usage?.cacheCreate ?? 0;
    cacheRead += t.usage?.cacheRead ?? 0;
  }

  const snapshot = {
    currentModel,
    currentTtl: ttl,
    lastTurnAt: last.endedAt ?? last.startedAt ?? null,
    turnsSoFar: view.turns.length,
    cacheReadTokensSoFar: cacheRead,
    cacheCreationTokensSoFar: cacheCreate,
    systemPromptTokens: null,
    toolListOrderHash: null,
    mcpServers: [],
  };

  const action = {
    modelFamily: modelFamilyOf(currentModel),
    model: currentModel,
    ttl,
    prompt: { text: typeof payload.prompt === "string" ? payload.prompt : "", pastedBlocks: [] },
    changes: {
      systemPromptTokens: null,
      toolListOrderHash: null,
      reasoningEffort: null,
      temperature: null,
      mcpServersAdded: [],
      mcpServersRemoved: [],
    },
    now: new Date().toISOString(),
  };

  const report = lint(action, snapshot, { suppress: SUPPRESS_NON_IDLE });
  const idle = report.findings.find((f) => f.ruleId === "CH-004");
  if (!idle) return emitNoop();

  // Elapsed analysis time (ms) — the measured cost of this advisory's work.
  const latencyMs = performance.now() - analysisStart;

  // Best-effort shadow telemetry under f9 (records regardless of flag; only
  // surfacing is gated). Keyed by session + last-turn timestamp so re-firing
  // on the same idle gap upserts rather than duplicates.
  await recordFeatureEventBestEffort({
    featureId: CACHE_HABITS_FEATURE_ID,
    qualityProof: buildCacheHabitsProof(report, action, snapshot),
    sessionId: deriveSessionId(payload),
    eventId: `f9-idle-${stableId(payload.transcript_path ?? "", snapshot.lastTurnAt ?? "")}`,
    model: currentModel,
    tokensCached: cacheCreate,
    estimatedCostUsd: idle.estimatedWasteUsd ?? 0,
    latencyMs,
  });

  const flags = flagsFromDisk();
  if (!isFeatureEnabled(flags, "f9")) return emitNoop();

  return emitAdditionalContext(
    `Prune cache-habits: ${idle.message} ${idle.suggestion}`,
    payload.hook_event_name ?? "UserPromptSubmit"
  );
});
