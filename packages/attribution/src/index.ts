/**
 * @prune/attribution
 *
 * Cross-vendor per-developer / per-PR / per-project cost attribution.
 * Local-first; auto-detects dimensions from git + CI env so callers
 * don't have to instrument calls. Competes with Anthropic Enterprise
 * Analytics on every plan, across every coding agent (Claude Code,
 * Cursor, Cline, Codex CLI, Aider) — same data, no Enterprise-plan
 * gate, no Anthropic-only lock-in.
 */

export {
  type AttributionDimensions,
  encodeDimensions,
  decodeDimensions,
} from "./dimensions.js";

export {
  detectDimensions,
  type DetectOptions,
} from "./context.js";

export {
  rollup,
  type RollupOptions,
  type RollupGroup,
  type RollupKey,
} from "./rollup.js";
