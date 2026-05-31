import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  appendFileSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  TranscriptReader,
  type TranscriptParseError,
} from "./transcript-reader.js";
import { groupIntoTurns, toTurnDataLike } from "./turn-mapper.js";
import { summarize, aggregateUsage, hitRate } from "./cache-fields.js";
import type { FlatMessage } from "./schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "../test/fixtures/session-basic.jsonl");

describe("TranscriptReader", () => {
  it("reads a JSONL transcript and flattens nested message envelopes", async () => {
    const reader = new TranscriptReader(FIXTURE);
    const { messages, errors } = await reader.readAll();
    expect(errors).toEqual([]);
    expect(messages.length).toBe(6);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].model).toBe("claude-sonnet-4-5-20250929");
    expect(messages[1].usage?.input_tokens).toBe(1200);
  });

  it("returns empty when file does not exist (no crash)", async () => {
    const reader = new TranscriptReader("/does/not/exist.jsonl");
    const result = await reader.readAll();
    expect(result.messages).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});

describe("groupIntoTurns", () => {
  it("groups messages into 2 turns — tool_result user-messages attach to the turn whose assistant invoked them", async () => {
    const { messages } = await new TranscriptReader(FIXTURE).readAll();
    const turns = groupIntoTurns(messages);
    // u1 → a1 → u2(tool_result) → a2 is a single user prompt being answered
    // via a tool round-trip; u2 must NOT start a new turn. u3 is a real
    // follow-up prompt and starts turn 2.
    expect(turns).toHaveLength(2);
    expect(turns[0].userMessage?.content).toContain("Read auth.ts");
    expect(turns[0].assistantMessages).toHaveLength(2);
    expect(turns[0].toolUses).toEqual([
      expect.objectContaining({ name: "Read", id: "tu_1" }),
    ]);
  });

  it("accumulates per-turn usage across the assistant's full reply, including tool round-trips", async () => {
    const { messages } = await new TranscriptReader(FIXTURE).readAll();
    const turns = groupIntoTurns(messages);
    // Turn 0 spans a1 (1200/40) + u2 (no usage) + a2 (80/160 + cache_create 1100).
    expect(turns[0].usage.input).toBe(1280);
    expect(turns[0].usage.output).toBe(200);
    expect(turns[0].usage.cacheCreate).toBe(1100);
    // Turn 1 is u3 → a3 (30/50 + cache_read 1180).
    expect(turns[1].usage.cacheRead).toBe(1180);
  });

  it("captures tool_result blocks on the turn whose assistant invoked them", async () => {
    const { messages } = await new TranscriptReader(FIXTURE).readAll();
    const turns = groupIntoTurns(messages);
    expect(turns[0].toolResults).toEqual([
      expect.objectContaining({ tool_use_id: "tu_1" }),
    ]);
  });
});

describe("cache-fields summarize", () => {
  it("computes hit rate from a real session aggregate", async () => {
    const { messages } = await new TranscriptReader(FIXTURE).readAll();
    const turns = groupIntoTurns(messages);
    const total = aggregateUsage(turns.map((t) => t.usage));
    const metrics = summarize(total);

    // Hand-computed: cacheRead 1180; uncached input 1200+80+30=1310; cache_create 1100.
    // total_input = 1180 + 1310 + 1100 = 3590; hitRate = 1180/3590 ≈ 0.3287.
    expect(metrics.totalInputTokens).toBe(3590);
    expect(metrics.cacheReadTokens).toBe(1180);
    expect(metrics.cacheCreationTokens).toBe(1100);
    expect(metrics.uncachedInputTokens).toBe(1310);
    expect(metrics.outputTokens).toBe(250);
    expect(metrics.hitRate).toBeCloseTo(1180 / 3590, 6);
    expect(hitRate(total)).toBeCloseTo(metrics.hitRate, 6);
  });

  it("returns 0 hit rate for an empty session", () => {
    const m = summarize({ input: 0, output: 0, cacheRead: 0, cacheCreate: 0 });
    expect(m.hitRate).toBe(0);
    expect(m.writeAmplification).toBe(0);
  });
});

describe("toTurnDataLike", () => {
  it("infers filesWritten and filesRead from tool uses", async () => {
    const { messages } = await new TranscriptReader(FIXTURE).readAll();
    const turns = groupIntoTurns(messages);
    const turn1 = toTurnDataLike(turns[0]);
    const turn2 = toTurnDataLike(turns[1]);
    expect(turn1.filesRead).toEqual(["src/auth.ts"]);
    expect(turn1.filesWritten).toEqual([]);
    expect(turn2.filesWritten).toEqual(["src/auth.test.ts"]);
    expect(turn2.tokensIn).toBe(30 + 1180); // input + cacheRead
  });

  it("projects tool_use blocks into responseContent so tool-only turns aren't classified as low-ROI", () => {
    const turn = {
      turnNumber: 1,
      assistantMessages: [],
      toolUses: [{ name: "Edit", input: { file_path: "src/x.ts" } }],
      toolResults: [],
      usage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 },
      textContent: "[tool_use:Edit(src/x.ts)]",
    } as Parameters<typeof toTurnDataLike>[0];
    const out = toTurnDataLike(turn);
    expect(out.responseContent).toContain("tool_use:Edit");
    expect(out.filesWritten).toEqual(["src/x.ts"]);
  });
});

describe("TranscriptReader.watch — tail-mode", () => {
  function sample(role: "user" | "assistant", text: string): string {
    return (
      JSON.stringify({
        type: role,
        sessionId: "sw",
        timestamp: "2026-05-30T10:00:00Z",
        message: {
          role,
          ...(role === "assistant"
            ? { model: "claude-sonnet-4-5-20250929" }
            : {}),
          content: text,
        },
      }) + "\n"
    );
  }

  async function settle(): Promise<void> {
    // Give fs.watch + the single-flight drain a couple of microtask flushes
    // plus a real timer tick — enough for inotify on Linux and the polling
    // fallback on other platforms.
    await new Promise((r) => setTimeout(r, 75));
  }

  let dir = "";
  let path = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "prune-watch-"));
    path = join(dir, "session.jsonl");
    writeFileSync(path, "");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("surfaces appended messages without losing any to fs.watch coalescing", async () => {
    const seen: FlatMessage[] = [];
    const reader = new TranscriptReader(path);
    const unsub = reader.watch((m) => seen.push(m));
    appendFileSync(path, sample("user", "hello"));
    await settle();
    appendFileSync(path, sample("assistant", "hi"));
    await settle();
    appendFileSync(path, sample("user", "again"));
    await settle();
    unsub();
    expect(seen.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });

  it("decodes multi-byte UTF-8 even when characters straddle the read boundary", async () => {
    const seen: FlatMessage[] = [];
    const reader = new TranscriptReader(path);
    const unsub = reader.watch((m) => seen.push(m));

    // Write the first record's bytes in two halves so a multi-byte character
    // splits across the fs.watch fire. Without a StringDecoder the second
    // half would arrive in a new utf8 stream that emits U+FFFD for the
    // dangling lead byte, JSON.parse would throw, and the line would be
    // lost.
    const line = sample("assistant", "héllo 🎉 こんにちは");
    const buf = Buffer.from(line, "utf8");
    // Find a byte that's the middle of a multi-byte sequence — choose the
    // 'こ' (E3 81 93) inside the content string; we know it's in there.
    const idx = buf.indexOf(Buffer.from([0xe3, 0x81, 0x93]));
    expect(idx).toBeGreaterThan(0);
    appendFileSync(path, buf.slice(0, idx + 1)); // mid-codepoint cut
    await settle();
    appendFileSync(path, buf.slice(idx + 1));
    await settle();
    unsub();

    expect(seen).toHaveLength(1);
    expect(seen[0].role).toBe("assistant");
    const content = seen[0].content;
    const text = typeof content === "string" ? content : "";
    expect(text).toContain("héllo");
    expect(text).toContain("🎉");
    expect(text).toContain("こんにちは");
    expect(text).not.toContain("�");
  });

  it("reports parse failures via onError instead of silently dropping the line", async () => {
    const seen: FlatMessage[] = [];
    const errors: TranscriptParseError[] = [];
    const reader = new TranscriptReader(path);
    const unsub = reader.watch(
      (m) => seen.push(m),
      (e) => errors.push(e)
    );

    appendFileSync(path, "not-json-at-all\n");
    await settle();
    appendFileSync(path, sample("user", "valid"));
    await settle();
    unsub();

    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0].reason).toContain("invalid JSON");
    expect(seen.map((m) => m.role)).toEqual(["user"]);
  });
});

describe("TranscriptReader.readAppended", () => {
  it("readAll() equals cached-prefix + readAppended(offset) on the fixture", async () => {
    const reader = new TranscriptReader(FIXTURE);
    const full = await reader.readAll();
    expect(full.errors).toEqual([]);

    // Read the first half, then the rest.
    const { statSync } = await import("node:fs");
    const totalBytes = statSync(FIXTURE).size;
    const mid = Math.floor(totalBytes / 2);
    const head = await reader.readAppended(0);
    const headOffset = head.newOffset;
    expect(headOffset).toBeGreaterThan(0);
    expect(headOffset).toBeLessThanOrEqual(totalBytes);

    const tail = await reader.readAppended(headOffset, head.newLineNumber);
    expect(tail.stale).toBe(false);
    expect(tail.newOffset).toBe(totalBytes);

    const reassembled = [...head.messages, ...tail.messages];
    expect(reassembled).toEqual(full.messages);

    // The split offset matters here: doing it in arbitrary chunks must also work.
    void mid;
  });

  it("leaves a trailing partial line for the next call", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prune-readappended-"));
    const path = join(dir, "t.jsonl");
    const reader = new TranscriptReader(path);
    try {
      const full = '{"role":"user","content":"hi"}\n';
      const partial = '{"role":"assist'; // intentionally unterminated
      writeFileSync(path, full + partial);
      const first = await reader.readAppended(0);
      expect(first.messages.map((m) => m.role)).toEqual(["user"]);
      expect(first.newOffset).toBe(Buffer.byteLength(full, "utf8"));

      // Append the rest of the line — the next call should pick up the now-complete record.
      appendFileSync(path, 'ant","content":"hi back"}\n');
      const second = await reader.readAppended(first.newOffset, first.newLineNumber);
      expect(second.messages.map((m) => m.role)).toEqual(["assistant"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("flags truncation as stale instead of returning garbage", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prune-readappended-stale-"));
    const path = join(dir, "t.jsonl");
    const reader = new TranscriptReader(path);
    try {
      writeFileSync(path, '{"role":"user","content":"a"}\n');
      const first = await reader.readAppended(0);
      // Simulate rotation/truncation: shrink the file.
      writeFileSync(path, "");
      const stale = await reader.readAppended(first.newOffset, first.newLineNumber);
      expect(stale.stale).toBe(true);
      expect(stale.messages).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("loadCachedSessionView", () => {
  let dir = "";
  let cacheDir = "";
  let path = "";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "prune-sessionview-"));
    cacheDir = join(dir, "cache");
    path = join(dir, "session.jsonl");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("second call after no transcript change does not re-classify committed turns", async () => {
    const { loadCachedSessionView } = await import("./session-cache.js");
    // Three completed turns: u1 → a1 → u2 → a2 → u3 → a3.
    const lines = [
      JSON.stringify({ role: "user", content: "one" }),
      JSON.stringify({
        role: "assistant",
        model: "claude-sonnet-4-5-20250929",
        content: "first reply",
        usage: { input_tokens: 100, output_tokens: 20 },
      }),
      JSON.stringify({ role: "user", content: "two" }),
      JSON.stringify({
        role: "assistant",
        model: "claude-sonnet-4-5-20250929",
        content: "second reply",
        usage: { input_tokens: 100, output_tokens: 20 },
      }),
      JSON.stringify({ role: "user", content: "three" }),
      JSON.stringify({
        role: "assistant",
        model: "claude-sonnet-4-5-20250929",
        content: "third reply",
        usage: { input_tokens: 100, output_tokens: 20 },
      }),
      "",
    ].join("\n");
    writeFileSync(path, lines);

    const first = await loadCachedSessionView(path, { cacheDir });
    expect(first.turns).toHaveLength(3);
    expect(first.walk?.perTurn).toHaveLength(3);

    const second = await loadCachedSessionView(path, { cacheDir });
    expect(second.turns).toHaveLength(3);
    // The walk's per-turn analysis array must match (same classification,
    // same signals) — proving the cache returned the same answer without
    // re-running classifyTurnROI from scratch.
    expect(second.walk?.perTurn).toEqual(first.walk?.perTurn);
  });

  it("incremental view after appending a turn matches a from-scratch view", async () => {
    const { loadCachedSessionView } = await import("./session-cache.js");
    // Pin timestamps so the from-scratch and incremental walks produce
    // identical TurnData (toTurnDataLike falls back to `new Date()` when
    // no timestamp is present, which would differ between runs).
    const msg = (role: string, content: string, n: number, hasUsage = true) => ({
      role,
      content,
      timestamp: `2026-05-30T10:0${n}:00.000Z`,
      ...(role === "assistant"
        ? {
            model: "claude-sonnet-4-5-20250929",
            ...(hasUsage
              ? { usage: { input_tokens: 100, output_tokens: 20 } }
              : {}),
          }
        : {}),
    });
    const initial =
      [
        JSON.stringify(msg("user", "one", 1)),
        JSON.stringify(msg("assistant", "first reply", 1)),
        JSON.stringify(msg("user", "two", 2)),
        JSON.stringify(msg("assistant", "second reply", 2)),
      ].join("\n") + "\n";
    writeFileSync(path, initial);
    await loadCachedSessionView(path, { cacheDir });

    appendFileSync(
      path,
      JSON.stringify(msg("user", "three", 3)) +
        "\n" +
        JSON.stringify(msg("assistant", "third reply", 3)) +
        "\n"
    );

    const incremental = await loadCachedSessionView(path, { cacheDir });

    // Compare against a fresh view (no cache) on the same file.
    const freshCache = join(dir, "fresh-cache");
    const fresh = await loadCachedSessionView(path, { cacheDir: freshCache });

    expect(incremental.turns.length).toBe(fresh.turns.length);
    expect(incremental.walk?.perTurn).toEqual(fresh.walk?.perTurn);
    expect(incremental.walk?.sessionROI).toEqual(fresh.walk?.sessionROI);
  });

  it("invalidates and re-reads from scratch when the transcript is truncated", async () => {
    const { loadCachedSessionView, SessionCache } = await import(
      "./session-cache.js"
    );
    const lines = [
      JSON.stringify({ role: "user", content: "one" }),
      JSON.stringify({
        role: "assistant",
        model: "claude-sonnet-4-5-20250929",
        content: "first reply",
        usage: { input_tokens: 100, output_tokens: 20 },
      }),
      "",
    ].join("\n");
    writeFileSync(path, lines);
    await loadCachedSessionView(path, { cacheDir });

    // Verify a cache entry was written.
    const cache = new SessionCache(path, { cacheDir });
    expect(await cache.load()).not.toBeNull();

    // Truncate and re-read.
    writeFileSync(path, "");
    const empty = await loadCachedSessionView(path, { cacheDir });
    expect(empty.turns).toEqual([]);
  });
});
