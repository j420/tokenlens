#!/usr/bin/env node
/**
 * Cache-stabilize hook.
 *
 * Wire as a UserPromptSubmit hook. Reads the transcript window,
 * detects cache-bust signals (timestamps, MCP tool drift, low hit
 * rate) and injects an advisory `additionalContext` line.
 */

import { loadCachedSessionView } from "@prune/telemetry";
import {
  computeCacheMetrics,
  diagnoseCacheBust,
  analyzeCacheCoPilot,
} from "@prune/intelligence";
import {
  emitAdditionalContext,
  emitNoop,
  readHookPayload,
  safeRun,
} from "./_runtime.mjs";

safeRun(async () => {
  const payload = await readHookPayload();
  if (!payload.transcript_path) return emitNoop();

  const { turns } = await loadCachedSessionView(payload.transcript_path);
  if (turns.length < 2) return emitNoop();

  const inputs = turns.map((t) => ({ model: t.model, usage: t.usage }));
  const metrics = computeCacheMetrics(inputs, "5m");
  // Build a tools-by-turn projection so MCP tool drift can be detected.
  // (UserPromptSubmit payloads don't carry the session's system prompt, so
  // timestamp_in_system can only fire when we eventually wire SessionStart.)
  const toolListsByTurn = turns
    .map((t) => t.toolUses.map((u) => u.name))
    .filter((list) => list.length > 0);
  const diagnoses = diagnoseCacheBust({
    turns: inputs,
    toolListsByTurn: toolListsByTurn.length >= 2 ? toolListsByTurn : undefined,
  });

  // Co-Pilot detectors: silent-failure runs and 5m vs 1h TTL penalty.
  // Both surface dollar-quantified findings that pure hit-rate analysis misses.
  const turnTimestamps = turns.map((t) => t.endedAt ?? t.startedAt ?? "");
  const copilot = analyzeCacheCoPilot({
    turns: inputs,
    turnTimestamps: turnTimestamps.every((s) => s !== "")
      ? turnTimestamps
      : undefined,
  });

  if (
    diagnoses.length === 0 &&
    copilot.silentFailures.length === 0 &&
    copilot.ttlPenalties.length === 0
  ) {
    return emitNoop();
  }

  const lines = [
    `Prune cache advisory: hit rate ${(metrics.hitRate * 100).toFixed(1)}% over ${turns.length} turns.`,
  ];
  for (const d of diagnoses.slice(0, 3)) {
    lines.push(`• ${d.signal}: ${d.evidence}. ${d.suggestion}`);
  }
  for (const s of copilot.silentFailures.slice(0, 2)) {
    lines.push(
      `• SILENT_FAILURE: ${s.consecutiveTurns} turns with ${s.uncachedInputTokens.toLocaleString()} ` +
        `uncached input tokens, est. ~$${s.estimatedExtraCostUsd.toFixed(4)} ` +
        `unnecessarily paid. ${s.suggestion}`
    );
  }
  for (const t of copilot.ttlPenalties.slice(0, 2)) {
    lines.push(
      `• TTL_PENALTY: ${t.cacheCreateTokens.toLocaleString()} cache_creation tokens ` +
        `rewritten across a ${t.gapMinutes.toFixed(1)}-minute gap, est. ` +
        `~$${t.estimatedExtraCostUsd.toFixed(4)} lost. ${t.suggestion}`
    );
  }
  if (copilot.totalLostUsd > 0) {
    lines.push(
      `→ Co-Pilot total recoverable: ~$${copilot.totalLostUsd.toFixed(4)} this session.`
    );
  }

  return emitAdditionalContext(
    lines.join("\n"),
    payload.hook_event_name ?? "UserPromptSubmit"
  );
});
