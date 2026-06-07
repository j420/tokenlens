/**
 * Deterministic path classification. All matching here is string-suffix and
 * path-segment comparison — explicitly NOT regex — so the rules are trivial to
 * audit and cannot pathologically backtrack.
 */

import type { ScriptKind } from "./types.js";
import { TEST_DIR_SEGMENTS, TEST_FILE_SUFFIXES } from "./constants.js";

/**
 * Normalize a path to forward slashes and strip a trailing slash. Uses
 * split/join rather than a regex so this module is regex-free end to end.
 */
export function normalizePath(p: string): string {
  const fwd = p.split("\\").join("/");
  return fwd.endsWith("/") && fwd.length > 1 ? fwd.slice(0, -1) : fwd;
}

/** Split a normalized path into non-empty segments. */
export function segments(p: string): string[] {
  return normalizePath(p)
    .split("/")
    .filter((s) => s.length > 0);
}

/**
 * Is this a test file? True when the path ends with a known test suffix, OR any
 * directory segment is a tests directory. `extra` adds repo-specific suffixes.
 */
export function isTestFilePath(
  filePath: string,
  extra: readonly string[] = []
): boolean {
  const norm = normalizePath(filePath).toLowerCase();
  for (const suffix of TEST_FILE_SUFFIXES) {
    if (norm.endsWith(suffix)) return true;
  }
  for (const suffix of extra) {
    if (suffix.length > 0 && norm.endsWith(suffix.toLowerCase())) return true;
  }
  for (const seg of segments(norm)) {
    if (TEST_DIR_SEGMENTS.has(seg)) return true;
  }
  return false;
}

/**
 * Is this path a designated grader/oracle? True when the normalized path equals
 * a configured grader path, OR ends with one as a path-suffix (so a repo can
 * configure `grader/oracle.ts` and match it regardless of the absolute prefix).
 * Suffix matching is segment-aligned: `a/grader.ts` matches `.../a/grader.ts`
 * but not `.../xgrader.ts`.
 */
export function isGraderPath(
  filePath: string,
  graderPaths: readonly string[] = []
): boolean {
  if (graderPaths.length === 0) return false;
  const norm = normalizePath(filePath);
  for (const raw of graderPaths) {
    const g = normalizePath(raw);
    if (g.length === 0) continue;
    if (norm === g) return true;
    // Segment-aligned suffix: the char before the match must be a separator.
    if (norm.endsWith(g) && norm[norm.length - g.length - 1] === "/") {
      return true;
    }
  }
  return false;
}

/** Derive the TypeScript script kind from a file extension. Defaults to ts. */
export function scriptKindForPath(filePath: string): ScriptKind {
  const norm = normalizePath(filePath).toLowerCase();
  if (norm.endsWith(".tsx")) return "tsx";
  if (norm.endsWith(".jsx")) return "jsx";
  if (
    norm.endsWith(".js") ||
    norm.endsWith(".mjs") ||
    norm.endsWith(".cjs")
  ) {
    return "js";
  }
  return "ts";
}
