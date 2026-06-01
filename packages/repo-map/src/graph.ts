/**
 * Symbol dependency graph builder.
 *
 * Edges are directed: A → B means "symbol A references symbol B by name".
 * We resolve references by identifier text. When multiple symbols share a
 * name (overloads, same-name-different-file), we connect to all of them
 * and let PageRank distribute the score — the same shortcut Aider's
 * repo-map takes.
 */

import type { ExtractedSymbol } from "./parser.js";

export interface SymbolNode extends ExtractedSymbol {
  outNeighbors: string[]; // ids
  inNeighbors: string[]; // ids
}

export interface SymbolGraph {
  /** id → node */
  nodes: Map<string, SymbolNode>;
  /** name → list of node ids that share that name */
  nameIndex: Map<string, string[]>;
}

export function buildGraph(symbols: ExtractedSymbol[]): SymbolGraph {
  const nodes = new Map<string, SymbolNode>();
  const nameIndex = new Map<string, string[]>();
  for (const s of symbols) {
    nodes.set(s.id, {
      ...s,
      outNeighbors: [],
      inNeighbors: [],
    });
    const arr = nameIndex.get(s.name) ?? [];
    arr.push(s.id);
    nameIndex.set(s.name, arr);
  }
  // Resolve references → targets by name lookup.
  for (const node of nodes.values()) {
    const seen = new Set<string>();
    for (const ref of node.references) {
      const targets = nameIndex.get(ref);
      if (!targets) continue;
      for (const t of targets) {
        if (t === node.id) continue; // skip self-reference
        if (seen.has(t)) continue;
        seen.add(t);
        node.outNeighbors.push(t);
        nodes.get(t)!.inNeighbors.push(node.id);
      }
    }
  }
  return { nodes, nameIndex };
}
