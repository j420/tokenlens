/**
 * Read-only access to the F6 detector state persisted by the
 * `context-health-advisor` hook at
 *   ~/.prune/cache/context-health-<sha256(transcriptPath)[:16]>.json
 *
 * Other features (F1 advisor modulation, dashboard, MCP report) can
 * use `readPersistedRegime(transcriptPath)` to learn the current
 * regime without re-running the detector themselves. Never writes.
 *
 * Atomic-write-tolerant: a torn JSON read returns "insufficient_data"
 * rather than throwing.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Regime } from "./types.js";

const CACHE_DIR_DEFAULT = join(homedir(), ".prune", "cache");

export interface ReadPersistedRegimeOptions {
  /** Override the cache directory (tests). */
  cacheDir?: string;
}

/**
 * Compute the on-disk state path for a given transcript path. Public
 * so callers can sanity-check / log it.
 */
export function statePathFor(
  transcriptPath: string,
  options: ReadPersistedRegimeOptions = {}
): string {
  const dir = options.cacheDir ?? CACHE_DIR_DEFAULT;
  const hash = createHash("sha256")
    .update(transcriptPath)
    .digest("hex")
    .slice(0, 16);
  return join(dir, `context-health-${hash}.json`);
}

/**
 * Read the persisted regime for a transcript. Returns
 * "insufficient_data" when the file doesn't exist, is malformed, or
 * carries an unrecognized regime string. Never throws.
 */
export function readPersistedRegime(
  transcriptPath: string,
  options: ReadPersistedRegimeOptions = {}
): Regime {
  if (typeof transcriptPath !== "string" || transcriptPath.length === 0) {
    return "insufficient_data";
  }
  const path = statePathFor(transcriptPath, options);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return "insufficient_data";
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "insufficient_data";
  }
  if (!parsed || typeof parsed !== "object") return "insufficient_data";
  const cusum = (parsed as { cusum?: unknown }).cusum;
  if (!cusum || typeof cusum !== "object") return "insufficient_data";
  const regime = (cusum as { regime?: unknown }).regime;
  if (
    regime === "healthy" ||
    regime === "warning" ||
    regime === "critical" ||
    regime === "insufficient_data"
  ) {
    return regime;
  }
  return "insufficient_data";
}
