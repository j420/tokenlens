/**
 * Anthropic invoker — concrete `ModelInvoker` that talks to the
 * Anthropic Messages API.
 *
 * Dependency posture: this module is **injection-based**. We do NOT
 * import `@anthropic-ai/sdk` — that would force every consumer of
 * `@prune/agent-sdk-adapter` to ship the SDK, which inflates the
 * extension bundle and couples the adapter to a versioned SDK shape.
 *
 * Instead, the caller passes their already-constructed client
 * (typed minimally via `AnthropicLikeClient`). The factory returns
 * a `ModelInvoker` that:
 *   1. Marshals our neutral `ProviderRequest` into the Anthropic
 *      `messages.create` parameter shape (including `cache_control`
 *      blocks the planner already attached).
 *   2. Calls `client.messages.create(...)`.
 *   3. Maps the response back to our neutral `MessageResponse`,
 *      including the cache-usage fields the cost-analyzer needs.
 *
 * Pure marshalling — no model call, no caching, no I/O beyond the
 * SDK call the caller's client performs.
 */

import type {
  MessageResponse,
  ModelInvoker,
  ProviderContentBlock,
  ProviderMessage,
  ProviderRequest,
  ProviderSystemBlock,
  ProviderToolDef,
} from "../types.js";

/**
 * Minimal subset of `@anthropic-ai/sdk` the invoker depends on.
 * Compatible with v0.x and v1.x of the SDK.
 */
export interface AnthropicLikeClient {
  messages: {
    create(params: AnthropicMessagesCreateParams): Promise<AnthropicMessage>;
  };
}

export interface AnthropicMessagesCreateParams {
  model: string;
  max_tokens: number;
  system?: Array<{
    type: "text";
    text: string;
    cache_control?: { type: "ephemeral"; ttl?: "5m" | "1h" };
  }>;
  tools?: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
    cache_control?: { type: "ephemeral"; ttl?: "5m" | "1h" };
  }>;
  messages: Array<{
    role: "user" | "assistant";
    content: Array<{
      type: string;
      [key: string]: unknown;
    }>;
  }>;
  metadata?: Record<string, string>;
}

export interface AnthropicMessage {
  id: string;
  model: string;
  content: Array<{
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  }>;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

export interface CreateAnthropicInvokerOptions {
  /** AbortSignal aggregator — invoker passes the caller's signal through. */
  client: AnthropicLikeClient;
}

/**
 * Build a `ModelInvoker` backed by the supplied Anthropic-like client.
 */
export function createAnthropicInvoker(
  options: CreateAnthropicInvokerOptions
): ModelInvoker {
  const client = options.client;
  if (!client || typeof client !== "object" || !client.messages) {
    throw new Error(
      "createAnthropicInvoker: options.client must be an AnthropicLikeClient"
    );
  }
  return async (request: ProviderRequest, _signal?: AbortSignal): Promise<MessageResponse> => {
    const params = toAnthropicCreateParams(request);
    const response = await client.messages.create(params);
    return fromAnthropicMessage(response);
  };
}

/* ------------------------------------------------------------------ */
/* Marshalling                                                        */
/* ------------------------------------------------------------------ */

export function toAnthropicCreateParams(
  request: ProviderRequest
): AnthropicMessagesCreateParams {
  const params: AnthropicMessagesCreateParams = {
    model: request.model,
    max_tokens: request.max_tokens,
    messages: request.messages.map(marshalMessage),
  };
  if (request.system.length > 0) {
    params.system = request.system.map(marshalSystem);
  }
  if (request.tools.length > 0) {
    params.tools = request.tools.map(marshalTool);
  }
  if (request.metadata) {
    params.metadata = request.metadata;
  }
  return params;
}

function marshalSystem(b: ProviderSystemBlock) {
  return b.cache_control
    ? { type: "text" as const, text: b.text, cache_control: b.cache_control }
    : { type: "text" as const, text: b.text };
}

function marshalTool(t: ProviderToolDef) {
  return t.cache_control
    ? {
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
        cache_control: t.cache_control,
      }
    : {
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      };
}

function marshalMessage(m: ProviderMessage) {
  return {
    role: m.role,
    content: m.content.map(marshalContent),
  };
}

function marshalContent(b: ProviderContentBlock) {
  // ProviderContentBlock is a discriminated union with text + tool_use +
  // tool_result. We pass through unchanged for tool_use / tool_result
  // (no cache_control on those); for text we forward cache_control.
  if (b.type === "text") {
    return b.cache_control
      ? { type: "text", text: b.text, cache_control: b.cache_control }
      : { type: "text", text: b.text };
  }
  // Any other block kind — pass through structurally.
  return { ...b };
}

/* ------------------------------------------------------------------ */
/* Demarshalling                                                      */
/* ------------------------------------------------------------------ */

export function fromAnthropicMessage(msg: AnthropicMessage): MessageResponse {
  if (!msg || typeof msg !== "object") {
    throw new Error("fromAnthropicMessage: invalid response shape");
  }
  return {
    id: typeof msg.id === "string" ? msg.id : "unknown",
    model: typeof msg.model === "string" ? msg.model : "unknown",
    content: Array.isArray(msg.content) ? msg.content.map(fromContent) : [],
    stop_reason:
      typeof msg.stop_reason === "string" ? (msg.stop_reason as MessageResponse["stop_reason"]) : "end_turn",
    usage: {
      input_tokens: sanitizeCount(msg.usage?.input_tokens),
      output_tokens: sanitizeCount(msg.usage?.output_tokens),
      cache_read_input_tokens:
        msg.usage?.cache_read_input_tokens !== undefined
          ? sanitizeCount(msg.usage.cache_read_input_tokens)
          : undefined,
      cache_creation_input_tokens:
        msg.usage?.cache_creation_input_tokens !== undefined
          ? sanitizeCount(msg.usage.cache_creation_input_tokens)
          : undefined,
    },
  };
}

function fromContent(
  b: AnthropicMessage["content"][number]
): MessageResponse["content"][number] {
  if (b.type === "text") {
    return { type: "text", text: typeof b.text === "string" ? b.text : "" };
  }
  if (b.type === "tool_use") {
    return {
      type: "tool_use",
      id: typeof b.id === "string" ? b.id : "",
      name: typeof b.name === "string" ? b.name : "",
      input: b.input && typeof b.input === "object" ? b.input : {},
    };
  }
  // Unknown block type: project to a text block carrying the type
  // name so the caller knows something arrived.
  return { type: "text", text: `[unsupported_block:${b.type}]` };
}

function sanitizeCount(n: number | undefined): number {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return 0;
  return Math.trunc(n);
}
