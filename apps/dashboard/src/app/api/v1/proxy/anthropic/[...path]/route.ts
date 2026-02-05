import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";

export const runtime = "edge";

// Model pricing for cost estimation
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-5-20251101": { input: 15, output: 75 },
  "claude-sonnet-4-5-20250929": { input: 3, output: 15 },
  "claude-sonnet-4-20250514": { input: 3, output: 15 },
  "claude-3-5-sonnet-20241022": { input: 3, output: 15 },
  "claude-3-5-haiku-20241022": { input: 0.8, output: 4 },
  "claude-3-opus-20240229": { input: 15, output: 75 },
  "claude-3-sonnet-20240229": { input: 3, output: 15 },
  "claude-3-haiku-20240307": { input: 0.25, output: 1.25 },
};

// Store event by posting to the events API
async function storeEventAsync(
  baseUrl: string,
  event: {
    id: string;
    timestamp: string;
    provider: string;
    tool: string;
    model: string;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    latencyMs: number;
  }
) {
  try {
    // Fire and forget - don't wait for response
    fetch(`${baseUrl}/api/v1/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    }).catch(err => console.error("Failed to store event:", err));
  } catch (error) {
    console.error("Failed to initiate event storage:", error);
  }
}

function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  const pricing = MODEL_PRICING[model] ?? { input: 3, output: 15 };
  const inputCost = (tokensIn / 1_000_000) * pricing.input;
  const outputCost = (tokensOut / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

// Rough token estimation (4 chars per token)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const pathStr = path.join("/");
  const correlationId = request.headers.get("x-correlation-id") ?? uuidv4();

  // Extract API key from request
  const apiKey = request.headers.get("x-api-key") ?? request.headers.get("authorization")?.replace("Bearer ", "");

  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing API key. Provide x-api-key header or Authorization bearer token." },
      { status: 401 }
    );
  }

  // Extract Prune API key for tracking (optional)
  const pruneApiKey = request.headers.get("x-prune-api-key");

  try {
    // Parse the request body
    const body = await request.json();
    const model = body.model ?? "unknown";

    // Estimate input tokens
    const requestBodyStr = JSON.stringify(body);
    const estimatedInputTokens = estimateTokens(requestBodyStr);

    // Forward to Anthropic
    const anthropicUrl = `https://api.anthropic.com/${pathStr}`;

    const forwardHeaders = new Headers();
    forwardHeaders.set("Content-Type", "application/json");
    forwardHeaders.set("x-api-key", apiKey);
    forwardHeaders.set("anthropic-version", request.headers.get("anthropic-version") ?? "2023-06-01");

    // Copy other anthropic headers
    const headersToCopy = ["anthropic-beta", "anthropic-dangerous-direct-browser-access"];
    for (const header of headersToCopy) {
      const value = request.headers.get(header);
      if (value) forwardHeaders.set(header, value);
    }

    const startTime = Date.now();

    const response = await fetch(anthropicUrl, {
      method: "POST",
      headers: forwardHeaders,
      body: JSON.stringify(body),
    });

    const latencyMs = Date.now() - startTime;

    // Handle streaming responses
    if (body.stream) {
      // For streaming, we pass through the response directly
      // Event capture would need to be done via a separate mechanism
      const responseHeaders = new Headers();
      responseHeaders.set("Content-Type", "text/event-stream");
      responseHeaders.set("Cache-Control", "no-cache");
      responseHeaders.set("Connection", "keep-alive");
      responseHeaders.set("x-correlation-id", correlationId);
      responseHeaders.set("x-prune-latency-ms", latencyMs.toString());

      return new Response(response.body, {
        status: response.status,
        headers: responseHeaders,
      });
    }

    // Non-streaming response
    const responseData = await response.json();

    // Extract token usage
    const tokensIn = responseData.usage?.input_tokens ?? estimatedInputTokens;
    const tokensOut = responseData.usage?.output_tokens ?? 0;
    const estimatedCost = estimateCost(model, tokensIn, tokensOut);

    // Store the event
    const event = {
      id: correlationId,
      timestamp: new Date().toISOString(),
      provider: "anthropic" as const,
      tool: "cursor" as const, // Cursor can use Anthropic API too
      model,
      tokensIn,
      tokensOut,
      costUsd: estimatedCost,
      latencyMs,
    };

    // Get base URL from request
    const baseUrl = new URL(request.url).origin;
    storeEventAsync(baseUrl, event);

    console.log({
      type: "proxy_event",
      ...event,
      pruneApiKey: pruneApiKey ? "present" : "absent",
    });

    // Return response with Prune headers
    const responseHeaders = new Headers();
    responseHeaders.set("Content-Type", "application/json");
    responseHeaders.set("x-correlation-id", correlationId);
    responseHeaders.set("x-prune-tokens-in", tokensIn.toString());
    responseHeaders.set("x-prune-tokens-out", tokensOut.toString());
    responseHeaders.set("x-prune-cost-usd", estimatedCost.toFixed(6));
    responseHeaders.set("x-prune-latency-ms", latencyMs.toString());

    return NextResponse.json(responseData, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("Proxy error:", error);
    return NextResponse.json(
      { error: "Proxy error", message: error instanceof Error ? error.message : "Unknown error" },
      { status: 502 }
    );
  }
}

// Handle OPTIONS for CORS
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key, x-prune-api-key, anthropic-version, anthropic-beta",
    },
  });
}
