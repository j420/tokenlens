import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { TranscriptReader } from "./transcript-reader.js";
import { groupIntoTurns, toTurnDataLike } from "./turn-mapper.js";
import { summarize, aggregateUsage, hitRate } from "./cache-fields.js";

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
