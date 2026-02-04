import { NextRequest, NextResponse } from "next/server";

// Mock session detail data
const MOCK_SESSION_DETAIL = {
  id: "session-1",
  tool: "claude-code",
  model: "Claude Sonnet 4.5",
  taskDescription: "auth-service refactor",
  startTime: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  endTime: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
  totalTokens: 84000,
  totalCost: 4.2,
  roi: 0.52,
  productiveCost: 2.18,
  wastedCost: 2.02,
  wasteBreakdown: [
    { pattern: "circular_loop", file: "auth.test.ts", cost: 1.45 },
    { pattern: "compaction_overhead", cost: 0.42 },
    { pattern: "redundant_reads", file: "utils.ts", cost: 0.15 },
  ],
  pruneInterventions: {
    burnAlerts: 1,
    compactionNotices: 1,
  },
  estimatedSavings: 1.2,
  turns: [
    {
      number: 1,
      time: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      prompt: "Refactor auth module to use JWT",
      tokensIn: 3200,
      tokensOut: 1800,
      cost: 0.12,
      roi: 1.0,
      status: "clean",
    },
    {
      number: 2,
      time: new Date(Date.now() - 1.9 * 60 * 60 * 1000).toISOString(),
      prompt: "Also update the refresh token logic",
      tokensIn: 4100,
      tokensOut: 3200,
      cost: 0.28,
      roi: 0.95,
      status: "clean",
    },
    {
      number: 3,
      time: new Date(Date.now() - 1.7 * 60 * 60 * 1000).toISOString(),
      prompt: "Fix the failing test in auth.test.ts",
      tokensIn: 8400,
      tokensOut: 6200,
      cost: 0.45,
      roi: 0,
      status: "loop_start",
      wasteAlert: "Circular loop: similar edit to auth.test.ts, test failed",
    },
    {
      number: 4,
      time: new Date(Date.now() - 1.6 * 60 * 60 * 1000).toISOString(),
      prompt: "[AI retry — same approach]",
      tokensIn: 8100,
      tokensOut: 5900,
      cost: 0.52,
      roi: 0,
      status: "loop_continued",
      wasteAlert: "80% similarity to Turn 3 output",
    },
    {
      number: 5,
      time: new Date(Date.now() - 1.5 * 60 * 60 * 1000).toISOString(),
      prompt: "[AI retry — same approach]",
      tokensIn: 7800,
      tokensOut: 6100,
      cost: 0.48,
      roi: 0,
      status: "loop_continued",
      wasteAlert: "BURN ALERT fired here: 'Loop detected, $2.40 wasted'",
    },
    {
      number: 6,
      time: new Date(Date.now() - 1.4 * 60 * 60 * 1000).toISOString(),
      prompt: "Let me try a different approach — mock the JWT library",
      tokensIn: 2100,
      tokensOut: 1200,
      cost: 0.08,
      roi: 1.0,
      status: "clean",
      note: "Developer rephrased after Prune alert",
    },
  ],
  compactions: [
    {
      turn: 6,
      time: new Date(Date.now() - 1.35 * 60 * 60 * 1000).toISOString(),
      tokensBefore: 68000,
      tokensAfter: 24000,
      lostReferences: [
        { item: "JWT expiry: 15 minutes", originalTurn: 2 },
        { item: "Middleware chain order", originalTurn: 1 },
      ],
    },
  ],
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // In production, this would fetch from the database
  // For now, return mock data
  if (!id) {
    return NextResponse.json({ error: "Session ID required" }, { status: 400 });
  }

  return NextResponse.json({
    ...MOCK_SESSION_DETAIL,
    id,
  });
}
