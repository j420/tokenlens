/**
 * Symbol-coverage equivalence.
 *
 * For mixed code+prose output where neither full-AST nor full-text comparison
 * is appropriate, we ask a weaker but useful question: do the named entities
 * (function names, identifiers, types) that appeared in the REFERENCE output
 * also appear in the CANDIDATE output? This is the F4 "output coverage"
 * signal and the F1 mixed-response check.
 *
 * It is intentionally directional: coverage(ref, cand) measures how much of
 * the reference the candidate reproduces, not vice versa.
 */

/** Tokenize into candidate "symbols": identifier-like words ≥ 2 chars. */
export function extractSymbols(text: string): Set<string> {
  const symbols = new Set<string>();
  // Identifier-ish: letter/underscore/$ start, then word chars. Captures
  // function names, variables, types, members.
  const re = /[A-Za-z_$][A-Za-z0-9_$]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const tok = m[0];
    if (tok.length >= 2 && !STOPWORDS.has(tok.toLowerCase())) {
      symbols.add(tok);
    }
  }
  return symbols;
}

export interface CoverageResult {
  /** Fraction of reference symbols present in the candidate, in [0,1]. */
  coverage: number;
  equivalent: boolean;
  referenceSymbols: number;
  coveredSymbols: number;
  missing: string[];
}

/**
 * Compute directional symbol coverage of `candidate` against `reference`.
 * Equivalent when coverage ≥ threshold (plan F1 default 0.97; F4 uses it as a
 * graded signal, not a gate).
 */
export function symbolCoverage(
  reference: string,
  candidate: string,
  threshold = 0.97
): CoverageResult {
  const refSyms = extractSymbols(reference);
  const candSyms = extractSymbols(candidate);
  if (refSyms.size === 0) {
    return {
      coverage: 1,
      equivalent: true,
      referenceSymbols: 0,
      coveredSymbols: 0,
      missing: [],
    };
  }
  const missing: string[] = [];
  let covered = 0;
  for (const s of refSyms) {
    if (candSyms.has(s)) covered++;
    else missing.push(s);
  }
  const coverage = covered / refSyms.size;
  return {
    coverage,
    equivalent: coverage >= threshold,
    referenceSymbols: refSyms.size,
    coveredSymbols: covered,
    missing,
  };
}

// Common English / markdown words that are not meaningful "symbols". Kept
// small and conservative — we'd rather count a borderline word than drop a
// real identifier.
const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "you",
  "with",
  "this",
  "that",
  "are",
  "was",
  "but",
  "not",
  "can",
  "will",
  "use",
  "using",
  "from",
  "into",
  "your",
  "here",
  "there",
  "should",
  "would",
  "could",
  "have",
  "has",
  "had",
]);
