import { Hono } from "hono";
import { cors } from "hono/cors";
import { v4 as uuidv4 } from "uuid";
import type { Logger } from "pino";
import { logger, createRequestLogger } from "./lib/logger.js";
import { authMiddleware, type AuthContext } from "./middleware/auth.js";
import { anthropicRouter } from "./providers/anthropic.js";
import { openaiRouter } from "./providers/openai.js";
import { streamRouter } from "./stream/websocket.js";
import { dashboardRouter } from "./api/dashboard.js";
import { analyzeRouter } from "./api/analyze.js";
import { teamRouter } from "./api/team.js";

// Define the Variables type for context
type Variables = {
  correlationId: string;
  logger: Logger;
  auth?: AuthContext;
};

export const app = new Hono<{ Variables: Variables }>();

// Global middleware
app.use("*", cors());

// Add correlation ID to all requests
app.use("*", async (c, next) => {
  const correlationId = c.req.header("x-correlation-id") ?? uuidv4();
  c.set("correlationId", correlationId);
  c.set("logger", createRequestLogger(correlationId));
  c.header("x-correlation-id", correlationId);
  await next();
});

// Health check - no auth required
app.get("/api/v1/health", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "0.1.0",
  });
});

// WebSocket stream endpoint - no auth for now (auth via session ID)
// In production, you'd want to authenticate the WebSocket connection
app.route("/api/v1/stream", streamRouter);

// API routes requiring authentication
const api = new Hono<{ Variables: Variables }>();

// Apply auth middleware to all proxy routes
api.use("*", authMiddleware);

// Mount provider routers
api.route("/anthropic", anthropicRouter);
api.route("/openai", openaiRouter);

// Mount API under /api/v1/proxy
app.route("/api/v1/proxy", api);

// Dashboard API (requires auth)
const dashboardApi = new Hono<{ Variables: Variables }>();
dashboardApi.use("*", authMiddleware);
dashboardApi.route("/", dashboardRouter);
app.route("/api/v1/dashboard", dashboardApi);

// Context analysis API (requires auth)
const analyzeApi = new Hono<{ Variables: Variables }>();
analyzeApi.use("*", authMiddleware);
analyzeApi.route("/", analyzeRouter);
app.route("/api/v1/analyze", analyzeApi);

// Team management API (requires auth)
const teamApi = new Hono<{ Variables: Variables }>();
teamApi.use("*", authMiddleware);
teamApi.route("/", teamRouter);
app.route("/api/v1/team", teamApi);

// 404 handler
app.notFound((c) => {
  return c.json({ error: "Not found" }, 404);
});

// Error handler
app.onError((err, c) => {
  const reqLogger = c.get("logger") ?? logger;
  reqLogger.error({ err }, "Unhandled error");
  return c.json({ error: "Internal server error" }, 500);
});
