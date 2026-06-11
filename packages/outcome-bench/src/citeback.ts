/**
 * Citeback contribution proxy (L4-38): which files the agent Read but never
 * referenced in ANY later output. A purely deterministic post-hoc analysis
 * over the transcript — selection-precision evidence for the report (a
 * governed arm should read fewer never-cited files than a naive one).
 *
 * "Cited" is deliberately conservative: the file's basename appearing in any
 * subsequent assistant text or tool input counts. This over-counts citations
 * (never under-counts), so `neverCited` is a LOWER bound on wasted reads.
 */

import { basename } from "node:path";
import type { FlatMessage, ContentBlock } from "@prune/telemetry";

export interface CitebackResult {
  filesRead: string[];
  neverCited: string[];
  /** neverCited.length / filesRead.length; null when nothing was read. */
  wasteRatio: number | null;
}

const READ_TOOLS = new Set(["Read", "read_file", "read", "view_file"]);

function blocksOf(content: string | ContentBlock[]): ContentBlock[] {
  return typeof content === "string"
    ? [{ type: "text", text: content }]
    : content;
}

function textOfBlock(b: ContentBlock): string {
  const rec = b as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof rec.text === "string") parts.push(rec.text);
  if (typeof rec.thinking === "string") parts.push(rec.thinking);
  if (rec.type === "tool_use" && rec.input !== undefined) {
    try {
      parts.push(JSON.stringify(rec.input));
    } catch {
      /* unserializable input — skip */
    }
  }
  return parts.join("\n");
}

function readPathOf(b: ContentBlock): string | null {
  const rec = b as Record<string, unknown>;
  if (rec.type !== "tool_use") return null;
  if (typeof rec.name !== "string" || !READ_TOOLS.has(rec.name)) return null;
  const input = rec.input as Record<string, unknown> | undefined;
  const p = input?.file_path ?? input?.path;
  return typeof p === "string" ? p : null;
}

export function analyzeCiteback(messages: FlatMessage[]): CitebackResult {
  // First pass: position of each Read, and the text content at each position.
  const reads: Array<{ path: string; index: number }> = [];
  const texts: string[] = [];
  messages.forEach((m, i) => {
    const blocks = blocksOf(m.content);
    let text = "";
    for (const b of blocks) {
      const p = readPathOf(b);
      if (p) {
        reads.push({ path: p, index: i });
        continue; // the Read call itself must not count as a citation
      }
      text += textOfBlock(b) + "\n";
    }
    texts.push(text);
  });

  const filesRead = [...new Set(reads.map((r) => r.path))];
  const neverCited: string[] = [];
  for (const file of filesRead) {
    const name = basename(file);
    const firstRead = Math.min(
      ...reads.filter((r) => r.path === file).map((r) => r.index)
    );
    const cited = texts.some(
      (t, i) => i > firstRead && t.includes(name)
    );
    if (!cited) neverCited.push(file);
  }
  return {
    filesRead,
    neverCited,
    wasteRatio:
      filesRead.length === 0 ? null : neverCited.length / filesRead.length,
  };
}
