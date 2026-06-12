/**
 * f21 — Repository Knowledge Compiler.
 *
 * Compiles a repository into a persistent, deterministic knowledge asset:
 * per-file content SHAs, extracted symbols (TS/JS via the repo-map
 * extractor), CODEOWNERS ownership, churn signals, and the symbol-reference
 * graph. Properties the rest of the system depends on:
 *
 *  - DETERMINISTIC: the same working tree compiles to the same
 *    `contentHash`, byte for byte — files, symbols, and edges are sorted,
 *    and the timestamp lives outside the hashed body. This is what lets a
 *    knowledge entry cite "derived from asset <hash>" meaningfully.
 *  - INCREMENTAL: `recompile(prev)` re-extracts only files whose content
 *    SHA changed (the graph is rebuilt — it is cheap relative to
 *    extraction, and partial graph patching is a correctness trap).
 *  - HONEST COVERAGE: non-parseable files still get SHA/owners/churn rows
 *    with zero symbols; a capped walk sets `truncated`; CODEOWNERS lines
 *    outside the supported subset are reported, not guessed.
 */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  buildGraph,
  extractSymbolsFromSource,
  isSupportedSource,
  type ExtractedSymbol,
} from "@prune/repo-map";
import { canonicalize } from "@prune/wastebench";
import { ownersFor, parseCodeowners, type ParsedCodeowners } from "./codeowners.js";
import {
  CompiledKnowledgeSchema,
  type CompiledEdge,
  type CompiledFile,
  type CompiledKnowledge,
  type CompiledSymbol,
} from "./types.js";

export interface CompileOptions {
  /** Max files compiled. Default 5000; hitting it sets `truncated`. */
  maxFiles?: number;
  /** Commits scanned for the churn signal. Default 300. */
  churnWindowCommits?: number;
  now?: () => string;
}

export interface CompileResult {
  asset: CompiledKnowledge;
  /** CODEOWNERS lines skipped as unsupported (visible, not silent). */
  codeownersSkipped: Array<{ line: string; reason: string }>;
  /** Files listed by git but unreadable at compile time (deleted mid-run etc.). */
  unreadable: string[];
}

const CODEOWNERS_LOCATIONS = [
  "CODEOWNERS",
  ".github/CODEOWNERS",
  "docs/CODEOWNERS",
];

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function git(repoRoot: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.error ? String(r.error.message) : (r.stderr ?? ""),
  };
}

/**
 * Churn signal: commits-touching-path over the window, computed from ONE
 * `git log --name-only` stream (never a subprocess per file).
 */
export function churnByPath(
  repoRoot: string,
  windowCommits: number
): Map<string, number> {
  const counts = new Map<string, number>();
  if (windowCommits === 0) return counts;
  const log = git(repoRoot, [
    "log",
    "--no-merges",
    `-n${windowCommits}`,
    "--name-only",
    "--format=%x1e",
  ]);
  if (log.status !== 0) return counts; // not a git repo → zero signal, honestly
  for (const block of log.stdout.split("\u001e")) {
    // Each commit block lists touched paths, one per line; count a path at
    // most once per commit.
    const seen = new Set<string>();
    for (const line of block.split("\n")) {
      const path = line.trim();
      if (path.length === 0 || seen.has(path)) continue;
      seen.add(path);
      counts.set(path, (counts.get(path) ?? 0) + 1);
    }
  }
  return counts;
}

function loadCodeowners(repoRoot: string): {
  parsed: ParsedCodeowners;
  skipped: Array<{ line: string; reason: string }>;
} {
  for (const location of CODEOWNERS_LOCATIONS) {
    const p = join(repoRoot, location);
    if (existsSync(p)) {
      const parsed = parseCodeowners(readFileSync(p, "utf8"));
      return { parsed, skipped: parsed.skipped };
    }
  }
  return { parsed: { rules: [], skipped: [] }, skipped: [] };
}

function compiledBodyHash(
  files: CompiledFile[],
  edges: CompiledEdge[],
  churnWindowCommits: number
): string {
  return sha256(canonicalize({ files, edges, churnWindowCommits }));
}

function extractFor(path: string, absPath: string): {
  contentSha256: string;
  symbols: CompiledSymbol[];
} | null {
  let bytes: Buffer;
  try {
    bytes = readFileSync(absPath);
  } catch {
    return null; // listed by git, gone from the tree — reported upstream
  }
  const contentSha256 = sha256(bytes);
  let symbols: CompiledSymbol[] = [];
  if (isSupportedSource(path)) {
    try {
      symbols = extractSymbolsFromSource(absPath, bytes.toString("utf8")).map(
        (s) => ({
          name: s.name,
          kind: s.kind,
          filePath: path,
          line: s.line,
          signature: s.signature,
          exported: s.exported,
          references: [...s.references].sort(),
        })
      );
    } catch {
      // A file the TS parser chokes on still gets a SHA/owners/churn row;
      // it simply contributes no symbols. Coverage stays honest via the row.
      symbols = [];
    }
  }
  symbols.sort((a, b) => a.line - b.line || a.name.localeCompare(b.name));
  return { contentSha256, symbols };
}

function buildEdges(files: CompiledFile[]): CompiledEdge[] {
  // Reuse the repo-map graph builder over the compiled symbols, projecting
  // its internal ids onto stable "<path>#<name>" ids. `text` is unused by
  // buildGraph (it resolves edges from `references` alone), so the compiled
  // asset can stay signature-only without losing edges.
  const flat: ExtractedSymbol[] = files.flatMap((f) =>
    f.symbols.map((s) => ({
      id: `${s.filePath}#${s.name}#${s.kind}#${s.line}`,
      name: s.name,
      kind: s.kind as ExtractedSymbol["kind"],
      filePath: s.filePath,
      line: s.line,
      text: "",
      signature: s.signature,
      exported: s.exported,
      references: s.references,
    }))
  );
  const graph = buildGraph(flat);
  const edges: CompiledEdge[] = [];
  for (const node of graph.nodes.values()) {
    const from = `${node.filePath}#${node.name}`;
    for (const neighbor of node.outNeighbors) {
      const target = graph.nodes.get(neighbor);
      if (!target) continue;
      edges.push({ from, to: `${target.filePath}#${target.name}` });
    }
  }
  edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  return edges;
}

export function compile(
  repoRoot: string,
  opts: CompileOptions = {}
): CompileResult | { error: string } {
  const maxFiles = opts.maxFiles ?? 5000;
  const windowCommits = opts.churnWindowCommits ?? 300;
  const now = opts.now ?? (() => new Date().toISOString());

  const ls = git(repoRoot, ["ls-files"]);
  if (ls.status !== 0) {
    return { error: `not a git repository (git ls-files failed): ${ls.stderr.trim()}` };
  }
  const allPaths = ls.stdout.split("\n").filter((p) => p.length > 0).sort();
  const truncated = allPaths.length > maxFiles;
  const paths = truncated ? allPaths.slice(0, maxFiles) : allPaths;

  const churn = churnByPath(repoRoot, windowCommits);
  const { parsed: codeowners, skipped } = loadCodeowners(repoRoot);

  const files: CompiledFile[] = [];
  const unreadable: string[] = [];
  for (const path of paths) {
    const extracted = extractFor(path, join(repoRoot, path));
    if (extracted === null) {
      unreadable.push(path);
      continue;
    }
    files.push({
      path,
      contentSha256: extracted.contentSha256,
      symbols: extracted.symbols,
      owners: ownersFor(path, codeowners),
      commitsInWindow: churn.get(path) ?? 0,
    });
  }
  const edges = buildEdges(files);

  return {
    asset: {
      version: 1,
      generatedAt: now(),
      churnWindowCommits: windowCommits,
      files,
      edges,
      truncated,
      contentHash: compiledBodyHash(files, edges, windowCommits),
    },
    codeownersSkipped: skipped,
    unreadable,
  };
}

/**
 * Incremental recompile: files whose content SHA is unchanged keep their
 * extracted symbols (the expensive part); changed/new files re-extract;
 * deleted files drop. Owners and churn are recomputed (both are cheap and
 * both can change without file content changing). Determinism invariant:
 * recompile(prev) on an unchanged tree produces the same contentHash as a
 * fresh compile — pinned by test.
 */
export function recompile(
  repoRoot: string,
  prev: CompiledKnowledge,
  opts: CompileOptions = {}
): CompileResult | { error: string } {
  const maxFiles = opts.maxFiles ?? 5000;
  const windowCommits = opts.churnWindowCommits ?? prev.churnWindowCommits;
  const now = opts.now ?? (() => new Date().toISOString());

  const ls = git(repoRoot, ["ls-files"]);
  if (ls.status !== 0) {
    return { error: `not a git repository (git ls-files failed): ${ls.stderr.trim()}` };
  }
  const allPaths = ls.stdout.split("\n").filter((p) => p.length > 0).sort();
  const truncated = allPaths.length > maxFiles;
  const paths = truncated ? allPaths.slice(0, maxFiles) : allPaths;

  const prevByPath = new Map(prev.files.map((f) => [f.path, f]));
  const churn = churnByPath(repoRoot, windowCommits);
  const { parsed: codeowners, skipped } = loadCodeowners(repoRoot);

  const files: CompiledFile[] = [];
  const unreadable: string[] = [];
  for (const path of paths) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(repoRoot, path));
    } catch {
      unreadable.push(path);
      continue;
    }
    const contentSha256 = sha256(bytes);
    const previous = prevByPath.get(path);
    let symbols: CompiledSymbol[];
    if (previous !== undefined && previous.contentSha256 === contentSha256) {
      symbols = previous.symbols; // unchanged — reuse the expensive part
    } else {
      const extracted = extractFor(path, join(repoRoot, path));
      symbols = extracted === null ? [] : extracted.symbols;
    }
    files.push({
      path,
      contentSha256,
      symbols,
      owners: ownersFor(path, codeowners),
      commitsInWindow: churn.get(path) ?? 0,
    });
  }
  const edges = buildEdges(files);

  return {
    asset: {
      version: 1,
      generatedAt: now(),
      churnWindowCommits: windowCommits,
      files,
      edges,
      truncated,
      contentHash: compiledBodyHash(files, edges, windowCommits),
    },
    codeownersSkipped: skipped,
    unreadable,
  };
}

// ============================================================================
// Persistence
// ============================================================================

export function knowledgeDir(repoRoot: string): string {
  return join(repoRoot, ".prune", "knowledge");
}

export function compiledAssetPath(repoRoot: string): string {
  return join(knowledgeDir(repoRoot), "compiled.json");
}

/** tmp+rename — a crash mid-write never leaves a torn asset. */
export function writeAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

export function saveCompiled(repoRoot: string, asset: CompiledKnowledge): string {
  const path = compiledAssetPath(repoRoot);
  writeAtomic(path, JSON.stringify(asset, null, 2) + "\n");
  return path;
}

export function loadCompiled(repoRoot: string): CompiledKnowledge | null {
  try {
    const raw = JSON.parse(readFileSync(compiledAssetPath(repoRoot), "utf8"));
    const parsed = CompiledKnowledgeSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
