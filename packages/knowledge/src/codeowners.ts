/**
 * Deterministic CODEOWNERS resolution — no regex, by construction.
 *
 * Implements the documented gitignore-style subset that covers the
 * overwhelming majority of real CODEOWNERS files:
 *   - `*`    matches within a path segment (never across `/`)
 *   - `**`   matches across segments (as its own segment, gitignore-style)
 *   - leading `/`  anchors to the repo root
 *   - trailing `/` matches everything under that directory
 *   - a pattern with no `/` matches the basename anywhere in the tree
 *   - LAST matching rule wins (CODEOWNERS semantics), comments (#) and
 *     blank lines skipped
 *
 * Patterns outside the subset (character classes `[...]`, `!` negation,
 * escaped spaces) are SKIPPED and reported — fail-open with a visible note
 * rather than a silently wrong owner. Honest partial coverage beats quiet
 * misattribution: ownership feeds knowledge provenance, and a wrong owner
 * is worse than none.
 */

export interface CodeownersRule {
  pattern: string;
  owners: string[];
}

export interface ParsedCodeowners {
  rules: CodeownersRule[];
  /** Lines skipped as outside the supported subset, with reasons. */
  skipped: Array<{ line: string; reason: string }>;
}

function isUnsupported(pattern: string): string | null {
  for (const ch of ["[", "]", "?"]) {
    if (pattern.includes(ch)) return `unsupported glob character "${ch}"`;
  }
  if (pattern.startsWith("!")) return "negation patterns are not supported";
  if (pattern.includes("\\")) return "escaped characters are not supported";
  return null;
}

export function parseCodeowners(text: string): ParsedCodeowners {
  const rules: CodeownersRule[] = [];
  const skipped: ParsedCodeowners["skipped"] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const parts = line.split(/* no regex */ " ").filter((p) => p.length > 0);
    // Tabs are legal separators too; re-split each part on tabs.
    const tokens: string[] = [];
    for (const p of parts) {
      for (const t of p.split("\t")) if (t.length > 0) tokens.push(t);
    }
    if (tokens.length < 2) {
      skipped.push({ line, reason: "no owners listed" });
      continue;
    }
    const [pattern, ...owners] = tokens;
    const unsupported = isUnsupported(pattern);
    if (unsupported !== null) {
      skipped.push({ line, reason: unsupported });
      continue;
    }
    rules.push({ pattern, owners });
  }
  return { rules, skipped };
}

/** Match one path segment against one pattern segment (supports `*`). */
function segmentMatches(segment: string, patternSegment: string): boolean {
  if (patternSegment === "*") return true;
  if (!patternSegment.includes("*")) return segment === patternSegment;
  // Single-segment glob: split on '*' and verify the literal pieces appear
  // in order, anchored at both ends.
  const pieces = patternSegment.split("*");
  let cursor = 0;
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i];
    if (piece.length === 0) continue;
    const at = segment.indexOf(piece, cursor);
    if (at === -1) return false;
    if (i === 0 && at !== 0) return false; // anchored start
    cursor = at + piece.length;
  }
  const last = pieces[pieces.length - 1];
  if (last.length > 0 && !segment.endsWith(last)) return false; // anchored end
  return true;
}

/** Recursive segment-list match supporting `**`. */
function segmentsMatch(path: string[], pattern: string[]): boolean {
  if (pattern.length === 0) return path.length === 0;
  const [head, ...restPattern] = pattern;
  if (head === "**") {
    // `**` matches zero or more segments.
    for (let skip = 0; skip <= path.length; skip++) {
      if (segmentsMatch(path.slice(skip), restPattern)) return true;
    }
    return false;
  }
  if (path.length === 0) return false;
  if (!segmentMatches(path[0], head)) return false;
  return segmentsMatch(path.slice(1), restPattern);
}

/**
 * Resolve owners for a repo-relative path ("/"-separated). Last matching
 * rule wins; no match → empty list.
 */
export function ownersFor(
  path: string,
  parsed: ParsedCodeowners
): string[] {
  const pathSegments = path.split("/").filter((s) => s.length > 0);
  let winner: string[] = [];
  for (const rule of parsed.rules) {
    let pattern = rule.pattern;
    const anchored = pattern.startsWith("/");
    if (anchored) pattern = pattern.slice(1);
    const dirOnly = pattern.endsWith("/");
    if (dirOnly) pattern = pattern.slice(0, -1);
    let patternSegments = pattern.split("/").filter((s) => s.length > 0);
    if (patternSegments.length === 0) continue;

    // A pattern with no `/` (after trimming anchors) matches a file OR
    // directory of that name at any depth (gitignore semantics): `*.ts`
    // matches via the basename, `docs` matches via the directory segment
    // and therefore owns everything beneath it.
    if (!anchored && patternSegments.length === 1 && !dirOnly) {
      const basePattern = patternSegments[0];
      if (pathSegments.some((s) => segmentMatches(s, basePattern))) {
        winner = rule.owners;
      }
      continue;
    }

    // Directory rules own everything beneath them: append `**`.
    if (dirOnly) patternSegments = [...patternSegments, "**"];
    // Unanchored multi-segment patterns may match at any depth.
    const candidates = anchored
      ? [patternSegments]
      : [patternSegments, ["**", ...patternSegments]];
    for (const candidate of candidates) {
      if (segmentsMatch(pathSegments, candidate)) {
        winner = rule.owners;
        break;
      }
    }
  }
  return winner;
}
