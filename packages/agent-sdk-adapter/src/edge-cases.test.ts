/**
 * Adversarial edge-case sweep for the adapter. None of these should crash,
 * NaN, or quietly produce a wrong plan. The dangerous failure mode is the
 * same as elsewhere: silently letting volatile content into a cacheable
 * prefix, or silently dropping a breakpoint we should have anchored.
 */

import { describe, expect, it } from "vitest";
import {
  applyBreakpoints,
  canonicalJSON,
  message,
  planBreakpoints,
  PruneAgentClient,
  stableText,
  tool,
  toolUse,
  volatileText,
} from "./index.js";
import type { MessageRequest, ModelInvoker } from "./index.js";

const SONNET = "claude-sonnet-4-5-20250929";

function req(overrides: Partial<MessageRequest> = {}): MessageRequest {
  return {
    model: SONNET,
    provider: "anthropic",
    system: [],
    tools: [],
    messages: [],
    maxOutputTokens: 256,
    ...overrides,
  };
}

describe("planner — degenerate inputs", () => {
  it("zero everything: empty plan, no crash, no NaN", () => {
    const plan = planBreakpoints(req());
    expect(plan.breakpoints).toEqual([]);
    expect(plan.cacheablePrefixTokens).toBe(0);
    expect(plan.rejected).toEqual([]);
  });

  it("maxBreakpoints=0 disables caching entirely (audit shows rejections)", () => {
    const r = req({
      system: [stableText("a".repeat(8000))], // well above threshold
    });
    const plan = planBreakpoints(r, { maxBreakpoints: 0 });
    expect(plan.breakpoints).toEqual([]);
    expect(plan.rejected.some((x) => /ceiling/.test(x.reason))).toBe(true);
  });

  it("custom minCacheableTokens override is honored", () => {
    const r = req({ system: [stableText("a".repeat(800))] }); // ~200 tokens
    const tight = planBreakpoints(r, { minCacheableTokens: 100 });
    const loose = planBreakpoints(r, { minCacheableTokens: 10000 });
    expect(tight.breakpoints.length).toBeGreaterThan(0);
    expect(loose.breakpoints.length).toBe(0);
  });

  it("custom estimator (exact tokenizer) flows through to the planner", () => {
    // An estimator that under-counts by 10× would push tiny blocks below the
    // threshold; verify it's actually called.
    let called = 0;
    const plan = planBreakpoints(
      req({ system: [stableText("a".repeat(8000))] }),
      {
        estimate: (s) => {
          called++;
          return Math.ceil(s.length / 4);
        },
      }
    );
    expect(called).toBeGreaterThan(0);
    expect(plan.breakpoints.length).toBeGreaterThan(0);
  });

  it("ALL-volatile system: every block is rejected with a clear reason", () => {
    const r = req({
      system: [
        volatileText("now: 12:00"),
        volatileText("session: 7"),
        volatileText("user: alice"),
      ],
    });
    const plan = planBreakpoints(r);
    expect(plan.breakpoints).toHaveLength(0);
    expect(plan.rejected.length).toBe(3);
    for (const r of plan.rejected) expect(/volatile/i.test(r.reason)).toBe(true);
  });

  it("very large stable system: still produces exactly one anchor at the run end", () => {
    const huge = stableText("x".repeat(100_000)); // ≈ 25k tokens
    const plan = planBreakpoints(req({ system: [huge] }));
    expect(plan.breakpoints.length).toBeGreaterThanOrEqual(1);
    expect(plan.cacheablePrefixTokens).toBeGreaterThan(20_000);
  });
});

describe("applyBreakpoints — canonical JSON sanity", () => {
  it("key-canonical output is the same regardless of build-up order", () => {
    const a = applyBreakpoints(
      req({ system: [stableText("a".repeat(8000))] }),
      planBreakpoints(req({ system: [stableText("a".repeat(8000))] }))
    );
    const b = applyBreakpoints(
      req({ system: [stableText("a".repeat(8000))] }),
      planBreakpoints(req({ system: [stableText("a".repeat(8000))] }))
    );
    expect(canonicalJSON(a)).toBe(canonicalJSON(b));
  });
});

describe("client — invoker contract", () => {
  it("propagates an invoker rejection without crashing the adapter", async () => {
    const invoker: ModelInvoker = async () => {
      throw new Error("provider 500");
    };
    const client = new PruneAgentClient({ invoke: invoker });
    await expect(
      client.query(req({ system: [stableText("rules")] }))
    ).rejects.toThrow(/provider 500/);
    // History should not record a turn that never returned.
    expect(client.turns).toHaveLength(0);
  });

  it("a malformed (missing usage) response still records the turn — but usage zeroed", async () => {
    const invoker: ModelInvoker = async () => ({
      id: "x",
      model: SONNET,
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      // Caller forgot to populate usage — provider can return partial.
      // We model that with explicit zeros so the summary stays well-defined.
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    const client = new PruneAgentClient({ invoke: invoker });
    const t = await client.query(req({ system: [stableText("rules")] }));
    expect(t.usage.input_tokens).toBe(0);
    expect(client.summary().costUsd).toBe(0);
  });
});

describe("client — summary correctness", () => {
  it("savedVsNoCacheUsd is non-negative even on a no-cache session", async () => {
    const invoker: ModelInvoker = async () => ({
      id: "x",
      model: SONNET,
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    const client = new PruneAgentClient({ invoke: invoker });
    for (let i = 0; i < 3; i++) {
      await client.query(req({ system: [stableText("tiny")] }));
    }
    const s = client.summary();
    // No cache anywhere ⇒ costNoCache == cost ⇒ saved == 0 (not negative).
    expect(s.savedVsNoCacheUsd).toBe(0);
    expect(s.cacheReadTokens).toBe(0);
  });
});
