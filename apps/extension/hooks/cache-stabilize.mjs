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
  const diagnoses = diagnoseCacheBust({
    systemPrompt: payload.system_prompt,
    turns: inputs,
  });

  if (diagnoses.length === 0) return emitNoop();

  const lines = [
    `Prune cache advisory: hit rate ${(metrics.hitRate * 100).toFixed(1)}% over ${turns.length} turns.`,
  ];
  for (const d of diagnoses.slice(0, 3)) {
    lines.push(`• ${d.signal}: ${d.evidence}. ${d.suggestion}`);
  }
  return emitAdditionalContext(lines.join("\n"));
});
