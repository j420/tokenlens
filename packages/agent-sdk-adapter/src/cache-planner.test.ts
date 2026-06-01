/**
 * Cache-breakpoint planner: the dollar-saving + safety-critical core.
 *
 * The tests prove the four soundness rules and the boundary cases that would
 * silently waste money or, worse, leak volatile content into a cacheable
 * prefix and produce stale responses.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_MIN_CACHEABLE_TOKENS,
  minCacheableForModel,
  planBreakpoints,
  prefixFingerprint,
} from "./cache-planner.js";
import {
  message,
  stableText,
  tool,
  toolResult,
  toolUse,
  volatileText,
} from "./content.js";
import type { MessageRequest } from "./types.js";

const SONNET = "claude-sonnet-4-5-20250929";

/** Build a stable text block padded to the given token target (≈ chars/4). */
function pad(textBase: string, targetTokens: number) {
  // Aim slightly above target to clear the threshold consistently.
  const chars = Math.max(1, targetTokens * 4 + 16);
  return stableText(textBase + ".".repeat(chars - textBase.length));
}

function baseRequest(overrides: Partial<MessageRequest> = {}): MessageRequest {
  return {
    model: SONNET,
    provider: "anthropic",
    system: [stableText("rules")],
    tools: [],
    messages: [message("user", stableText("hi"))],
    maxOutputTokens: 256,
    ...overrides,
  };
}

describe("minCacheableForModel", () => {
  it("returns the documented sonnet minimum (1024)", () => {
    expect(minCacheableForModel(SONNET)).toBe(
      DEFAULT_MIN_CACHEABLE_TOKENS.sonnet
    );
  });
  it("returns the documented opus minimum (4096)", () => {
    expect(minCacheableForModel("claude-opus-4-5")).toBe(
      DEFAULT_MIN_CACHEABLE_TOKENS.opus
    );
  });
  it("returns conservative default for unknown models", () => {
    expect(minCacheableForModel("future-model")).toBe(
      DEFAULT_MIN_CACHEABLE_TOKENS.default
    );
  });
});

describe("planBreakpoints — soundness", () => {
  it("places NO breakpoint when no stable run clears the minimum prefix", () => {
    const req = baseRequest({
      system: [stableText("tiny")],
      tools: [tool("t", "desc", { type: "object" }, "stable")],
    });
    const plan = planBreakpoints(req);
    expect(plan.breakpoints).toHaveLength(0);
    expect(plan.cacheablePrefixTokens).toBe(0);
    // and we EXPLAIN why
    expect(plan.rejected.some((r) => /min cacheable/.test(r.reason))).toBe(true);
  });

  it("places a breakpoint at the end of every stable segment run that clears min", () => {
    // A single stable run spans system → (trivial stable) messages. The
    // provider lets us anchor at the end of each segment in the prefix; the
    // planner offers both for cache resilience (cumulativeTokens monotone).
    const req = baseRequest({
      system: [pad("rules ", 1100)], // > sonnet 1024 minimum
    });
    const plan = planBreakpoints(req);
    expect(plan.breakpoints.length).toBeGreaterThanOrEqual(1);
    // At least one of them must anchor the system block.
    expect(
      plan.breakpoints.some(
        (b) => b.segment === "system" && b.blockIndex === 0
      )
    ).toBe(true);
    // cacheablePrefixTokens reflects the LARGEST span reached.
    expect(plan.cacheablePrefixTokens).toBeGreaterThanOrEqual(1024);
    // Each breakpoint's cumulativeTokens is monotone in afterIndex.
    for (let i = 1; i < plan.breakpoints.length; i++) {
      expect(
        plan.breakpoints[i].cumulativeTokens
      ).toBeGreaterThanOrEqual(plan.breakpoints[i - 1].cumulativeTokens);
    }
  });

  it("NEVER places a breakpoint on or after a volatile block", () => {
    const req = baseRequest({
      system: [pad("rules ", 1100), volatileText("timestamp: 2026-06-01")],
      tools: [tool("t", "desc", { type: "object" }, "stable")],
    });
    const plan = planBreakpoints(req);
    // No breakpoint may reference the volatile system block (index 1).
    for (const bp of plan.breakpoints) {
      const isVolatileSlot = bp.segment === "system" && bp.blockIndex === 1;
      expect(isVolatileSlot).toBe(false);
    }
    // The volatile block is in the rejected list with a clear reason.
    expect(
      plan.rejected.some(
        (r) =>
          r.segment === "system" &&
          r.blockIndex === 1 &&
          /volatile/i.test(r.reason)
      )
    ).toBe(true);
  });

  it("RESETS the running prefix at a volatile boundary (no extension across it)", () => {
    // Two stable runs separated by a volatile block. The second run must
    // independently clear the minimum to earn its own breakpoint.
    const req = baseRequest({
      system: [
        pad("first ", 1100), // stable run A: above threshold
        volatileText("session id"), // boundary
        pad("second", 200), // stable run B: BELOW threshold
      ],
    });
    const plan = planBreakpoints(req);
    // Only ONE breakpoint (run A); run B is too small.
    expect(plan.breakpoints).toHaveLength(1);
    expect(plan.breakpoints[0].blockIndex).toBe(0);
    expect(
      plan.rejected.some(
        (r) =>
          r.segment === "system" &&
          r.blockIndex === 2 &&
          /min cacheable/.test(r.reason)
      )
    ).toBe(true);
  });

  it("honors the maxBreakpoints ceiling and KEEPS the largest spans", () => {
    // 6 stable runs separated by volatile blocks, all above the min. With
    // maxBreakpoints=4 the four LATEST (largest cumulative) candidates win.
    const sys = [];
    for (let i = 0; i < 6; i++) {
      sys.push(pad(`run-${i} `, 1100));
      sys.push(volatileText(`marker-${i}`));
    }
    const req = baseRequest({ system: sys });
    const plan = planBreakpoints(req);
    expect(plan.breakpoints).toHaveLength(4);
    // The four chosen are runs 2,3,4,5 (latest). Earlier runs are rejected.
    const chosenIndices = plan.breakpoints
      .map((b) => b.blockIndex)
      .sort((a, b) => a - b); // numeric sort, not the default lexicographic
    expect(chosenIndices).toEqual([4, 6, 8, 10]);
    expect(
      plan.rejected.some((r) => /maxBreakpoints/.test(r.reason))
    ).toBe(true);
  });

  it("treats a message as volatile if ANY of its blocks is volatile", () => {
    // The user message contains one volatile content block. The whole
    // message must be ineligible for a breakpoint.
    const req = baseRequest({
      system: [pad("rules", 1100)],
      messages: [message("user", stableText("base"), volatileText("now"))],
    });
    const plan = planBreakpoints(req);
    expect(
      plan.breakpoints.some(
        (b) => b.segment === "messages" && b.blockIndex === 0
      )
    ).toBe(false);
  });

  it("an empty messages array still surfaces a system-segment breakpoint", () => {
    const req = baseRequest({
      system: [pad("rules", 1100)],
      messages: [],
    });
    const plan = planBreakpoints(req);
    expect(plan.breakpoints).toHaveLength(1);
    expect(plan.breakpoints[0].segment).toBe("system");
  });
});

describe("planBreakpoints — determinism", () => {
  it("same inputs ⇒ same plan ⇒ same fingerprint (required for cache hits)", () => {
    const req = baseRequest({ system: [pad("rules", 1100)] });
    const a = planBreakpoints(req);
    const b = planBreakpoints(req);
    expect(a).toEqual(b);
    expect(prefixFingerprint(req, a)).toBe(prefixFingerprint(req, b));
  });

  it("any drift in stable content changes the fingerprint", () => {
    const req1 = baseRequest({ system: [pad("rules-A", 1100)] });
    const req2 = baseRequest({ system: [pad("rules-B", 1100)] });
    expect(prefixFingerprint(req1, planBreakpoints(req1))).not.toBe(
      prefixFingerprint(req2, planBreakpoints(req2))
    );
  });
});

describe("planBreakpoints — TTL routing", () => {
  it("defaults to 5m (cheap writes)", () => {
    const req = baseRequest({ system: [pad("rules", 1100)] });
    const plan = planBreakpoints(req);
    expect(plan.breakpoints[0].ttl).toBe("5m");
  });
  it("respects defaultTtl: '1h'", () => {
    const req = baseRequest({ system: [pad("rules", 1100)] });
    const plan = planBreakpoints(req, { defaultTtl: "1h" });
    expect(plan.breakpoints[0].ttl).toBe("1h");
  });
});

describe("planBreakpoints — degenerate inputs", () => {
  it("zero system + tools + messages: empty plan, no crash", () => {
    const plan = planBreakpoints(
      baseRequest({ system: [], tools: [], messages: [] })
    );
    expect(plan.breakpoints).toEqual([]);
    expect(plan.cacheablePrefixTokens).toBe(0);
  });
  it("tool with an entirely volatile schema slot does not anchor a breakpoint", () => {
    const req = baseRequest({
      system: [],
      tools: [tool("t1", "desc", { type: "object" }, "volatile")],
    });
    const plan = planBreakpoints(req);
    expect(
      plan.breakpoints.some(
        (b) => b.segment === "tools" && b.blockIndex === 0
      )
    ).toBe(false);
  });
});

describe("planBreakpoints — interleaved tool messages (the realistic agent loop)", () => {
  it("a tool_result follows a stable system+tools prefix ⇒ breakpoint sits before tool I/O", () => {
    const req = baseRequest({
      system: [pad("rules", 1100)],
      tools: [tool("read", "Read a file", { type: "object" }, "stable")],
      messages: [
        message(
          "assistant",
          stableText("calling read"),
          toolUse("tu_1", "read", { file_path: "a.ts" })
        ),
        message("user", toolResult("tu_1", "file contents...")),
      ],
    });
    const plan = planBreakpoints(req);
    // No breakpoint on the tool_use or tool_result messages (both volatile).
    for (const bp of plan.breakpoints) {
      expect(bp.segment).not.toBe("messages");
    }
    // The system prefix is still cached.
    expect(
      plan.breakpoints.some((b) => b.segment === "system" && b.blockIndex === 0)
    ).toBe(true);
  });
});
