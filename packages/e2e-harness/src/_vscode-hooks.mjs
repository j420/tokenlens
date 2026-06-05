/**
 * Node module-customization resolve hook: redirect `vscode` → the local stub.
 * Everything else falls through to the default (tsx) resolver, which then
 * transpiles the returned .ts stub like any other source file.
 */
const STUB = new URL("./_vscode-stub.ts", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "vscode") {
    return { url: STUB, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
