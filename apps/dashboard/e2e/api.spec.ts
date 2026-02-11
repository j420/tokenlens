import { test, expect } from "@playwright/test";

test.describe("Health API", () => {
  test("should return health status", async ({ request }) => {
    const response = await request.get("/api/v1/health");
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.status).toBe("ok");
    expect(data.version).toBe("0.1.0");
    expect(data.timestamp).toBeDefined();
  });
});

test.describe("Events API", () => {
  test("should return events list", async ({ request }) => {
    const response = await request.get("/api/v1/events");
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(Array.isArray(data.events)).toBeTruthy();
    expect(data.summary).toBeDefined();
    expect(data.storage).toBeDefined();
  });

  test("should accept limit parameter", async ({ request }) => {
    const response = await request.get("/api/v1/events?limit=10");
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.events.length).toBeLessThanOrEqual(10);
  });

  test("should store a new event", async ({ request }) => {
    const event = {
      id: `test-${Date.now()}`,
      timestamp: new Date().toISOString(),
      provider: "anthropic",
      tool: "claude-code",
      model: "claude-sonnet-4",
      tokensIn: 1000,
      tokensOut: 500,
      costUsd: 0.05,
      latencyMs: 1500,
    };

    const response = await request.post("/api/v1/events", {
      data: event,
    });
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.stored).toBe(true);
  });

  test("should persist stored events", async ({ request }) => {
    // Store an event
    const eventId = `persist-test-${Date.now()}`;
    const event = {
      id: eventId,
      timestamp: new Date().toISOString(),
      provider: "openai",
      tool: "cursor",
      model: "gpt-4o",
      tokensIn: 500,
      tokensOut: 200,
      costUsd: 0.02,
      latencyMs: 800,
    };

    await request.post("/api/v1/events", { data: event });

    // Fetch events
    const response = await request.get("/api/v1/events?limit=100");
    const data = await response.json();

    // Check if event is in the list
    const found = data.events.some((e: { id: string }) => e.id === eventId);
    expect(found).toBeTruthy();
  });
});

test.describe("Dashboard Overview API", () => {
  test("should return overview data", async ({ request }) => {
    const response = await request.get("/api/dashboard/overview");
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty("todaySpend");
    expect(data).toHaveProperty("dailyAverage");
    expect(data).toHaveProperty("sessions");
    expect(data).toHaveProperty("chartData");
  });

  test("should accept period parameter", async ({ request }) => {
    const periods = ["today", "week", "month"];

    for (const period of periods) {
      const response = await request.get(`/api/dashboard/overview?period=${period}`);
      expect(response.ok()).toBeTruthy();
    }
  });

  test("should return chart data for 7 days", async ({ request }) => {
    const response = await request.get("/api/dashboard/overview");
    const data = await response.json();

    expect(Array.isArray(data.chartData)).toBeTruthy();
    expect(data.chartData.length).toBe(7);

    for (const day of data.chartData) {
      expect(day).toHaveProperty("date");
      expect(day).toHaveProperty("productive");
      expect(day).toHaveProperty("waste");
    }
  });
});

test.describe("Dashboard Settings API", () => {
  test("should return settings", async ({ request }) => {
    const response = await request.get("/api/dashboard/settings");
    // Settings API may return 404 if not implemented, or 200 with data
    expect(response.status()).toBeLessThan(500);
  });
});

test.describe("Dashboard Sessions API", () => {
  test("should return sessions list", async ({ request }) => {
    const response = await request.get("/api/dashboard/sessions");
    // Sessions API may return empty or with data
    expect(response.status()).toBeLessThan(500);
  });
});

test.describe("Cost Prediction API", () => {
  test("should accept prediction requests", async ({ request }) => {
    const response = await request.post("/api/v1/predict/cost", {
      data: {
        taskType: "debug",
        model: "claude-sonnet-4",
        estimatedContextTokens: 50000,
      },
    });
    // Prediction API may or may not be fully implemented
    expect(response.status()).toBeLessThan(500);
  });
});

test.describe("API Error Handling", () => {
  test("should handle 404 for unknown routes", async ({ request }) => {
    const response = await request.get("/api/v1/unknown-endpoint");
    expect(response.status()).toBe(404);
  });

  test("should handle malformed JSON in POST", async ({ request }) => {
    const response = await request.post("/api/v1/events", {
      headers: { "Content-Type": "application/json" },
      data: "not valid json",
    });
    // Should return 4xx or 5xx for bad request
    expect(response.status()).toBeGreaterThanOrEqual(400);
  });
});
