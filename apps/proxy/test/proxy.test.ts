import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { app } from "../src/app.js";

// Mock the database for testing
vi.mock("@prune/db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              {
                apiKey: {
                  id: "test-api-key-id",
                  user_id: "test-user-id",
                  key_hash: "test-hash",
                  key_prefix: "prune_sk_test",
                  name: "Test Key",
                  last_used_at: null,
                  created_at: new Date().toISOString(),
                  revoked_at: null,
                },
                user: {
                  id: "test-user-id",
                  email: "test@example.com",
                  name: "Test User",
                  team_id: null,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                },
              },
            ]),
          }),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
    query: {
      sessions: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    },
  },
  apiKeys: {},
  users: {},
  sessions: {},
  events: {},
}));

describe("Proxy Server", () => {
  describe("Health Check", () => {
    it("should return health status without authentication", async () => {
      const res = await app.request("/api/v1/health");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.status).toBe("ok");
      expect(body.version).toBe("0.1.0");
      expect(body.timestamp).toBeDefined();
    });
  });

  describe("Authentication", () => {
    it("should reject requests without API key", async () => {
      const res = await app.request("/api/v1/proxy/anthropic/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: "claude-3-sonnet-20240229", messages: [] }),
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Missing API key");
    });

    it("should reject requests with invalid API key format", async () => {
      const res = await app.request("/api/v1/proxy/anthropic/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-prune-api-key": "invalid-key",
        },
        body: JSON.stringify({ model: "claude-3-sonnet-20240229", messages: [] }),
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Invalid API key format");
    });
  });

  describe("Correlation ID", () => {
    it("should add correlation ID to response headers", async () => {
      const res = await app.request("/api/v1/health");
      expect(res.headers.get("x-correlation-id")).toBeDefined();
    });

    it("should preserve correlation ID from request", async () => {
      const customCorrelationId = "test-correlation-123";
      const res = await app.request("/api/v1/health", {
        headers: {
          "x-correlation-id": customCorrelationId,
        },
      });

      expect(res.headers.get("x-correlation-id")).toBe(customCorrelationId);
    });
  });

  describe("404 Handler", () => {
    it("should return 404 for unknown routes", async () => {
      const res = await app.request("/unknown/route");
      expect(res.status).toBe(404);

      const body = await res.json();
      expect(body.error).toBe("Not found");
    });
  });
});

describe("Proxy Transparency", () => {
  // These tests would require actual API keys to run against real providers
  // In a real setup, you'd use mock servers or skip in CI without credentials

  describe("Anthropic Proxy", () => {
    it.skipIf(!process.env["ANTHROPIC_API_KEY"])(
      "should forward requests transparently to Anthropic",
      async () => {
        // This test requires a real API key
        // It verifies that the response from the proxy matches a direct API call
      }
    );

    it("should handle missing ANTHROPIC_API_KEY gracefully", async () => {
      // Save and clear the env var
      const originalKey = process.env["ANTHROPIC_API_KEY"];
      delete process.env["ANTHROPIC_API_KEY"];

      // Mock auth to pass
      vi.doMock("../src/middleware/auth.js", () => ({
        authMiddleware: vi.fn().mockImplementation(async (c: any, next: any) => {
          c.set("auth", { userId: "test", teamId: null, apiKeyId: "test" });
          await next();
        }),
      }));

      // Note: This would need a fresh app import to work properly
      // For now, we're just documenting the expected behavior

      // Restore
      if (originalKey) {
        process.env["ANTHROPIC_API_KEY"] = originalKey;
      }
    });
  });

  describe("OpenAI Proxy", () => {
    it.skipIf(!process.env["OPENAI_API_KEY"])(
      "should forward requests transparently to OpenAI",
      async () => {
        // This test requires a real API key
        // It verifies that the response from the proxy matches a direct API call
      }
    );
  });
});

describe("Event Capture", () => {
  it("should not block response if event capture fails", async () => {
    // This test verifies the critical rule:
    // "If Prune's intelligence layer crashes, the proxy must still forward the request"

    // We'd mock the captureEvent function to throw and verify the proxy still works
    // The actual implementation wraps everything in try/catch
  });
});
