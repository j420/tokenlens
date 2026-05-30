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
  it("groups messages into 3 turns split at user messages", async () => {
    const { messages } = await new TranscriptReader(FIXTURE).readAll();
    const turns = groupIntoTurns(messages);
    expect(turns).toHaveLength(3);
    expect(turns[0].userMessage?.content).toContain("Read auth.ts");
    expect(turns[0].assistantMessages).toHaveLength(1);
    expect(turns[0].toolUses).toEqual([
      expect.objectContaining({ name: "Read", id: "tu_1" }),
    ]);
  });

  it("accumulates per-turn usage including cache fields", async () => {
    const { messages } = await new TranscriptReader(FIXTURE).readAll();
    const turns = groupIntoTurns(messages);
    // Turn 1: a1 usage 1200/40 + tool result on u2 (no usage) + a2 80/160 + cache_create 1100.
    // But u2 begins the assistant's chained reply — under our grouping
    // (split on user role), u2 (tool_result) starts a new turn since it's
    // role:user. Validate that's what we see.
    expect(turns[0].usage.input).toBe(1200);
    expect(turns[0].usage.output).toBe(40);
    expect(turns[1].usage.cacheCreate).toBe(1100);
    expect(turns[2].usage.cacheRead).toBe(1180);
  });

  it("captures tool_result blocks on the user turn that delivers them", async () => {
    const { messages } = await new TranscriptReader(FIXTURE).readAll();
    const turns = groupIntoTurns(messages);
    expect(turns[1].toolResults).toEqual([
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
    const turn3 = toTurnDataLike(turns[2]);
    expect(turn1.filesRead).toEqual(["src/auth.ts"]);
    expect(turn1.filesWritten).toEqual([]);
    expect(turn3.filesWritten).toEqual(["src/auth.test.ts"]);
    expect(turn3.tokensIn).toBe(30 + 1180); // input + cacheRead
  });
});
