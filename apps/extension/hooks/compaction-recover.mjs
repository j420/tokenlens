#!/usr/bin/env node
/**
 * Compaction-recover hook.
 *
 * Wire as a PostCompact hook. After the transcript compacts, inspect
 * what tracked entities were lost (architectural decisions, file
 * references, rules) and inject a recovery reminder so the next turn
 * can rehydrate them.
 */

import {
  TranscriptReader,
  groupIntoTurns,
} from "@prune/telemetry";
import {
  MessageBuffer,
  analyzeCompaction,
  createMessageSummary,
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

  const splitAt = Math.floor(turns.length / 2);
  const before = turns.slice(0, splitAt);
  const after = turns.slice(splitAt);

  const buffer = new MessageBuffer();
  for (const t of before) {
    if (t.userMessage) {
      buffer.addMessage(
        createMessageSummary(t.textContent, t.turnNumber, "user")
      );
    }
    for (const a of t.assistantMessages) {
      const text =
        typeof a.content === "string"
          ? a.content
          : a.content
              .map((b) => (b?.text ?? ""))
              .join("\n");
      buffer.addMessage(
        createMessageSummary(text, t.turnNumber, "assistant")
      );
    }
  }

  const postContent = after.map((t) => t.textContent).join("\n");
  const diff = analyzeCompaction(buffer, postContent, splitAt);
  if (diff.lostReferences.length === 0) return emitNoop();

  const top = diff.lostReferences.slice(0, 5);
  const lines = [
    "Prune compaction-recovery: the following may have been forgotten in the summary —",
  ];
  for (const r of top) {
    lines.push(`• ${r.item} (originally turn ${r.original_turn})`);
  }
  lines.push("Re-introduce them in the next request if they're still relevant.");
  return emitAdditionalContext(lines.join("\n"));
});
