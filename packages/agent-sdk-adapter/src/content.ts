/**
 * Structured content builders — the regex-free way to declare volatility.
 *
 * Every call site that constructs a ContentBlock should use these helpers so
 * volatility is a deliberate, code-reviewable choice. If a caller forgets to
 * mark volatility, TypeScript rejects the call.
 */

import type { ContentBlock, Message, MessageRole, ToolSchema } from "./types.js";

/** Stable text — eligible to sit inside a cacheable prefix. */
export function stableText(text: string): ContentBlock {
  return { type: "text", text, volatility: "stable" };
}

/** Volatile text — never inside a cacheable prefix (timestamps, session ids). */
export function volatileText(text: string): ContentBlock {
  return { type: "text", text, volatility: "volatile" };
}

/** Tool-use block. Tool inputs are volatile by nature (per-call args). */
export function toolUse(
  id: string,
  name: string,
  input: Record<string, unknown>
): ContentBlock {
  return { type: "tool_use", id, name, input, volatility: "volatile" };
}

/** Tool-result block. Volatile by default; mark stable only if you know it is. */
export function toolResult(
  toolUseId: string,
  content: string,
  options: { isError?: boolean; volatility?: "stable" | "volatile" } = {}
): ContentBlock {
  return {
    type: "tool_result",
    tool_use_id: toolUseId,
    content,
    is_error: options.isError,
    volatility: options.volatility ?? "volatile",
  };
}

export function message(role: MessageRole, ...content: ContentBlock[]): Message {
  return { role, content };
}

/** Tool schema with declared volatility — `stable` is the right default. */
export function tool(
  name: string,
  description: string,
  inputSchema: Record<string, unknown>,
  volatility: "stable" | "volatile" = "stable"
): ToolSchema {
  return { name, description, inputSchema, volatility };
}
