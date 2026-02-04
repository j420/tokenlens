import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { app } from "./app.js";
import { logger } from "./lib/logger.js";
import { startWasteDetectionWorker, stopWasteDetectionWorker } from "./waste/queue.js";

const port = parseInt(process.env["PORT"] ?? "3000", 10);

// Create WebSocket server
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// Re-export upgradeWebSocket for use in the stream router
export { upgradeWebSocket };

logger.info({ port }, "Starting Prune proxy server");

// Start the waste detection worker
startWasteDetectionWorker();

// Create HTTP server with WebSocket support
const server = serve({
  fetch: app.fetch,
  port,
});

// Inject WebSocket handling into the server
injectWebSocket(server);

logger.info({ port }, `Prune proxy server listening on port ${port}`);

// Graceful shutdown
async function shutdown() {
  logger.info("Shutting down...");
  await stopWasteDetectionWorker();
  server.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
