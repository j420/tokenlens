/**
 * @prune/mcp-proxy (E1)
 *
 * Cross-vendor lazy-schema MCP proxy. Sits between any MCP host (Cursor,
 * Codex CLI, Cline, Continue, Aider, ...) and one or more upstream MCP
 * servers; intercepts the JSON-RPC handshake to return only the tools
 * matching the current intent. The full `inputSchema` for each tool
 * loads lazily on first `tools/call` reference and passes through
 * `@prune/sentinel`'s injection shield before substitution.
 *
 * v0.1 ships the PURE TRANSFORMATION LAYER (indexing + matching + lazy
 * load). v0.2 adds the Node-side stdio / socket transport that mounts
 * this against a live host. Keeping the transport out of v0.1 means the
 * package builds and tests without any vendor-specific MCP client SDK.
 *
 * Discipline:
 *   - No regex (typed JSON walks + char-code tokenization)
 *   - No model call (verb classifier is a rule table)
 *   - Caller-declared intent (from `@prune/router/classifier`)
 *   - Fail-safe-to-INCLUDE (uncertain matches return the full catalog)
 *   - Every dynamically-loaded schema passes `@prune/sentinel`
 *
 * Public surface: types, indexer, matcher, lazy loader, proxy class,
 * `quality_proof` schema. Hook scripts and the MCP server consume these;
 * downstream packages should not reach into source modules.
 */

export * from "./types.js";
export {
  tokenizeToolName,
  classifyToolNameByVerbs,
  getVerbTable,
} from "./verb-classifier.js";
export {
  indexCatalog,
  ALL_INTENTS,
  type IndexOptions,
} from "./catalog.js";
export {
  matchCatalog,
  type MatchOptions,
  type MatchResult,
} from "./intent-matcher.js";
export {
  LazyLoader,
  type LazyLoadResult,
} from "./lazy-loader.js";
export {
  McpProxy,
  type ProxyOptions,
  type ServeResult,
} from "./proxy.js";
export {
  buildQualityProof,
  MCP_PROXY_FEATURE_ID,
  QUALITY_PROOF_SCHEMA_VERSION,
  type McpProxyQualityProof,
} from "./quality-proof.js";
