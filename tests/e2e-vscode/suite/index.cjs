// Test entry — invoked inside VS Code's Extension Host. The vscode
// module is supplied by the Host at runtime.
const vscode = require("vscode");
const { strict: assert } = require("node:assert");

async function activateExtension() {
  // Find the extension by package.json id (publisher.name → delimit.prune).
  let ext = vscode.extensions.getExtension("delimit.prune");
  if (!ext) {
    // Fallback: scan all extensions for the one named "prune".
    for (const e of vscode.extensions.all) {
      if (e.packageJSON?.name === "prune") { ext = e; break; }
    }
  }
  assert.ok(ext, "prune extension not found in the Extension Host");
  await ext.activate();
  return ext;
}

async function run() {
  console.log("=== TokenLens E2E inside VS Code Extension Host ===");
  let passed = 0, failed = 0;
  const failures = [];
  function check(name, cond, detail) {
    if (cond) { passed++; console.log("  ✓ " + name); }
    else { failed++; failures.push({ name, detail }); console.log("  ✗ " + name + (detail ? " (" + detail + ")" : "")); }
  }

  try {
    const ext = await activateExtension();
    check("extension activated", ext.isActive);

    const cmds = await vscode.commands.getCommands(true);
    const pruneCmds = cmds.filter((c) => c.startsWith("prune.")).sort();
    check("registered prune.* commands", pruneCmds.length >= 10, "got " + pruneCmds.length);
    console.log("    commands: " + pruneCmds.join(", "));

    // Smoke: invoke prune.sessionStats — should not throw, even on a fresh session.
    try {
      await vscode.commands.executeCommand("prune.sessionStats");
      check("prune.sessionStats executes", true);
    } catch (e) {
      check("prune.sessionStats executes", false, e.message);
    }

    // Smoke: invoke prune.checkCursorUsage — should fall back gracefully when no Cursor installed.
    try {
      await vscode.commands.executeCommand("prune.checkCursorUsage");
      check("prune.checkCursorUsage executes (no-Cursor fallback)", true);
    } catch (e) {
      check("prune.checkCursorUsage executes", false, e.message);
    }

    // Smoke: invoke prune.resetSession — pure state mutation, should not throw.
    try {
      await vscode.commands.executeCommand("prune.resetSession");
      check("prune.resetSession executes", true);
    } catch (e) {
      check("prune.resetSession executes", false, e.message);
    }
  } catch (e) {
    failed++;
    failures.push({ name: "(uncaught)", detail: e.stack || e.message });
    console.log("FATAL: " + (e.stack || e.message));
  }

  console.log("");
  console.log("=".repeat(60));
  console.log(`VSCode E2E: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log("  ✗ " + f.name + (f.detail ? "\n    " + f.detail : ""));
    throw new Error(failed + " failures");
  }
}

module.exports = { run };
