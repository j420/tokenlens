import { NextRequest, NextResponse } from "next/server";

// Event storage - use Vercel KV if available
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

// In-memory fallback storage
const memoryStore: ProxyEvent[] = [];

async function getKV() {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const { kv } = await import("@vercel/kv");
      return kv;
    } catch {
      return null;
    }
  }
  return null;
}

// POST - Store a new event
export async function POST(request: NextRequest) {
  try {
    const event: ProxyEvent = await request.json();

    const kv = await getKV();
    if (kv) {
      await kv.lpush("prune:events", JSON.stringify(event));
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
      }, { ex: 86400 * 30 });
    } else {
      // Fallback to memory
      memoryStore.unshift(event);
      if (memoryStore.length > 500) {
        memoryStore.splice(500);
      }
    }

    return NextResponse.json({ success: true, stored: true });
  } catch (error) {
    console.error("Failed to store event:", error);
    return NextResponse.json(
      { success: false, error: "Failed to store event" },
      { status: 500 }
    );
  }
}

// GET - Retrieve events
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get("limit") || "100", 10);

  try {
    const kv = await getKV();

    let events: ProxyEvent[] = [];
    let storageType: "kv" | "memory" = "memory";

    if (kv) {
      storageType = "kv";
      const rawEvents = await kv.lrange<string>("prune:events", 0, limit - 1);
      events = rawEvents.map(e => typeof e === "string" ? JSON.parse(e) : e);
    } else {
      events = memoryStore.slice(0, limit);
    }

    // Calculate summary stats
    const today = new Date().toISOString().split("T")[0];
    const todayEvents = events.filter(e => e.timestamp.startsWith(today));
    const totalCost = todayEvents.reduce((sum, e) => sum + e.costUsd, 0);
    const totalTokens = todayEvents.reduce((sum, e) => sum + e.tokensIn + e.tokensOut, 0);

    return NextResponse.json({
      events,
      summary: {
        totalEvents: events.length,
        todayEvents: todayEvents.length,
        todayCost: totalCost,
        todayTokens: totalTokens,
      },
      storage: storageType,
    });
  } catch (error) {
    console.error("Failed to get events:", error);
    return NextResponse.json(
      { events: memoryStore.slice(0, limit), storage: "memory-fallback" }
    );
  }
}
