import { describe, expect, it } from "vitest";
import {
  cacheHitTrend,
  largeToolResultCause,
  scopeDriftSlope,
} from "./drift.js";
import { makeTurn } from "./test-helpers.js";

describe("cacheHitTrend", () => {
  it("returns 0 with fewer than 2 informative turns", () => {
    expect(cacheHitTrend([], 5)).toBe(0);
    expect(
      cacheHitTrend([makeTurn({ turnNumber: 1, inputTokens: 100 })], 5)
    ).toBe(0);
  });

  it("returns negative slope when hit rate is falling", () => {
    // hit rate: 1.0 → 0.8 → 0.5 → 0.2 → 0.0 across 5 turns
    const turns = [
      makeTurn({ turnNumber: 1, cacheReadTokens: 1000, inputTokens: 0 }),         // 1.0
      makeTurn({ turnNumber: 2, cacheReadTokens: 800, inputTokens: 200 }),        // 0.8
      makeTurn({ turnNumber: 3, cacheReadTokens: 500, inputTokens: 500 }),        // 0.5
      makeTurn({ turnNumber: 4, cacheReadTokens: 200, inputTokens: 800 }),        // 0.2
      makeTurn({ turnNumber: 5, cacheReadTokens: 0, inputTokens: 1000 }),         // 0.0
    ];
    expect(cacheHitTrend(turns, 5)).toBeLessThan(-0.2);
  });

  it("returns positive slope when hit rate is rising", () => {
    const turns = [
      makeTurn({ turnNumber: 1, cacheReadTokens: 0, inputTokens: 1000 }),
      makeTurn({ turnNumber: 2, cacheReadTokens: 500, inputTokens: 500 }),
      makeTurn({ turnNumber: 3, cacheReadTokens: 1000, inputTokens: 0 }),
    ];
    expect(cacheHitTrend(turns, 5)).toBeGreaterThan(0.4);
  });

  it("skips zero-attended turns (user-only messages)", () => {
    const turns = [
      makeTurn({ turnNumber: 1 }), // 0 tokens — skipped
      makeTurn({ turnNumber: 2, cacheReadTokens: 800, inputTokens: 200 }),
      makeTurn({ turnNumber: 3, cacheReadTokens: 200, inputTokens: 800 }),
    ];
    const slope = cacheHitTrend(turns, 5);
    // Should be negative (0.8 → 0.2) — skipped turn doesn't drag to 0
    expect(slope).toBeLessThan(-0.4);
  });

  it("uses only the last `window` turns", () => {
    const turns = [
      makeTurn({ turnNumber: 1, cacheReadTokens: 0, inputTokens: 1000 }),   // 0.0 — outside window
      makeTurn({ turnNumber: 2, cacheReadTokens: 0, inputTokens: 1000 }),   // 0.0 — outside window
      makeTurn({ turnNumber: 3, cacheReadTokens: 1000, inputTokens: 0 }),   // 1.0
      makeTurn({ turnNumber: 4, cacheReadTokens: 500, inputTokens: 500 }),  // 0.5
      makeTurn({ turnNumber: 5, cacheReadTokens: 0, inputTokens: 1000 }),   // 0.0
    ];
    // With window=3, slope is computed over last 3 (1.0 → 0.5 → 0.0)
    expect(cacheHitTrend(turns, 3)).toBeLessThan(-0.4);
  });
});

describe("scopeDriftSlope", () => {
  it("returns positive slope when distinct paths per turn increases", () => {
    const turns = [
      makeTurn({
        turnNumber: 1,
        toolUses: [{ name: "Read", input: { file_path: "a.ts" }, id: "t1" }],
      }),
      makeTurn({
        turnNumber: 2,
        toolUses: [
          { name: "Read", input: { file_path: "a.ts" }, id: "t2" },
          { name: "Read", input: { file_path: "b.ts" }, id: "t3" },
        ],
      }),
      makeTurn({
        turnNumber: 3,
        toolUses: [
          { name: "Read", input: { file_path: "a.ts" }, id: "t4" },
          { name: "Read", input: { file_path: "b.ts" }, id: "t5" },
          { name: "Read", input: { file_path: "c.ts" }, id: "t6" },
        ],
      }),
    ];
    expect(scopeDriftSlope(turns, 5)).toBeCloseTo(1.0, 6);
  });

  it("returns 0 for stable scope", () => {
    const turns = [
      makeTurn({
        turnNumber: 1,
        toolUses: [{ name: "Read", input: { file_path: "a.ts" }, id: "t1" }],
      }),
      makeTurn({
        turnNumber: 2,
        toolUses: [{ name: "Read", input: { file_path: "a.ts" }, id: "t2" }],
      }),
      makeTurn({
        turnNumber: 3,
        toolUses: [{ name: "Read", input: { file_path: "a.ts" }, id: "t3" }],
      }),
    ];
    expect(scopeDriftSlope(turns, 5)).toBe(0);
  });

  it("handles tools without paths (counts 0 distinct)", () => {
    const turns = [
      makeTurn({
        turnNumber: 1,
        toolUses: [{ name: "Bash", input: { command: "ls" }, id: "t1" }],
      }),
      makeTurn({
        turnNumber: 2,
        toolUses: [{ name: "Bash", input: { command: "pwd" }, id: "t2" }],
      }),
    ];
    expect(scopeDriftSlope(turns, 5)).toBe(0);
  });

  it("reads input.path as well as input.file_path", () => {
    const turns = [
      makeTurn({
        turnNumber: 1,
        toolUses: [{ name: "Glob", input: { path: "src/" }, id: "t1" }],
      }),
      makeTurn({
        turnNumber: 2,
        toolUses: [
          { name: "Glob", input: { path: "src/" }, id: "t2" },
          { name: "Glob", input: { path: "lib/" }, id: "t3" },
        ],
      }),
    ];
    expect(scopeDriftSlope(turns, 5)).toBeCloseTo(1.0, 6);
  });

  it("never emits NaN or Infinity on degenerate input", () => {
    const turns = [
      makeTurn({ turnNumber: 1, toolUses: [] }),
      makeTurn({ turnNumber: 2, toolUses: [] }),
    ];
    const s = scopeDriftSlope(turns, 5);
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBe(0);
  });
});

describe("largeToolResultCause", () => {
  it("returns the tool when its result exceeds the fraction threshold", () => {
    const bigContent = "x".repeat(40_000); // ~10K tokens (40000 / 4)
    const turn = makeTurn({
      turnNumber: 5,
      toolUses: [{ name: "Read", input: { file_path: "huge.json" }, id: "t1" }],
      toolResults: [{ tool_use_id: "t1", content: bigContent }],
    });
    const cause = largeToolResultCause(turn, 50_000, 0.15);
    expect(cause).not.toBeNull();
    expect(cause!.toolName).toBe("Read");
    expect(cause!.toolResultTokenEstimate).toBe(10_000);
  });

  it("returns null when no single result is dominant", () => {
    const turn = makeTurn({
      turnNumber: 5,
      toolUses: [{ name: "Read", input: { file_path: "small.ts" }, id: "t1" }],
      toolResults: [{ tool_use_id: "t1", content: "short" }],
    });
    expect(largeToolResultCause(turn, 50_000, 0.15)).toBeNull();
  });

  it("picks the largest when multiple are dominant", () => {
    const big1 = "x".repeat(40_000);
    const big2 = "y".repeat(80_000);
    const turn = makeTurn({
      turnNumber: 5,
      toolUses: [
        { name: "Read", input: { file_path: "a.ts" }, id: "t1" },
        { name: "Bash", input: { command: "cat large.bin" }, id: "t2" },
      ],
      toolResults: [
        { tool_use_id: "t1", content: big1 },
        { tool_use_id: "t2", content: big2 },
      ],
    });
    const cause = largeToolResultCause(turn, 50_000, 0.15);
    expect(cause).not.toBeNull();
    expect(cause!.toolName).toBe("Bash");
    expect(cause!.toolResultTokenEstimate).toBe(20_000);
  });

  it("returns null when window is unknown (0)", () => {
    const bigContent = "x".repeat(40_000);
    const turn = makeTurn({
      turnNumber: 5,
      toolUses: [{ name: "Read", input: { file_path: "huge.json" }, id: "t1" }],
      toolResults: [{ tool_use_id: "t1", content: bigContent }],
    });
    expect(largeToolResultCause(turn, 0, 0.15)).toBeNull();
  });

  it("estimates from array-of-blocks tool_result content", () => {
    const turn = makeTurn({
      turnNumber: 5,
      toolUses: [{ name: "Read", input: { file_path: "a.ts" }, id: "t1" }],
      toolResults: [
        {
          tool_use_id: "t1",
          content: [
            { type: "text", text: "x".repeat(60_000) },
            { type: "text", text: "y".repeat(20_000) },
          ],
        },
      ],
    });
    const cause = largeToolResultCause(turn, 50_000, 0.15);
    expect(cause).not.toBeNull();
    expect(cause!.toolResultTokenEstimate).toBe(20_000);
  });

  it("falls back to 'unknown' tool name when tool_use_id has no match", () => {
    const turn = makeTurn({
      turnNumber: 5,
      toolUses: [],
      toolResults: [{ tool_use_id: "orphan", content: "x".repeat(40_000) }],
    });
    const cause = largeToolResultCause(turn, 50_000, 0.15);
    expect(cause).not.toBeNull();
    expect(cause!.toolName).toBe("unknown");
  });
});
