/**
 * @prune/code-mode-mcp (F8)
 *
 * Public surface. Three pieces:
 *
 *   1. schema-to-ts.ts — JSON-schema → typed TS API generator
 *      (Toolbox interface, sanitized method names, structural walk).
 *
 *   2. executor.ts — Node `vm`-based sandbox that runs a code-mode
 *      script with a single side-effect surface (toolbox.<method>).
 *      No fs, no process, no require, no fetch.
 *
 *   3. equivalence-harness.ts — corpus runner that compares
 *      direct-tool-call vs code-mode outputs via @prune/equivalence
 *      and tallies sandbox-escape attempts.
 */

export * from "./schema-to-ts.js";
export * from "./executor.js";
export * from "./equivalence-harness.js";
