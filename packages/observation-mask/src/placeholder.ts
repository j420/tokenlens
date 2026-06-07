/**
 * Deterministic placeholder rendering. The placeholder is what replaces a masked
 * observation's body in the context. It is short, human-readable, and carries
 * the content hash so the original can be restored on demand and so re-planning
 * is idempotent (the same observation always renders the same marker).
 */

import type { Observation } from "./types.js";

/** Render the one-line placeholder for a masked observation. */
export function placeholderFor(obs: Observation): string {
  const sha = obs.contentHash ? obs.contentHash.slice(0, 8) : "00000000";
  return `[masked observation ${obs.id}: ${obs.tokens} tok, sha ${sha}]`;
}
