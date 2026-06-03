/**
 * Intent tokenizer — char-code based, NO regex (Phase 7 hard rule #1).
 *
 * Extracts meaningful terms from a task prompt for intent fingerprinting.
 * Splits on any non-alphanumeric character, lowercases, drops tokens shorter
 * than 3 chars and a small stop-word set so the Jaccard signal isn't drowned
 * by "the", "and", "for". Deterministic and order-independent (returns a sorted
 * unique term list).
 */

const UPPER_A = 0x41;
const UPPER_Z = 0x5a;
const LOWER_A = 0x61;
const LOWER_Z = 0x7a;
const DIGIT_0 = 0x30;
const DIGIT_9 = 0x39;

function isAlnum(code: number): boolean {
  return (
    (code >= LOWER_A && code <= LOWER_Z) ||
    (code >= UPPER_A && code <= UPPER_Z) ||
    (code >= DIGIT_0 && code <= DIGIT_9)
  );
}

function toLower(code: number): number {
  return code >= UPPER_A && code <= UPPER_Z ? code + 0x20 : code;
}

/** Common English stop words that carry no intent signal. */
const STOP_WORDS: ReadonlySet<string> = new Set([
  "the", "and", "for", "with", "that", "this", "from", "have", "has", "are",
  "was", "will", "can", "you", "your", "please", "want", "need", "would",
  "should", "could", "into", "out", "but", "not", "all", "any", "how", "what",
  "when", "where", "why", "which", "who", "use", "using", "add", "get",
]);

/**
 * Tokenize a task prompt into a sorted, unique set of intent terms. Pure.
 * `minLength` defaults to 3; tokens shorter than that are dropped.
 */
export function tokenizeIntent(prompt: string, minLength = 3): string[] {
  const seen = new Set<string>();
  let buf = "";
  const flush = () => {
    if (buf.length >= minLength && !STOP_WORDS.has(buf)) seen.add(buf);
    buf = "";
  };
  for (let i = 0; i < prompt.length; i++) {
    const code = prompt.charCodeAt(i);
    if (isAlnum(code)) {
      buf += String.fromCharCode(toLower(code));
    } else {
      flush();
    }
  }
  flush();
  return [...seen].sort();
}

/** Jaccard similarity between two term sets. Pure; symmetric; in [0,1]. */
export function jaccard(
  a: readonly string[],
  b: readonly string[]
): { similarity: number; intersection: string[] } {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 && sb.size === 0) {
    return { similarity: 0, intersection: [] };
  }
  const [small, large] = sa.size < sb.size ? [sa, sb] : [sb, sa];
  const intersection: string[] = [];
  for (const x of small) if (large.has(x)) intersection.push(x);
  const interCount = intersection.length;
  const union = sa.size + sb.size - interCount;
  return {
    similarity: union === 0 ? 0 : interCount / union,
    intersection: intersection.sort(),
  };
}
