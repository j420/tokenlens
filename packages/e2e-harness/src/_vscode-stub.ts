/**
 * No-op stand-in for the `vscode` module.
 *
 * `apps/extension/src/token-saver.ts` carries `import * as vscode from "vscode"`
 * but references `vscode` ZERO times (verified) — TypeScript elides the dead
 * import under tsc/ts-node. This stub is belt-and-suspenders for bundlers
 * (esbuild/tsx) that may keep an unused namespace import: resolving the bare
 * `vscode` specifier here yields an empty module instead of a hard resolution
 * error. It is never actually called at runtime.
 */
export {};
