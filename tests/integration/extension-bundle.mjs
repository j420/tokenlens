#!/usr/bin/env node
/**
 * Extension-bundle smoke — loads the esbuild-bundled extension.js
 * with a minimal VS Code API shim and verifies that `activate(context)`
 * runs to completion and registers a meaningful number of commands.
 *
 * The extension's own test harness runs inside VS Code's Extension Host
 * (`Prune: Run Intelligence Tests` command). This smoke is the closest
 * we can get to "did the bundle survive transpilation" without spinning
 * up a real VS Code instance.
 */

import { createRequire } from "node:module";
import { resolve } from "node:path";

const REPO = process.cwd();
const BUNDLE = resolve(REPO, "apps/extension/dist/extension.js");
const require = createRequire(import.meta.url);

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? "  (" + detail + ")" : ""}`);
  }
}

// Stub the "vscode" module.
const stubModule = {
  commands: {
    registerCommand: (id) => ({ dispose: () => {}, id }),
    registerTextEditorCommand: (id) => ({ dispose: () => {}, id }),
    executeCommand: () => Promise.resolve(),
  },
  window: {
    showInformationMessage: () => Promise.resolve(),
    showErrorMessage: () => Promise.resolve(),
    showWarningMessage: () => Promise.resolve(),
    showInputBox: () => Promise.resolve(""),
    showQuickPick: () => Promise.resolve(),
    showOpenDialog: () => Promise.resolve([]),
    showSaveDialog: () => Promise.resolve(undefined),
    createStatusBarItem: () => ({
      show: () => {}, hide: () => {}, dispose: () => {},
      text: "", tooltip: "", command: "",
    }),
    createOutputChannel: () => ({
      appendLine: () => {}, append: () => {}, show: () => {}, dispose: () => {}, clear: () => {},
    }),
    createWebviewPanel: () => ({
      webview: { html: "", postMessage: () => Promise.resolve(true), onDidReceiveMessage: () => ({ dispose: () => {} }) },
      onDidDispose: () => ({ dispose: () => {} }),
      dispose: () => {},
      reveal: () => {},
    }),
    activeTextEditor: undefined,
    visibleTextEditors: [],
    onDidChangeActiveTextEditor: () => ({ dispose: () => {} }),
    onDidChangeTextEditorSelection: () => ({ dispose: () => {} }),
    onDidChangeVisibleTextEditors: () => ({ dispose: () => {} }),
    registerUriHandler: () => ({ dispose: () => {} }),
    withProgress: (_o, fn) => fn({ report: () => {} }),
  },
  workspace: {
    onDidChangeTextDocument: () => ({ dispose: () => {} }),
    onDidOpenTextDocument: () => ({ dispose: () => {} }),
    onDidCloseTextDocument: () => ({ dispose: () => {} }),
    onDidChangeConfiguration: () => ({ dispose: () => {} }),
    workspaceFolders: undefined,
    rootPath: undefined,
    getConfiguration: () => ({ get: () => undefined, update: () => Promise.resolve(), inspect: () => undefined }),
    fs: { readFile: () => Promise.resolve(new Uint8Array()), stat: () => Promise.resolve({ size: 0 }) },
    findFiles: () => Promise.resolve([]),
    openTextDocument: () => Promise.resolve({ getText: () => "", fileName: "" }),
  },
  languages: {
    registerCodeActionsProvider: () => ({ dispose: () => {} }),
    registerHoverProvider: () => ({ dispose: () => {} }),
  },
  Uri: {
    parse: (s) => ({ toString: () => s, fsPath: s, scheme: "file" }),
    file: (s) => ({ toString: () => `file://${s}`, fsPath: s, scheme: "file" }),
    joinPath: (base, ...parts) => ({ toString: () => parts.join("/"), fsPath: parts.join("/"), scheme: "file" }),
  },
  Position: class { constructor(line, col) { this.line = line; this.character = col; } },
  Range: class { constructor(a, b) { this.start = a; this.end = b; } },
  Selection: class { constructor(a, b) { this.start = a; this.end = b; this.active = b; this.anchor = a; } },
  StatusBarAlignment: { Left: 1, Right: 2 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  ViewColumn: { One: 1, Two: 2, Three: 3, Active: -1, Beside: -2 },
  ExtensionMode: { Production: 1, Development: 2, Test: 3 },
  ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
  EventEmitter: class {
    constructor() { this.event = () => ({ dispose: () => {} }); }
    fire() {}
    dispose() {}
  },
  CancellationTokenSource: class {
    constructor() { this.token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) }; }
    cancel() {}
    dispose() {}
  },
};

// Splice the stub into Node's resolution.
const Module = require("module");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...args) {
  if (req === "vscode") return "vscode-shim";
  return origResolve.call(this, req, ...args);
};
require.cache["vscode-shim"] = {
  id: "vscode-shim", filename: "vscode-shim", loaded: true, exports: stubModule,
  paths: [], children: [],
};

console.log("=== Extension bundle smoke ===");
let bundle;
try {
  bundle = require(BUNDLE);
  check("bundle requires without throwing", true);
} catch (e) {
  console.log("  ✗ bundle require failed:", e.message);
  process.exit(1);
}

check("exports activate()", typeof bundle.activate === "function");
check("exports deactivate()", typeof bundle.deactivate === "function" || bundle.deactivate === undefined);

const ctx = {
  subscriptions: [],
  extensionPath: REPO + "/apps/extension",
  extensionUri: { fsPath: REPO + "/apps/extension", toString: () => "file://" + REPO + "/apps/extension", scheme: "file" },
  globalState: {
    get: () => undefined,
    update: () => Promise.resolve(),
    keys: () => [],
    setKeysForSync: () => {},
  },
  workspaceState: {
    get: () => undefined,
    update: () => Promise.resolve(),
    keys: () => [],
  },
  globalStorageUri: { fsPath: "/tmp/prune-test", toString: () => "file:///tmp/prune-test", scheme: "file" },
  storageUri: undefined,
  logUri: { fsPath: "/tmp/prune-test/log", toString: () => "", scheme: "file" },
  asAbsolutePath: (p) => REPO + "/apps/extension/" + p,
  extensionMode: 3, // Test
  secrets: { get: () => Promise.resolve(undefined), store: () => Promise.resolve(), delete: () => Promise.resolve() },
};

try {
  const r = bundle.activate(ctx);
  check("activate() returned (may be Promise)", true);
  // Wait for any async work.
  await Promise.resolve(r);
  check("activate() resolved without throwing", true);
} catch (e) {
  console.log("  ✗ activate() threw:", e.message);
  console.log(e.stack);
  process.exit(1);
}

check("registered at least 10 subscriptions",
  ctx.subscriptions.length >= 10,
  `got ${ctx.subscriptions.length}`);

// Inspect the registered command ids — should match the contributes/commands list.
const ids = ctx.subscriptions
  .map((s) => s.id)
  .filter(Boolean)
  .sort();
console.log(`  ✓ registered command ids (${ids.length}):`);
for (const id of ids) console.log("      " + id);

// Expect every prune.* command declared in package.json to be registered.
const pkg = require(REPO + "/apps/extension/package.json");
const declared = pkg.contributes?.commands?.map((c) => c.command) ?? [];
const missing = declared.filter((c) => !ids.includes(c));
check("every contributes/commands entry has a registered handler",
  missing.length === 0,
  missing.length > 0 ? "missing: " + missing.join(", ") : "");

console.log("\n=== bundle smoke: " + passed + " passed, " + failed + " failed ===");
process.exit(failed > 0 ? 1 : 0);
