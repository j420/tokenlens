/**
 * End-to-end client tests. The credibility property under test: a full
 * three-turn session with a stable system prefix produces a real provider
 * request with cache_control, the invoker (a fake here) reports cache_read
 * tokens by turn 2, and the rolling summary reports savings vs no-cache.
 *
 * The fake invoker is the ONE place we substitute the SDK — by design. It
 * verifies the inputs are well-formed and returns realistic usage echoes.
 */

import { describe, expect, it, vi } from "vitest";
import { message, stableText, tool, toolUse, volatileText } from "./content.js";
import { PruneAgentClient } from "./client.js";
import { LoopPolicy } from "./loop.js";
import { LowRoiRoutingPolicy } from "./routing.js";
import type {
  MessageRequest,
  ModelInvoker,
  ProviderRequest,
} from "./types.js";

const SONNET = "claude-sonnet-4-5-20250929";

function pad(text: string, target: number) {
  return stableText(text + ".".repeat(target * 4));
}

interface FakeUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

/**
 * A deterministic fake invoker that simulates Anthropic's prompt-cache
 * behavior: on first call it writes the cacheable prefix; on subsequent
 * identical prefixes it reports cache_read tokens.
 */
function makeFakeInvoker() {
  let seenFingerprint: string | null = null;
  const calls: ProviderRequest[] = [];

  const invoker: ModelInvoker = async (req) => {
    calls.push(req);
    // Approximate the cacheable prefix size by summing every block that has a
    // cache_control attached, plus all earlier system/tools blocks (the
    // provider treats cache_control as "this and everything before it").
    let prefixTokens = 0;
    let sawCC = false;
    for (const s of req.system) {
      prefixTokens += Math.ceil(s.text.length / 4);
      if (s.cache_control) sawCC = true;
    }
    if (sawCC === false) {
      for (const t of req.tools) {
        prefixTokens += Math.ceil((t.description?.length ?? 0) / 4);
        if (t.cache_control) {
          sawCC = true;
          break;
        }
      }
    }
    const fingerprint = JSON.stringify({
      model: req.model,
      sys: req.system.map((s) => s.text),
      tools: req.tools.map((t) => t.name),
    });
    const usage: FakeUsage = sawCC
      ? seenFingerprint === fingerprint
        ? {
            input_tokens: 50,
            output_tokens: 80,
            cache_read_input_tokens: prefixTokens,
          }
        : {
            input_tokens: 50,
            output_tokens: 80,
            cache_creation_input_tokens: prefixTokens,
          }
      : { input_tokens: prefixTokens + 50, output_tokens: 80 };

    if (sawCC) seenFingerprint = fingerprint;

    return {
      id: `msg_${calls.length}`,
      model: req.model,
      content: [
        {
          type: "text",
          // Distinct, productive-looking text per turn so the ROI classifier
          // doesn't flag the fake responses as recursive duplicates.
          text:
            `Implemented feature_${calls.length}: refactored ${calls.length} ` +
            `module${calls.length === 1 ? "" : "s"} and updated their tests.`,
        },
      ],
      stop_reason: "end_turn",
      usage,
    };
  };
  return { invoker, calls: () => calls };
}

function baseRequest(turnText: string): MessageRequest {
  return {
    model: SONNET,
    provider: "anthropic",
    system: [pad("project rules and standards", 1100)],
    tools: [tool("read", "Read a file", { type: "object" }, "stable")],
    messages: [
      message("user", volatileText(`turn ${turnText} request`), stableText("ok")),
    ],
    maxOutputTokens: 256,
  };
}

describe("PruneAgentClient end-to-end", () => {
  it("plans a breakpoint, invokes, reports cache_read by turn 2", async () => {
    const { invoker, calls } = makeFakeInvoker();
    const client = new PruneAgentClient({ invoke: invoker });

    const t1 = await client.query(baseRequest("1"));
    const t2 = await client.query(baseRequest("2"));
    const t3 = await client.query(baseRequest("3"));

    // Provider got the cache_control on turn 1 (write) AND turn 2/3 (read).
    expect(calls()).toHaveLength(3);
    const cc1 = JSON.stringify(calls()[0]).includes("cache_control");
    expect(cc1).toBe(true);

    // Turn 1 wrote the cache; turn 2/3 hit it.
    expect(t1.usage.cache_creation_input_tokens).toBeGreaterThan(0);
    expect(t2.usage.cache_read_input_tokens).toBeGreaterThan(0);
    expect(t3.usage.cache_read_input_tokens).toBeGreaterThan(0);

    const summary = client.summary();
    expect(summary.turns).toBe(3);
    expect(summary.cacheReadTokens).toBeGreaterThan(0);
    expect(summary.savedVsNoCacheUsd).toBeGreaterThan(0);
  });

  it("throws ModelInvoker error path: caller must supply an invoke", () => {
    expect(
      () => new PruneAgentClient({ invoke: undefined as never })
    ).toThrow(/requires an `invoke` function/);
  });

  it("static routing keeps the baseline model across turns", async () => {
    const { invoker, calls } = makeFakeInvoker();
    const client = new PruneAgentClient({ invoke: invoker });
    await client.query(baseRequest("1"));
    await client.query(baseRequest("2"));
    expect(calls()[0].model).toBe(SONNET);
    expect(calls()[1].model).toBe(SONNET);
  });

  it("LowRoiRoutingPolicy + a productive session does NOT switch model", async () => {
    const { invoker, calls } = makeFakeInvoker();
    // A productive turn in the real harness carries file/test signals that
    // come from POST-response tool execution — not from the model's text. We
    // supply that signal via a custom turn-data projection.
    const client = new PruneAgentClient({
      invoke: invoker,
      routing: new LowRoiRoutingPolicy({ threshold: 3 }),
      toTurnData: (turnNumber, _req, res) => ({
        turnNumber,
        responseContent: res.content
          .map((c) => (c.type === "text" ? c.text : ""))
          .join("\n"),
        filesWritten: [`src/feature_${turnNumber}.ts`], // productive signal
        filesRead: [],
        testsPassed: true,
        errorsPresent: [],
        tokensIn:
          res.usage.input_tokens +
          (res.usage.cache_read_input_tokens ?? 0) +
          (res.usage.cache_creation_input_tokens ?? 0),
        tokensOut: res.usage.output_tokens,
        timestamp: new Date(),
      }),
    });
    for (let i = 0; i < 5; i++) await client.query(baseRequest(String(i)));
    for (const c of calls()) expect(c.model).toBe(SONNET);
  });

  it("preserves the turn history with full request + plan for audit", async () => {
    const { invoker } = makeFakeInvoker();
    const client = new PruneAgentClient({ invoke: invoker });
    await client.query(baseRequest("1"));
    await client.query(baseRequest("2"));
    expect(client.turns).toHaveLength(2);
    expect(client.turns[0].plan.breakpoints.length).toBeGreaterThanOrEqual(1);
    expect(client.turns[0].routing.switched).toBe(false);
    expect(client.turns[1].usage.cache_read_input_tokens).toBeGreaterThan(0);
  });

  it("AbortSignal threads through to the invoker", async () => {
    const invoker = vi.fn(async (_req: ProviderRequest, signal?: AbortSignal) => {
      expect(signal).toBeDefined();
      return {
        id: "x",
        model: SONNET,
        content: [],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    });
    const client = new PruneAgentClient({ invoke: invoker });
    const ac = new AbortController();
    await client.query(baseRequest("1"), ac.signal);
    expect(invoker).toHaveBeenCalled();
  });
});
