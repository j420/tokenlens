/**
 * Provider-neutral types for the Agent SDK adapter.
 *
 * Design rule (carried from the program mandate): NO regex. NO sniffing of
 * payloads for volatility. The caller declares which content is `stable` and
 * which is `volatile` via discriminated-union tags. That declaration is the
 * single source of truth for cache-breakpoint placement; the planner never
 * second-guesses it.
 *
 * Design rule: NO SDK dependency. The adapter calls a caller-supplied
 * `ModelInvoker` function. The Anthropic / OpenAI client, an Agent SDK
 * `query()` closure, and the F4 fixture runner all plug into the same shape.
 */

import type { Provider } from "@prune/shared";

// ---- Content blocks -------------------------------------------------------

/** A single content block. `volatility` is REQUIRED — no sniffing. */
export type ContentBlock =
  | { type: "text"; text: string; volatility: Volatility; cacheable?: boolean }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
      volatility: Volatility;
    }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: string;
      is_error?: boolean;
      volatility: Volatility;
    };

/**
 * Declared content stability. The cache-breakpoint planner walks the prefix
 * from the start, placing breakpoints at boundaries between `stable` and
 * `volatile` runs. A `volatile` block can never be inside a cacheable prefix.
 */
export type Volatility = "stable" | "volatile";

/** A tool schema entry the model sees; required for the F2/MCP audit too. */
export interface ToolSchema {
  name: string;
  description: string;
  /** JSON schema body (kept opaque — adapter never inspects it). */
  inputSchema: Record<string, unknown>;
  /** Whether this tool's definition should sit in the cacheable prefix. */
  volatility: Volatility;
}

// ---- Messages -------------------------------------------------------------

export type MessageRole = "user" | "assistant";

export interface Message {
  role: MessageRole;
  /** Content is always blocks — no string short-form, so volatility is total. */
  content: ContentBlock[];
}

export interface MessageRequest {
  model: string;
  provider: Provider;
  /**
   * System prompt as ordered blocks. Place STABLE blocks (e.g. CLAUDE.md,
   * persistent rules) first; VOLATILE last (timestamps, session state). The
   * planner relies on this ordering for breakpoint placement.
   */
  system: ContentBlock[];
  tools: ToolSchema[];
  messages: Message[];
  /** Hard ceiling, in tokens, on output. Required — no silent defaults. */
  maxOutputTokens: number;
  /** Optional metadata propagated to telemetry. */
  metadata?: Record<string, string>;
}

// ---- Usage + response (echoes Anthropic's usage shape but neutral) --------

export interface UsageReport {
  input_tokens: number;
  output_tokens: number;
  /** Tokens served from the prompt cache (10% of input price, typically). */
  cache_read_input_tokens?: number;
  /** Tokens written into the cache by this request (1.25× / 2× of input). */
  cache_creation_input_tokens?: number;
}

export interface MessageResponse {
  id: string;
  model: string;
  /** Provider-reported content blocks (text/tool_use). */
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  >;
  stop_reason: "end_turn" | "max_tokens" | "tool_use" | "stop_sequence" | string;
  usage: UsageReport;
}

// ---- Cache control --------------------------------------------------------

/** A breakpoint annotation produced by the planner; provider-neutral. */
export interface CacheBreakpoint {
  /** Which segment slot the breakpoint terminates. */
  segment: "system" | "tools" | "messages";
  /**
   * Zero-based index of the block (within its segment) after which the
   * breakpoint sits. `cache_control` annotates THIS block.
   */
  blockIndex: number;
  /** TTL hint. 5m is the cheap-writes tier; 1h is the long-prefix tier. */
  ttl: "5m" | "1h";
  /** Estimated cumulative tokens of the cacheable prefix up to and including this block. */
  cumulativeTokens: number;
}

/** What the planner produces — pure data, no SDK side effects. */
export interface BreakpointPlan {
  /** Up to 4 (Anthropic's limit). Always ordered by `cumulativeTokens` ascending. */
  breakpoints: CacheBreakpoint[];
  /** Reasons individual potential breakpoints were rejected — for telemetry. */
  rejected: Array<{
    segment: CacheBreakpoint["segment"];
    blockIndex: number;
    reason: string;
  }>;
  /** Tokens in the cacheable prefix (sum across stable runs that got a breakpoint). */
  cacheablePrefixTokens: number;
}

// ---- The pluggable invoker ------------------------------------------------

/**
 * Caller-supplied function that actually talks to the model. The Anthropic /
 * OpenAI SDK client is wrapped here ONCE by the caller; everything else in
 * this package is pure logic over this signature.
 *
 * Crucially, the invoker receives the PLANNED request (with cache_control
 * markers already attached as needed by the planner via `applyBreakpoints`
 * BEFORE the invoker runs) — the adapter does not depend on the invoker
 * understanding TokenLens types.
 */
export type ModelInvoker = (
  request: ProviderRequest,
  signal?: AbortSignal
) => Promise<MessageResponse>;

/**
 * The provider-shaped request the invoker actually sends. This is what
 * `applyBreakpoints` materializes from `(MessageRequest, BreakpointPlan)`.
 * Kept structurally close to the Anthropic Messages API shape so the
 * Anthropic invoker is a one-liner, but the field names are ours.
 */
export interface ProviderRequest {
  model: string;
  system: ProviderSystemBlock[];
  tools: ProviderToolDef[];
  messages: ProviderMessage[];
  max_tokens: number;
  metadata?: Record<string, string>;
}

export interface ProviderSystemBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral"; ttl?: "5m" | "1h" };
}

export interface ProviderToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  cache_control?: { type: "ephemeral"; ttl?: "5m" | "1h" };
}

export interface ProviderMessage {
  role: MessageRole;
  content: Array<ProviderContentBlock>;
}

export type ProviderContentBlock =
  | {
      type: "text";
      text: string;
      cache_control?: { type: "ephemeral"; ttl?: "5m" | "1h" };
    }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    };

// ---- Loop-halt + routing decisions ---------------------------------------

export interface LoopHaltDecision {
  halt: boolean;
  reason: string;
  /** Optional cheaper model the router thinks the user could fall back to. */
  suggestedModel?: string | null;
  /** Number of consecutive low-ROI turns that produced this decision. */
  streak: number;
}

export class LoopHaltError extends Error {
  constructor(
    message: string,
    readonly decision: LoopHaltDecision
  ) {
    super(message);
    this.name = "LoopHaltError";
  }
}
