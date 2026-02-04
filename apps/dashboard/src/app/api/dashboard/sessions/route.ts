import { NextRequest, NextResponse } from "next/server";

// Mock sessions data
const MOCK_SESSIONS = [
  {
    id: "session-1",
    tool: "claude-code",
    model: "claude-sonnet-4-5",
    taskDescription: "auth-service refactor",
    tokens: 84000,
    cost: 4.2,
    roi: 0.52,
    wasteEvents: 2,
    compactions: 1,
    startTime: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    endTime: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
    turns: 12,
  },
  {
    id: "session-2",
    tool: "cursor",
    model: "claude-sonnet-4-5",
    taskDescription: "frontend button fix",
    tokens: 12000,
    cost: 0.45,
    roi: 0.94,
    wasteEvents: 0,
    compactions: 0,
    startTime: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    endTime: new Date(Date.now() - 4.5 * 60 * 60 * 1000).toISOString(),
    turns: 4,
  },
  {
    id: "session-3",
    tool: "claude-code",
    model: "claude-sonnet-4-5",
    taskDescription: "test generation",
    tokens: 42000,
    cost: 2.1,
    roi: 0.78,
    wasteEvents: 1,
    compactions: 0,
    startTime: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
    endTime: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(),
    turns: 8,
  },
];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period") || "today";
  const limit = parseInt(searchParams.get("limit") || "20", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  // In production, this would fetch from the sessions table
  // with proper pagination and filtering

  return NextResponse.json({
    sessions: MOCK_SESSIONS.slice(offset, offset + limit),
    total: MOCK_SESSIONS.length,
    hasMore: offset + limit < MOCK_SESSIONS.length,
  });
}
