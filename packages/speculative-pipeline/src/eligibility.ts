/**
 * Eligibility gate — which tools may be speculatively executed.
 *
 * Hard rule: ONLY pure-read tools. A speculative write/edit/delete would apply
 * a side effect the agent may never actually request — categorically unsafe.
 * The allowlist mirrors @prune/intelligence's ELIGIBLE_TOOLS for the
 * speculative cache (Read/Glob/LS/Grep), the read-only tools whose result is a
 * pure function of the current filesystem state.
 *
 * Bash is DEFERRED to v0.2: classifying a bash command as pure-read requires
 * shell parsing, and the no-regex rule means we don't ship the speculative-
 * cache's regex-based bash classifier here. Until a structural bash parser
 * lands, bash commands are never speculated (fail-safe-to-exclude).
 */

/** The read-only tools eligible for speculative execution in v0.1. */
export const SPECULATABLE_TOOLS: readonly string[] = [
  "Read",
  "Glob",
  "LS",
  "Grep",
] as const;

const ELIGIBLE = new Set<string>(SPECULATABLE_TOOLS);

/**
 * Is this tool name eligible for speculative execution? Pure, case-sensitive
 * (tool names are canonical identifiers, not free text).
 */
export function isSpeculatable(toolName: string): boolean {
  return ELIGIBLE.has(toolName);
}
