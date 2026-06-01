/**
 * Shannon-entropy detector for high-entropy strings that may be
 * secrets even when no vendor pattern matches.
 *
 * Standard Shannon entropy: H(s) = -sum(p_i * log2(p_i)) over the
 * symbol distribution. Random base64 of length ≥ 32 typically has
 * entropy ≥ 4.5 bits/char; English prose averages ≈ 1.0-1.5
 * bits/char. We flag tokens of length ≥ minLength with entropy ≥
 * minEntropy.
 *
 * This is the same primitive `detect-secrets` and `truffleHog` use
 * as a fallback when no vendor pattern matches. Same false-positive
 * rate (occasional UUIDs, base64 image blobs) — caller allowlists
 * specific patterns via skipPatternIds, or filters by surrounding
 * context.
 */

export interface EntropyFinding {
  /** Start index in the payload. */
  start: number;
  /** End index (exclusive). */
  end: number;
  /** The string that triggered. */
  token: string;
  entropy: number;
  /** First 4 + last 4 chars with `…` in between. */
  preview: string;
}

export interface EntropyScanOptions {
  /** Minimum token length to consider. Default 24. */
  minLength?: number;
  /** Minimum entropy (bits per character). Default 4.5 (random base64-ish). */
  minEntropy?: number;
}

function shannon(s: string): number {
  if (s.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

const TOKEN_RE = /[A-Za-z0-9+/_=-]{16,}/g;

export function scanByEntropy(
  payload: string,
  opts: EntropyScanOptions = {}
): EntropyFinding[] {
  const minLength = opts.minLength ?? 24;
  const minEntropy = opts.minEntropy ?? 4.5;
  const out: EntropyFinding[] = [];
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(payload)) !== null) {
    const tok = m[0];
    if (tok.length < minLength) continue;
    const h = shannon(tok);
    if (h < minEntropy) continue;
    out.push({
      start: m.index,
      end: m.index + tok.length,
      token: tok,
      entropy: h,
      preview:
        tok.length <= 12 ? tok.slice(0, 2) + "…" + tok.slice(-2) : tok.slice(0, 4) + "…" + tok.slice(-4),
    });
  }
  return out;
}

export { shannon };
