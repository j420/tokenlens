/**
 * Streaming reader for Claude Code transcript JSONL files.
 *
 * Designed for multi-MB transcripts: never loads the whole file into memory,
 * and supports tail-watch mode for live sessions. Schema violations on a line
 * are reported (not silently dropped) — callers decide how to handle them.
 */

import { createReadStream, watch, statSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { StringDecoder } from "node:string_decoder";
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
   * function. New messages are emitted via `onMessage`; parse failures
   * are reported via `onError` (not silently dropped).
   *
   * Implementation notes:
   *  - Single-flight: only one drain runs at a time. fs.watch firings that
   *    arrive while a drain is in progress trigger one more drain after it
   *    completes, so growth during a drain is never lost — but two
   *    concurrent reads can't race the shared offset or buffer.
   *  - UTF-8 safety: byte-range slices through a multi-byte character would
   *    otherwise decode to U+FFFD and break JSON.parse. A StringDecoder
   *    buffers incomplete sequences across reads.
   *  - Truncation: if the file shrinks (rotation, manual edit), reset
   *    rather than try to read a negative range.
   */
  watch(
    onMessage: (m: FlatMessage) => void,
    onError?: (err: TranscriptParseError) => void
  ): () => void {
    let lastSize = this.exists() ? statSync(this.path).size : 0;
    let buffer = "";
    let lineNumber = 0;
    const decoder = new StringDecoder("utf8");
    let inFlight: Promise<void> | null = null;
    let pendingRedrain = false;
    let closed = false;

    const drain = async (): Promise<void> => {
      if (closed || !this.exists()) return;
      const current = statSync(this.path).size;
      if (current < lastSize) {
        // File truncated or rotated — reset.
        lastSize = current;
        buffer = decoder.end();
        return;
      }
      if (current === lastSize) return;

      const startAt = lastSize;
      // NOTE: do not advance lastSize until the bytes are consumed; the
      // single-flight guard ensures no other drain reads in parallel.
      const stream = createReadStream(this.path, {
        start: startAt,
        end: current - 1,
      });
      try {
        for await (const chunk of stream) {
          buffer += decoder.write(chunk as Buffer);
        }
      } finally {
        lastSize = current;
      }

      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        lineNumber++;
        if (!line) continue;
        let json: unknown;
        try {
          json = JSON.parse(line);
        } catch (e) {
          onError?.({
            lineNumber,
            raw: line,
            reason: `invalid JSON: ${(e as Error).message}`,
          });
          continue;
        }
        const parsed = TranscriptMessageSchema.safeParse(json);
        if (!parsed.success) {
          onError?.({
            lineNumber,
            raw: line,
            reason: parsed.error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; "),
          });
          continue;
        }
        const flat = flattenMessage(parsed.data);
        if (flat) onMessage(flat);
      }
    };

    const schedule = (): void => {
      if (closed) return;
      if (inFlight) {
        // Coalesce — the file may have grown during the current drain;
        // request exactly one more pass after it finishes.
        pendingRedrain = true;
        return;
      }
      inFlight = drain()
        .catch((err) => {
          onError?.({
            lineNumber,
            raw: "",
            reason: `watch drain failed: ${(err as Error).message}`,
          });
        })
        .finally(() => {
          inFlight = null;
          if (pendingRedrain && !closed) {
            pendingRedrain = false;
            schedule();
          }
        });
    };

    const watcher = watch(this.path, () => schedule());
    watcher.on("error", (err) => {
      onError?.({
        lineNumber,
        raw: "",
        reason: `fs.watch error: ${(err as Error).message}`,
      });
    });

    // Initial drain — surface any messages already present at watch-start.
    schedule();

    return () => {
      closed = true;
      watcher.close();
    };
  }
}
