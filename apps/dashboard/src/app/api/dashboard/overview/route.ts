import { NextRequest, NextResponse } from "next/server";

interface ProxyEvent {
  id: string;
  timestamp: string;
  provider: "openai" | "anthropic";
  tool: "cursor" | "claude-code" | "codex" | "unknown";
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
}

interface SessionSummary {
  id: string;
  tool: "cursor" | "claude-code" | "codex" | "unknown";
  taskDescription: string;
  tokens: number;
  cost: number;
  roi: number;
  wasteEvents: number;
  compactions: number;
  startTime: string;
}

// Group events into sessions (30-min gaps)
function groupEventsIntoSessions(events: ProxyEvent[]): SessionSummary[] {
  if (events.length === 0) return [];

  const sessions: SessionSummary[] = [];
  let currentSession: ProxyEvent[] = [];
  let lastTime: Date | null = null;

  const sorted = [...events].sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  for (const event of sorted) {
    const eventTime = new Date(event.timestamp);

    if (lastTime && (lastTime.getTime() - eventTime.getTime()) > 30 * 60 * 1000) {
      if (currentSession.length > 0) {
        sessions.push(createSessionSummary(currentSession));
      }
      currentSession = [event];
    } else {
      currentSession.push(event);
    }
    lastTime = eventTime;
  }

  if (currentSession.length > 0) {
    sessions.push(createSessionSummary(currentSession));
  }

  return sessions;
}

function createSessionSummary(events: ProxyEvent[]): SessionSummary {
  const totalCost = events.reduce((sum, e) => sum + e.costUsd, 0);
  const totalTokens = events.reduce((sum, e) => sum + e.tokensIn + e.tokensOut, 0);
  const tool = events[0]?.tool || "unknown";
  const model = events[0]?.model || "unknown";

  return {
    id: `session-${events[events.length - 1]?.id || Date.now()}`,
    tool,
    taskDescription: `${model} session (${events.length} requests)`,
    tokens: totalTokens,
    cost: totalCost,
    roi: 0.75,
    wasteEvents: 0,
    compactions: 0,
    startTime: events[events.length - 1]?.timestamp || new Date().toISOString(),
  };
}

function generateChartData(events: ProxyEvent[]) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const chartData: Array<{ date: string; productive: number; waste: number }> = [];

  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split("T")[0];
    const dayName = days[date.getDay()];

    const dayEvents = events.filter(e => e.timestamp.startsWith(dateStr));
    const dayCost = dayEvents.reduce((sum, e) => sum + e.costUsd, 0);

    chartData.push({
      date: dayName,
      productive: Math.round(dayCost * 75) / 100,
      waste: Math.round(dayCost * 25) / 100,
    });
  }

  return chartData;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period") || "today";

  try {
    // Fetch events from internal API
    const baseUrl = new URL(request.url).origin;
    const eventsResponse = await fetch(`${baseUrl}/api/v1/events?limit=500`, {
      cache: "no-store",
    });

    if (!eventsResponse.ok) {
      throw new Error("Failed to fetch events");
    }

    const { events, summary, storage } = await eventsResponse.json() as {
      events: ProxyEvent[];
      summary: { totalEvents: number; todayEvents: number; todayCost: number; todayTokens: number };
      storage: string;
    };

    // Filter by period
    const now = new Date();
    const periodStart = new Date();
    if (period === "week") {
      periodStart.setDate(now.getDate() - 7);
    } else if (period === "month") {
      periodStart.setDate(now.getDate() - 30);
    } else {
      periodStart.setHours(0, 0, 0, 0);
    }

    const periodEvents = events.filter((e: ProxyEvent) => new Date(e.timestamp) >= periodStart);
    const totalCost = periodEvents.reduce((sum: number, e: ProxyEvent) => sum + e.costUsd, 0);
    const sessions = groupEventsIntoSessions(periodEvents);

    // Calculate daily average from week data
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekEvents = events.filter((e: ProxyEvent) => new Date(e.timestamp) >= weekAgo);
    const weekTotal = weekEvents.reduce((sum: number, e: ProxyEvent) => sum + e.costUsd, 0);
    const dailyAverage = weekTotal / 7;

    const chartData = generateChartData(events);

    const data = {
      todaySpend: totalCost,
      dailyAverage: dailyAverage || 0,
      sessions: sessions.length,
      productiveRoi: 0.75,
      pruneSaved: 0,
      pruneSavedDetails: { trims: 0, alerts: 0 },
      totalEvents: periodEvents.length,
      lastEvent: periodEvents.length > 0 ? {
        tokens: periodEvents[0].tokensIn + periodEvents[0].tokensOut,
        cost: periodEvents[0].costUsd,
      } : null,
      recentSessions: sessions.slice(0, 10),
      chartData,
      _meta: {
        storage,
        hasRealData: events.length > 0,
      },
    };

    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to fetch overview data:", error);

    // Return empty state instead of mock data
    return NextResponse.json({
      todaySpend: 0,
      dailyAverage: 0,
      sessions: 0,
      productiveRoi: 0,
      pruneSaved: 0,
      pruneSavedDetails: { trims: 0, alerts: 0 },
      totalEvents: 0,
      lastEvent: null,
      recentSessions: [],
      chartData: [
        { date: "Mon", productive: 0, waste: 0 },
        { date: "Tue", productive: 0, waste: 0 },
        { date: "Wed", productive: 0, waste: 0 },
        { date: "Thu", productive: 0, waste: 0 },
        { date: "Fri", productive: 0, waste: 0 },
        { date: "Sat", productive: 0, waste: 0 },
        { date: "Sun", productive: 0, waste: 0 },
      ],
      _meta: {
        storage: "error",
        hasRealData: false,
        error: "Failed to fetch data",
      },
    });
  }
}
