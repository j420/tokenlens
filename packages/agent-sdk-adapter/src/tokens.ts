/**
 * Lightweight, provider-neutral token estimator for the planner.
 *
 * The adapter never uses this number for billing display — that's
 * @prune/tokenizer's job (exact or labeled-estimated). The planner only needs
 * a RELATIVE size signal to decide whether a stable run clears the
 * minimum-cacheable-prefix threshold and to rank candidate breakpoints. So a
 * deterministic chars/4 heuristic plus per-block fixed overhead is enough, and
 * it has zero dependencies — important for an isolated control-plane package.
 *
 * If the caller wants precise counts they pass an `EstimateFn` to the planner;
 * the default below is the floor.
 */

import type {
  ContentBlock,
  Message,
  ProviderContentBlock,
  ToolSchema,
} from "./types.js";

/** Caller can override with an exact tokenizer (e.g. Anthropic count_tokens). */
export type EstimateFn = (text: string) => number;

export const defaultEstimate: EstimateFn = (text: string): number => {
  // chars/4 — consistent with the cost-display heuristic used elsewhere.
  if (!text) return 0;
  return Math.ceil(text.length / 4);
};

// Per-block structural overhead (rough, but deterministic + monotone). Real
// providers tokenize JSON keys + block-type tags; these constants approximate
// that without ever falling below truth in a way that would cause the planner
// to think a run clears the min-prefix when it doesn't.
const PER_TEXT_BLOCK_OVERHEAD = 3;
const PER_TOOL_USE_OVERHEAD = 8;
const PER_TOOL_RESULT_OVERHEAD = 6;
const PER_TOOL_SCHEMA_OVERHEAD = 12;

export function estimateContentBlockTokens(
  block: ContentBlock,
  estimate: EstimateFn = defaultEstimate
): number {
  switch (block.type) {
    case "text":
      return PER_TEXT_BLOCK_OVERHEAD + estimate(block.text);
    case "tool_use":
      return (
        PER_TOOL_USE_OVERHEAD +
        estimate(block.name) +
        estimate(JSON.stringify(block.input ?? {}))
      );
    case "tool_result":
      return PER_TOOL_RESULT_OVERHEAD + estimate(block.content);
  }
}

export function estimateProviderBlockTokens(
  block: ProviderContentBlock,
  estimate: EstimateFn = defaultEstimate
): number {
  switch (block.type) {
    case "text":
      return PER_TEXT_BLOCK_OVERHEAD + estimate(block.text);
    case "tool_use":
      return (
        PER_TOOL_USE_OVERHEAD +
        estimate(block.name) +
        estimate(JSON.stringify(block.input ?? {}))
      );
    case "tool_result":
      return PER_TOOL_RESULT_OVERHEAD + estimate(block.content);
  }
}

export function estimateToolSchemaTokens(
  tool: ToolSchema,
  estimate: EstimateFn = defaultEstimate
): number {
  return (
    PER_TOOL_SCHEMA_OVERHEAD +
    estimate(tool.name) +
    estimate(tool.description) +
    estimate(JSON.stringify(tool.inputSchema ?? {}))
  );
}

export function estimateMessageTokens(
  message: Message,
  estimate: EstimateFn = defaultEstimate
): number {
  let sum = 1; // role byte
  for (const b of message.content) sum += estimateContentBlockTokens(b, estimate);
  return sum;
}
