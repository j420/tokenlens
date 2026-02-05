/**
 * Event storage for Prune
 * Uses Vercel KV when available, falls back to in-memory for development
 */

export interface ProxyEvent {
  id: string;
  timestamp: string;
  provider: "openai" | "anthropic";
  tool: "cursor" | "claude-code" | "codex" | "unknown";
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  sessionId?: string;
  userId?: string;
}

export interface SessionSummary {
  id: string;
  tool: "cursor" | "claude-code" | "codex" | "unknown";
  taskDescription: string;
  tokens: number;
  cost: number;
  roi: number;
  wasteEvents: number;
  compactions: number;
  startTime: string;
  eventCount: number;
}

// In-memory storage for development (resets on each deployment)
const memoryStore: {
  events: ProxyEvent[];
  lastUpdated: string;
} = {
  events: [],
  lastUpdated: new Date().toISOString(),
};

// Check if Vercel KV is configured
function isKVConfigured(): boolean {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

// Store an event
export async function storeEvent(event: ProxyEvent): Promise<void> {
  if (isKVConfigured()) {
    try {
      const { kv } = await import("@vercel/kv");

      // Store individual event
      await kv.lpush("prune:events", JSON.stringify(event));

      // Keep only last 1000 events
      await kv.ltrim("prune:events", 0, 999);

      // Update daily stats
      const today = new Date().toISOString().split("T")[0];
      const statsKey = `prune:stats:${today}`;

      const currentStats = await kv.get<{
        totalCost: number;
        totalTokens: number;
        eventCount: number;
      }>(statsKey) || { totalCost: 0, totalTokens: 0, eventCount: 0 };

      await kv.set(statsKey, {
        totalCost: currentStats.totalCost + event.costUsd,
        totalTokens: currentStats.totalTokens + event.tokensIn + event.tokensOut,
        eventCount: currentStats.eventCount + 1,
      }, { ex: 86400 * 30 }); // Expire after 30 days

    } catch (error) {
      console.error("Failed to store event in KV:", error);
      // Fallback to memory
      memoryStore.events.unshift(event);
      if (memoryStore.events.length > 1000) {
        memoryStore.events = memoryStore.events.slice(0, 1000);
      }
    }
  } else {
    // Use in-memory storage
    memoryStore.events.unshift(event);
    memoryStore.lastUpdated = new Date().toISOString();
    if (memoryStore.events.length > 1000) {
      memoryStore.events = memoryStore.events.slice(0, 1000);
    }
    console.log(`[Memory Store] Event stored. Total: ${memoryStore.events.length}`);
  }
}

// Get recent events
export async function getRecentEvents(limit: number = 100): Promise<ProxyEvent[]> {
  if (isKVConfigured()) {
    try {
      const { kv } = await import("@vercel/kv");
      const events = await kv.lrange<string>("prune:events", 0, limit - 1);
      return events.map(e => typeof e === "string" ? JSON.parse(e) : e);
    } catch (error) {
      console.error("Failed to get events from KV:", error);
      return memoryStore.events.slice(0, limit);
    }
  }
  return memoryStore.events.slice(0, limit);
}

// Get daily stats
export async function getDailyStats(date?: string): Promise<{
  totalCost: number;
  totalTokens: number;
  eventCount: number;
}> {
  const targetDate = date || new Date().toISOString().split("T")[0];

  if (isKVConfigured()) {
    try {
      const { kv } = await import("@vercel/kv");
      const stats = await kv.get<{
        totalCost: number;
        totalTokens: number;
        eventCount: number;
      }>(`prune:stats:${targetDate}`);

      return stats || { totalCost: 0, totalTokens: 0, eventCount: 0 };
    } catch (error) {
      console.error("Failed to get stats from KV:", error);
    }
  }

  // Calculate from in-memory events
  const todayEvents = memoryStore.events.filter(e =>
    e.timestamp.startsWith(targetDate)
  );

  return {
    totalCost: todayEvents.reduce((sum, e) => sum + e.costUsd, 0),
    totalTokens: todayEvents.reduce((sum, e) => sum + e.tokensIn + e.tokensOut, 0),
    eventCount: todayEvents.length,
  };
}

// Get overview data for dashboard
export async function getOverviewData(period: "today" | "week" | "month" = "today"): Promise<{
  todaySpend: number;
  dailyAverage: number;
  sessions: number;
  productiveRoi: number;
  pruneSaved: number;
  pruneSavedDetails: { trims: number; alerts: number };
  totalEvents: number;
  lastEvent: { tokens: number; cost: number } | null;
  recentSessions: SessionSummary[];
  chartData: Array<{ date: string; productive: number; waste: number }>;
}> {
  const events = await getRecentEvents(500);
  const today = new Date().toISOString().split("T")[0];

  // Filter events by period
  const now = new Date();
  const periodStart = new Date();
  if (period === "week") {
    periodStart.setDate(now.getDate() - 7);
  } else if (period === "month") {
    periodStart.setDate(now.getDate() - 30);
  } else {
    periodStart.setHours(0, 0, 0, 0);
  }

  const periodEvents = events.filter(e => new Date(e.timestamp) >= periodStart);

  // Calculate stats
  const totalCost = periodEvents.reduce((sum, e) => sum + e.costUsd, 0);
  const totalTokens = periodEvents.reduce((sum, e) => sum + e.tokensIn + e.tokensOut, 0);

  // Group events into sessions (by 30-min gaps)
  const sessions = groupEventsIntoSessions(periodEvents);

  // Calculate daily average (use 7-day history)
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekEvents = events.filter(e => new Date(e.timestamp) >= weekAgo);
  const weekTotal = weekEvents.reduce((sum, e) => sum + e.costUsd, 0);
  const dailyAverage = weekTotal / 7;

  // Generate chart data
  const chartData = generateChartData(events);

  return {
    todaySpend: totalCost,
    dailyAverage,
    sessions: sessions.length,
    productiveRoi: 0.75, // Placeholder - would need more analysis
    pruneSaved: 0, // Placeholder - no pruning implemented yet
    pruneSavedDetails: { trims: 0, alerts: 0 },
    totalEvents: periodEvents.length,
    lastEvent: periodEvents.length > 0 ? {
      tokens: periodEvents[0].tokensIn + periodEvents[0].tokensOut,
      cost: periodEvents[0].costUsd,
    } : null,
    recentSessions: sessions.slice(0, 10),
    chartData,
  };
}

// Group events into sessions based on time gaps
function groupEventsIntoSessions(events: ProxyEvent[]): SessionSummary[] {
  if (events.length === 0) return [];

  const sessions: SessionSummary[] = [];
  let currentSession: ProxyEvent[] = [];
  let lastTime: Date | null = null;

  // Sort events by timestamp descending
  const sorted = [...events].sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  for (const event of sorted) {
    const eventTime = new Date(event.timestamp);

    if (lastTime && (lastTime.getTime() - eventTime.getTime()) > 30 * 60 * 1000) {
      // Gap > 30 minutes, start new session
      if (currentSession.length > 0) {
        sessions.push(createSessionSummary(currentSession));
      }
      currentSession = [event];
    } else {
      currentSession.push(event);
    }
    lastTime = eventTime;
  }

  // Add last session
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
    id: `session-${events[events.length - 1]?.timestamp || Date.now()}`,
    tool,
    taskDescription: `${model} session (${events.length} requests)`,
    tokens: totalTokens,
    cost: totalCost,
    roi: 0.75, // Placeholder
    wasteEvents: 0,
    compactions: 0,
    startTime: events[events.length - 1]?.timestamp || new Date().toISOString(),
    eventCount: events.length,
  };
}

function generateChartData(events: ProxyEvent[]): Array<{ date: string; productive: number; waste: number }> {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const chartData: Array<{ date: string; productive: number; waste: number }> = [];

  // Generate last 7 days
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split("T")[0];
    const dayName = days[date.getDay()];

    const dayEvents = events.filter(e => e.timestamp.startsWith(dateStr));
    const dayCost = dayEvents.reduce((sum, e) => sum + e.costUsd, 0);

    chartData.push({
      date: dayName,
      productive: Math.round(dayCost * 75) / 100, // 75% productive (placeholder)
      waste: Math.round(dayCost * 25) / 100, // 25% waste (placeholder)
    });
  }

  return chartData;
}

// Check storage status
export async function getStorageStatus(): Promise<{
  type: "kv" | "memory";
  eventCount: number;
  lastUpdated: string;
}> {
  if (isKVConfigured()) {
    try {
      const { kv } = await import("@vercel/kv");
      const count = await kv.llen("prune:events");
      return {
        type: "kv",
        eventCount: count,
        lastUpdated: new Date().toISOString(),
      };
    } catch {
      // Fall through to memory
    }
  }

  return {
    type: "memory",
    eventCount: memoryStore.events.length,
    lastUpdated: memoryStore.lastUpdated,
  };
}
