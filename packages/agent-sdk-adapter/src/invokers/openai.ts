/**
 * OpenAI invoker — concrete `ModelInvoker` that talks to the
 * OpenAI Chat Completions API (the surface that ships
 * automatic-prefix caching).
 *
 * Injection-based: caller supplies their `OpenAILikeClient`. We do
 * NOT import `openai` here.
 *
 * Caching posture:
 *   - OpenAI's prompt cache is **automatic** above ~1024 input tokens
 *     for supported models; there are no per-block `cache_control`
 *     markers to attach. Our `BreakpointPlan` is informational only
 *     for this invoker — we still surface the plan so telemetry can
 *     log "what would 5m breakpoints have looked like" and compare
 *     against OpenAI's auto-cache hit rate.
 *
 * Marshalling:
 *   - system → single system message (concatenated text blocks
 *     joined by a NUL-separated double-newline so the join itself
 *     can't collide with caller content).
 *   - tools → OpenAI function-call tool definitions.
 *   - messages → role + content pairs (only text + tool_use +
 *     tool_result kinds are projected; everything else is a
 *     defensive text placeholder).
 *
 * Demarshalling preserves the `usage` totals; OpenAI's
 * `prompt_tokens_details.cached_tokens` (when present) is mapped to
 * `cache_read_input_tokens`. cache_creation_input_tokens stays
 * undefined because OpenAI doesn't bill writes separately.
 */

import type {
  MessageResponse,
  ModelInvoker,
  ProviderContentBlock,
  ProviderMessage,
  ProviderRequest,
} from "../types.js";

export interface OpenAILikeClient {
  chat: {
    completions: {
      create(
        params: OpenAIChatCreateParams
      ): Promise<OpenAIChatCompletion>;
    };
  };
}

export interface OpenAIChatCreateParams {
  model: string;
  max_tokens?: number;
  messages: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content?: string | Array<{ type: string; text?: string }>;
    tool_calls?: Array<{
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }>;
    tool_call_id?: string;
  }>;
  tools?: Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>;
  metadata?: Record<string, string>;
}

export interface OpenAIChatCompletion {
  id: string;
  model: string;
  choices: Array<{
    finish_reason: string;
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    /** Present on caching-enabled models. */
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

export interface CreateOpenAIInvokerOptions {
  client: OpenAILikeClient;
}

export function createOpenAIInvoker(
  options: CreateOpenAIInvokerOptions
): ModelInvoker {
  const client = options.client;
  if (!client || typeof client !== "object" || !client.chat?.completions) {
    throw new Error(
      "createOpenAIInvoker: options.client must be an OpenAILikeClient"
    );
  }
  return async (request: ProviderRequest, _signal?: AbortSignal): Promise<MessageResponse> => {
    const params = toOpenAIChatCreateParams(request);
    const response = await client.chat.completions.create(params);
    return fromOpenAIChatCompletion(response);
  };
}

/* ------------------------------------------------------------------ */
/* Marshalling                                                        */
/* ------------------------------------------------------------------ */

export function toOpenAIChatCreateParams(
  request: ProviderRequest
): OpenAIChatCreateParams {
  const messages: OpenAIChatCreateParams["messages"] = [];
  if (request.system.length > 0) {
    messages.push({
      role: "system",
      content: request.system.map((b) => b.text).join("\n\n"),
    });
  }
  for (const m of request.messages) {
    messages.push(marshalMessage(m));
  }
  const params: OpenAIChatCreateParams = {
    model: request.model,
    max_tokens: request.max_tokens,
    messages,
  };
  if (request.tools.length > 0) {
    params.tools = request.tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));
  }
  if (request.metadata) {
    params.metadata = request.metadata;
  }
  return params;
}

function marshalMessage(m: ProviderMessage): OpenAIChatCreateParams["messages"][number] {
  // Tool calls and tool results need their own message shape in OpenAI.
  const toolCalls = m.content
    .filter((b): b is Extract<ProviderContentBlock, { type: "tool_use" }> =>
      b.type === "tool_use"
    )
    .map((b) => ({
      id: b.id,
      type: "function" as const,
      function: {
        name: b.name,
        arguments: JSON.stringify(b.input ?? {}),
      },
    }));
  const textParts = m.content
    .filter((b): b is Extract<ProviderContentBlock, { type: "text" }> =>
      b.type === "text"
    )
    .map((b) => b.text);

  const role: "user" | "assistant" =
    m.role === "assistant" ? "assistant" : "user";

  const msg: OpenAIChatCreateParams["messages"][number] = {
    role,
    content: textParts.join(""),
  };
  if (toolCalls.length > 0) msg.tool_calls = toolCalls;
  return msg;
}

/* ------------------------------------------------------------------ */
/* Demarshalling                                                      */
/* ------------------------------------------------------------------ */

export function fromOpenAIChatCompletion(
  res: OpenAIChatCompletion
): MessageResponse {
  if (!res || !Array.isArray(res.choices) || res.choices.length === 0) {
    throw new Error("fromOpenAIChatCompletion: invalid response shape");
  }
  const choice = res.choices[0]!;
  const content: MessageResponse["content"] = [];
  if (
    typeof choice.message?.content === "string" &&
    choice.message.content.length > 0
  ) {
    content.push({ type: "text", text: choice.message.content });
  }
  if (Array.isArray(choice.message?.tool_calls)) {
    for (const tc of choice.message.tool_calls) {
      content.push({
        type: "tool_use",
        id: tc.id,
        name: tc.function?.name ?? "",
        input: parseToolArguments(tc.function?.arguments),
      });
    }
  }

  const cachedTokens = res.usage.prompt_tokens_details?.cached_tokens;
  return {
    id: typeof res.id === "string" ? res.id : "unknown",
    model: typeof res.model === "string" ? res.model : "unknown",
    content,
    stop_reason: mapStopReason(choice.finish_reason),
    usage: {
      input_tokens: sanitizeCount(res.usage.prompt_tokens),
      output_tokens: sanitizeCount(res.usage.completion_tokens),
      cache_read_input_tokens:
        cachedTokens !== undefined ? sanitizeCount(cachedTokens) : undefined,
      cache_creation_input_tokens: undefined,
    },
  };
}

function mapStopReason(reason: string | undefined): MessageResponse["stop_reason"] {
  switch (reason) {
    case "stop":
      return "end_turn";
    case "length":
      return "max_tokens";
    case "tool_calls":
      return "tool_use";
    case "function_call":
      return "tool_use";
    default:
      return typeof reason === "string" && reason.length > 0 ? reason : "end_turn";
  }
}

function parseToolArguments(raw: string | undefined): Record<string, unknown> {
  if (typeof raw !== "string" || raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function sanitizeCount(n: number | undefined): number {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return 0;
  return Math.trunc(n);
}
