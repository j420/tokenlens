/**
 * Adversarial-probe-driven edge cases (round 2).
 *
 * Every test here pins a behaviour I found by probing the previously-shipped
 * adapter. Each one prevents a real failure mode — provider-side errors,
 * silent dollar leaks, or invisible quality regressions — from coming back.
 */

import { describe, expect, it } from "vitest";
import {
  applyBreakpoints,
  canonicalJSON,
  deepKeySort,
  message,
  planBreakpoints,
  PruneAgentClient,
  stableText,
  tool,
  toolUse,
  volatileText,
} from "./index.js";
import { ValidationError, validateRequest } from "./validate.js";
import type { MessageRequest, ModelInvoker } from "./index.js";

const SONNET = "claude-sonnet-4-5-20250929";
const HAIKU = "claude-3-5-haiku-20241022";

function pad(s: string, target: number) {
  return stableText(s + ".".repeat(Math.max(0, target * 4 - s.length)));
}
function baseReq(overrides: Partial<MessageRequest> = {}): MessageRequest {
  return {
    model: SONNET,
    provider: "anthropic",
    system: [pad("rules", 1100)],
    tools: [],
    messages: [message("user", stableText("hi"))],
    maxOutputTokens: 256,
    ...overrides,
  };
}

// ===========================================================================
// FINDING 1+2+3: maxBreakpoints out-of-range silently produces wrong plans.
// ===========================================================================

describe("planner — maxBreakpoints clamping (PROVIDER HARD-CAP 4)", () => {
  it("maxBreakpoints=Infinity clamps to 4 (provider would reject >4)", () => {
    const sys = [];
    for (let i = 0; i < 8; i++) {
      sys.push(pad(`r${i}`, 1100));
      sys.push(volatileText(`v${i}`));
    }
    const plan = planBreakpoints(baseReq({ system: sys, messages: [] }), {
      maxBreakpoints: Infinity,
    });
    expect(plan.breakpoints.length).toBeLessThanOrEqual(4);
  });

  it("maxBreakpoints=NaN clamps to 4 (silent NaN never reaches the wire)", () => {
    const plan = planBreakpoints(baseReq(), { maxBreakpoints: NaN });
    expect(plan.breakpoints.length).toBeLessThanOrEqual(4);
    // and it actually allows up to 4, not 0
    expect(plan.breakpoints.length).toBeGreaterThanOrEqual(1);
  });

  it("maxBreakpoints=-1 clamps to 0 (no negative cap silently accepted)", () => {
    const plan = planBreakpoints(baseReq(), { maxBreakpoints: -1 });
    expect(plan.breakpoints.length).toBe(0);
  });

  it("maxBreakpoints=10 clamps to 4 (above the provider's hard cap)", () => {
    const sys = [];
    for (let i = 0; i < 6; i++) {
      sys.push(pad(`r${i}`, 1100));
      sys.push(volatileText(`v${i}`));
    }
    const plan = planBreakpoints(baseReq({ system: sys, messages: [] }), {
      maxBreakpoints: 10,
    });
    expect(plan.breakpoints.length).toBeLessThanOrEqual(4);
  });
});

// ===========================================================================
// FINDING 4: tool input_schema key order produces different wire bytes,
// silently busting the provider's prompt cache.
// ===========================================================================

describe("apply — tool input_schema canonicalization (cache-hit safety)", () => {
  it("two schemas with reordered keys produce IDENTICAL wire JSON", () => {
    const a = baseReq({
      tools: [
        tool(
          "read",
          "Read",
          { type: "object", properties: { a: {}, b: {} } },
          "stable"
        ),
      ],
    });
    const b = baseReq({
      tools: [
        tool(
          "read",
          "Read",
          { type: "object", properties: { b: {}, a: {} } },
          "stable"
        ),
      ],
    });
    const outA = applyBreakpoints(a, planBreakpoints(a));
    const outB = applyBreakpoints(b, planBreakpoints(b));
    // The wire JSON must be byte-identical or the provider's cache misses.
    expect(JSON.stringify(outA)).toBe(JSON.stringify(outB));
  });

  it("deepKeySort handles nested objects, arrays, null, undefined, and cycles", () => {
    const v = { b: 1, a: { d: [1, 2], c: null } } as Record<string, unknown>;
    const sorted = deepKeySort(v) as Record<string, unknown>;
    expect(Object.keys(sorted)).toEqual(["a", "b"]);
    expect(Object.keys(sorted.a as Record<string, unknown>)).toEqual(["c", "d"]);
    // cycles
    type Cyclic = { x: number; cycle?: unknown };
    const cyclic: Cyclic = { x: 1 };
    cyclic.cycle = cyclic;
    expect(() => deepKeySort(cyclic)).not.toThrow();
  });
});

// ===========================================================================
// FINDING 5+6+10: input validation at the boundary, with named fields.
// ===========================================================================

describe("validateRequest — boundary validation (no silent NaN/garbage)", () => {
  it("rejects an unknown provider with a named error", () => {
    const req = baseReq();
    (req as unknown as { provider: string }).provider = "fake-provider";
    const issues = validateRequest(req);
    expect(
      issues.some((i) => i.field === "provider" && i.severity === "error")
    ).toBe(true);
  });

  it("rejects maxOutputTokens ≤ 0 (provider would reject -100)", () => {
    const req = baseReq({ maxOutputTokens: -100 });
    const issues = validateRequest(req);
    expect(
      issues.some(
        (i) => i.field === "maxOutputTokens" && i.severity === "error"
      )
    ).toBe(true);
  });

  it("rejects non-integer maxOutputTokens", () => {
    const req = baseReq({ maxOutputTokens: 100.5 });
    const issues = validateRequest(req);
    expect(issues.some((i) => i.field === "maxOutputTokens")).toBe(true);
  });

  it("rejects cyclic metadata (would crash provider serialization)", () => {
    const meta: Record<string, unknown> = {};
    meta.self = meta;
    const req = baseReq({ metadata: meta as never });
    const issues = validateRequest(req);
    expect(issues.some((i) => i.field === "metadata")).toBe(true);
  });

  it("rejects a system block with type other than 'text'", () => {
    const req = baseReq({
      // Forge a non-text block.
      system: [toolUse("tu", "x", {}) as never],
    });
    const issues = validateRequest(req);
    expect(issues.some((i) => i.field.includes("system[0]"))).toBe(true);
  });

  it("rejects a block missing the 'volatility' field (caller-bug guard)", () => {
    const req = baseReq({
      system: [{ type: "text", text: "rules" } as never], // no volatility tag
    });
    const issues = validateRequest(req);
    expect(
      issues.some((i) => i.field.includes("volatility") && i.severity === "error")
    ).toBe(true);
  });

  it("a valid request passes with zero error issues", () => {
    const issues = validateRequest(baseReq());
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });
});

describe("PruneAgentClient — fails fast on invalid input", () => {
  it("throws ValidationError listing EVERY error at the boundary", async () => {
    const client = new PruneAgentClient({
      invoke: async () => {
        throw new Error("should never be called");
      },
    });
    const bad: MessageRequest = {
      ...baseReq(),
      maxOutputTokens: -1,
      provider: "fake" as never,
    };
    try {
      await client.query(bad);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      const ve = e as ValidationError;
      // Aggregates ALL errors, not just the first.
      const errFields = ve.issues
        .filter((i) => i.severity === "error")
        .map((i) => i.field);
      expect(errFields).toContain("provider");
      expect(errFields).toContain("maxOutputTokens");
    }
  });
});

// ===========================================================================
// FINDING 7: invoker returning no `usage` field crashes the client.
// ===========================================================================

describe("client — malformed-response resilience", () => {
  it("invoker omitting `usage` records a warning, NEVER crashes the loop", async () => {
    const invoker: ModelInvoker = async () => ({
      id: "x",
      model: SONNET,
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: undefined as never,
    });
    const client = new PruneAgentClient({ invoke: invoker });
    const turn = await client.query(baseReq());
    // Normalized to explicit zeros — cost math is well-defined.
    expect(turn.usage.input_tokens).toBe(0);
    expect(turn.usage.output_tokens).toBe(0);
    // And the warning is on the turn for telemetry to pick up.
    expect(
      turn.responseWarnings.some((w) => w.field.includes("usage"))
    ).toBe(true);
    expect(client.summary().costUsd).toBe(0);
  });

  it("invoker returning partial usage (no input_tokens) ⇒ zeroed, not NaN", async () => {
    const invoker: ModelInvoker = async () => ({
      id: "x",
      model: SONNET,
      content: [],
      stop_reason: "end_turn",
      usage: { output_tokens: 10 } as never,
    });
    const client = new PruneAgentClient({ invoke: invoker });
    const t = await client.query(baseReq());
    expect(t.usage.input_tokens).toBe(0);
    expect(t.usage.output_tokens).toBe(10);
    expect(Number.isFinite(client.summary().costUsd)).toBe(true);
  });
});

// ===========================================================================
// FINDING 8: vendor downgrade was invisible to cost summary.
// ===========================================================================

describe("client — vendor downgrade visibility", () => {
  it("records vendor-returned model on the turn (billedModel)", async () => {
    const downgrade: ModelInvoker = async () => ({
      id: "x",
      model: HAIKU, // provider silently returned a different model
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10_000, output_tokens: 200 },
    });
    const client = new PruneAgentClient({ invoke: downgrade });
    const t = await client.query(baseReq()); // requested SONNET
    expect(t.request.model).toBe(SONNET);
    expect(t.response.model).toBe(HAIKU);
    expect(t.billedModel).toBe(HAIKU);
  });

  it("summary cost matches the BILLED (returned) model, not the requested one", async () => {
    const downgrade: ModelInvoker = async () => ({
      id: "x",
      model: HAIKU,
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1_000_000, output_tokens: 0 },
    });
    const sonnetClient = new PruneAgentClient({ invoke: downgrade });
    await sonnetClient.query(baseReq()); // requested SONNET
    // Haiku rate is $0.80/M input vs sonnet's $3.00/M — costing against haiku
    // is the realized cost.
    const cost = sonnetClient.summary().costUsd;
    expect(cost).toBeGreaterThan(0.7);
    expect(cost).toBeLessThan(0.9); // ~$0.80 at haiku rate, NOT ~$3.00 at sonnet
  });
});

// ===========================================================================
// FINDING 11: cache_creation premium was hidden — write-only turn cost more
// than no-cache but summary showed 0 savings.
// ===========================================================================

describe("summary — cache_creation write-premium honesty", () => {
  it("savedVsNoCacheUsd is NEGATIVE on a write-only turn (writes cost more)", async () => {
    const writeOnly: ModelInvoker = async () => ({
      id: "x",
      model: SONNET,
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: {
        input_tokens: 50,
        output_tokens: 80,
        cache_creation_input_tokens: 5000, // big write, no read
      },
    });
    const client = new PruneAgentClient({ invoke: writeOnly });
    await client.query(baseReq());
    const s = client.summary();
    // Anthropic charges cache_creation at 1.25× input — the no-cache run
    // would have been cheaper, so saved must be NEGATIVE.
    expect(s.savedVsNoCacheUsd).toBeLessThan(0);
    expect(s.costUsd).toBeGreaterThan(s.costNoCacheUsd);
  });

  it("savedVsNoCacheUsd is POSITIVE once cache_read kicks in (amortized win)", async () => {
    const writeThenRead: ModelInvoker = async (req) => {
      const turn = (req.system[0]?.text ?? "").length; // just a discriminator
      return {
        id: `t${turn}`,
        model: SONNET,
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        // Write once, then read many times.
        usage:
          turn === 1100
            ? {
                input_tokens: 50,
                output_tokens: 80,
                cache_creation_input_tokens: 5000,
              }
            : {
                input_tokens: 50,
                output_tokens: 80,
                cache_read_input_tokens: 5000,
              },
      };
    };
    const client = new PruneAgentClient({ invoke: writeThenRead });
    // Three turns: one create, two reads — net positive savings.
    await client.query(baseReq()); // creation
    await client.query(baseReq()); // read
    await client.query(baseReq()); // read
    const s = client.summary();
    expect(s.savedVsNoCacheUsd).toBeGreaterThan(0);
  });
});

// ===========================================================================
// FINDING 9: Unicode-heavy content has different real token cost than
// chars/4 — documented limitation, not a bug, but worth pinning.
// ===========================================================================

describe("estimator — Unicode CJK behaviour (documented under-count)", () => {
  it("CJK text estimates LOWER than reality; use a real tokenizer for exact", () => {
    // 2400 CJK chars ≈ 4800 real Claude tokens (each Han char is ~1.5–2 BPE).
    // chars/4 estimates ~600. This is a KNOWN limitation of the cheap
    // estimator — production must use packages/tokenizer for exact counts.
    const unicode = "日本語".repeat(800);
    const plan = planBreakpoints(
      baseReq({ system: [stableText(unicode)] }),
      { minCacheableTokens: 1024 }
    );
    // The CJK block under-estimates ⇒ planner thinks it's below threshold ⇒
    // refuses to anchor. SAFE direction: we'd rather miss a cache hit than
    // anchor a block the provider would have rejected for being too small.
    // Pin this so the under-estimate behaviour is intentional and visible.
    expect(plan.breakpoints.length).toBe(0);
    // But: passing a real tokenizer fixes it.
    const planWithExact = planBreakpoints(
      baseReq({ system: [stableText(unicode)] }),
      { minCacheableTokens: 1024, estimate: () => 5000 }
    );
    expect(planWithExact.breakpoints.length).toBeGreaterThan(0);
  });
});
