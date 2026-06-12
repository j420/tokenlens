/**
 * Governed-arm context brief: a deterministic, signatures-only map of the
 * task-relevant region of the repo, prepended to the prompt. This is the
 * "selection" half of the governed arm (the hooks are the "governance" half).
 *
 * Built on @prune/repo-map (PageRank over the symbol graph, biased by the
 * task prompt). Includes the L4-20 compressor-eligibility pre-filter: the
 * brief is only attached when its own size clears a deterministic arithmetic
 * gate, so the governance layer can never inject more context than it is
 * plausibly worth. The brief's character count is reported as overhead — it
 * goes ON the WasteBench ledger, not under it.
 */

import { indexRepo, queryMap, type RankedSymbol } from "@prune/repo-map";

export interface ContextBrief {
  /** The text to prepend to the prompt; empty when ineligible. */
  text: string;
  /** Whether the eligibility gate admitted the brief. */
  eligible: boolean;
  reason: string;
  /** Conservative size accounting (chars; tokens are provider-reported later). */
  chars: number;
  symbolCount: number;
}

export interface BriefOptions {
  /** Max symbols listed. Default 40. */
  topK?: number;
  /** Hard cap on brief size in characters. Default 8000. */
  maxChars?: number;
  /**
   * Minimum symbols for a brief to be worth its framing overhead. A brief
   * with fewer matches than this is dropped (L4-20: never attach
   * negative-expected-value context). Default 3.
   */
  minSymbols?: number;
}

export function renderBrief(symbols: RankedSymbol[]): string {
  if (symbols.length === 0) return "";
  const byFile = new Map<string, RankedSymbol[]>();
  for (const s of symbols) {
    const bucket = byFile.get(s.filePath) ?? [];
    bucket.push(s);
    byFile.set(s.filePath, bucket);
  }
  const lines: string[] = [
    "Repository map (signatures only, ranked by relevance to the task):",
    "",
  ];
  for (const [file, syms] of byFile) {
    lines.push(`// ${file}`);
    for (const s of syms) {
      lines.push(`  ${s.signature || s.name}  [${s.kind}, line ${s.line}]`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Deterministic eligibility gate (L4-20). Pure arithmetic on sizes — no
 * model, no heuristics that could silently bloat the governed arm.
 */
export function briefEligibility(
  text: string,
  symbolCount: number,
  opts: BriefOptions = {}
): { eligible: boolean; reason: string } {
  const maxChars = opts.maxChars ?? 8000;
  const minSymbols = opts.minSymbols ?? 3;
  if (symbolCount < minSymbols) {
    return {
      eligible: false,
      reason: `only ${symbolCount} relevant symbols (< ${minSymbols}); brief not worth its framing overhead`,
    };
  }
  if (text.length > maxChars) {
    return {
      eligible: false,
      reason: `brief is ${text.length} chars (> ${maxChars} cap)`,
    };
  }
  return { eligible: true, reason: "within size budget" };
}

export async function buildContextBrief(
  repoRoot: string,
  taskPrompt: string,
  opts: BriefOptions = {}
): Promise<ContextBrief> {
  const topK = opts.topK ?? 40;
  const map = await indexRepo(repoRoot);
  const ranked = queryMap(map, { taskQuery: taskPrompt, topK });
  const text = renderBrief(ranked);
  const { eligible, reason } = briefEligibility(text, ranked.length, opts);
  return {
    text: eligible ? text : "",
    eligible,
    reason,
    chars: eligible ? text.length : 0,
    symbolCount: ranked.length,
  };
}
