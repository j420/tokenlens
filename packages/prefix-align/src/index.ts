/**
 * @prune/prefix-align (List1 openai-increment-prefix-aligner)
 *
 * Align a stable prefix to the provider's cache-increment boundary
 * (default OpenAI 1024 + 128·k): cacheable portion, wasted tail, pad-to-next
 * advice. Pure arithmetic; no regex, no model.
 */

export {
  alignPrefix,
  type AlignOptions,
  type AlignResult,
} from "./align.js";
