/**
 * Structural tokenization — NO regex.
 *
 * Every relevance signal that needs "words" out of a path or keyword is built
 * on these explicit character scans. We deliberately avoid regex so the
 * splitting rules are auditable, deterministic, and free of catastrophic
 * backtracking on adversarial input.
 *
 * The rules are intentionally simple and structural:
 *   - Path separators: '/' and '\' split path components.
 *   - Within a component, identifier boundaries are: any non-alphanumeric
 *     character ('.', '-', '_', space, etc.) AND camelCase humps
 *     (lower→Upper transitions) AND letter↔digit transitions.
 *   - All tokens are lowercased for case-insensitive overlap.
 *   - Empty tokens are dropped.
 */

/** True for ASCII upper-case letters only (camelCase hump detection). */
function isUpper(ch: string): boolean {
  return ch >= "A" && ch <= "Z";
}

/** True for ASCII lower-case letters only. */
function isLower(ch: string): boolean {
  return ch >= "a" && ch <= "z";
}

/** True for ASCII digits. */
function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

/**
 * Alphanumeric for the purpose of identifier-token membership. We treat any
 * Unicode letter (code point outside the ASCII control/punctuation ranges and
 * not whitespace) as part of a token unless it is one of the explicit
 * separators handled by the caller. To keep this regex-free and deterministic
 * we classify by code point: ASCII alnum, plus any code point >= 0x80 that is
 * not whitespace is considered "word-ish" so unicode paths tokenize sensibly.
 */
function isWordChar(ch: string): boolean {
  if (isUpper(ch) || isLower(ch) || isDigit(ch)) return true;
  const cp = ch.codePointAt(0);
  if (cp === undefined) return false;
  if (cp < 0x80) return false; // ASCII non-alnum → not a word char
  // Non-ASCII: treat as word char unless it is whitespace.
  // (Common unicode whitespace handled explicitly.)
  if (
    cp === 0x00a0 || // no-break space
    cp === 0x2028 || // line separator
    cp === 0x2029 || // paragraph separator
    (cp >= 0x2000 && cp <= 0x200a) // various spaces
  ) {
    return false;
  }
  return true;
}

/**
 * Split a single path component (no separators) into identifier tokens by
 * scanning character by character. Boundaries: non-word char, camel hump
 * (lower→Upper), and letter↔digit transitions.
 */
function splitComponent(component: string, out: string[]): void {
  let cur = "";
  let prev = "";
  for (const ch of component) {
    if (!isWordChar(ch)) {
      if (cur.length > 0) {
        out.push(cur.toLowerCase());
        cur = "";
      }
      prev = "";
      continue;
    }
    if (cur.length > 0) {
      const lowerToUpper = isLower(prev) && isUpper(ch);
      const letterToDigit =
        (isLower(prev) || isUpper(prev)) && isDigit(ch);
      const digitToLetter = isDigit(prev) && (isLower(ch) || isUpper(ch));
      if (lowerToUpper || letterToDigit || digitToLetter) {
        out.push(cur.toLowerCase());
        cur = "";
      }
    }
    cur += ch;
    prev = ch;
  }
  if (cur.length > 0) out.push(cur.toLowerCase());
}

/**
 * Split a path into its components on '/' and '\'. Empty components (from
 * leading/trailing/duplicate separators) are dropped.
 */
export function pathComponents(path: string): string[] {
  if (typeof path !== "string" || path.length === 0) return [];
  const out: string[] = [];
  let cur = "";
  for (const ch of path) {
    if (ch === "/" || ch === "\\") {
      if (cur.length > 0) out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

/**
 * Full structural tokenization of a path into a lowercased identifier-token
 * set. Used for task-keyword overlap. File extensions become their own tokens
 * (e.g. "service.ts" → "service", "ts") because they carry meaning.
 */
export function tokenizePath(path: string): Set<string> {
  const tokens: string[] = [];
  for (const comp of pathComponents(path)) {
    splitComponent(comp, tokens);
  }
  return new Set(tokens);
}

/**
 * Tokenize an array of free-form keyword strings into a single lowercased
 * token set, applying the same identifier-boundary rules so "authService" and
 * "auth service" both yield {auth, service}.
 */
export function tokenizeKeywords(keywords: string[]): Set<string> {
  const tokens: string[] = [];
  for (const kw of keywords) {
    if (typeof kw !== "string") continue;
    // A keyword may itself contain separators; treat them like a path.
    for (const comp of pathComponents(kw)) {
      splitComponent(comp, tokens);
    }
    // Also handle a keyword with no separators at all.
    if (pathComponents(kw).length === 0) {
      splitComponent(kw, tokens);
    }
  }
  return new Set(tokens);
}

/**
 * Jaccard similarity of two token sets ∈ [0,1]. Empty ∩ empty ⇒ 0
 * (no information), which the caller treats as "signal absent".
 */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  // Iterate the smaller set for efficiency.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const t of small) {
    if (large.has(t)) inter++;
  }
  const union = a.size + b.size - inter;
  if (union === 0) return 0;
  return inter / union;
}
