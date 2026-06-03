/**
 * @prune/semantic-cache (F7)
 *
 * Public surface. Hook scripts, MCP server, and dashboard consume
 * these symbols; downstream packages should not reach into source
 * modules directly.
 */

export * from "./types.js";
export {
  LexicalEmbedder,
  cosine,
  DEFAULT_LEXICAL_EMBEDDER_OPTIONS,
  type LexicalEmbedderOptions,
} from "./lexical-embedder.js";
export {
  SemanticCache,
  DEFAULT_SEMANTIC_CACHE_CONFIG,
  type SemanticCacheOptions,
  type SerializedSemanticCache,
} from "./cache.js";
export { contentShaFreshness } from "./freshness.js";
