/**
 * @prune/shared/node — Node-only utilities.
 *
 * Kept in a separate subpath export from the main `@prune/shared` so the
 * dashboard's Edge runtime routes (which import the main entry for
 * pricing) never resolve `node:crypto` and fail to bundle.
 */

import { createHash } from "node:crypto";

/** Hex-encoded SHA-256 of a string. Single source of truth across the repo. */
export function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
