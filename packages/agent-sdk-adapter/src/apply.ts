/**
 * Materialize a `ProviderRequest` from a neutral `MessageRequest` + breakpoint
 * plan. Pure function — no side effects, no network, no SDK import. The
 * caller-supplied ModelInvoker is the only thing that ever touches a wire.
 *
 * Two important credibility properties pinned by tests:
 *   1. Determinism. Same inputs ⇒ byte-identical output (modulo property
 *      order, which JSON.stringify normalizes when we hash). Required for the
 *      provider's prompt-cache to actually hit.
 *   2. Identity on the no-breakpoint path. A request with NO valid
 *      breakpoints round-trips with no `cache_control` markers — never any
 *      "default" cache annotation we didn't ask for.
 */

import type {
  BreakpointPlan,
  CacheBreakpoint,
  ContentBlock,
  Message,
  MessageRequest,
  ProviderContentBlock,
  ProviderMessage,
  ProviderRequest,
  ProviderSystemBlock,
  ProviderToolDef,
  ToolSchema,
} from "./types.js";

export function applyBreakpoints(
  request: MessageRequest,
  plan: BreakpointPlan
): ProviderRequest {
  // Index breakpoints by (segment, blockIndex) for O(1) lookup.
  const bpAt = new Map<string, CacheBreakpoint>();
  for (const bp of plan.breakpoints) {
    bpAt.set(`${bp.segment}:${bp.blockIndex}`, bp);
  }
  const tagFor = (
    segment: CacheBreakpoint["segment"],
    i: number
  ): { type: "ephemeral"; ttl?: "5m" | "1h" } | undefined => {
    const bp = bpAt.get(`${segment}:${i}`);
    if (!bp) return undefined;
    return bp.ttl === "1h"
      ? { type: "ephemeral", ttl: "1h" }
      : { type: "ephemeral", ttl: "5m" };
  };

  const system: ProviderSystemBlock[] = request.system.map((b, i) => {
    if (b.type !== "text") {
      // System segments must be text; reject loudly rather than coerce.
      throw new Error(
        `applyBreakpoints: system block ${i} is type=${b.type}; only text supported`
      );
    }
    const cc = tagFor("system", i);
    const out: ProviderSystemBlock = { type: "text", text: b.text };
    if (cc) out.cache_control = cc;
    return out;
  });

  const tools: ProviderToolDef[] = request.tools.map((t, i) => {
    const cc = tagFor("tools", i);
    const out: ProviderToolDef = {
      name: t.name,
      description: t.description,
      // CRITICAL: the provider's prompt cache hashes the wire BYTES of the
      // request. Two semantically-identical input_schemas with different key
      // order would silently miss the cache. We canonicalize (deep sort) the
      // schema here so callers don't have to worry about object construction
      // order. Without this, swapping `properties:{a,b}` ↔ `{b,a}` would
      // produce a different fingerprint and break the cache hit.
      input_schema: deepKeySort(t.inputSchema) as Record<string, unknown>,
    };
    if (cc) out.cache_control = cc;
    return out;
  });

  const messages: ProviderMessage[] = request.messages.map((m, mi) => {
    const cc = tagFor("messages", mi);
    return {
      role: m.role,
      content: m.content.map((b, bi) =>
        toProviderBlock(
          b,
          // Only the LAST content block of a message receives the message-level
          // cache_control annotation — the provider's convention.
          cc && bi === m.content.length - 1 ? cc : undefined
        )
      ),
    };
  });

  const out: ProviderRequest = {
    model: request.model,
    system,
    tools,
    messages,
    max_tokens: request.maxOutputTokens,
  };
  if (request.metadata) out.metadata = { ...request.metadata };
  return out;
}

function toProviderBlock(
  b: ContentBlock,
  cc: { type: "ephemeral"; ttl?: "5m" | "1h" } | undefined
): ProviderContentBlock {
  switch (b.type) {
    case "text": {
      const out: ProviderContentBlock = { type: "text", text: b.text };
      if (cc) (out as { cache_control?: typeof cc }).cache_control = cc;
      return out;
    }
    case "tool_use":
      // tool_use does not take cache_control in the provider contract; ignore cc.
      return { type: "tool_use", id: b.id, name: b.name, input: b.input };
    case "tool_result":
      return {
        type: "tool_result",
        tool_use_id: b.tool_use_id,
        content: b.content,
        is_error: b.is_error,
      };
  }
}

/** Stable JSON for hashing / fingerprinting; key-order-canonical. */
export function canonicalJSON(value: unknown): string {
  return JSON.stringify(value, replacer());
}
function replacer(): (k: string, v: unknown) => unknown {
  const seen = new WeakSet<object>();
  return (_k: string, v: unknown) => {
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v as object)) return null;
    seen.add(v as object);
    if (Array.isArray(v)) return v;
    const o = v as Record<string, unknown>;
    const ordered: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) ordered[k] = o[k];
    return ordered;
  };
}

/**
 * Recursively sort object keys for stable wire bytes. Used inside
 * applyBreakpoints to canonicalize tool input_schemas before they hit the
 * provider — required so caller-controlled key order can't accidentally bust
 * the prompt-cache prefix. Defensive against undefined/null and cycles.
 */
export function deepKeySort(value: unknown): unknown {
  return deepKeySortInner(value, new WeakSet());
}
function deepKeySortInner(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value as object)) return null; // cycle guard
  seen.add(value as object);
  if (Array.isArray(value)) {
    return value.map((v) => deepKeySortInner(v, seen));
  }
  const o = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o).sort()) {
    out[k] = deepKeySortInner(o[k], seen);
  }
  return out;
}

/** Utilities for tests + callers. */
export function tools(schemas: ToolSchema[]): ToolSchema[] {
  return schemas;
}
export function msg(role: "user" | "assistant", ...content: ContentBlock[]): Message {
  return { role, content };
}
