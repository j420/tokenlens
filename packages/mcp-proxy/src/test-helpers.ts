/**
 * Test-only helpers. Loads the real-capture fixture and provides typed
 * builders for ad-hoc minimal catalogs.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import type { McpTool, ToolCatalog, ToolTokenCost } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Load the real-capture multi-server catalog fixture. Cited inline in
 * the fixture file: tool names from github.com/modelcontextprotocol/servers
 * public READMEs, June 2026.
 */
export function loadFixtureCatalog(): ToolCatalog {
  const path = resolve(here, "..", "test", "fixtures", "catalog-multi-server.json");
  const raw = JSON.parse(readFileSync(path, "utf8")) as {
    _source: string;
    tools: McpTool[];
  };
  return { tools: raw.tools };
}

/** Build a synthetic minimal catalog for testing pure logic. */
export function buildCatalog(tools: McpTool[]): ToolCatalog {
  return { tools };
}

/**
 * Build a per-tool token cost map for the fixture catalog. Caller-supplied
 * counts simulate what `@prune/tokenizer` would produce at index time.
 * For the fixture: schema and description bytes counted at 0.25 tokens/byte
 * (the gpt-tokenizer rule of thumb) so audits are reproducible.
 */
export function tokenCostsForCatalog(
  catalog: ToolCatalog
): Map<string, ToolTokenCost> {
  const out = new Map<string, ToolTokenCost>();
  for (const tool of catalog.tools) {
    out.set(tool.name, {
      schemaTokens: Math.ceil(JSON.stringify(tool.inputSchema).length / 4),
      descriptionTokens: Math.ceil((tool.description ?? "").length / 4),
    });
  }
  return out;
}
