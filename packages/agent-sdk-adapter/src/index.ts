/**
 * @prune/agent-sdk-adapter
 *
 * Provider-neutral control plane for the Agent SDK loop. Plans prompt-cache
 * breakpoints over CALLER-DECLARED volatility, gates routing on F4 QpD
 * non-inferiority, halts low-ROI loops, and reports cache-saving telemetry
 * — all without depending on any vendor SDK.
 *
 * The Anthropic / OpenAI client (or an Agent SDK `query()` closure, or the
 * F4 fixture runner) plugs in via the `ModelInvoker` function type. Every
 * decision is pure, deterministic, and inspectable.
 */

export * from "./types.js";
export * from "./content.js";
export * from "./tokens.js";
export * from "./cache-planner.js";
export * from "./apply.js";
export * from "./routing.js";
export * from "./loop.js";
export * from "./client.js";
