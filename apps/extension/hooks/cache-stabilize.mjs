#!/usr/bin/env node
/**
 * Cache-stabilize hook.
 *
 * Wire as a UserPromptSubmit hook. Reads the transcript window,
 * detects cache-bust signals (timestamps, MCP tool drift, low hit
 * rate) and injects an advisory `additionalContext` line.
 */

import {
  TranscriptReader,
  groupIntoTurns,
} from "@prune/telemetry";
import {
  computeCacheMetrics,
  diagnoseCacheBust,
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

  const reader = new TranscriptReader(payload.transcript_path);
  if (!reader.exists()) return emitNoop();

  const { messages } = await reader.readAll();
  const turns = groupIntoTurns(messages);
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

  if (diagnoses.length === 0) return emitNoop();

  const lines = [
    `Prune cache advisory: hit rate ${(metrics.hitRate * 100).toFixed(1)}% over ${turns.length} turns.`,
  ];
  for (const d of diagnoses.slice(0, 3)) {
    lines.push(`• ${d.signal}: ${d.evidence}. ${d.suggestion}`);
  }
  return emitAdditionalContext(
    lines.join("\n"),
    payload.hook_event_name ?? "UserPromptSubmit"
  );
});
