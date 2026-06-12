/**
 * @prune/repo-proof — f20: evidence-gated, repo-local outcome proof.
 *
 * Mine SWE-bench-style task candidates from a repository's own git history
 * (prompts human-curated, never fabricated), verify each task with the
 * three-state protocol, run the @prune/outcome-bench paired matrix under an
 * explicit budget, and — only on a passing, Ed25519-attested proof — promote
 * TokenLens feature flags shadow→general for that repository.
 *
 * CLI: prune-proof mine|verify|prove|promote|status (src/cli.ts).
 */

export * from "./types.js";
export * from "./paths.js";
export * from "./mine.js";
export * from "./map.js";
export * from "./verify.js";
export * from "./prove.js";
export * from "./promote.js";
export * from "./status.js";
export { parseArgs, run, type Command, type CliDeps, type CliIo, type ParseError } from "./cli.js";
