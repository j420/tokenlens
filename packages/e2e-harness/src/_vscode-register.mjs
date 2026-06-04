/**
 * Preloaded by the `demo` script (`tsx --import ./src/_vscode-register.mjs`).
 * Registers a resolve hook that maps the bare `vscode` specifier to the local
 * no-op stub, so the demo can load apps/extension source (which carries an
 * unused `vscode` import) without a "Cannot find module 'vscode'" failure.
 * The vitest path uses `resolve.alias` in vitest.config.ts for the same effect.
 */
import { register } from "node:module";

register(new URL("./_vscode-hooks.mjs", import.meta.url));
