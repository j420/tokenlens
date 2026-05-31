/**
 * @prune/telemetry
 *
 * Streaming reader + normalizer for Claude Code session transcripts. Feeds
 * the intelligence layer (ROI classifier, cache analyzer, compaction
 * auditor) with structured turn data derived from the raw JSONL.
 *
 * No persistence — see @prune/persistence for that.
 */

export * from "./schema.js";
export * from "./transcript-reader.js";
export * from "./turn-mapper.js";
export * from "./cache-fields.js";
export * from "./projection.js";
export * from "./session-cache.js";
