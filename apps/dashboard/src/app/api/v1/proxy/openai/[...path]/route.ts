import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";

export const runtime = "edge";

// Model pricing for cost estimation
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4-turbo": { input: 10, output: 30 },
  "gpt-4": { input: 30, output: 60 },
  "gpt-3.5-turbo": { input: 0.5, output: 1.5 },
  "o1-preview": { input: 15, output: 60 },
  "o1-mini": { input: 3, output: 12 },
  "o3-mini": { input: 1.1, output: 4.4 },
};

function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  const pricing = MODEL_PRICING[model] ?? { input: 2.5, output: 10 };
  const inputCost = (tokensIn / 1_000_000) * pricing.input;
  const outputCost = (tokensOut / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

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

  // Extract API key
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Missing or invalid Authorization header" },
      { status: 401 }
    );
  }

  const apiKey = authHeader.replace("Bearer ", "");
  const pruneApiKey = request.headers.get("x-prune-api-key");

  try {
    const body = await request.json();
    const model = body.model ?? "unknown";

    const requestBodyStr = JSON.stringify(body);
    const estimatedInputTokens = estimateTokens(requestBodyStr);

    // Forward to OpenAI
    const openaiUrl = `https://api.openai.com/${pathStr}`;

    const forwardHeaders = new Headers();
    forwardHeaders.set("Content-Type", "application/json");
    forwardHeaders.set("Authorization", `Bearer ${apiKey}`);

    // Copy OpenAI-specific headers
    const orgId = request.headers.get("openai-organization");
    if (orgId) forwardHeaders.set("OpenAI-Organization", orgId);

    const startTime = Date.now();

    const response = await fetch(openaiUrl, {
      method: "POST",
      headers: forwardHeaders,
      body: JSON.stringify(body),
    });

    const latencyMs = Date.now() - startTime;

    // Handle streaming responses
    if (body.stream) {
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
    const tokensIn = responseData.usage?.prompt_tokens ?? estimatedInputTokens;
    const tokensOut = responseData.usage?.completion_tokens ?? 0;
    const estimatedCost = estimateCost(model, tokensIn, tokensOut);

    console.log({
      type: "proxy_event",
      correlationId,
      provider: "openai",
      model,
      tokensIn,
      tokensOut,
      estimatedCostUsd: estimatedCost,
      latencyMs,
      pruneApiKey: pruneApiKey ? "present" : "absent",
      timestamp: new Date().toISOString(),
    });

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

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, x-prune-api-key, openai-organization",
    },
  });
}
