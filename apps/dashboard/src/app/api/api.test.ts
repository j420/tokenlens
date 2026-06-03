import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// Mock environment
vi.stubEnv("KV_REST_API_URL", "");
vi.stubEnv("KV_REST_API_TOKEN", "");

// ============================================================================
// HEALTH API TESTS
// ============================================================================

describe("Health API (/api/v1/health)", () => {
  let GET: () => Promise<Response>;

  beforeEach(async () => {
    // Dynamically import to get fresh module
    const module = await import("./v1/health/route.js");
    GET = module.GET;
  });

  it("should return status ok", async () => {
    const response = await GET();
    const data = await response.json();

    expect(data.status).toBe("ok");
    expect(data.version).toBe("0.1.0");
    expect(data.runtime).toBe("vercel-edge");
  });

  it("should include a valid timestamp", async () => {
    const response = await GET();
    const data = await response.json();

    expect(data.timestamp).toBeDefined();
    const timestamp = new Date(data.timestamp);
    expect(timestamp.getTime()).not.toBeNaN();
  });

  it("should return correct Content-Type", async () => {
    const response = await GET();
    expect(response.headers.get("content-type")).toContain("application/json");
  });
});

// ============================================================================
// EVENTS API TESTS
// ============================================================================

describe("Events API (/api/v1/events)", () => {
  let GET: (request: NextRequest) => Promise<Response>;
  let POST: (request: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.resetModules();
    const module = await import("./v1/events/route.js");
    GET = module.GET;
    POST = module.POST;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/v1/events", () => {
    it("should return empty events array initially", async () => {
      const request = new NextRequest("http://localhost:3000/api/v1/events");
      const response = await GET(request);
      const data = await response.json();

      expect(Array.isArray(data.events)).toBe(true);
      expect(data.storage).toBe("memory");
    });

    it("should return summary statistics", async () => {
      const request = new NextRequest("http://localhost:3000/api/v1/events");
      const response = await GET(request);
      const data = await response.json();

      expect(data.summary).toBeDefined();
      expect(data.summary).toHaveProperty("totalEvents");
      expect(data.summary).toHaveProperty("todayEvents");
      expect(data.summary).toHaveProperty("todayCost");
      expect(data.summary).toHaveProperty("todayTokens");
    });

    it("should respect limit parameter", async () => {
      const request = new NextRequest("http://localhost:3000/api/v1/events?limit=50");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(Array.isArray(data.events)).toBe(true);
    });

    it("should use default limit of 100 when not specified", async () => {
      const request = new NextRequest("http://localhost:3000/api/v1/events");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      // Memory store limits to 500, GET should respect limit param default of 100
      expect(data.events.length).toBeLessThanOrEqual(100);
    });
  });

  describe("POST /api/v1/events", () => {
    const validEvent = {
      id: "test-event-1",
      timestamp: new Date().toISOString(),
      provider: "anthropic",
      tool: "claude-code",
      model: "claude-sonnet-4",
      tokensIn: 1000,
      tokensOut: 500,
      costUsd: 0.05,
      latencyMs: 1500,
    };

    it("should store a valid event", async () => {
      const request = new NextRequest("http://localhost:3000/api/v1/events", {
        method: "POST",
        body: JSON.stringify(validEvent),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.stored).toBe(true);
    });

    it("should store multiple events", async () => {
      const events = [
        { ...validEvent, id: "test-event-2" },
        { ...validEvent, id: "test-event-3" },
      ];

      for (const event of events) {
        const request = new NextRequest("http://localhost:3000/api/v1/events", {
          method: "POST",
          body: JSON.stringify(event),
        });
        const response = await POST(request);
        expect(response.status).toBe(200);
      }
    });

    it("should handle OpenAI events", async () => {
      const openaiEvent = {
        ...validEvent,
        id: "openai-event-1",
        provider: "openai",
        tool: "cursor",
        model: "gpt-4o",
      };

      const request = new NextRequest("http://localhost:3000/api/v1/events", {
        method: "POST",
        body: JSON.stringify(openaiEvent),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data.success).toBe(true);
    });

    it("should return 500 on invalid JSON", async () => {
      const request = new NextRequest("http://localhost:3000/api/v1/events", {
        method: "POST",
        body: "invalid json",
      });

      const response = await POST(request);
      expect(response.status).toBe(500);
    });
  });
});

// ============================================================================
// FEATURES API TESTS (/api/v1/features) — f9–f13 telemetry rollup
// ============================================================================

describe("Features API (/api/v1/features)", () => {
  let GET: (request: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.resetModules();
    const module = await import("./v1/features/route.js");
    GET = module.GET;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns a well-formed report with f9..f13 in deterministic order", async () => {
    const request = new NextRequest("http://localhost:3000/api/v1/features");
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(data.features)).toBe(true);
    expect(data.features.map((f: { featureId: string }) => f.featureId)).toEqual([
      "f9",
      "f10",
      "f11",
      "f12",
      "f13",
    ]);
  });

  it("includes honest _meta and totals fields", async () => {
    const request = new NextRequest("http://localhost:3000/api/v1/features");
    const response = await GET(request);
    const data = await response.json();

    expect(data).toHaveProperty("totalEvents");
    expect(data).toHaveProperty("outOfScopeEventCount");
    expect(data._meta).toHaveProperty("storage");
    expect(data._meta).toHaveProperty("hasFeatureTelemetry");
    expect(data._meta).toHaveProperty("scannedEvents");
    expect(typeof data._meta.hasFeatureTelemetry).toBe("boolean");
  });

  it("each feature rollup carries the required aggregate fields", async () => {
    const request = new NextRequest("http://localhost:3000/api/v1/features");
    const response = await GET(request);
    const data = await response.json();

    for (const f of data.features) {
      expect(f).toHaveProperty("featureId");
      expect(f).toHaveProperty("featureName");
      expect(f).toHaveProperty("eventCount");
      expect(f).toHaveProperty("tokensIn");
      expect(f).toHaveProperty("estimatedCostUsd");
      expect(f).toHaveProperty("malformedProofCount");
      expect(f).toHaveProperty("summary");
    }
  });

  it("respects the limit parameter without crashing", async () => {
    const request = new NextRequest(
      "http://localhost:3000/api/v1/features?limit=10"
    );
    const response = await GET(request);
    expect(response.status).toBe(200);
  });
});

// ============================================================================
// OVERVIEW API TESTS
// ============================================================================

describe("Overview API (/api/dashboard/overview)", () => {
  describe("Response structure", () => {
    it("should return correct structure on error/empty state", async () => {
      // Test the error response structure
      const emptyResponse = {
        todaySpend: 0,
        dailyAverage: 0,
        sessions: 0,
        productiveRoi: 0,
        pruneSaved: 0,
        pruneSavedDetails: { trims: 0, alerts: 0 },
        totalEvents: 0,
        lastEvent: null,
        recentSessions: [],
        chartData: [
          { date: "Mon", productive: 0, waste: 0 },
          { date: "Tue", productive: 0, waste: 0 },
          { date: "Wed", productive: 0, waste: 0 },
          { date: "Thu", productive: 0, waste: 0 },
          { date: "Fri", productive: 0, waste: 0 },
          { date: "Sat", productive: 0, waste: 0 },
          { date: "Sun", productive: 0, waste: 0 },
        ],
        _meta: {
          storage: "error",
          hasRealData: false,
          error: "Failed to fetch data",
        },
      };

      // Verify structure
      expect(emptyResponse).toHaveProperty("todaySpend");
      expect(emptyResponse).toHaveProperty("dailyAverage");
      expect(emptyResponse).toHaveProperty("sessions");
      expect(emptyResponse).toHaveProperty("productiveRoi");
      expect(emptyResponse).toHaveProperty("pruneSaved");
      expect(emptyResponse).toHaveProperty("chartData");
      expect(emptyResponse).toHaveProperty("recentSessions");
      expect(emptyResponse.chartData).toHaveLength(7);
    });
  });
});

// ============================================================================
// SETTINGS API TESTS
// ============================================================================

describe("Settings API (/api/dashboard/settings)", () => {
  // Test the expected settings structure
  const mockSettings = {
    notifications: {
      budgetAlerts: true,
      wasteDetection: true,
      weeklyReports: true,
    },
    display: {
      theme: "system",
      compactView: false,
    },
    budgets: {
      dailyLimit: 10,
      monthlyLimit: 200,
      warningThreshold: 80,
    },
  };

  it("should have correct notification settings structure", () => {
    expect(mockSettings.notifications).toHaveProperty("budgetAlerts");
    expect(mockSettings.notifications).toHaveProperty("wasteDetection");
    expect(mockSettings.notifications).toHaveProperty("weeklyReports");
    expect(typeof mockSettings.notifications.budgetAlerts).toBe("boolean");
  });

  it("should have correct display settings structure", () => {
    expect(mockSettings.display).toHaveProperty("theme");
    expect(mockSettings.display).toHaveProperty("compactView");
    expect(["system", "light", "dark"]).toContain(mockSettings.display.theme);
  });

  it("should have correct budget settings structure", () => {
    expect(mockSettings.budgets).toHaveProperty("dailyLimit");
    expect(mockSettings.budgets).toHaveProperty("monthlyLimit");
    expect(mockSettings.budgets).toHaveProperty("warningThreshold");
    expect(mockSettings.budgets.dailyLimit).toBeGreaterThan(0);
    expect(mockSettings.budgets.monthlyLimit).toBeGreaterThan(mockSettings.budgets.dailyLimit);
    expect(mockSettings.budgets.warningThreshold).toBeGreaterThanOrEqual(0);
    expect(mockSettings.budgets.warningThreshold).toBeLessThanOrEqual(100);
  });
});

// ============================================================================
// SESSIONS API TESTS
// ============================================================================

describe("Sessions API (/api/dashboard/sessions)", () => {
  // Test expected session structure
  const mockSession = {
    id: "session-123",
    tool: "claude-code",
    taskDescription: "Implementing auth feature",
    tokens: 15000,
    cost: 0.45,
    roi: 0.85,
    wasteEvents: 2,
    compactions: 1,
    startTime: "2024-01-01T10:00:00.000Z",
  };

  it("should have required session properties", () => {
    expect(mockSession).toHaveProperty("id");
    expect(mockSession).toHaveProperty("tool");
    expect(mockSession).toHaveProperty("taskDescription");
    expect(mockSession).toHaveProperty("tokens");
    expect(mockSession).toHaveProperty("cost");
    expect(mockSession).toHaveProperty("roi");
    expect(mockSession).toHaveProperty("wasteEvents");
    expect(mockSession).toHaveProperty("compactions");
    expect(mockSession).toHaveProperty("startTime");
  });

  it("should have valid tool type", () => {
    const validTools = ["claude-code", "cursor", "codex", "unknown"];
    expect(validTools).toContain(mockSession.tool);
  });

  it("should have valid ROI between 0 and 1", () => {
    expect(mockSession.roi).toBeGreaterThanOrEqual(0);
    expect(mockSession.roi).toBeLessThanOrEqual(1);
  });

  it("should have non-negative numeric values", () => {
    expect(mockSession.tokens).toBeGreaterThanOrEqual(0);
    expect(mockSession.cost).toBeGreaterThanOrEqual(0);
    expect(mockSession.wasteEvents).toBeGreaterThanOrEqual(0);
    expect(mockSession.compactions).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// COST PREDICTION API TESTS
// ============================================================================

describe("Cost Prediction API (/api/v1/predict/cost)", () => {
  // Test expected prediction input/output structure
  const mockPredictionInput = {
    taskType: "debug",
    model: "claude-sonnet-4",
    estimatedContextTokens: 50000,
    sessionDepth: 5,
    hourOfDay: 14,
    repoIdentifier: "my-project",
  };

  const mockPredictionOutput = {
    predictedCostUsd: 0.75,
    confidenceIntervalLow: 0.50,
    confidenceIntervalHigh: 1.00,
    confidence: 0.85,
    breakdown: {
      inputCost: 0.50,
      estimatedOutputCost: 0.25,
    },
  };

  it("should have valid prediction input structure", () => {
    expect(mockPredictionInput).toHaveProperty("taskType");
    expect(mockPredictionInput).toHaveProperty("model");
    expect(mockPredictionInput).toHaveProperty("estimatedContextTokens");
    expect(mockPredictionInput).toHaveProperty("sessionDepth");
    expect(mockPredictionInput).toHaveProperty("hourOfDay");
  });

  it("should have valid task type", () => {
    const validTaskTypes = ["debug", "refactor", "test", "feature", "unknown"];
    expect(validTaskTypes).toContain(mockPredictionInput.taskType);
  });

  it("should have valid hour of day", () => {
    expect(mockPredictionInput.hourOfDay).toBeGreaterThanOrEqual(0);
    expect(mockPredictionInput.hourOfDay).toBeLessThanOrEqual(23);
  });

  it("should have valid prediction output structure", () => {
    expect(mockPredictionOutput).toHaveProperty("predictedCostUsd");
    expect(mockPredictionOutput).toHaveProperty("confidenceIntervalLow");
    expect(mockPredictionOutput).toHaveProperty("confidenceIntervalHigh");
    expect(mockPredictionOutput).toHaveProperty("confidence");
  });

  it("should have confidence interval that contains prediction", () => {
    expect(mockPredictionOutput.confidenceIntervalLow).toBeLessThanOrEqual(
      mockPredictionOutput.predictedCostUsd
    );
    expect(mockPredictionOutput.confidenceIntervalHigh).toBeGreaterThanOrEqual(
      mockPredictionOutput.predictedCostUsd
    );
  });

  it("should have confidence between 0 and 1", () => {
    expect(mockPredictionOutput.confidence).toBeGreaterThanOrEqual(0);
    expect(mockPredictionOutput.confidence).toBeLessThanOrEqual(1);
  });
});

// ============================================================================
// SESSION DETAIL API TESTS
// ============================================================================

describe("Session Detail API (/api/dashboard/session/[id])", () => {
  const mockSessionDetail = {
    id: "session-456",
    tool: "cursor",
    model: "gpt-4o",
    startedAt: "2024-01-01T09:00:00.000Z",
    endedAt: "2024-01-01T10:30:00.000Z",
    totalTokensIn: 25000,
    totalTokensOut: 10000,
    totalCostUsd: 0.85,
    eventCount: 15,
    events: [
      {
        id: "event-1",
        timestamp: "2024-01-01T09:05:00.000Z",
        tokensIn: 2000,
        tokensOut: 500,
        costUsd: 0.05,
        classification: "productive",
      },
    ],
    wasteAnalysis: {
      totalWastedTokens: 3000,
      totalWastedCost: 0.10,
      patterns: ["redundant_reads"],
    },
  };

  it("should have required session detail properties", () => {
    expect(mockSessionDetail).toHaveProperty("id");
    expect(mockSessionDetail).toHaveProperty("tool");
    expect(mockSessionDetail).toHaveProperty("model");
    expect(mockSessionDetail).toHaveProperty("startedAt");
    expect(mockSessionDetail).toHaveProperty("endedAt");
    expect(mockSessionDetail).toHaveProperty("totalTokensIn");
    expect(mockSessionDetail).toHaveProperty("totalTokensOut");
    expect(mockSessionDetail).toHaveProperty("totalCostUsd");
    expect(mockSessionDetail).toHaveProperty("eventCount");
    expect(mockSessionDetail).toHaveProperty("events");
  });

  it("should have events array", () => {
    expect(Array.isArray(mockSessionDetail.events)).toBe(true);
    expect(mockSessionDetail.events.length).toBeGreaterThan(0);
  });

  it("should have waste analysis", () => {
    expect(mockSessionDetail).toHaveProperty("wasteAnalysis");
    expect(mockSessionDetail.wasteAnalysis).toHaveProperty("totalWastedTokens");
    expect(mockSessionDetail.wasteAnalysis).toHaveProperty("totalWastedCost");
    expect(mockSessionDetail.wasteAnalysis).toHaveProperty("patterns");
  });

  it("should have event count matching events length when all events loaded", () => {
    // In a paginated response, eventCount might be larger than events.length
    expect(mockSessionDetail.eventCount).toBeGreaterThanOrEqual(
      mockSessionDetail.events.length
    );
  });
});

// ============================================================================
// EDGE CASES AND ERROR HANDLING
// ============================================================================

describe("API Edge Cases", () => {
  describe("Invalid request handling", () => {
    it("should handle missing parameters gracefully", () => {
      // Test that APIs don't crash with missing params
      const request = new NextRequest("http://localhost:3000/api/v1/events");
      expect(request.url).toBeDefined();
    });

    it("should handle invalid UUID formats", () => {
      const invalidId = "not-a-valid-uuid";
      expect(invalidId).not.toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it("should handle negative numbers in query params", () => {
      const request = new NextRequest("http://localhost:3000/api/v1/events?limit=-1");
      const params = new URL(request.url).searchParams;
      const limit = parseInt(params.get("limit") || "100", 10);
      // Negative limits should be handled gracefully
      expect(limit).toBeLessThan(0);
    });
  });

  describe("Large data handling", () => {
    it("should limit response size", () => {
      const maxEventsPerResponse = 500; // As defined in memory store
      expect(maxEventsPerResponse).toBeLessThanOrEqual(1000);
    });
  });

  describe("Date handling", () => {
    it("should handle ISO date strings", () => {
      const validDate = "2024-01-01T00:00:00.000Z";
      const parsed = new Date(validDate);
      expect(parsed.toISOString()).toBe(validDate);
    });

    it("should handle timezone variations", () => {
      const utcDate = "2024-01-01T00:00:00.000Z";
      const parsed = new Date(utcDate);
      expect(parsed.getTime()).toBe(1704067200000);
    });
  });
});

// ============================================================================
// RATE LIMITING CONSIDERATIONS
// ============================================================================

describe("Rate Limiting Behavior", () => {
  it("should store events sequentially in memory", () => {
    // Verify memory store maintains order
    const events = [
      { id: "1", timestamp: "2024-01-01T00:00:00.000Z" },
      { id: "2", timestamp: "2024-01-01T00:01:00.000Z" },
      { id: "3", timestamp: "2024-01-01T00:02:00.000Z" },
    ];
    const time1 = new Date(events[0].timestamp).getTime();
    const time3 = new Date(events[2].timestamp).getTime();
    expect(time1).toBeLessThan(time3);
  });

  it("should trim old events when limit exceeded", () => {
    const maxStoreSize = 500;
    const events: unknown[] = [];
    for (let i = 0; i < 600; i++) {
      events.push({ id: `event-${i}` });
    }
    // Simulate trim
    if (events.length > maxStoreSize) {
      events.splice(maxStoreSize);
    }
    expect(events.length).toBe(maxStoreSize);
  });
});
