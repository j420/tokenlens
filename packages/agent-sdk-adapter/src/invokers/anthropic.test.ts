import { describe, expect, it, vi } from "vitest";
import {
  createAnthropicInvoker,
  fromAnthropicMessage,
  toAnthropicCreateParams,
  type AnthropicLikeClient,
  type AnthropicMessage,
} from "./anthropic.js";
import type { ProviderRequest } from "../types.js";

const REQUEST: ProviderRequest = {
  model: "claude-sonnet-4-5-20250929",
  max_tokens: 1024,
  system: [
    {
      type: "text",
      text: "You are a helpful coding assistant.",
      cache_control: { type: "ephemeral", ttl: "5m" },
    },
  ],
  tools: [
    {
      name: "read_file",
      description: "Read a file from disk.",
      input_schema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  ],
  messages: [
    {
      role: "user",
      content: [{ type: "text", text: "Read foo.ts" }],
    },
  ],
};

const FAKE_RESPONSE: AnthropicMessage = {
  id: "msg_01",
  model: "claude-sonnet-4-5-20250929",
  content: [{ type: "text", text: "Reading foo.ts..." }],
  stop_reason: "end_turn",
  usage: {
    input_tokens: 1500,
    output_tokens: 12,
    cache_read_input_tokens: 1300,
    cache_creation_input_tokens: 0,
  },
};

describe("toAnthropicCreateParams", () => {
  it("threads cache_control on system blocks", () => {
    const p = toAnthropicCreateParams(REQUEST);
    expect(p.system?.[0]?.cache_control).toEqual({
      type: "ephemeral",
      ttl: "5m",
    });
  });

  it("omits empty system / tools arrays", () => {
    const p = toAnthropicCreateParams({
      ...REQUEST,
      system: [],
      tools: [],
    });
    expect(p.system).toBeUndefined();
    expect(p.tools).toBeUndefined();
  });

  it("emits content blocks for each message", () => {
    const p = toAnthropicCreateParams(REQUEST);
    expect(p.messages[0]!.role).toBe("user");
    expect(p.messages[0]!.content[0]).toEqual({
      type: "text",
      text: "Read foo.ts",
    });
  });

  it("propagates metadata when present", () => {
    const p = toAnthropicCreateParams({
      ...REQUEST,
      metadata: { user_id: "u1" },
    });
    expect(p.metadata).toEqual({ user_id: "u1" });
  });

  it("propagates tool input_schema verbatim", () => {
    const p = toAnthropicCreateParams(REQUEST);
    expect(p.tools?.[0]?.input_schema).toEqual(
      REQUEST.tools[0]!.input_schema
    );
  });
});

describe("fromAnthropicMessage", () => {
  it("maps text content and usage", () => {
    const r = fromAnthropicMessage(FAKE_RESPONSE);
    expect(r.id).toBe("msg_01");
    expect(r.model).toBe("claude-sonnet-4-5-20250929");
    expect(r.content[0]).toEqual({ type: "text", text: "Reading foo.ts..." });
    expect(r.usage.cache_read_input_tokens).toBe(1300);
  });

  it("maps tool_use content blocks", () => {
    const msg: AnthropicMessage = {
      ...FAKE_RESPONSE,
      content: [
        {
          type: "tool_use",
          id: "tu1",
          name: "read_file",
          input: { path: "x.ts" },
        },
      ],
    };
    const r = fromAnthropicMessage(msg);
    expect(r.content[0]).toEqual({
      type: "tool_use",
      id: "tu1",
      name: "read_file",
      input: { path: "x.ts" },
    });
  });

  it("handles missing usage fields defensively", () => {
    const msg = {
      id: "msg_x",
      model: "x",
      content: [],
      stop_reason: "end_turn",
      usage: {
        input_tokens: -5, // garbage
        output_tokens: Number.NaN,
        cache_read_input_tokens: undefined,
      },
    } as unknown as AnthropicMessage;
    const r = fromAnthropicMessage(msg);
    expect(r.usage.input_tokens).toBe(0);
    expect(r.usage.output_tokens).toBe(0);
    expect(r.usage.cache_read_input_tokens).toBeUndefined();
  });

  it("projects unsupported block types defensively", () => {
    const msg = {
      ...FAKE_RESPONSE,
      content: [{ type: "future_block" } as never],
    };
    const r = fromAnthropicMessage(msg);
    expect(r.content[0]).toEqual({
      type: "text",
      text: "[unsupported_block:future_block]",
    });
  });
});

describe("createAnthropicInvoker", () => {
  it("calls client.messages.create with the marshaled request", async () => {
    const create = vi.fn().mockResolvedValue(FAKE_RESPONSE);
    const client: AnthropicLikeClient = {
      messages: { create },
    };
    const invoker = createAnthropicInvoker({ client });
    const response = await invoker(REQUEST);
    expect(create).toHaveBeenCalledTimes(1);
    const params = create.mock.calls[0][0];
    expect(params.model).toBe(REQUEST.model);
    expect(params.system?.[0]?.cache_control).toBeDefined();
    expect(response.usage.cache_read_input_tokens).toBe(1300);
  });

  it("rejects an invalid client", () => {
    expect(() =>
      createAnthropicInvoker({ client: undefined as never })
    ).toThrow();
    expect(() =>
      createAnthropicInvoker({ client: {} as never })
    ).toThrow();
  });

  it("propagates rejection from client.messages.create", async () => {
    const create = vi.fn().mockRejectedValue(new Error("network down"));
    const invoker = createAnthropicInvoker({
      client: { messages: { create } },
    });
    await expect(invoker(REQUEST)).rejects.toThrow("network down");
  });
});
