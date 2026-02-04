import { createMiddleware } from "hono/factory";
import { createHash } from "crypto";
import type { Logger } from "pino";
import { db, apiKeys, users } from "@prune/db";
import { eq, isNull, and } from "drizzle-orm";
import { API_KEY_PREFIX } from "@prune/shared";
import { logger } from "../lib/logger.js";

export interface AuthContext {
  userId: string;
  teamId: string | null;
  apiKeyId: string;
}

// Hash the API key for comparison
function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export const authMiddleware = createMiddleware<{
  Variables: {
    auth: AuthContext;
    correlationId: string;
    logger: Logger;
  };
}>(async (c, next) => {
  const apiKey =
    c.req.header("x-prune-api-key") ?? c.req.header("authorization")?.replace("Bearer ", "");

  if (!apiKey) {
    return c.json({ error: "Missing API key" }, 401);
  }

  // Validate key format
  if (!apiKey.startsWith(API_KEY_PREFIX)) {
    return c.json({ error: "Invalid API key format" }, 401);
  }

  try {
    const keyHash = hashApiKey(apiKey);

    // Look up the API key
    const result = await db
      .select({
        apiKey: apiKeys,
        user: users,
      })
      .from(apiKeys)
      .innerJoin(users, eq(apiKeys.user_id, users.id))
      .where(and(eq(apiKeys.key_hash, keyHash), isNull(apiKeys.revoked_at)))
      .limit(1);

    if (result.length === 0) {
      return c.json({ error: "Invalid or revoked API key" }, 401);
    }

    const { apiKey: foundKey, user } = result[0]!;

    // Update last used timestamp (fire and forget)
    db.update(apiKeys)
      .set({ last_used_at: new Date() })
      .where(eq(apiKeys.id, foundKey.id))
      .catch((err) => {
        logger.warn({ err, apiKeyId: foundKey.id }, "Failed to update API key last_used_at");
      });

    // Set auth context
    c.set("auth", {
      userId: user.id,
      teamId: user.team_id,
      apiKeyId: foundKey.id,
    });

    await next();
  } catch (err) {
    logger.error({ err }, "Auth middleware error");
    return c.json({ error: "Authentication failed" }, 500);
  }
});

// Utility to generate a new API key
export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const randomPart = createHash("sha256")
    .update(Math.random().toString() + Date.now().toString())
    .digest("hex")
    .substring(0, 32);

  const key = `${API_KEY_PREFIX}${randomPart}`;
  const hash = hashApiKey(key);
  const prefix = key.substring(0, API_KEY_PREFIX.length + 8);

  return { key, hash, prefix };
}
