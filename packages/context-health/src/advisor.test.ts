import { describe, expect, it } from "vitest";
import { buildAdvisory, inferPrimaryCause } from "./advisor.js";
import { ContextHealthDetector } from "./detector.js";
import { DEFAULT_CONFIG } from "./constants.js";
import { makeTurn } from "./test-helpers.js";
import type { DetectorObservation } from "./types.js";

const CFG = DEFAULT_CONFIG;

function observe(
  inputTokens: number,
  opts: Partial<{
    cacheReadTokens: number;
    toolUses: Array<{ name: string; input: unknown; id?: string }>;
    toolResults: Array<{ tool_use_id?: string; content: unknown }>;
  }> = {}
): DetectorObservation {
  const det = new ContextHealthDetector(CFG);
  const turn = makeTurn({
    turnNumber: 1,
    sessionId: "s",
    model: "claude-sonnet-4-5-20250929",
    inputTokens,
    cacheReadTokens: opts.cacheReadTokens,
    toolUses: opts.toolUses ?? [],
    toolResults: opts.toolResults ?? [],
  });
  return det.observe(turn, [turn]);
}

describe("buildAdvisory — null in healthy regime", () => {
  it("returns null for healthy observation", () => {
    const o = observe(60_000); // ecf=0.3 → healthy
    expect(buildAdvisory(o)).toBeNull();
  });

  it("returns null for insufficient_data", () => {
    const det = new ContextHealthDetector(CFG);
    // Don't observe anything — state is insufficient_data
    expect(det.current.cusum.regime).toBe("insufficient_data");
    // Construct a synthetic observation with insufficient_data regime
    const fakeObs: DetectorObservation = {
      turnNumber: 1,
      ecfSample: {
        turnNumber: 1,
        attendedInput: 0,
        discountedCacheRead: 0,
        committedOutput: 0,
        contextWindow: 200_000,
        ecf: 0.3,
        source: "exact",
      },
      cusum: det.current.cusum,
      signals: { cacheHitTrend: 0, scopeDriftSlope: 0, largeToolResultCause: null },
      skipped: false,
    };
    expect(buildAdvisory(fakeObs)).toBeNull();
  });
});

describe("buildAdvisory — warning text", () => {
  it("produces a warning advisory at ecf ~ 0.55", () => {
    const o = observe(110_000); // ecf = 0.55 → warning
    const a = buildAdvisory(o);
    expect(a).not.toBeNull();
    expect(a!.regime).toBe("warning");
    expect(a!.text).toContain("WARNING");
    expect(a!.text).toContain("Turn 1");
    expect(a!.text).toContain("55.0%");
    expect(a!.text).toContain("Chroma");
  });

  it("idempotent: same observation → byte-identical text", () => {
    const o1 = observe(110_000);
    const o2 = observe(110_000);
    const a1 = buildAdvisory(o1);
    const a2 = buildAdvisory(o2);
    expect(a1!.text).toBe(a2!.text);
  });
});

describe("buildAdvisory — critical text", () => {
  it("produces a critical advisory at ecf ~ 0.9", () => {
    const o = observe(180_000); // ecf = 0.9 → critical
    const a = buildAdvisory(o);
    expect(a).not.toBeNull();
    expect(a!.regime).toBe("critical");
    expect(a!.text).toContain("CRITICAL");
    expect(a!.text).toContain("90.0%");
  });
});

describe("inferPrimaryCause", () => {
  it("returns large_tool_result when a dominant tool result was seen", () => {
    const o = observe(180_000, {
      toolUses: [{ name: "Read", input: { file_path: "huge.json" }, id: "t1" }],
      toolResults: [
        { tool_use_id: "t1", content: "x".repeat(200_000) }, // ~10K tokens
      ],
    });
    expect(inferPrimaryCause(o)).toBe("large_tool_result");
  });

  it("defaults to rising_ecf when no secondary signal fires", () => {
    const o = observe(180_000); // pure attended input growth
    expect(inferPrimaryCause(o)).toBe("rising_ecf");
  });
});

describe("buildAdvisory — action choice", () => {
  it("warning + rising_ecf → trim_context", () => {
    const o = observe(110_000); // warning
    const a = buildAdvisory(o);
    expect(a!.suggestedAction).toBe("trim_context");
  });

  it("critical + large_tool_result → trim_context (don't compact away evidence)", () => {
    const o = observe(180_000, {
      toolUses: [{ name: "Read", input: { file_path: "huge.json" }, id: "t1" }],
      toolResults: [{ tool_use_id: "t1", content: "x".repeat(200_000) }],
    });
    const a = buildAdvisory(o);
    expect(a!.regime).toBe("critical");
    expect(a!.primaryCause).toBe("large_tool_result");
    expect(a!.suggestedAction).toBe("trim_context");
  });

  it("critical + rising_ecf → compact", () => {
    const o = observe(180_000);
    const a = buildAdvisory(o);
    expect(a!.suggestedAction).toBe("compact");
  });
});

describe("buildAdvisory — PII hygiene", () => {
  it("never includes tool input values in the advisory text", () => {
    const o = observe(180_000, {
      toolUses: [
        { name: "Read", input: { file_path: "/etc/secret/passwords.txt" }, id: "t1" },
      ],
      toolResults: [{ tool_use_id: "t1", content: "x".repeat(200_000) }],
    });
    const a = buildAdvisory(o);
    expect(a!.text).not.toContain("/etc/secret");
    expect(a!.text).not.toContain("passwords.txt");
  });

  it("never includes tool result content", () => {
    const secret = "my-real-jwt-token-abc123";
    const o = observe(180_000, {
      toolUses: [{ name: "Read", input: { file_path: "config.ts" }, id: "t1" }],
      toolResults: [
        { tool_use_id: "t1", content: secret + "y".repeat(200_000) },
      ],
    });
    const a = buildAdvisory(o);
    expect(a!.text).not.toContain(secret);
  });

  it("sanitizes a tool name with garbage characters", () => {
    const o = observe(180_000, {
      toolUses: [{ name: "Tool/with/slashes$and|pipes", input: {}, id: "t1" }],
      toolResults: [{ tool_use_id: "t1", content: "x".repeat(200_000) }],
    });
    const a = buildAdvisory(o);
    expect(a!.text).toContain("Toolwithslashesandpipes");
    // Garbage characters in the tool name (/, $, |) must not survive into
    // the rendered advisory. We don't assert on `;` because the static
    // evidence line legitimately includes one.
    expect(a!.text).not.toContain("/");
    expect(a!.text).not.toContain("$");
    expect(a!.text).not.toContain("|");
  });
});
