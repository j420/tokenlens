import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Logger } from "pino";
import { logger } from "../lib/logger.js";
import type { AuthContext } from "../middleware/auth.js";
import { captureEvent, getOrCreateSession } from "../events/capture.js";
import { detectTool } from "../lib/tool-detection.js";
import { preflightAnalysis, getPruneSuggestion } from "../middleware/preflight.js";
import { publishPruneSuggestion, type PruneSuggestionEvent } from "../stream/publisher.js";

const ANTHROPIC_API_URL = "https://api.anthropic.com";

export const anthropicRouter = new Hono<{
  Variables: {
    auth: AuthContext;
    correlationId: string;
    logger: Logger;
    pruneSuggestion?: PruneSuggestionEvent;
    preflightAnalysis?: {
      totalTokens: number;
      relevantTokens: number;
      noiseTokens: number;
      processingTimeMs: number;
    };
  };
}>();

// Apply pre-flight analysis middleware to POST requests (the messages endpoint)
anthropicRouter.post("/*", preflightAnalysis({ enabled: true, timeoutMs: 50 }));

// Handle all Anthropic API routes
anthropicRouter.all("/*", async (c) => {
  const reqLogger = c.get("logger");
  const auth = c.get("auth");
  const startTime = Date.now();

  // Get the path after /anthropic
  const path = c.req.path.replace(/^\/api\/v1\/proxy\/anthropic/, "");
  const targetUrl = `${ANTHROPIC_API_URL}${path}`;

  // Get the original request body
  let requestBody: string | undefined;
  let parsedBody: Record<string, unknown> | undefined;

  if (c.req.method === "POST" || c.req.method === "PUT" || c.req.method === "PATCH") {
    requestBody = await c.req.text();
    try {
      parsedBody = JSON.parse(requestBody);
    } catch {
      // Not JSON, that's fine
    }
  }

  // Check if streaming is requested
  const isStreaming = parsedBody?.["stream"] === true;
  const model = (parsedBody?.["model"] as string) ?? "unknown";

  // Detect which tool is making the request
  const tool = detectTool(c.req.header("user-agent"));

  // Get or create a session
  let sessionId: string;
  try {
    sessionId = await getOrCreateSession({
      userId: auth.userId,
      teamId: auth.teamId,
      provider: "anthropic",
      tool,
      model,
    });
  } catch {
    sessionId = crypto.randomUUID();
  }

  // Check for prune suggestion from pre-flight analysis and publish if present
  const pruneSuggestion = getPruneSuggestion(c);
  if (pruneSuggestion) {
    reqLogger.info(
      { sessionId, estimatedSavings: pruneSuggestion.estimated_savings_usd },
      "Publishing prune suggestion"
    );
    publishPruneSuggestion(sessionId, pruneSuggestion);
  }

  // Forward headers, replacing the API key with the real one
  const headers = new Headers();
  const anthropicApiKey = process.env["ANTHROPIC_API_KEY"];

  if (!anthropicApiKey) {
    reqLogger.error("ANTHROPIC_API_KEY not configured");
    return c.json({ error: "Proxy not configured for Anthropic" }, 500);
  }

  // Copy relevant headers
  for (const [key, value] of c.req.raw.headers.entries()) {
    // Skip headers we'll set ourselves
    if (
      key.toLowerCase() === "host" ||
      key.toLowerCase() === "x-prune-api-key" ||
      key.toLowerCase() === "authorization" ||
      key.toLowerCase() === "content-length"
    ) {
      continue;
    }
    headers.set(key, value);
  }

  // Set the real Anthropic API key
  headers.set("x-api-key", anthropicApiKey);
  headers.set("anthropic-version", c.req.header("anthropic-version") ?? "2023-06-01");

  reqLogger.info(
    { targetUrl, method: c.req.method, isStreaming, model, sessionId },
    "Proxying request to Anthropic"
  );

  try {
    // Make the request to Anthropic
    const response = await fetch(targetUrl, {
      method: c.req.method,
      headers,
      body: requestBody,
    });

    // Copy response headers
    const responseHeaders = new Headers();
    for (const [key, value] of response.headers.entries()) {
      // Skip transfer-encoding as Hono handles this
      if (key.toLowerCase() === "transfer-encoding") continue;
      responseHeaders.set(key, value);
    }

    // Handle streaming responses
    if (isStreaming && response.body) {
      // Set SSE headers
      c.header("Content-Type", "text/event-stream");
      c.header("Cache-Control", "no-cache");
      c.header("Connection", "keep-alive");

      // Copy other response headers
      for (const [key, value] of responseHeaders.entries()) {
        if (!["content-type", "cache-control", "connection"].includes(key.toLowerCase())) {
          c.header(key, value);
        }
      }

      return streamSSE(c, async (stream) => {
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let tokensIn = 0;
        let tokensOut = 0;
        let tokensCached = 0;

        try {
          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              // Capture the event after streaming completes
              const latencyMs = Date.now() - startTime;
              captureEvent({
                sessionId,
                userId: auth.userId,
                teamId: auth.teamId,
                provider: "anthropic",
                tool,
                model,
                tokensIn,
                tokensOut,
                tokensCached,
                latencyMs,
              });
              break;
            }

            // Decode the chunk
            const chunk = decoder.decode(value, { stream: true });
            buffer += chunk;

            // Parse SSE events to extract token usage and forward
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const data = line.slice(6);

                // Forward the raw line (we'll writeSSE manually for better control)
                await stream.writeSSE({ data });

                if (data === "[DONE]") continue;

                try {
                  const event = JSON.parse(data);

                  // Extract usage from message_delta or message_stop events
                  if (event.type === "message_delta" && event.usage) {
                    tokensOut = event.usage.output_tokens ?? tokensOut;
                  }
                  if (event.type === "message_start" && event.message?.usage) {
                    tokensIn = event.message.usage.input_tokens ?? tokensIn;
                    tokensCached = event.message.usage.cache_read_input_tokens ?? 0;
                  }
                  if (event.type === "message_stop" || event.type === "message_delta") {
                    if (event.usage) {
                      tokensOut = event.usage.output_tokens ?? tokensOut;
                    }
                  }
                } catch {
                  // Not valid JSON, ignore
                }
              } else if (line.startsWith("event: ")) {
                // Forward event lines too
                const eventType = line.slice(7);
                // Event type will be picked up by next data line
              } else if (line.trim() !== "") {
                // Forward any other non-empty lines
              }
            }
          }
        } catch (err) {
          reqLogger.error({ err }, "Error during streaming");
          throw err;
        } finally {
          reader.releaseLock();
        }
      });
    }

    // Non-streaming response
    const responseBody = await response.text();
    const latencyMs = Date.now() - startTime;

    // Try to extract token usage from response
    let tokensIn = 0;
    let tokensOut = 0;
    let tokensCached = 0;

    try {
      const responseJson = JSON.parse(responseBody);
      if (responseJson.usage) {
        tokensIn = responseJson.usage.input_tokens ?? 0;
        tokensOut = responseJson.usage.output_tokens ?? 0;
        tokensCached = responseJson.usage.cache_read_input_tokens ?? 0;
      }
    } catch {
      // Not JSON or no usage field
    }

    // Capture the event (fire and forget - never blocks response)
    captureEvent({
      sessionId,
      userId: auth.userId,
      teamId: auth.teamId,
      provider: "anthropic",
      tool,
      model,
      tokensIn,
      tokensOut,
      tokensCached,
      latencyMs,
    });

    reqLogger.info(
      { statusCode: response.status, latencyMs, tokensIn, tokensOut },
      "Anthropic request completed"
    );

    return new Response(responseBody, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (err) {
    reqLogger.error({ err }, "Error proxying to Anthropic");

    // Even if we fail, try to forward the error gracefully
    return c.json(
      { error: "Proxy error", message: err instanceof Error ? err.message : "Unknown error" },
      502
    );
  }
});
