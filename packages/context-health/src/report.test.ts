import { describe, expect, it } from "vitest";
import { buildReport } from "./report.js";
import { makeTurn, rampSession } from "./test-helpers.js";

describe("buildReport — basic shape", () => {
  it("reports insufficient_data for empty turn stream", () => {
    const r = buildReport([]);
    expect(r.regime).toBe("insufficient_data");
    expect(r.source).toBe("insufficient_data");
    expect(r.ecfCurrent).toBeNull();
    expect(r.ecfSeries).toEqual([]);
    expect(r.totalTurns).toBe(0);
    expect(r.observedTurns).toBe(0);
    expect(r.primaryCause).toBeNull();
  });

  it("reports insufficient_data for a single turn (cannot detect trend)", () => {
    const turns = [makeTurn({ turnNumber: 1, inputTokens: 60_000 })];
    const r = buildReport(turns);
    expect(r.regime).toBe("insufficient_data");
  });

  it("reports healthy regime for a low-ECF session", () => {
    const turns = rampSession({
      count: 5,
      startEcf: 0.2,
      endEcf: 0.3,
      contextWindow: 200_000,
    });
    const r = buildReport(turns);
    expect(r.regime).toBe("healthy");
    expect(r.source).toBe("exact");
    expect(r.ecfCurrent).toBeCloseTo(0.3, 6);
    expect(r.primaryCause).toBeNull();
  });

  it("reports warning regime when ECF crosses 50%", () => {
    const turns = rampSession({
      count: 6,
      startEcf: 0.3,
      endEcf: 0.6,
      contextWindow: 200_000,
    });
    const r = buildReport(turns);
    expect(r.regime).toBe("warning");
    expect(r.primaryCause).toBe("rising_ecf");
    expect(r.ecfCurrent).toBeCloseTo(0.6, 6);
  });

  it("reports critical regime when ECF crosses 75%", () => {
    const turns = rampSession({
      count: 6,
      startEcf: 0.3,
      endEcf: 0.9,
      contextWindow: 200_000,
    });
    const r = buildReport(turns);
    expect(r.regime).toBe("critical");
  });

  it("populates model and modelWindow from the dominant model", () => {
    const turns = rampSession({
      count: 4,
      startEcf: 0.2,
      endEcf: 0.4,
      contextWindow: 200_000,
      model: "claude-sonnet-4-5-20250929",
    });
    const r = buildReport(turns);
    expect(r.model).toBe("claude-sonnet-4-5-20250929");
    expect(r.modelWindow).toBe(200_000);
  });
});

describe("buildReport — sources", () => {
  it("reports source=unknown_window when every turn uses an unknown model", () => {
    const turns = [
      makeTurn({ turnNumber: 1, model: "unknown-x", inputTokens: 10_000 }),
      makeTurn({ turnNumber: 2, model: "unknown-x", inputTokens: 20_000 }),
    ];
    const r = buildReport(turns);
    expect(r.source).toBe("unknown_window");
    expect(r.regime).toBe("insufficient_data");
  });

  it("a mixed stream still computes regime on the exact subset", () => {
    const turns = [
      makeTurn({
        turnNumber: 1,
        model: "claude-sonnet-4-5-20250929",
        inputTokens: 110_000, // ECF = 0.55
      }),
      makeTurn({
        turnNumber: 2,
        model: "claude-sonnet-4-5-20250929",
        inputTokens: 110_000,
      }),
      makeTurn({ turnNumber: 3, model: "unknown-y", inputTokens: 10_000 }),
    ];
    const r = buildReport(turns);
    expect(r.source).toBe("exact");
    expect(r.regime).toBe("warning");
    expect(r.skippedTurns).toBe(1);
    expect(r.observedTurns).toBe(2);
  });
});

describe("buildReport — JSON-stringifies cleanly", () => {
  it("can be JSON.stringify'd without throwing", () => {
    const turns = rampSession({
      count: 5,
      startEcf: 0.3,
      endEcf: 0.9,
      contextWindow: 200_000,
    });
    const r = buildReport(turns);
    expect(() => JSON.stringify(r)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(r));
    expect(parsed.regime).toBe("critical");
    expect(parsed.ecfSeries.length).toBe(5);
  });
});
