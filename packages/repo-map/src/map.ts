/**
 * RepoMap — the public API.
 *
 * Productizes the Aider repo-map discipline (PageRank over an AST-derived
 * symbol graph) cross-agent via this package. Reference benchmark:
 * Aider uses 4.2× fewer tokens than Claude Code on the same 47-file task
 * (https://www.morphllm.com/comparisons/morph-vs-aider-diff). The shape
 * here is the same; the consumer chooses how to ship it (MCP tool, CLI,
 * Smart Copy variant).
 *
 * v0.1 scope:
 *   - TypeScript / JavaScript only via the TS Compiler API (no regex).
 *   - One-shot indexing; no incremental on-edit. Index a small/medium
 *     repo (up to ~100k LoC) in seconds; output stays under the agent
 *     budget.
 *   - Optional bias (personalized PageRank) for intent-conditioned
 *     ranking — pass a `taskQuery` and the indexer surfaces symbols
 *     whose name or signature contains a query term.
 */

import { promises as fs } from "node:fs";
import { join, relative } from "node:path";

import {
  extractSymbolsFromSource,
  isSupportedSource,
  type ExtractedSymbol,
} from "./parser.js";
import { buildGraph, type SymbolGraph, type SymbolNode } from "./graph.js";
import { pagerank, type PageRankOptions } from "./pagerank.js";

export interface IndexOptions {
  /** Glob-style ignore prefixes (matched against the repo-relative path). */
  ignore?: string[];
  /** Hard cap on files scanned. Default 5000. */
  maxFiles?: number;
  /** Hard cap on total bytes scanned. Default 50 MB. */
  maxBytes?: number;
}

export interface QueryOptions extends PageRankOptions {
  /** Free-text query — surfaces symbols whose name or signature contains a token. */
  taskQuery?: string;
  /** Max symbols to return. Default 50. */
  topK?: number;
}

export interface RankedSymbol {
  id: string;
  name: string;
  kind: string;
  filePath: string;
  line: number;
  signature: string;
  score: number;
  inDegree: number;
  outDegree: number;
}

const DEFAULT_IGNORE = [
  "node_modules/",
  "dist/",
  "build/",
  ".git/",
  ".next/",
  ".turbo/",
  "coverage/",
];

async function walk(
  dir: string,
  rootAbs: string,
  ignore: string[],
  maxFiles: number,
  maxBytes: number,
  out: string[],
  state: { files: number; bytes: number }
): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (state.files >= maxFiles || state.bytes >= maxBytes) return;
    const abs = join(dir, e.name);
    const rel = relative(rootAbs, abs);
    if (ignore.some((p) => rel.startsWith(p) || rel.includes("/" + p))) continue;
    if (e.isDirectory()) {
      await walk(abs, rootAbs, ignore, maxFiles, maxBytes, out, state);
    } else if (e.isFile() && isSupportedSource(abs)) {
      let stat;
      try {
        stat = await fs.stat(abs);
      } catch {
        continue;
      }
      state.files++;
      state.bytes += stat.size;
      out.push(abs);
    }
  }
}

export interface RepoMap {
  root: string;
  symbols: ExtractedSymbol[];
  graph: SymbolGraph;
  filesScanned: number;
  bytesScanned: number;
}

export async function indexRepo(
  root: string,
  opts: IndexOptions = {}
): Promise<RepoMap> {
  const ignore = [...DEFAULT_IGNORE, ...(opts.ignore ?? [])];
  const maxFiles = opts.maxFiles ?? 5000;
  const maxBytes = opts.maxBytes ?? 50 * 1024 * 1024;
  const rootAbs = root;
  const files: string[] = [];
  const state = { files: 0, bytes: 0 };
  await walk(rootAbs, rootAbs, ignore, maxFiles, maxBytes, files, state);

  const symbols: ExtractedSymbol[] = [];
  for (const f of files) {
    try {
      const src = await fs.readFile(f, "utf-8");
      symbols.push(...extractSymbolsFromSource(f, src));
    } catch {
      // Unreadable files just don't contribute symbols.
    }
  }

  const graph = buildGraph(symbols);
  return {
    root: rootAbs,
    symbols,
    graph,
    filesScanned: state.files,
    bytesScanned: state.bytes,
  };
}

/**
 * Rank the symbols in `map` by PageRank, optionally biased toward
 * matches of `taskQuery`. Returns the top-K ranked symbols with
 * signatures only — the consumer can decide to fetch full bodies for
 * the top few if needed.
 */
export function queryMap(map: RepoMap, opts: QueryOptions = {}): RankedSymbol[] {
  let bias: Map<string, number> | undefined;
  if (opts.taskQuery && opts.taskQuery.trim()) {
    bias = new Map();
    const tokens = opts.taskQuery
      .toLowerCase()
      .split(/[^a-zA-Z0-9_]+/)
      .filter((t) => t.length >= 3);
    for (const node of map.graph.nodes.values()) {
      const hay = (node.name + " " + node.signature).toLowerCase();
      let hits = 0;
      for (const t of tokens) {
        if (hay.includes(t)) hits++;
      }
      if (hits > 0) bias.set(node.id, hits);
    }
    if (bias.size === 0) bias = undefined;
  }

  const { scores } = pagerank(map.graph, { ...opts, bias });
  const topK = opts.topK ?? 50;
  const sorted = Array.from(map.graph.nodes.values())
    .map((n: SymbolNode) => ({
      id: n.id,
      name: n.name,
      kind: n.kind,
      filePath: n.filePath,
      line: n.line,
      signature: n.signature,
      score: scores.get(n.id) ?? 0,
      inDegree: n.inNeighbors.length,
      outDegree: n.outNeighbors.length,
    }))
    .sort((a, b) => b.score - a.score);
  return sorted.slice(0, topK);
}
