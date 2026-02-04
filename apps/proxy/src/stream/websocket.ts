import { Hono } from "hono";
import { createNodeWebSocket } from "@hono/node-ws";
import type { Logger } from "pino";
import { logger } from "../lib/logger.js";
import { streamPublisher, type StreamEvent } from "./publisher.js";

// Create the WebSocket upgrade helper
export const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({
  app: undefined as unknown as Hono, // Will be set when creating the router
});

export const streamRouter = new Hono<{
  Variables: {
    correlationId: string;
    logger: Logger;
  };
}>();

// WebSocket endpoint for real-time streaming
// Clients connect to /api/v1/stream/{session_id}
streamRouter.get(
  "/:sessionId",
  upgradeWebSocket((c) => {
    const sessionId = c.req.param("sessionId");
    const reqLogger = c.get("logger") ?? logger;

    reqLogger.info({ sessionId }, "WebSocket connection upgrading");

    let unsubscribe: (() => void) | null = null;

    return {
      onOpen(evt, ws) {
        reqLogger.info({ sessionId }, "WebSocket connection opened");

        // Subscribe to events for this session
        unsubscribe = streamPublisher.subscribe(sessionId, (event: StreamEvent) => {
          try {
            ws.send(JSON.stringify(event));
          } catch (err) {
            reqLogger.error({ err, sessionId }, "Failed to send WebSocket message");
          }
        });

        // Send initial connection confirmation
        ws.send(
          JSON.stringify({
            type: "connected",
            session_id: sessionId,
            timestamp: new Date().toISOString(),
          })
        );
      },

      onMessage(evt, ws) {
        // Handle ping/pong for keepalive
        try {
          const data = JSON.parse(evt.data.toString());
          if (data.type === "ping") {
            ws.send(JSON.stringify({ type: "pong", timestamp: new Date().toISOString() }));
          }
        } catch {
          // Ignore invalid messages
        }
      },

      onClose(evt, ws) {
        reqLogger.info({ sessionId }, "WebSocket connection closed");
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
      },

      onError(evt, ws) {
        reqLogger.error({ sessionId, error: evt }, "WebSocket error");
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
      },
    };
  })
);

// HTTP fallback for polling (if WebSocket not available)
streamRouter.get("/:sessionId/poll", async (c) => {
  const sessionId = c.req.param("sessionId");
  const timeout = parseInt(c.req.query("timeout") ?? "30000", 10);

  // Long-polling: wait for an event or timeout
  const events = await new Promise<StreamEvent[]>((resolve) => {
    const collectedEvents: StreamEvent[] = [];

    const unsubscribe = streamPublisher.subscribe(sessionId, (event) => {
      collectedEvents.push(event);
      // Return immediately when we get an event
      clearTimeout(timer);
      unsubscribe();
      resolve(collectedEvents);
    });

    const timer = setTimeout(() => {
      unsubscribe();
      resolve([]);
    }, Math.min(timeout, 30000)); // Max 30 seconds
  });

  return c.json({ events });
});
