import { describe, expect, it, vi } from "vitest";
import {
  createOpenAIInvoker,
  fromOpenAIChatCompletion,
  toOpenAIChatCreateParams,
  type OpenAIChatCompletion,
  type OpenAILikeClient,
} from "./openai.js";
import type { ProviderRequest } from "../types.js";

const REQUEST: ProviderRequest = {
  model: "gpt-4o",
  max_tokens: 1024,
  system: [
    { type: "text", text: "Sys block 1" },
    { type: "text", text: "Sys block 2" },
  ],
  tools: [
    {
      name: "read_file",
      description: "Read a file from disk.",
      input_schema: {
        type: "object",
        properties: { path: { type: "string" } },
      },
    },
  ],
  messages: [
    {
      role: "user",
      content: [{ type: "text", text: "Hello" }],
    },
    {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "tu1",
          name: "read_file",
          input: { path: "foo.ts" },
        },
      ],
    },
  ],
};

const FAKE_RESPONSE: OpenAIChatCompletion = {
  id: "cmpl_01",
  model: "gpt-4o",
  choices: [
    {
      finish_reason: "stop",
      message: {
        role: "assistant",
        content: "Hello there",
      },
    },
  ],
  usage: {
    prompt_tokens: 1500,
    completion_tokens: 12,
    prompt_tokens_details: { cached_tokens: 1300 },
  },
};

describe("toOpenAIChatCreateParams", () => {
  it("concatenates system blocks into one system message", () => {
    const p = toOpenAIChatCreateParams(REQUEST);
    expect(p.messages[0]!.role).toBe("system");
    expect(p.messages[0]!.content).toContain("Sys block 1");
    expect(p.messages[0]!.content).toContain("Sys block 2");
  });

  it("translates tool_use to OpenAI tool_calls", () => {
    const p = toOpenAIChatCreateParams(REQUEST);
    const assistantMsg = p.messages.find((m) => m.role === "assistant");
    expect(assistantMsg?.tool_calls?.[0]).toMatchObject({
      id: "tu1",
      type: "function",
    });
    const args = JSON.parse(assistantMsg!.tool_calls![0]!.function.arguments);
    expect(args).toEqual({ path: "foo.ts" });
  });

  it("translates tools to OpenAI function tool defs", () => {
    const p = toOpenAIChatCreateParams(REQUEST);
    expect(p.tools?.[0]?.function?.name).toBe("read_file");
    expect(p.tools?.[0]?.function?.parameters).toEqual({
      type: "object",
      properties: { path: { type: "string" } },
    });
  });

  it("omits tools when none are declared", () => {
    const p = toOpenAIChatCreateParams({ ...REQUEST, tools: [] });
    expect(p.tools).toBeUndefined();
  });

  it("omits system when no system blocks are declared", () => {
    const p = toOpenAIChatCreateParams({ ...REQUEST, system: [] });
    const systemPresent = p.messages.some((m) => m.role === "system");
    expect(systemPresent).toBe(false);
  });
});

describe("fromOpenAIChatCompletion", () => {
  it("maps text response + usage including cached_tokens", () => {
    const r = fromOpenAIChatCompletion(FAKE_RESPONSE);
    expect(r.id).toBe("cmpl_01");
    expect(r.content[0]).toEqual({ type: "text", text: "Hello there" });
    expect(r.usage.input_tokens).toBe(1500);
    expect(r.usage.cache_read_input_tokens).toBe(1300);
    expect(r.usage.cache_creation_input_tokens).toBeUndefined();
  });

  it("maps tool_calls to tool_use blocks", () => {
    const res: OpenAIChatCompletion = {
      ...FAKE_RESPONSE,
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "tc1",
                type: "function",
                function: { name: "read_file", arguments: '{"path":"a.ts"}' },
              },
            ],
          },
        },
      ],
    };
    const r = fromOpenAIChatCompletion(res);
    expect(r.stop_reason).toBe("tool_use");
    expect(r.content).toHaveLength(1);
    expect(r.content[0]).toEqual({
      type: "tool_use",
      id: "tc1",
      name: "read_file",
      input: { path: "a.ts" },
    });
  });

  it("handles missing cached_tokens (no automatic caching)", () => {
    const res: OpenAIChatCompletion = {
      ...FAKE_RESPONSE,
      usage: { prompt_tokens: 100, completion_tokens: 5 },
    };
    const r = fromOpenAIChatCompletion(res);
    expect(r.usage.cache_read_input_tokens).toBeUndefined();
  });

  it("maps finish_reason values to neutral stop_reason", () => {
    const make = (fr: string): OpenAIChatCompletion => ({
      ...FAKE_RESPONSE,
      choices: [{ finish_reason: fr, message: { role: "assistant", content: "x" } }],
    });
    expect(fromOpenAIChatCompletion(make("stop")).stop_reason).toBe("end_turn");
    expect(fromOpenAIChatCompletion(make("length")).stop_reason).toBe("max_tokens");
    expect(fromOpenAIChatCompletion(make("function_call")).stop_reason).toBe("tool_use");
    expect(fromOpenAIChatCompletion(make("unknown_reason")).stop_reason).toBe("unknown_reason");
  });

  it("throws on missing choices array", () => {
    expect(() =>
      fromOpenAIChatCompletion({ ...FAKE_RESPONSE, choices: [] })
    ).toThrow();
  });

  it("recovers from malformed tool_call.arguments", () => {
    const res: OpenAIChatCompletion = {
      ...FAKE_RESPONSE,
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "tc1",
                type: "function",
                function: { name: "f", arguments: "{not json" },
              },
            ],
          },
        },
      ],
    };
    const r = fromOpenAIChatCompletion(res);
    expect((r.content[0] as { input: unknown }).input).toEqual({});
  });
});

describe("createOpenAIInvoker", () => {
  it("calls client.chat.completions.create and maps the response", async () => {
    const create = vi.fn().mockResolvedValue(FAKE_RESPONSE);
    const client: OpenAILikeClient = {
      chat: { completions: { create } },
    };
    const invoker = createOpenAIInvoker({ client });
    const r = await invoker(REQUEST);
    expect(create).toHaveBeenCalledTimes(1);
    expect(r.usage.input_tokens).toBe(1500);
  });

  it("rejects an invalid client", () => {
    expect(() => createOpenAIInvoker({ client: {} as never })).toThrow();
  });

  it("propagates rejection from the underlying client", async () => {
    const create = vi.fn().mockRejectedValue(new Error("auth failed"));
    const invoker = createOpenAIInvoker({
      client: { chat: { completions: { create } } },
    });
    await expect(invoker(REQUEST)).rejects.toThrow("auth failed");
  });
});

describe("toOpenAIChatCreateParams — content/tool_calls invariant (regression)", () => {
  it("omits content entirely when tool_calls present and no text", () => {
    // OpenAI rejects { role: "assistant", content: "", tool_calls: [...] };
    // content must be either non-empty or absent.
    const p = toOpenAIChatCreateParams({
      ...REQUEST,
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tu1",
              name: "f",
              input: {},
            },
          ],
        },
      ],
    });
    const assistantMsg = p.messages.find((m) => m.role === "assistant")!;
    expect(assistantMsg.tool_calls).toBeDefined();
    expect("content" in assistantMsg).toBe(false);
  });

  it("keeps content when text is present alongside tool_calls", () => {
    const p = toOpenAIChatCreateParams({
      ...REQUEST,
      messages: [
        {
          role: "assistant",
          content: [
            { type: "text", text: "Let me look that up" },
            { type: "tool_use", id: "tu1", name: "f", input: {} },
          ],
        },
      ],
    });
    const assistantMsg = p.messages.find((m) => m.role === "assistant")!;
    expect(assistantMsg.content).toBe("Let me look that up");
    expect(assistantMsg.tool_calls).toHaveLength(1);
  });

  it("keeps empty content for a text-only user message (legal there)", () => {
    const p = toOpenAIChatCreateParams({
      ...REQUEST,
      messages: [{ role: "user", content: [] }],
    });
    // No tool_calls path here; an empty content string is acceptable.
    const userMsg = p.messages.find((m) => m.role === "user")!;
    expect(userMsg.content).toBe("");
  });
});
