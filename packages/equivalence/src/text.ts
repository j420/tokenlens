/**
 * Text-level equivalence: normalized Levenshtein distance.
 *
 * Used for prose segments of a model response (F1 final-output comparison)
 * and as the fallback when neither side parses as code.
 */

/**
 * Levenshtein edit distance between two strings, computed with the two-row
 * dynamic-programming variant (O(min(a,b)) memory). Operations are unit-cost
 * insert/delete/substitute.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Ensure b is the shorter string for the row width.
  if (a.length < b.length) {
    const t = a;
    a = b;
    b = t;
  }

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost // substitution
      );
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[b.length];
}

/**
 * Normalized Levenshtein distance in [0, 1]: edit distance divided by the
 * length of the longer string. 0 = identical, 1 = maximally different.
 */
export function normalizedLevenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 0;
  return levenshtein(a, b) / maxLen;
}

export interface TextEquivalenceResult {
  equivalent: boolean;
  /** Similarity in [0,1]: 1 − normalized distance. */
  similarity: number;
  distance: number;
}

/**
 * Decide text equivalence at a distance threshold (default 0.05, i.e. ≤5%
 * normalized edit distance counts as equivalent — the plan's prose bar).
 */
export function textEquivalent(
  a: string,
  b: string,
  maxDistance = 0.05
): TextEquivalenceResult {
  const distance = normalizedLevenshtein(a, b);
  return {
    equivalent: distance <= maxDistance,
    similarity: 1 - distance,
    distance,
  };
}
