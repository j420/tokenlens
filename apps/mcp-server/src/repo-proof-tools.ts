/**
 * MCP handler for f20 repo-proof — READ-ONLY introspection.
 *
 * Lets an agent answer "what has been proven on this repo, and why are my
 * flags what they are?" from the persisted proof state. The state reader
 * re-verifies the stored attestation on every call (never trusts a stored
 * verdict) and degrades to absent sections instead of throwing. Mutation
 * (mine/verify/prove/promote) is deliberately NOT exposed over MCP — those
 * are operator actions on the prune-proof CLI, and prove spends money.
 */

import { readProofState } from "@prune/repo-proof";

function J(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function handleRepoProofStatus(args: unknown): string {
  if (args === null || typeof args !== "object") {
    return J({ error: "expected an object with { repoRoot: string }" });
  }
  const repoRoot = (args as Record<string, unknown>).repoRoot;
  if (typeof repoRoot !== "string" || repoRoot.length === 0) {
    return J({ error: "repoRoot must be a non-empty string" });
  }
  try {
    return J(readProofState(repoRoot));
  } catch (e) {
    // readProofState is designed not to throw; if it ever does, the tool
    // stays fail-safe and reports instead of crashing the server.
    return J({ error: e instanceof Error ? e.message : String(e) });
  }
}
