/**
 * Repo-map artifact — the zero-spend "floor plan" a user sees on screen
 * before any money is spent, built to the Aider repo-map discipline:
 *
 *  - PageRank over the symbol dependency graph decides WHAT matters
 *    (@prune/repo-map, signatures only);
 *  - a TOKEN BUDGET decides HOW MUCH is shown: binary search over the
 *    ranked-symbol count for the largest map that fits the budget, with
 *    sizes measured by the local tokenizer (labeled local BPE count, not a
 *    provider report) — Aider's defining behavior, not a flat char cap;
 *  - an optional QUERY personalizes the ranking toward a task ("what files
 *    matter for the auth bug?") the way Aider biases toward chat files;
 *  - rendering is an outline: files in importance order, symbols within a
 *    file in source order, one signature line each.
 *
 * Honesty notes baked into the artifact: the header carries the scan
 * envelope (files/bytes/symbols, shown/total, measured token size), and a
 * repo with no parseable sources SAYS the indexer is TS/JS-only (v0.1)
 * instead of rendering an empty shell as if the repo were empty.
 */

import { indexRepo, queryMap, type RankedSymbol } from "@prune/repo-map";
import { countTokens } from "@prune/tokenizer";

export interface RepoMapArtifact {
  /** Markdown document (also what `prune-proof map` prints). */
  text: string;
  /** Symbols shown after budget fitting. */
  symbolCount: number;
  /** Symbols the ranking had available before the budget cut. */
  rankedAvailable: number;
  /** Local-BPE token size of `text` (the budget the map was fitted to). */
  tokens: number;
  filesScanned: number;
  bytesScanned: number;
  /** True when the scan stopped at the file/byte cap (partial coverage). */
  scanTruncated: boolean;
  /**
   * True when even a one-symbol map exceeds the budget (the honest floor):
   * `tokens` is the real measured size, larger than the requested budget.
   */
  exceedsBudget: boolean;
  /** False when no parseable sources were found (artifact explains why). */
  hasSymbols: boolean;
}

export interface RepoMapArtifactOptions {
  /**
   * Token budget the rendered map must fit (local BPE count). Default 1024,
   * matching Aider's default map size.
   */
  tokenBudget?: number;
  /** Optional task text to personalize the ranking toward. */
  query?: string;
  /** Upper bound on symbols considered before fitting. Default 512. */
  maxSymbols?: number;
  now?: () => string;
}

/** Files in first-appearance (importance) order; symbols in source order. */
function renderOutline(symbols: RankedSymbol[]): string {
  const byFile = new Map<string, RankedSymbol[]>();
  for (const s of symbols) {
    const list = byFile.get(s.filePath) ?? [];
    list.push(s);
    byFile.set(s.filePath, list);
  }
  const L: string[] = [];
  for (const [file, syms] of byFile) {
    L.push(`${file}:`);
    for (const s of [...syms].sort((a, b) => a.line - b.line)) {
      L.push(`│ ${s.signature}`);
    }
    L.push("");
  }
  return L.join("\n");
}

function header(
  repoRoot: string,
  generatedAt: string,
  scan: {
    filesScanned: number;
    bytesScanned: number;
    totalSymbols: number;
    truncated: boolean;
  },
  fitted: { shown: number; available: number; tokens: number; budget: number },
  query: string | undefined
): string {
  const L: string[] = [];
  L.push(`# Repo map — ${repoRoot}`);
  L.push("");
  L.push(
    `Generated ${generatedAt} · ${scan.filesScanned} files scanned (${scan.bytesScanned} bytes)` +
      (scan.truncated ? " — **scan TRUNCATED at the file/byte cap; coverage is partial**" : "") +
      ` · ${scan.totalSymbols} symbols indexed`
  );
  L.push(
    `Showing ${fitted.shown} of ${fitted.available} ranked symbols — fitted to a ` +
      `${fitted.budget}-token budget (measured: ${fitted.tokens} tokens, local BPE count)` +
      (fitted.tokens > fitted.budget
        ? " — **exceeds budget: minimum one-symbol map**"
        : "")
  );
  L.push(
    `Ranking: PageRank over the symbol dependency graph` +
      (query ? `, personalized toward: "${query}"` : "") +
      ` (signatures only — the same ranking that seeds the governed arm's context brief).`
  );
  L.push("");
  return L.join("\n");
}

export async function buildRepoMapArtifact(
  repoRoot: string,
  opts: RepoMapArtifactOptions = {}
): Promise<RepoMapArtifact> {
  const tokenBudget = opts.tokenBudget ?? 1024;
  const maxSymbols = opts.maxSymbols ?? 512;
  const now = opts.now ?? (() => new Date().toISOString());
  const map = await indexRepo(repoRoot);
  const ranked = queryMap(map, { topK: maxSymbols, taskQuery: opts.query });
  const generatedAt = now();
  const scan = {
    filesScanned: map.filesScanned,
    bytesScanned: map.bytesScanned,
    totalSymbols: map.symbols.length,
    truncated: map.truncated,
  };

  if (ranked.length === 0) {
    const text =
      header(repoRoot, generatedAt, scan, { shown: 0, available: 0, tokens: 0, budget: tokenBudget }, opts.query) +
      "**No symbols could be indexed.** The current indexer parses " +
      "TypeScript/JavaScript sources; this repository may use other " +
      "languages (a known v0.1 limitation — the map declines rather than " +
      "pretending the repo is empty), or contains no parseable source files.";
    return {
      text,
      symbolCount: 0,
      rankedAvailable: 0,
      tokens: countTokens(text).tokens,
      filesScanned: scan.filesScanned,
      bytesScanned: scan.bytesScanned,
      scanTruncated: scan.truncated,
      exceedsBudget: false,
      hasSymbols: false,
    };
  }

  // Binary search the largest prefix of the ranked list whose rendered
  // outline fits the token budget (header excluded from the budget so a
  // verbose path/repo name cannot starve the map itself). At least one
  // symbol is always shown — a budget too small for one line still yields
  // an honest, minimal map rather than nothing.
  const fits = (k: number): number =>
    countTokens(renderOutline(ranked.slice(0, k))).tokens;
  let lo = 1;
  let hi = ranked.length;
  let best = 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid) <= tokenBudget) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  const body = renderOutline(ranked.slice(0, best));
  const bodyTokens = countTokens(body).tokens;
  const text =
    header(
      repoRoot,
      generatedAt,
      scan,
      { shown: best, available: ranked.length, tokens: bodyTokens, budget: tokenBudget },
      opts.query
    ) + body;
  return {
    text,
    symbolCount: best,
    rankedAvailable: ranked.length,
    tokens: bodyTokens,
    filesScanned: scan.filesScanned,
    bytesScanned: scan.bytesScanned,
    scanTruncated: scan.truncated,
    exceedsBudget: bodyTokens > tokenBudget,
    hasSymbols: true,
  };
}
