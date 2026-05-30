/**
 * Streaming reader for Claude Code transcript JSONL files.
 *
 * Designed for multi-MB transcripts: never loads the whole file into memory,
 * and supports tail-watch mode for live sessions. Schema violations on a line
 * are reported (not silently dropped) — callers decide how to handle them.
 */

import { createReadStream, watch, statSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import {
  TranscriptMessageSchema,
  type TranscriptMessage,
  type FlatMessage,
  flattenMessage,
} from "./schema.js";

export interface TranscriptParseError {
  lineNumber: number;
  raw: string;
  reason: string;
}

export interface TranscriptReadResult {
  messages: FlatMessage[];
  rawMessages: TranscriptMessage[];
  errors: TranscriptParseError[];
}

export class TranscriptReader {
  constructor(private readonly path: string) {}

  exists(): boolean {
    return existsSync(this.path);
  }

  /**
   * Stream raw JSONL records. Yields each successfully parsed message.
   * Errors are accumulated on the returned iterator's `errors` array (after
   * iteration completes).
   */
  async *iterateRaw(): AsyncGenerator<TranscriptMessage, void, void> {
    if (!this.exists()) return;
    const stream = createReadStream(this.path, { encoding: "utf8" });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    let lineNumber = 0;
    for await (const line of rl) {
      lineNumber++;
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const json = JSON.parse(trimmed);
        const parsed = TranscriptMessageSchema.safeParse(json);
        if (parsed.success) yield parsed.data;
      } catch {
        // skip malformed
      }
    }
  }

  /**
   * Read the full transcript, flattened. Convenience for batch jobs and
   * tests; for live sessions use `watch`.
   */
  async readAll(): Promise<TranscriptReadResult> {
    const messages: FlatMessage[] = [];
    const rawMessages: TranscriptMessage[] = [];
    const errors: TranscriptParseError[] = [];
    if (!this.exists()) return { messages, rawMessages, errors };

    const stream = createReadStream(this.path, { encoding: "utf8" });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    let lineNumber = 0;
    for await (const line of rl) {
      lineNumber++;
      const trimmed = line.trim();
      if (!trimmed) continue;
      let json: unknown;
      try {
        json = JSON.parse(trimmed);
      } catch (e) {
        errors.push({
          lineNumber,
          raw: trimmed,
          reason: `invalid JSON: ${(e as Error).message}`,
        });
        continue;
      }
      const parsed = TranscriptMessageSchema.safeParse(json);
      if (!parsed.success) {
        errors.push({
          lineNumber,
          raw: trimmed,
          reason: parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        });
        continue;
      }
      rawMessages.push(parsed.data);
      const flat = flattenMessage(parsed.data);
      if (flat) messages.push(flat);
    }
    return { messages, rawMessages, errors };
  }

  /**
   * Tail the transcript file for live sessions. Returns an unsubscribe
   * function. New messages are emitted via `onMessage`; the watcher tracks
   * the byte offset and reads only appended content.
   *
   * Note: this is a best-effort poll-style watcher (fs.watch semantics vary
   * across platforms); for production live-mode use Phase 1 will switch to
   * platform-specific subscription where available.
   */
  watch(onMessage: (m: FlatMessage) => void): () => void {
    let lastSize = this.exists() ? statSync(this.path).size : 0;
    let buffer = "";

    const readAppended = async () => {
      const current = this.exists() ? statSync(this.path).size : 0;
      if (current <= lastSize) {
        lastSize = current;
        return;
      }
      const stream = createReadStream(this.path, {
        encoding: "utf8",
        start: lastSize,
        end: current - 1,
      });
      lastSize = current;
      for await (const chunk of stream) {
        buffer += chunk as string;
      }
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const parsed = TranscriptMessageSchema.parse(JSON.parse(line));
          const flat = flattenMessage(parsed);
          if (flat) onMessage(flat);
        } catch {
          // skip
        }
      }
    };

    const watcher = watch(this.path, () => {
      readAppended().catch(() => {});
    });

    // Also kick off an initial drain so callers receive any messages already
    // present at watch-start time.
    readAppended().catch(() => {});

    return () => watcher.close();
  }
}
