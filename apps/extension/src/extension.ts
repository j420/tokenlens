/**
 * Prune VS Code Extension
 *
 * Token intelligence for AI coding assistants.
 * Zero API keys required. All processing happens locally.
 */

import * as vscode from "vscode";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { analyzeContent, cleanup, formatTokens, countTokens } from "@prune/tokenizer";
import { type PruneConfig, DEFAULT_CONFIG } from "@prune/shared";

const execAsync = promisify(exec);

// ============================================================================
// State
// ============================================================================

let statusBarItem: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;
let pythonPath: string | null = null;
let squeezerPath: string | null = null;

// ============================================================================
// Logging
// ============================================================================

const LOG_PREFIX = "[Prune]";

function log(message: string) {
  console.log(LOG_PREFIX, message);
  outputChannel?.appendLine(message);
}

function logError(message: string, error?: unknown) {
  const errorMsg = error instanceof Error ? error.message : String(error || "");
  console.error(LOG_PREFIX, message, errorMsg);
  outputChannel?.appendLine(`ERROR: ${message} ${errorMsg}`);
}

// ============================================================================
// Python Squeezer Integration
// ============================================================================

interface PythonSqueezeResult {
  original_tokens: number;
  squeezed_tokens: number;
  savings: number;
  savings_percent: number;
  is_valid: boolean;
  error: string | null;
  squeezed_code: string;
}

/**
 * Find Python executable
 */
async function findPython(): Promise<string | null> {
  const pythonCommands = ["python3", "python"];

  for (const cmd of pythonCommands) {
    try {
      const { stdout } = await execAsync(`${cmd} --version`, { timeout: 5000 });
      if (stdout.includes("Python 3")) {
        log(`Found Python: ${cmd} (${stdout.trim()})`);
        return cmd;
      }
    } catch {
      // Try next
    }
  }

  return null;
}

/**
 * Find the Python squeezer script
 */
function findSqueezerScript(extensionPath: string): string | null {
  // The squeezer should be in packages/squeezer-py relative to the workspace
  const workspaceFolders = vscode.workspace.workspaceFolders;

  // Try relative to extension
  const possiblePaths = [
    // Development: relative to workspace
    path.join(extensionPath, "..", "..", "packages", "squeezer-py", "semantic_squeezer.py"),
    // Installed: bundled with extension
    path.join(extensionPath, "squeezer-py", "semantic_squeezer.py"),
  ];

  // Also check workspace folders
  if (workspaceFolders) {
    for (const folder of workspaceFolders) {
      possiblePaths.push(
        path.join(folder.uri.fsPath, "packages", "squeezer-py", "semantic_squeezer.py")
      );
    }
  }

  for (const p of possiblePaths) {
    try {
      const fs = require("fs");
      if (fs.existsSync(p)) {
        log(`Found squeezer at: ${p}`);
        return p;
      }
    } catch {
      // Try next
    }
  }

  return null;
}

/**
 * Check if Python squeezer is available
 */
async function checkPythonSqueezer(extensionPath: string): Promise<boolean> {
  if (pythonPath && squeezerPath) {
    return true;
  }

  pythonPath = await findPython();
  if (!pythonPath) {
    log("Python 3 not found");
    return false;
  }

  squeezerPath = findSqueezerScript(extensionPath);
  if (!squeezerPath) {
    log("Squeezer script not found");
    return false;
  }

  // Verify tree-sitter is installed
  try {
    await execAsync(`${pythonPath} -c "import tree_sitter; import tree_sitter_python; import tree_sitter_javascript"`, {
      timeout: 10000,
    });
    log("Tree-sitter dependencies verified");
    return true;
  } catch (error) {
    log("Tree-sitter not installed. Run: pip install tree-sitter tree-sitter-python tree-sitter-javascript");
    return false;
  }
}

/**
 * Squeeze code using Python Tree-sitter squeezer
 */
async function squeezePython(code: string, language: string): Promise<PythonSqueezeResult> {
  if (!pythonPath || !squeezerPath) {
    throw new Error("Python squeezer not available");
  }

  // Write code to temp file to avoid shell escaping issues
  const fs = require("fs");
  const os = require("os");
  const tempFile = path.join(os.tmpdir(), `prune-squeeze-${Date.now()}.txt`);
  const outputFile = path.join(os.tmpdir(), `prune-squeeze-${Date.now()}-out.json`);

  try {
    fs.writeFileSync(tempFile, code, "utf8");

    // Call Python squeezer
    const cmd = `${pythonPath} "${squeezerPath}" --json --language ${language} --input "${tempFile}" --output "${outputFile}"`;
    log(`Executing: ${cmd}`);

    await execAsync(cmd, { timeout: 30000 });

    // Read result
    const resultJson = fs.readFileSync(outputFile, "utf8");
    const result = JSON.parse(resultJson) as PythonSqueezeResult;

    return result;
  } finally {
    // Cleanup temp files
    try {
      fs.unlinkSync(tempFile);
    } catch {}
    try {
      fs.unlinkSync(outputFile);
    } catch {}
  }
}

// ============================================================================
// Activation
// ============================================================================

export function activate(context: vscode.ExtensionContext) {
  // Create output channel
  outputChannel = vscode.window.createOutputChannel("Prune");
  log("Prune extension activated");

  // Create status bar item
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = "prune.analyzeSelection";
  statusBarItem.tooltip = "Click to analyze token count";
  context.subscriptions.push(statusBarItem);

  // Check Python squeezer availability (async, non-blocking)
  checkPythonSqueezer(context.extensionPath).then((available) => {
    if (available) {
      log("Python Telegraphic Squeezer ready");
    } else {
      log("Python squeezer not available - install Python 3 and tree-sitter");
    }
  });

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand("prune.analyzeSelection", analyzeSelection),
    vscode.commands.registerCommand("prune.analyzeFile", analyzeCurrentFile),
    vscode.commands.registerCommand("prune.copyTokenCount", copyTokenCount),
    vscode.commands.registerCommand("prune.squeezeFile", () => squeezeCurrentFile(context)),
    vscode.commands.registerCommand("prune.checkCursorUsage", checkCursorUsage)
  );

  // Update status bar on selection change
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(updateStatusBar)
  );

  // Update status bar on active editor change
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(updateStatusBar)
  );

  // Initial status bar update
  updateStatusBar();

  log("Prune ready - token counting active");
}

export function deactivate() {
  cleanup();
  outputChannel?.dispose();
}

// ============================================================================
// Status Bar
// ============================================================================

function updateStatusBar() {
  const config = getConfig();
  if (!config.showStatusBar) {
    statusBarItem.hide();
    return;
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    statusBarItem.text = "$(symbol-misc) Prune";
    statusBarItem.tooltip = "Open a file to see token count";
    statusBarItem.backgroundColor = undefined;
    statusBarItem.show();
    return;
  }

  const selection = editor.selection;
  const text = selection.isEmpty
    ? editor.document.getText()
    : editor.document.getText(selection);

  try {
    const analysis = analyzeContent(text, "gpt-4o", config.autoSqueezeThreshold);

    if (analysis.isLarge) {
      statusBarItem.text = "$(warning) " + analysis.formatted.tokens + " tokens";
      statusBarItem.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground"
      );
      statusBarItem.tooltip = "Large context: " + analysis.formatted.tokens + " tokens (~" + analysis.formatted.cost + ")";
    } else {
      statusBarItem.text = "$(symbol-misc) " + analysis.formatted.tokens;
      statusBarItem.backgroundColor = undefined;
      statusBarItem.tooltip = analysis.formatted.tokens + " tokens (~" + analysis.formatted.cost + ")";
    }
    statusBarItem.command = "prune.analyzeSelection";
  } catch (error) {
    logError("Token count error:", error);
    statusBarItem.text = "$(symbol-misc) Prune";
    statusBarItem.tooltip = "Error counting tokens";
    statusBarItem.backgroundColor = undefined;
  }

  statusBarItem.show();
}

// ============================================================================
// Commands
// ============================================================================

async function analyzeSelection() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("No active editor");
    return;
  }

  const selection = editor.selection;
  const isSelection = !selection.isEmpty;
  const text = isSelection
    ? editor.document.getText(selection)
    : editor.document.getText();

  const config = getConfig();
  const analysis = analyzeContent(text, "gpt-4o", config.autoSqueezeThreshold);

  const scope = isSelection ? "Selection" : "File";
  const message = [
    scope + ": " + analysis.formatted.tokens + " tokens",
    "Cost: ~" + analysis.formatted.cost,
    analysis.isLarge ? "⚠️ Large context" : "✓ OK",
  ].join(" | ");

  if (analysis.isLarge) {
    vscode.window.showWarningMessage(message, "Copy Count").then((action) => {
      if (action === "Copy Count") {
        vscode.env.clipboard.writeText(analysis.tokens.toString());
        vscode.window.showInformationMessage("Token count copied: " + analysis.tokens);
      }
    });
  } else {
    vscode.window.showInformationMessage(message, "Copy Count").then((action) => {
      if (action === "Copy Count") {
        vscode.env.clipboard.writeText(analysis.tokens.toString());
        vscode.window.showInformationMessage("Token count copied: " + analysis.tokens);
      }
    });
  }
}

async function analyzeCurrentFile() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("No active editor");
    return;
  }

  const text = editor.document.getText();
  const analysis = analyzeContent(text, "gpt-4o", getConfig().autoSqueezeThreshold);

  const fileName = editor.document.fileName.split(/[\\/]/).pop() || "File";

  outputChannel.appendLine("---");
  outputChannel.appendLine("File: " + fileName);
  outputChannel.appendLine("Tokens: " + analysis.tokens);
  outputChannel.appendLine("Cost: ~" + analysis.formatted.cost);
  outputChannel.appendLine("---");
  outputChannel.show();

  vscode.window.showInformationMessage(
    fileName + ": " + analysis.formatted.tokens + " tokens (~" + analysis.formatted.cost + ")"
  );
}

async function copyTokenCount() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("No active editor");
    return;
  }

  const selection = editor.selection;
  const text = selection.isEmpty
    ? editor.document.getText()
    : editor.document.getText(selection);

  const { tokens } = countTokens(text, "gpt-4o");

  await vscode.env.clipboard.writeText(tokens.toString());
  vscode.window.showInformationMessage("Token count copied: " + formatTokens(tokens));
}

async function squeezeCurrentFile(context: vscode.ExtensionContext) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("No active editor");
    return;
  }

  const text = editor.document.getText();
  const filePath = editor.document.fileName;
  const fileName = filePath.split(/[\\/]/).pop() || "file";

  // Detect language from file extension
  const ext = path.extname(filePath).toLowerCase();
  const languageMap: Record<string, string> = {
    ".py": "python",
    ".js": "javascript",
    ".jsx": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".mjs": "javascript",
    ".cjs": "javascript",
  };

  const language = languageMap[ext];
  if (!language) {
    vscode.window.showWarningMessage(
      `Unsupported file type: ${ext}. Supported: .py, .js, .jsx, .ts, .tsx`
    );
    return;
  }

  // Check if Python squeezer is available
  const pythonAvailable = await checkPythonSqueezer(context.extensionPath);

  if (!pythonAvailable) {
    const action = await vscode.window.showWarningMessage(
      "Python Telegraphic Squeezer requires Python 3 and tree-sitter. Install dependencies?",
      "Show Instructions",
      "Cancel"
    );

    if (action === "Show Instructions") {
      outputChannel.appendLine("---");
      outputChannel.appendLine("SETUP: Python Telegraphic Squeezer");
      outputChannel.appendLine("---");
      outputChannel.appendLine("");
      outputChannel.appendLine("1. Install Python 3 (if not already installed)");
      outputChannel.appendLine("   https://www.python.org/downloads/");
      outputChannel.appendLine("");
      outputChannel.appendLine("2. Install tree-sitter dependencies:");
      outputChannel.appendLine("   pip install tree-sitter tree-sitter-python tree-sitter-javascript");
      outputChannel.appendLine("");
      outputChannel.appendLine("3. Restart VS Code and try again");
      outputChannel.appendLine("---");
      outputChannel.show();
    }
    return;
  }

  // Show progress while squeezing
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Squeezing with Tree-sitter...",
      cancellable: false,
    },
    async () => {
      try {
        log("---");
        log("Squeezing: " + filePath);
        log("Language: " + language);

        const result = await squeezePython(text, language);

        log("Original tokens: " + result.original_tokens);
        log("Squeezed tokens: " + result.squeezed_tokens);
        log("Savings: " + result.savings + " (" + result.savings_percent.toFixed(1) + "%)");
        log("Valid: " + result.is_valid);

        if (result.error) {
          log("Error: " + result.error);
        }

        if (!result.is_valid) {
          vscode.window.showWarningMessage(
            "Compression produced invalid syntax. " + (result.error || "Using original file.")
          );
          return;
        }

        if (result.savings <= 0) {
          vscode.window.showInformationMessage(
            "No compression possible: " + (result.error || "File is already minimal")
          );
          return;
        }

        // Show results in output channel
        outputChannel.appendLine("---");
        outputChannel.appendLine("Squeeze: " + fileName);
        outputChannel.appendLine("Language: " + language);
        outputChannel.appendLine("Original: " + formatTokens(result.original_tokens) + " tokens");
        outputChannel.appendLine("Squeezed: " + formatTokens(result.squeezed_tokens) + " tokens");
        outputChannel.appendLine("Savings: " + formatTokens(result.savings) + " tokens (" + result.savings_percent.toFixed(1) + "%)");
        outputChannel.appendLine("---");

        // Ask user what to do
        const action = await vscode.window.showInformationMessage(
          `Saved ${formatTokens(result.savings)} tokens (${result.savings_percent.toFixed(1)}%)`,
          "Copy to Clipboard",
          "View in Output",
          "Replace File"
        );

        if (action === "Copy to Clipboard") {
          await vscode.env.clipboard.writeText(result.squeezed_code);
          vscode.window.showInformationMessage("Compressed code copied to clipboard");
        } else if (action === "View in Output") {
          outputChannel.appendLine("\n=== COMPRESSED CODE ===\n");
          outputChannel.appendLine(result.squeezed_code);
          outputChannel.appendLine("\n=== END COMPRESSED CODE ===\n");
          outputChannel.show();
        } else if (action === "Replace File") {
          const edit = new vscode.WorkspaceEdit();
          const fullRange = new vscode.Range(
            editor.document.positionAt(0),
            editor.document.positionAt(text.length)
          );
          edit.replace(editor.document.uri, fullRange, result.squeezed_code);
          await vscode.workspace.applyEdit(edit);
          vscode.window.showInformationMessage("File compressed: " + result.savings_percent.toFixed(1) + "% savings");
        }
      } catch (error) {
        logError("Squeeze error:", error);
        vscode.window.showErrorMessage(
          "Failed to squeeze: " + (error instanceof Error ? error.message : String(error))
        );
      }
    }
  );
}

// ============================================================================
// Cursor Usage Check (lazy loaded)
// ============================================================================

async function checkCursorUsage() {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Checking Cursor usage...",
      cancellable: false,
    },
    async () => {
      try {
        const { getCursorStatus, fetchCursorUsageDetailed } = await import("@prune/state-scraper");

        const status = await getCursorStatus();

        if (!status.available) {
          vscode.window.showWarningMessage("Cursor Usage: " + (status.error || "Not available"));
          logError("Cursor usage check failed:", status.error);
          return;
        }

        const usage = status.usage!;

        const percentUsed = Math.round((usage.requestsUsed / usage.requestsLimit) * 100);
        const resetDateStr = usage.resetDate.toLocaleDateString();

        outputChannel.appendLine("---");
        outputChannel.appendLine("Cursor Usage Report");
        outputChannel.appendLine("---");
        if (status.email) {
          outputChannel.appendLine("Account: " + status.email);
        }
        outputChannel.appendLine("Plan: " + usage.plan.toUpperCase());
        outputChannel.appendLine("Requests Used: " + usage.requestsUsed + " / " + usage.requestsLimit);
        outputChannel.appendLine("Requests Remaining: " + usage.requestsRemaining);
        outputChannel.appendLine("Usage: " + percentUsed + "%");
        outputChannel.appendLine("Resets: " + resetDateStr);

        const detailed = await fetchCursorUsageDetailed();
        if (detailed) {
          outputChannel.appendLine("");
          outputChannel.appendLine("By Model:");
          outputChannel.appendLine("  GPT-4: " + detailed["gpt-4"].numRequests + " requests, " + detailed["gpt-4"].numTokens + " tokens");
          outputChannel.appendLine("  GPT-3.5: " + detailed["gpt-3.5-turbo"].numRequests + " requests, " + detailed["gpt-3.5-turbo"].numTokens + " tokens");
          if (detailed["gpt-4o-mini"]) {
            outputChannel.appendLine("  GPT-4o-mini: " + detailed["gpt-4o-mini"].numRequests + " requests, " + detailed["gpt-4o-mini"].numTokens + " tokens");
          }
        }
        outputChannel.appendLine("---");

        let icon: string;
        let message: string;

        if (percentUsed >= 90) {
          icon = "$(warning)";
          message = icon + " Cursor: " + usage.requestsRemaining + " requests left (" + percentUsed + "% used)";
          vscode.window.showWarningMessage(message, "View Details").then((action) => {
            if (action === "View Details") outputChannel.show();
          });
        } else if (percentUsed >= 70) {
          icon = "$(info)";
          message = icon + " Cursor: " + usage.requestsRemaining + " / " + usage.requestsLimit + " requests remaining";
          vscode.window.showInformationMessage(message, "View Details").then((action) => {
            if (action === "View Details") outputChannel.show();
          });
        } else {
          icon = "$(check)";
          message = icon + " Cursor: " + usage.requestsRemaining + " / " + usage.requestsLimit + " requests remaining";
          vscode.window.showInformationMessage(message, "View Details").then((action) => {
            if (action === "View Details") outputChannel.show();
          });
        }
      } catch (error) {
        logError("Cursor usage error:", error);
        vscode.window.showErrorMessage("Failed to check Cursor usage: " + (error instanceof Error ? error.message : String(error)));
      }
    }
  );
}

// ============================================================================
// Helpers
// ============================================================================

function getConfig(): PruneConfig {
  const config = vscode.workspace.getConfiguration("prune");
  return {
    defaultTier: config.get("defaultTier", DEFAULT_CONFIG.defaultTier),
    autoSqueezeThreshold: config.get(
      "autoSqueezeThreshold",
      DEFAULT_CONFIG.autoSqueezeThreshold
    ),
    showStatusBar: config.get("showStatusBar", DEFAULT_CONFIG.showStatusBar),
    showPreflightWarnings: config.get(
      "showPreflightWarnings",
      DEFAULT_CONFIG.showPreflightWarnings
    ),
    preserveTodos: config.get("preserveTodos", DEFAULT_CONFIG.preserveTodos),
    preserveTypeHints: config.get(
      "preserveTypeHints",
      DEFAULT_CONFIG.preserveTypeHints
    ),
  };
}
