/**
 * Content-hash baselining. A stable SHA-256 of a test/grader file lets the
 * interlock recognize, even across sessions, that a previously-green file has
 * been altered — the cheap first-line check before the structural analysis runs.
 * Node builtin only; no third-party dependency.
 */

import { createHash } from "node:crypto";

/** Lower-case hex SHA-256 of a UTF-8 string. */
export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** True when two contents hash identically (i.e. are byte-equal UTF-8). */
export function sameContent(a: string, b: string): boolean {
  return hashContent(a) === hashContent(b);
}
