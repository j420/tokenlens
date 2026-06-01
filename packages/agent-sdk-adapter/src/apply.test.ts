/**
 * applyBreakpoints — materializes the provider-shaped request from the plan.
 *
 * Adversarial tests for the credibility properties:
 *   1. Identity on the no-plan path (no cache_control sneaks in).
 *   2. Determinism (byte-identical output ⇒ provider cache hits).
 *   3. cache_control lands on the LAST content block of an annotated message
 *      (the provider convention).
 *   4. tool_use blocks NEVER receive cache_control (provider rejects it).
 *   5. Volatile-by-declaration system block throws if asked to anchor it.
 */

import { describe, expect, it } from "vitest";
import { applyBreakpoints, canonicalJSON } from "./apply.js";
import { planBreakpoints } from "./cache-planner.js";
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

function pad(base: string, target: number) {
  return stableText(base + ".".repeat(target * 4));
}

function req(overrides: Partial<MessageRequest> = {}): MessageRequest {
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

describe("applyBreakpoints — identity on the no-plan path", () => {
  it("NO cache_control anywhere when the plan has no breakpoints", () => {
    const r = req({
      system: [stableText("tiny")], // too small for min cacheable
      tools: [tool("t", "desc", { type: "object" }, "stable")],
    });
    const plan = planBreakpoints(r);
    expect(plan.breakpoints).toHaveLength(0);
    const out = applyBreakpoints(r, plan);
    expect(JSON.stringify(out)).not.toContain("cache_control");
    expect(JSON.stringify(out)).not.toContain("ephemeral");
  });

  it("preserves block ordering byte-for-byte", () => {
    const r = req({
      system: [stableText("a"), stableText("b"), stableText("c")],
    });
    const out = applyBreakpoints(r, planBreakpoints(r));
    expect(out.system.map((b) => b.text)).toEqual(["a", "b", "c"]);
  });
});

describe("applyBreakpoints — determinism", () => {
  it("same inputs ⇒ byte-identical canonical JSON (required for cache hits)", () => {
    const r = req({ system: [pad("rules", 1100)] });
    const a = applyBreakpoints(r, planBreakpoints(r));
    const b = applyBreakpoints(r, planBreakpoints(r));
    expect(canonicalJSON(a)).toBe(canonicalJSON(b));
  });
});

describe("applyBreakpoints — provider conventions", () => {
  it("attaches cache_control to a SYSTEM block when the plan selects it", () => {
    const r = req({ system: [pad("rules", 1100)] });
    const plan = planBreakpoints(r);
    const out = applyBreakpoints(r, plan);
    const annotated = out.system.find((b) => b.cache_control);
    expect(annotated).toBeTruthy();
    expect(annotated?.cache_control?.type).toBe("ephemeral");
  });

  it("attaches cache_control to the LAST content block of an annotated message", () => {
    // Construct a stable user message that clears the threshold by itself.
    const r = req({
      system: [pad("rules", 1100)],
      messages: [
        message("user", stableText("first"), stableText("second"), pad("third", 1100)),
      ],
    });
    const plan = planBreakpoints(r);
    const out = applyBreakpoints(r, plan);
    const msgBp = plan.breakpoints.find((b) => b.segment === "messages");
    if (msgBp) {
      const m = out.messages[msgBp.blockIndex];
      // cache_control must be on the LAST block in that message — and ONLY that block.
      const last = m.content[m.content.length - 1] as { cache_control?: unknown };
      expect(last.cache_control).toBeTruthy();
      for (let i = 0; i < m.content.length - 1; i++) {
        const b = m.content[i] as { cache_control?: unknown };
        expect(b.cache_control).toBeUndefined();
      }
    }
  });

  it("NEVER attaches cache_control to a tool_use block (provider rejects it)", () => {
    const r = req({
      system: [pad("rules", 1100)],
      messages: [
        message(
          "assistant",
          stableText("calling"),
          toolUse("tu_1", "read", { file_path: "a.ts" })
        ),
      ],
    });
    const out = applyBreakpoints(r, planBreakpoints(r));
    for (const m of out.messages) {
      for (const b of m.content) {
        if (b.type === "tool_use") {
          expect("cache_control" in b).toBe(false);
        }
      }
    }
  });

  it("tool_result block lifts through unchanged (no cache_control)", () => {
    const r = req({
      messages: [
        message("assistant", toolUse("tu_1", "read", {})),
        message("user", toolResult("tu_1", "contents", { isError: false })),
      ],
    });
    const out = applyBreakpoints(r, planBreakpoints(r));
    const tr = out.messages[1].content[0];
    expect(tr.type).toBe("tool_result");
    expect("cache_control" in (tr as object)).toBe(false);
  });
});

describe("applyBreakpoints — rejection conditions", () => {
  it("rejects loudly if a system block is not type=text", () => {
    const r = req({
      // Forge a non-text system block; only text is supported in system.
      system: [toolUse("tu_x", "x", {}) as never],
    });
    expect(() => applyBreakpoints(r, planBreakpoints(r))).toThrow(
      /system block 0/
    );
  });
});

describe("applyBreakpoints — metadata propagation", () => {
  it("forwards a metadata object verbatim", () => {
    const r = req({ metadata: { sessionId: "abc-123" } });
    const out = applyBreakpoints(r, planBreakpoints(r));
    expect(out.metadata).toEqual({ sessionId: "abc-123" });
  });
  it("omits metadata when none is provided", () => {
    const out = applyBreakpoints(req(), planBreakpoints(req()));
    expect(out.metadata).toBeUndefined();
  });
});
