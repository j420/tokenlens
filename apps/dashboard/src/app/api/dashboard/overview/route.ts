import { NextRequest, NextResponse } from "next/server";

// Mock data for demo - in production this would fetch from the proxy backend
const MOCK_DATA = {
  todaySpend: 14.2,
  dailyAverage: 10.8,
  sessions: 6,
  productiveRoi: 0.68,
  pruneSaved: 4.8,
  pruneSavedDetails: { trims: 3, alerts: 1 },
  totalEvents: 42,
  lastEvent: {
    tokens: 1240,
    cost: 0.04,
  },
  recentSessions: [
    {
      id: "session-1",
      tool: "claude-code",
      taskDescription: "auth-service refactor",
      tokens: 84000,
      cost: 4.2,
      roi: 0.52,
      wasteEvents: 2,
      compactions: 1,
      startTime: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: "session-2",
      tool: "cursor",
      taskDescription: "frontend button fix",
      tokens: 12000,
      cost: 0.45,
      roi: 0.94,
      wasteEvents: 0,
      compactions: 0,
      startTime: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: "session-3",
      tool: "claude-code",
      taskDescription: "test generation",
      tokens: 42000,
      cost: 2.1,
      roi: 0.78,
      wasteEvents: 1,
      compactions: 0,
      startTime: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
    },
  ],
  chartData: [
    { date: "Mon", productive: 8, waste: 2 },
    { date: "Tue", productive: 12, waste: 4 },
    { date: "Wed", productive: 10, waste: 5 },
    { date: "Thu", productive: 7, waste: 3 },
    { date: "Fri", productive: 11, waste: 4 },
    { date: "Sat", productive: 4, waste: 1 },
    { date: "Sun", productive: 9, waste: 5 },
  ],
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period") || "today";

  // In production, this would:
  // 1. Verify auth token
  // 2. Fetch aggregated data from the events table
  // 3. Calculate ROI, waste, savings from alerts table
  // 4. Return the data

  // Adjust data based on period for demo
  const multiplier = period === "week" ? 7 : period === "month" ? 30 : 1;
  const data = {
    ...MOCK_DATA,
    todaySpend: MOCK_DATA.todaySpend * multiplier,
    dailyAverage: MOCK_DATA.dailyAverage,
    sessions: MOCK_DATA.sessions * multiplier,
    pruneSaved: MOCK_DATA.pruneSaved * multiplier,
  };

  return NextResponse.json(data);
}
