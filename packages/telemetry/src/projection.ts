/**
 * Projects normalized turns onto the shapes required by intelligence's
 * compaction auditor: a `MessageBuffer` and a flat `beforeContent` string.
 *
 * The two callers that need this (`handleCompactionCheck` in the MCP
 * server and the `compaction-recover.mjs` hook) used to build both by
 * hand from the same 15-line loop. When one copy drifted, the MCP and
 * hook silently disagreed on the same transcript. Centralizing here
 * keeps them honest.
 *
 * Why both outputs from one walk: `MessageBuffer.getTotalTokens` is a
 * heuristic count that disagrees with `countTokens` by tens of percent;
 * routing both sides of a compaction diff through `countTokens(beforeContent)`
 * and `countTokens(postContent)` avoids spurious "compaction detected"
 * verdicts caused purely by the token-counter mismatch.
 */

import { MessageBuffer, createMessageSummary } from "@prune/intelligence";
import type { NormalizedTurn } from "./turn-mapper.js";
import type { ContentBlock } from "./schema.js";

export interface ProjectedBuffer {
  buffer: MessageBuffer;
  beforeContent: string;
}

function assistantText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as ContentBlock[])
    .map((b) => ("text" in b && typeof b.text === "string" ? b.text : ""))
    .join("\n");
}

export function projectTurnsToBuffer(turns: NormalizedTurn[]): ProjectedBuffer {
  const buffer = new MessageBuffer();
  const parts: string[] = [];
  for (const t of turns) {
    if (t.userMessage) {
      buffer.addMessage(createMessageSummary(t.textContent, t.turnNumber, "user"));
      if (t.textContent) parts.push(t.textContent);
    }
    for (const a of t.assistantMessages) {
      const text = assistantText(a.content);
      buffer.addMessage(createMessageSummary(text, t.turnNumber, "assistant"));
      if (text) parts.push(text);
    }
  }
  return { buffer, beforeContent: parts.join("\n") };
}
