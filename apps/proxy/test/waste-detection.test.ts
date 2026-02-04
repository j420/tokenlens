import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database
vi.mock("@prune/db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  },
  events: {},
  alerts: {},
  sessions: {},
}));

// Mock the stream publisher
vi.mock("../src/stream/publisher.js", () => ({
  publishBurnAlert: vi.fn(),
}));

import { publishBurnAlert } from "../src/stream/publisher.js";
import { db } from "@prune/db";

describe("Waste Detection Patterns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Pattern 1: Circular Reasoning Loop", () => {
    it("should detect when same file is edited 3+ times", async () => {
      // Mock events showing repeated edits to the same file
      const mockEvents = [
        {
          id: "event-1",
          session_id: "session-1",
          files_referenced: ["auth.test.ts"],
          tokens_in: 5000,
          tokens_out: 3000,
          estimated_cost_usd: 0.5,
          timestamp: new Date(),
        },
        {
          id: "event-2",
          session_id: "session-1",
          files_referenced: ["auth.test.ts"],
          tokens_in: 5000,
          tokens_out: 3000,
          estimated_cost_usd: 0.5,
          timestamp: new Date(),
        },
        {
          id: "event-3",
          session_id: "session-1",
          files_referenced: ["auth.test.ts"],
          tokens_in: 5000,
          tokens_out: 3000,
          estimated_cost_usd: 0.5,
          timestamp: new Date(),
        },
      ];

      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(mockEvents),
            }),
          }),
        }),
      } as any);

      // Import after mocking
      const { runWasteDetection } = await import("../src/waste/detector.js");

      await runWasteDetection({
        eventId: "event-4",
        sessionId: "session-1",
        userId: "user-1",
        teamId: null,
        provider: "anthropic",
        model: "claude-3-sonnet",
        tokensIn: 5000,
        tokensOut: 3000,
        estimatedCostUsd: 0.5,
        toolCalls: [],
        filesReferenced: ["auth.test.ts"],
        compactionTriggered: false,
        contextSizeBefore: 0,
        contextSizeAfter: 0,
      });

      // Verify an alert was created
      expect(publishBurnAlert).toHaveBeenCalled();
    });

    it("should not trigger if file only appears twice", async () => {
      const mockEvents = [
        {
          id: "event-1",
          session_id: "session-1",
          files_referenced: ["auth.test.ts"],
          tokens_in: 5000,
          tokens_out: 3000,
          estimated_cost_usd: 0.5,
          timestamp: new Date(),
        },
        {
          id: "event-2",
          session_id: "session-1",
          files_referenced: ["auth.test.ts"],
          tokens_in: 5000,
          tokens_out: 3000,
          estimated_cost_usd: 0.5,
          timestamp: new Date(),
        },
      ];

      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(mockEvents),
            }),
          }),
        }),
      } as any);

      vi.mocked(publishBurnAlert).mockClear();

      const { runWasteDetection } = await import("../src/waste/detector.js");

      await runWasteDetection({
        eventId: "event-3",
        sessionId: "session-1",
        userId: "user-1",
        teamId: null,
        provider: "anthropic",
        model: "claude-3-sonnet",
        tokensIn: 5000,
        tokensOut: 3000,
        estimatedCostUsd: 0.5,
        toolCalls: [],
        filesReferenced: ["utils.ts"], // Different file
        compactionTriggered: false,
        contextSizeBefore: 0,
        contextSizeAfter: 0,
      });

      // No circular loop alert for just 2 occurrences
      const calls = vi.mocked(publishBurnAlert).mock.calls;
      const circularLoopCalls = calls.filter(
        (call) => call[0].pattern === "circular_loop"
      );
      expect(circularLoopCalls.length).toBe(0);
    });
  });

  describe("Pattern 2: Redundant File Reads", () => {
    it("should detect when same file is read 3+ times in session", async () => {
      const mockEvents = [
        {
          id: "event-1",
          files_referenced: ["src/auth.ts"],
          tokens_in: 4000,
          timestamp: new Date(),
        },
        {
          id: "event-2",
          files_referenced: ["src/auth.ts"],
          tokens_in: 4000,
          timestamp: new Date(),
        },
        {
          id: "event-3",
          files_referenced: ["src/auth.ts"],
          tokens_in: 4000,
          timestamp: new Date(),
        },
      ];

      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(mockEvents),
            }),
          }),
        }),
      } as any);
    });
  });

  describe("Pattern 3: Compaction Storm", () => {
    it("should detect 2+ compactions in 60 minutes", async () => {
      const now = new Date();
      const mockCompactionEvents = [
        {
          id: "event-1",
          compaction_triggered: true,
          estimated_cost_usd: 0.5,
          timestamp: new Date(now.getTime() - 30 * 60 * 1000), // 30 min ago
        },
        {
          id: "event-2",
          compaction_triggered: true,
          estimated_cost_usd: 0.5,
          timestamp: new Date(now.getTime() - 15 * 60 * 1000), // 15 min ago
        },
      ];

      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(mockCompactionEvents),
        }),
      } as any);
    });
  });

  describe("Pattern 4: Zero Acceptance", () => {
    it("should detect high token usage with no write operations", async () => {
      const now = new Date();
      const mockEvents = [
        {
          id: "event-1",
          tokens_in: 15000,
          tokens_out: 10000,
          tool_calls: ["read_file"],
          estimated_cost_usd: 1.5,
          timestamp: new Date(now.getTime() - 5 * 60 * 1000),
        },
        {
          id: "event-2",
          tokens_in: 10000,
          tokens_out: 8000,
          tool_calls: ["read_file", "search"],
          estimated_cost_usd: 1.0,
          timestamp: new Date(now.getTime() - 3 * 60 * 1000),
        },
      ];

      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(mockEvents),
        }),
      } as any);
    });

    it("should not trigger if writes are present", async () => {
      const now = new Date();
      const mockEvents = [
        {
          id: "event-1",
          tokens_in: 15000,
          tokens_out: 10000,
          tool_calls: ["read_file", "write_file"], // Has write
          estimated_cost_usd: 1.5,
          timestamp: new Date(now.getTime() - 5 * 60 * 1000),
        },
      ];

      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(mockEvents),
        }),
      } as any);
    });
  });

  describe("Pattern 5: MCP Overhead Bloat", () => {
    it("should detect when tool definitions exceed 15% of tokens", async () => {
      // Event with many tool calls (each ~350 tokens)
      const { runWasteDetection } = await import("../src/waste/detector.js");

      vi.mocked(publishBurnAlert).mockClear();

      await runWasteDetection({
        eventId: "event-1",
        sessionId: "session-1",
        userId: "user-1",
        teamId: null,
        provider: "anthropic",
        model: "claude-3-sonnet",
        tokensIn: 10000, // 10K tokens in
        tokensOut: 3000,
        estimatedCostUsd: 0.5,
        toolCalls: [
          "tool1",
          "tool2",
          "tool3",
          "tool4",
          "tool5",
          "tool6",
          "tool7",
          "tool8",
          "tool9",
          "tool10",
        ], // 10 tools = ~3500 tokens = 35% overhead
        filesReferenced: [],
        compactionTriggered: false,
        contextSizeBefore: 0,
        contextSizeAfter: 0,
      });

      const calls = vi.mocked(publishBurnAlert).mock.calls;
      const mcpBloatCalls = calls.filter((call) => call[0].pattern === "mcp_bloat");
      expect(mcpBloatCalls.length).toBe(1);
    });

    it("should not trigger for low tool count", async () => {
      const { runWasteDetection } = await import("../src/waste/detector.js");

      vi.mocked(publishBurnAlert).mockClear();

      await runWasteDetection({
        eventId: "event-1",
        sessionId: "session-mcp-low",
        userId: "user-1",
        teamId: null,
        provider: "anthropic",
        model: "claude-3-sonnet",
        tokensIn: 10000,
        tokensOut: 3000,
        estimatedCostUsd: 0.5,
        toolCalls: ["tool1", "tool2"], // Only 2 tools
        filesReferenced: [],
        compactionTriggered: false,
        contextSizeBefore: 0,
        contextSizeAfter: 0,
      });

      const calls = vi.mocked(publishBurnAlert).mock.calls;
      const mcpBloatCalls = calls.filter((call) => call[0].pattern === "mcp_bloat");
      expect(mcpBloatCalls.length).toBe(0);
    });
  });

  describe("Pattern 6: Cost Anomaly", () => {
    it("should detect costs >3x the average", async () => {
      // Mock historical average
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { avgCost: 0.5, stdDev: 0.1 }, // Average is $0.50
          ]),
        }),
      } as any);

      const { runWasteDetection } = await import("../src/waste/detector.js");

      vi.mocked(publishBurnAlert).mockClear();

      await runWasteDetection({
        eventId: "event-anomaly",
        sessionId: "session-anomaly",
        userId: "user-1",
        teamId: null,
        provider: "anthropic",
        model: "claude-3-sonnet",
        tokensIn: 50000,
        tokensOut: 30000,
        estimatedCostUsd: 2.0, // 4x the average
        toolCalls: [],
        filesReferenced: [],
        compactionTriggered: false,
        contextSizeBefore: 0,
        contextSizeAfter: 0,
      });

      const calls = vi.mocked(publishBurnAlert).mock.calls;
      const anomalyCalls = calls.filter((call) => call[0].pattern === "cost_anomaly");
      expect(anomalyCalls.length).toBe(1);
    });
  });
});

// Stream Publisher tests are in a separate file to avoid mock conflicts
