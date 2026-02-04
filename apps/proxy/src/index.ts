import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { logger } from "./lib/logger.js";

const port = parseInt(process.env["PORT"] ?? "3000", 10);

logger.info({ port }, "Starting Prune proxy server");

serve({
  fetch: app.fetch,
  port,
});

logger.info({ port }, `Prune proxy server listening on port ${port}`);
