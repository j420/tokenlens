/**
 * Prune VS Code Extension
 *
 * Token intelligence for AI coding assistants.
 * Zero API keys required. All processing happens locally.
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { execFile } from "child_process";
import { analyzeContent, cleanup, formatTokens, countTokens } from "@prune/tokenizer";
import { type PruneConfig, DEFAULT_CONFIG } from "@prune/shared";
import { SemanticSqueezer, initParser, loadLanguage, setDebugMode } from "./squeezer";
import { analyzeContext, type ContextAnalysis, type FileRelevance } from "./context-analyzer";
import { PruneIntelligenceEngine } from "./prune-intelligence";
import { testSamples } from "./prune-intelligence.test";
import {
  generateSmartCopy,
  analyzePreFlight,
  recordFileRead,
  getSessionStats,
  resetSessionMemory,
  trackDecision,
  recordContextSize,
  getDecisionsAtRisk,
  generateCompactionReminder,
  extractDecisionsFromText,
  incrementTurn,
  getSessionFiles,
  getAllDecisions,
  removeDecision,
  isFileContentCurrent,
  getCurrentTurn,
  type PreflightAnalysis,
  type TrackedDecision,
  type DecisionPriority,
} from "./token-saver";
import { runAllTokenSaverTestsExtended } from "./token-saver.test";
import { runAllHudTests } from "./hud-compute.test";
import { FeatureFlagStore, FLAG_PATH } from "./feature-flags-store";
import { activateHud } from "./hud";
import {
  TCRP_FEATURE_IDS,
  TCRP_FEATURE_NAMES,
  resolveFeatureId,
} from "@prune/shared";

// ============================================================================
// State
// ============================================================================

let statusBarItem: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;
let squeezerInstance: SemanticSqueezer | null = null;
let wasmDir: string | null = null;
// sql.js WASM is bundled, no external sqlite3 CLI needed
let intelligenceEngine: PruneIntelligenceEngine | null = null;
let featureFlagStore: FeatureFlagStore | null = null;

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
// WASM Squeezer Integration
// ============================================================================

/**
 * Initialize the WASM-based squeezer
 */
async function initSqueezer(extensionPath: string): Promise<boolean> {
  if (squeezerInstance && wasmDir) {
    return true;
  }

  try {
    // Enable debug logging for troubleshooting
    setDebugMode(true);

    log(`Extension path: ${extensionPath}`);
    log(`Platform: ${process.platform}`);

    // Find WASM directory
    const possiblePaths = [
      // Installed: bundled with extension
      path.join(extensionPath, "wasm"),
      // Development: relative to dist
      path.join(extensionPath, "..", "wasm"),
    ];

    const fs = require("fs");
    for (const p of possiblePaths) {
      log(`Checking WASM path: ${p}`);
      // Look for either tree-sitter.wasm or web-tree-sitter.wasm
      const wasmFile1 = path.join(p, "web-tree-sitter.wasm");
      const wasmFile2 = path.join(p, "tree-sitter.wasm");
      if (fs.existsSync(wasmFile1)) {
        wasmDir = p;
        log(`Found WASM files at: ${p} (web-tree-sitter.wasm)`);
        break;
      }
      if (fs.existsSync(wasmFile2)) {
        wasmDir = p;
        log(`Found WASM files at: ${p} (tree-sitter.wasm)`);
        break;
      }
    }

    if (!wasmDir) {
      log("WASM files not found in any expected location");
      log(`Searched paths: ${possiblePaths.join(", ")}`);
      return false;
    }

    // List WASM directory contents
    const wasmFiles = fs.readdirSync(wasmDir);
    log(`WASM directory contents: ${wasmFiles.join(", ")}`);

    // Initialize parser
    log("Initializing parser...");
    await initParser(wasmDir);
    squeezerInstance = new SemanticSqueezer();

    log("WASM Squeezer initialized successfully");

    // Disable debug logging after successful init
    setDebugMode(false);
    return true;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : "";
    logError("Failed to initialize WASM squeezer:", errorMsg);
    log(`Error stack: ${errorStack}`);
    return false;
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

  // Initialize WASM squeezer (async, non-blocking)
  initSqueezer(context.extensionPath).then((available) => {
    if (available) {
      log("WASM Telegraphic Squeezer ready");
    } else {
      log("WASM squeezer initialization failed");
    }
  });

  // sql.js (used by @prune/state-scraper) needs sql-wasm.wasm next to
  // the bundled JS — i.e. inside dist/. The build script
  // (npm run copy-wasm, invoked after esbuild) copies the file from
  // wasm/sql-wasm.wasm into dist/sql-wasm.wasm so sql.js's default
  // Node.js lookup finds it without needing a locateFile override.
  // (Passing locateFile or wasmBinary triggers a LinkError on certain
  // Node versions; the default path-relative lookup is the safe codepath.)
  log("sql.js: relying on dist/sql-wasm.wasm (copied by build step)");

  // Initialize Intelligence Engine
  intelligenceEngine = new PruneIntelligenceEngine();
  log("Prune Intelligence Engine initialized");

  // Initialize TCRP feature-flag store and activate F5 (HUD).
  // Flags live at ~/.prune/feature-flags.json; defaults ship F5 enabled,
  // F1-F4 in shadow mode. See plan §"Final Executable Plan" cross-cutting.
  featureFlagStore = new FeatureFlagStore();
  featureFlagStore.startWatching();
  context.subscriptions.push({
    dispose: () => featureFlagStore?.dispose(),
  });
  context.subscriptions.push(activateHud(context, featureFlagStore, log));
  log(`Feature flags loaded from ${FLAG_PATH}`);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand("prune.analyzeSelection", analyzeSelection),
    vscode.commands.registerCommand("prune.analyzeFile", analyzeCurrentFile),
    vscode.commands.registerCommand("prune.squeezeFile", () => squeezeCurrentFile(context)),
    vscode.commands.registerCommand("prune.checkCursorUsage", checkCursorUsage),
    vscode.commands.registerCommand("prune.analyzeContext", () => analyzeContextCommand(context)),
    vscode.commands.registerCommand("prune.smartContext", () => smartContextCommand(context)),
    vscode.commands.registerCommand("prune.runTests", runTestsCommand),
    // Token Saver Features
    vscode.commands.registerCommand("prune.smartCopy", smartCopyCommand),
    vscode.commands.registerCommand("prune.preflight", () => preflightCommand(context)),
    vscode.commands.registerCommand("prune.sessionStats", sessionStatsCommand),
    vscode.commands.registerCommand("prune.resetSession", resetSessionCommand),
    vscode.commands.registerCommand("prune.compactionCheck", compactionCheckCommand),
    vscode.commands.registerCommand("prune.trackDecision", trackDecisionCommand),
    // TCRP feature control
    vscode.commands.registerCommand("prune.disableFeature", disableFeatureCommand),
    vscode.commands.registerCommand("prune.enableFeature", enableFeatureCommand),
    vscode.commands.registerCommand("prune.listFeatures", listFeaturesCommand),
    vscode.commands.registerCommand("prune.installHooks", () => installHooksCommand(context))
  );

  // Register URI handler for dashboard -> IDE interaction
  // Handles URIs like: vscode://delimit.prune/run/smartCopy
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri: vscode.Uri): vscode.ProviderResult<void> {
        log(`URI handler invoked: ${uri.toString()}`);

        const pathParts = uri.path.split("/").filter(Boolean);
        if (pathParts[0] !== "run" || !pathParts[1]) {
          log(`Invalid URI path: ${uri.path}`);
          vscode.window.showErrorMessage(`Prune: Invalid command URI`);
          return;
        }

        const featureId = pathParts[1];
        const commandMap: Record<string, string> = {
          smartCopy: "prune.smartCopy",
          preflight: "prune.preflight",
          sessionStats: "prune.sessionStats",
          compactionCheck: "prune.compactionCheck",
          trackDecision: "prune.trackDecision",
          resetSession: "prune.resetSession",
          analyzeFile: "prune.analyzeFile",
          analyzeSelection: "prune.analyzeSelection",
          analyzeContext: "prune.analyzeContext",
          smartContext: "prune.smartContext",
          squeezeFile: "prune.squeezeFile",
          checkCursorUsage: "prune.checkCursorUsage",
          runTests: "prune.runTests",
        };

        const command = commandMap[featureId];
        if (!command) {
          log(`Unknown feature ID: ${featureId}`);
          vscode.window.showErrorMessage(`Prune: Unknown command "${featureId}"`);
          return;
        }

        log(`Executing command via URI: ${command}`);
        vscode.commands.executeCommand(command).then(
          () => log(`Command ${command} executed successfully`),
          (err) => {
            logError(`Command ${command} failed:`, err);
            vscode.window.showErrorMessage(`Prune: Command failed - ${err.message || err}`);
          }
        );
      },
    })
  );
  log("URI handler registered for dashboard integration");

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
    const sessionStats = getSessionStats();
    const sessionInfo = sessionStats.tokensSaved > 0
      ? ` | Session: ${formatTokens(sessionStats.tokensSaved)} saved`
      : "";

    if (analysis.isLarge) {
      statusBarItem.text = "$(warning) " + analysis.formatted.tokens + " tokens";
      statusBarItem.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground"
      );
      statusBarItem.tooltip = `Large context: ${analysis.formatted.tokens} tokens (~${analysis.formatted.cost})${sessionInfo}`;
    } else {
      statusBarItem.text = "$(symbol-misc) " + analysis.formatted.tokens;
      statusBarItem.backgroundColor = undefined;
      statusBarItem.tooltip = `${analysis.formatted.tokens} tokens (~${analysis.formatted.cost})${sessionInfo}`;
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
    ".tsx": "tsx",
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

  // Initialize squeezer if needed
  const squeezerAvailable = await initSqueezer(context.extensionPath);
  if (!squeezerAvailable || !squeezerInstance || !wasmDir) {
    vscode.window.showErrorMessage("Squeezer not available. Check output for details.");
    return;
  }

  // Show progress while squeezing
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Squeezing with WASM Tree-sitter...",
      cancellable: false,
    },
    async () => {
      try {
        log("---");
        log("Squeezing: " + filePath);
        log("Language: " + language);

        const result = await squeezerInstance!.squeeze(text, language, wasmDir!);

        log("Original tokens: " + result.originalTokens);
        log("Squeezed tokens: " + result.squeezedTokens);
        log("Savings: " + result.savings + " (" + result.savingsPercent.toFixed(1) + "%)");
        log("Valid: " + result.isValid);

        if (result.error) {
          log("Error: " + result.error);
        }

        if (!result.isValid) {
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
        outputChannel.appendLine("Original: " + formatTokens(result.originalTokens) + " tokens");
        outputChannel.appendLine("Squeezed: " + formatTokens(result.squeezedTokens) + " tokens");
        outputChannel.appendLine("Savings: " + formatTokens(result.savings) + " tokens (" + result.savingsPercent.toFixed(1) + "%)");
        outputChannel.appendLine("---");

        // Ask user what to do
        const action = await vscode.window.showInformationMessage(
          `Saved ${formatTokens(result.savings)} tokens (${result.savingsPercent.toFixed(1)}%)`,
          "Copy to Clipboard",
          "View in Output",
          "Replace File"
        );

        if (action === "Copy to Clipboard") {
          await vscode.env.clipboard.writeText(result.squeezedCode);
          vscode.window.showInformationMessage("Compressed code copied to clipboard");
        } else if (action === "View in Output") {
          outputChannel.appendLine("\n=== COMPRESSED CODE ===\n");
          outputChannel.appendLine(result.squeezedCode);
          outputChannel.appendLine("\n=== END COMPRESSED CODE ===\n");
          outputChannel.show();
        } else if (action === "Replace File") {
          const edit = new vscode.WorkspaceEdit();
          const fullRange = new vscode.Range(
            editor.document.positionAt(0),
            editor.document.positionAt(text.length)
          );
          edit.replace(editor.document.uri, fullRange, result.squeezedCode);
          await vscode.workspace.applyEdit(edit);
          vscode.window.showInformationMessage("File compressed: " + result.savingsPercent.toFixed(1) + "% savings");
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
          // Show user-friendly error message
          const errorMsg = status.error || "Not available";

          // Don't spam for "Cursor not installed" - this is expected for non-Cursor users
          if (errorMsg.includes("not installed") || errorMsg.includes("not found")) {
            log("Cursor not detected: " + errorMsg);
            vscode.window.showInformationMessage("Cursor is not installed or not logged in.");
          } else {
            vscode.window.showWarningMessage("Cursor Usage: " + errorMsg);
            logError("Cursor usage check failed:", errorMsg);
          }
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
// Smart Context Analysis
// ============================================================================

async function analyzeContextCommand(context: vscode.ExtensionContext) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("No active file to analyze");
    return;
  }

  // Get user's intent/prompt
  const prompt = await vscode.window.showInputBox({
    prompt: "What do you want to do? (e.g., 'fix the auth bug', 'add validation')",
    placeHolder: "Describe your task...",
  });

  if (!prompt) {
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Analyzing context relevance...",
      cancellable: false,
    },
    async () => {
      try {
        const activeFilePath = editor.document.uri.fsPath;
        const activeFileContent = editor.document.getText();

        // Get all workspace files
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
          vscode.window.showWarningMessage("No workspace folder open");
          return;
        }

        // Find all relevant files (exclude node_modules, dist, etc.)
        const files = await vscode.workspace.findFiles(
          "**/*.{js,jsx,ts,tsx,py,go,rs,java,kt,c,cpp,h,hpp,rb,php,json}",
          "**/node_modules/**"
        );

        // Read file contents (limit to reasonable size)
        const workspaceFiles: { path: string; content: string }[] = [];
        for (const file of files.slice(0, 100)) { // Limit to 100 files
          try {
            const doc = await vscode.workspace.openTextDocument(file);
            const content = doc.getText();
            if (content.length < 500000) { // Skip very large files
              workspaceFiles.push({ path: file.fsPath, content });
            }
          } catch {
            // Skip files that can't be read
          }
        }

        // Run analysis
        const analysis = analyzeContext({
          activeFilePath,
          activeFileContent,
          prompt,
          workspaceFiles,
        });

        // Calculate costs
        const costPerMillion = 3; // $3 per million input tokens (approximate for Claude)
        const beforeCost = (analysis.totalTokens / 1000000) * costPerMillion;
        const afterCost = (analysis.relevantTokens / 1000000) * costPerMillion;
        const savedCost = beforeCost - afterCost;

        // Show results in output channel
        outputChannel.appendLine("");
        outputChannel.appendLine("╔═══════════════════════════════════════════════════════════════╗");
        outputChannel.appendLine("║              🧠 PRUNE CONTEXT ANALYSIS                        ║");
        outputChannel.appendLine("╚═══════════════════════════════════════════════════════════════╝");
        outputChannel.appendLine("");
        outputChannel.appendLine(`  📝 Task: "${prompt}"`);
        outputChannel.appendLine(`  📄 Active file: ${path.basename(activeFilePath)}`);
        outputChannel.appendLine("");

        // BEFORE vs AFTER comparison
        outputChannel.appendLine("┌─────────────────────────────────────────────────────────────────┐");
        outputChannel.appendLine("│                    📊 BEFORE vs AFTER                          │");
        outputChannel.appendLine("├─────────────────────────────────────────────────────────────────┤");
        outputChannel.appendLine("│                                                                 │");
        outputChannel.appendLine("│   ❌ WITHOUT PRUNE (naive approach):                           │");
        outputChannel.appendLine(`│      Files:  ${(analysis.relevantFiles.length + analysis.excludedFiles.length).toString().padStart(4)} files (all workspace files)               │`);
        outputChannel.appendLine(`│      Tokens: ${formatTokens(analysis.totalTokens).padStart(8)}                                       │`);
        outputChannel.appendLine(`│      Cost:   $${beforeCost.toFixed(4).padStart(7)} per request                            │`);
        outputChannel.appendLine("│                                                                 │");
        outputChannel.appendLine("│   ✅ WITH PRUNE (smart selection):                             │");
        outputChannel.appendLine(`│      Files:  ${analysis.relevantFiles.length.toString().padStart(4)} files (only relevant)                    │`);
        outputChannel.appendLine(`│      Tokens: ${formatTokens(analysis.relevantTokens).padStart(8)}                                       │`);
        outputChannel.appendLine(`│      Cost:   $${afterCost.toFixed(4).padStart(7)} per request                            │`);
        outputChannel.appendLine("│                                                                 │");
        outputChannel.appendLine("├─────────────────────────────────────────────────────────────────┤");
        outputChannel.appendLine("│                                                                 │");
        outputChannel.appendLine(`│   💰 YOU SAVE: ${formatTokens(analysis.excludedTokens).padStart(8)} tokens (${analysis.savingsPercent.toFixed(0)}%)                      │`);
        outputChannel.appendLine(`│               $${savedCost.toFixed(4)} per request                               │`);
        outputChannel.appendLine("│                                                                 │");
        outputChannel.appendLine("└─────────────────────────────────────────────────────────────────┘");

        outputChannel.appendLine("");
        outputChannel.appendLine("┌─────────────────────────────────────────────────────────────────┐");
        outputChannel.appendLine("│  ✅ RECOMMENDED FILES (include these in your context)          │");
        outputChannel.appendLine("├─────────────────────────────────────────────────────────────────┤");

        for (const file of analysis.relevantFiles) {
          const score = file.relevanceScore.toString().padStart(3);
          const tokens = formatTokens(file.tokens).padStart(8);
          const reasons = file.relevanceReasons.slice(0, 2).join(", ");
          outputChannel.appendLine(`│  [${score}%] ${tokens}  ${file.fileName.padEnd(35).substring(0, 35)} │`);
          outputChannel.appendLine(`│         └─ ${reasons.substring(0, 50).padEnd(50)} │`);
        }

        outputChannel.appendLine("└─────────────────────────────────────────────────────────────────┘");

        outputChannel.appendLine("");
        outputChannel.appendLine("┌─────────────────────────────────────────────────────────────────┐");
        outputChannel.appendLine("│  ❌ SKIP THESE FILES (not relevant to your task)               │");
        outputChannel.appendLine("├─────────────────────────────────────────────────────────────────┤");

        for (const file of analysis.excludedFiles.slice(0, 8)) {
          const tokens = formatTokens(file.tokens).padStart(8);
          const reason = file.relevanceReasons[0] || "Low relevance";
          outputChannel.appendLine(`│  ${tokens}  ${file.fileName.padEnd(45).substring(0, 45)} │`);
          outputChannel.appendLine(`│         └─ ${reason.substring(0, 50).padEnd(50)} │`);
        }

        if (analysis.excludedFiles.length > 8) {
          outputChannel.appendLine(`│  ... and ${(analysis.excludedFiles.length - 8).toString().padStart(3)} more files                                          │`);
        }

        outputChannel.appendLine("└─────────────────────────────────────────────────────────────────┘");

        outputChannel.appendLine("");
        outputChannel.appendLine("  💡 TIP: Use Ctrl+Alt+A (Cmd+Alt+A on Mac) to quickly run this analysis");
        outputChannel.appendLine("");
        outputChannel.show();

      } catch (error) {
        logError("Context analysis error:", error);
        vscode.window.showErrorMessage(
          "Failed to analyze context: " + (error instanceof Error ? error.message : String(error))
        );
      }
    }
  );

  // Show summary notification AFTER progress completes
  vscode.window.showInformationMessage(
    "Context analysis complete. See output for details.",
    "View Details"
  ).then((action) => {
    if (action === "View Details") {
      outputChannel.show();
    }
  });
}

// ============================================================================
// Prune v2 Intelligence Commands
// ============================================================================

async function smartContextCommand(context: vscode.ExtensionContext) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("No active file to analyze");
    return;
  }

  if (!intelligenceEngine) {
    intelligenceEngine = new PruneIntelligenceEngine();
  }

  // Get user's intent/prompt
  const prompt = await vscode.window.showInputBox({
    prompt: "What do you want to do? (e.g., 'fix the auth bug', 'refactor the user service')",
    placeHolder: "Describe your task...",
  });

  if (!prompt) {
    return;
  }

  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Prune v2: Analyzing with Intelligence Engine...",
      cancellable: false,
    },
    async () => {
      try {
        const activeFilePath = editor.document.uri.fsPath;
        const activeFileContent = editor.document.getText();
        const cursorLine = editor.selection.active.line + 1;

        // Get all workspace files
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
          vscode.window.showWarningMessage("No workspace folder open");
          return;
        }

        // Find all relevant files
        const filePatterns = "**/*.{js,jsx,ts,tsx,py,go,rs,java,kt,c,cpp,h,hpp,rb,php,cs,swift}";
        const excludePattern = "**/node_modules/**";
        const files = await vscode.workspace.findFiles(filePatterns, excludePattern);

        // Read file contents and detect language
        const workspaceFiles: Array<{path: string; content: string; language: string}> = [];

        for (const file of files.slice(0, 100)) {
          try {
            const doc = await vscode.workspace.openTextDocument(file);
            const content = doc.getText();
            if (content.length < 500000) {
              const ext = path.extname(file.fsPath).toLowerCase();
              const langMap: Record<string, string> = {
                ".ts": "typescript", ".tsx": "typescript", ".js": "javascript",
                ".jsx": "javascript", ".py": "python", ".go": "go", ".rs": "rust",
                ".java": "java", ".kt": "kotlin", ".c": "c", ".cpp": "cpp",
                ".h": "c", ".hpp": "cpp", ".rb": "ruby", ".php": "php",
                ".cs": "csharp", ".swift": "swift",
              };
              workspaceFiles.push({
                path: file.fsPath,
                content,
                language: langMap[ext] || "unknown",
              });
            }
          } catch {
            // Skip files that can't be read
          }
        }

        // Analyze with intelligence engine
        await intelligenceEngine!.analyzeFiles(workspaceFiles);

        // Select context based on prompt
        const selection = intelligenceEngine!.selectContext(prompt, {
          activeFile: activeFilePath,
          cursorLine,
          modelMaxTokens: 128000,
        });

        // Get stats
        const stats = intelligenceEngine!.getStats();

        // Generate manifest
        const manifest = intelligenceEngine!.generateManifest();

        // Show results
        outputChannel.appendLine("");
        outputChannel.appendLine("═══════════════════════════════════════════════════════════════════════");
        outputChannel.appendLine("  PRUNE v2 INTELLIGENT CONTEXT SELECTION");
        outputChannel.appendLine("═══════════════════════════════════════════════════════════════════════");
        outputChannel.appendLine("");
        outputChannel.appendLine(`📝 Task: "${prompt}"`);
        outputChannel.appendLine(`📄 Active file: ${path.basename(activeFilePath)}:${cursorLine}`);
        outputChannel.appendLine("");
        outputChannel.appendLine("───────────────────────────────────────────────────────────────────────");
        outputChannel.appendLine("  📊 CODEBASE ANALYSIS");
        outputChannel.appendLine("───────────────────────────────────────────────────────────────────────");
        outputChannel.appendLine(`  Files analyzed:    ${stats.fileCount}`);
        outputChannel.appendLine(`  Symbols found:     ${stats.symbolCount}`);
        outputChannel.appendLine(`  Dependencies:      ${stats.edgeCount} edges`);
        outputChannel.appendLine(`  Total tokens:      ${formatTokens(stats.totalTokens)}`);
        outputChannel.appendLine("");
        outputChannel.appendLine("───────────────────────────────────────────────────────────────────────");
        outputChannel.appendLine("  ✅ SELECTED CONTEXT (sorted by relevance)");
        outputChannel.appendLine("───────────────────────────────────────────────────────────────────────");

        // Group by category
        const critical = selection.selectedSymbols.filter(s => s.relevance.category === "critical");
        const high = selection.selectedSymbols.filter(s => s.relevance.category === "high");
        const medium = selection.selectedSymbols.filter(s => s.relevance.category === "medium");
        const low = selection.selectedSymbols.filter(s => s.relevance.category === "low");

        if (critical.length > 0) {
          outputChannel.appendLine("");
          outputChannel.appendLine("  🔴 CRITICAL (full code):");
          for (const item of critical) {
            const score = item.relevance.score.toString().padStart(3);
            const tokens = formatTokens(item.tokens).padStart(6);
            const reasons = item.relevance.reasons.slice(0, 2).join(", ");
            outputChannel.appendLine(`    [${score}] ${tokens}  ${item.symbol.kind}: ${item.symbol.name}`);
            outputChannel.appendLine(`                └─ ${reasons}`);
          }
        }

        if (high.length > 0) {
          outputChannel.appendLine("");
          outputChannel.appendLine("  🟠 HIGH (full code):");
          for (const item of high.slice(0, 10)) {
            const score = item.relevance.score.toString().padStart(3);
            const tokens = formatTokens(item.tokens).padStart(6);
            const reasons = item.relevance.reasons.slice(0, 2).join(", ");
            outputChannel.appendLine(`    [${score}] ${tokens}  ${item.symbol.kind}: ${item.symbol.name}`);
            outputChannel.appendLine(`                └─ ${reasons}`);
          }
          if (high.length > 10) {
            outputChannel.appendLine(`    ... and ${high.length - 10} more`);
          }
        }

        if (medium.length > 0) {
          outputChannel.appendLine("");
          outputChannel.appendLine("  🟡 MEDIUM (signatures only):");
          for (const item of medium.slice(0, 10)) {
            const score = item.relevance.score.toString().padStart(3);
            const tokens = formatTokens(item.tokens).padStart(6);
            outputChannel.appendLine(`    [${score}] ${tokens}  ${item.symbol.kind}: ${item.symbol.name}`);
          }
          if (medium.length > 10) {
            outputChannel.appendLine(`    ... and ${medium.length - 10} more`);
          }
        }

        if (low.length > 0) {
          outputChannel.appendLine("");
          outputChannel.appendLine("  🟢 LOW (reference only):");
          outputChannel.appendLine(`    ${low.length} symbols included as references`);
        }

        outputChannel.appendLine("");
        outputChannel.appendLine("───────────────────────────────────────────────────────────────────────");
        outputChannel.appendLine("  💰 CONTEXT BUDGET");
        outputChannel.appendLine("───────────────────────────────────────────────────────────────────────");
        outputChannel.appendLine(`  Selected:     ${formatTokens(selection.totalTokens)} tokens`);
        outputChannel.appendLine(`  Remaining:    ${formatTokens(selection.budgetRemaining)} tokens`);
        outputChannel.appendLine(`  Excluded:     ${selection.excludedCount} symbols`);
        outputChannel.appendLine(`  Compression:  ${((1 - selection.compressionRatio) * 100).toFixed(1)}% reduction`);

        const costPerMillion = 3;
        const originalCost = (stats.totalTokens / 1000000) * costPerMillion;
        const selectedCost = (selection.totalTokens / 1000000) * costPerMillion;
        const savings = originalCost - selectedCost;
        outputChannel.appendLine(`  Est. savings: ~$${savings.toFixed(4)} per request`);

        outputChannel.appendLine("");
        outputChannel.appendLine("═══════════════════════════════════════════════════════════════════════");
        outputChannel.show();

        // Store results for notification handler
        return { selection, compressionRatio: selection.compressionRatio };
      } catch (error) {
        logError("Smart context error:", error);
        vscode.window.showErrorMessage(
          "Failed to analyze: " + (error instanceof Error ? error.message : String(error))
        );
        return null;
      }
    }
  );

  // Show summary notification AFTER progress completes
  if (result) {
    const totalSelected = result.selection.selectedSymbols.length;
    const compressionPct = ((1 - result.compressionRatio) * 100).toFixed(0);

    vscode.window.showInformationMessage(
      `Prune v2: Selected ${totalSelected} symbols (${formatTokens(result.selection.totalTokens)} tokens), ${compressionPct}% reduction`,
      "View Details",
      "Copy Context"
    ).then(async (action) => {
      if (action === "View Details") {
        outputChannel.show();
      } else if (action === "Copy Context") {
        const contextText = result.selection.selectedSymbols
          .map((s: any) => `// === ${s.symbol.filePath}:${s.symbol.startLine} ===\n${s.content}`)
          .join("\n\n");
        await vscode.env.clipboard.writeText(contextText);
        vscode.window.showInformationMessage("Context copied to clipboard");
      }
    });
  }
}

async function runTestsCommand() {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Running Prune tests...",
      cancellable: false,
    },
    async () => {
      try {
        outputChannel.appendLine("");
        outputChannel.appendLine("═══════════════════════════════════════════════════════════════");
        outputChannel.appendLine("                    PRUNE TEST SUITE");
        outputChannel.appendLine("═══════════════════════════════════════════════════════════════");
        outputChannel.appendLine("");

        // =====================================================================
        // Run Token Saver Tests
        // =====================================================================
        outputChannel.appendLine("Running Token Saver Tests...");
        outputChannel.appendLine("");

        try {
          const tokenSaverResults = runAllTokenSaverTestsExtended();
          for (const line of tokenSaverResults.summary) {
            outputChannel.appendLine(line);
          }
          outputChannel.appendLine("");
        } catch (error) {
          outputChannel.appendLine(`❌ Token Saver tests failed: ${error}`);
          outputChannel.appendLine("");
        }

        // =====================================================================
        // Run TCRP F5 HUD Tests
        // =====================================================================
        outputChannel.appendLine("Running F5 HUD Tests...");
        outputChannel.appendLine("");

        try {
          const hudResults = runAllHudTests();
          for (const line of hudResults.summary) {
            outputChannel.appendLine(line);
          }
          outputChannel.appendLine("");
        } catch (error) {
          outputChannel.appendLine(`❌ HUD tests failed: ${error}`);
          outputChannel.appendLine("");
        }

        // =====================================================================
        // Run Intelligence Engine Tests
        // =====================================================================
        outputChannel.appendLine("Running Prune Intelligence Engine Tests...");
        outputChannel.appendLine("");

        // Run tests and capture output
        const originalLog = console.log;
        const originalError = console.error;
        const logLines: string[] = [];

        console.log = (...args) => {
          const line = args.map(a =>
            typeof a === 'object' ? JSON.stringify(a) : String(a)
          ).join(' ');
          logLines.push(line);
          originalLog.apply(console, args);
        };
        console.error = (...args) => {
          const line = args.map(a =>
            typeof a === 'object' ? JSON.stringify(a) : String(a)
          ).join(' ');
          logLines.push(line);
          originalError.apply(console, args);
        };

        try {
          // Import and run tests
          const { TestRunner } = await import("./prune-intelligence.test");
          const runner = new TestRunner();
          await runner.runAllTests();
        } catch (error) {
          logLines.push(`❌ Intelligence Engine tests failed: ${error}`);
        }

        // Restore console
        console.log = originalLog;
        console.error = originalError;

        // Output to channel
        for (const line of logLines) {
          outputChannel.appendLine(line);
        }

        outputChannel.appendLine("");
        outputChannel.appendLine("═══════════════════════════════════════════════════════════════");
        outputChannel.appendLine("                    TEST RUN COMPLETE");
        outputChannel.appendLine("═══════════════════════════════════════════════════════════════");

        outputChannel.show();
        vscode.window.showInformationMessage("Test run complete. See output for results.");
      } catch (error) {
        logError("Test run error:", error);
        vscode.window.showErrorMessage(
          "Tests failed: " + (error instanceof Error ? error.message : String(error))
        );
      }
    }
  );
}

// ============================================================================
// Token Saver Commands
// ============================================================================

/**
 * Smart Copy - Right-click → "Copy for AI (optimized)"
 * Copies selected files as optimized signatures
 */
async function smartCopyCommand() {
  const editor = vscode.window.activeTextEditor;

  // Get files to copy
  let filesToCopy: Array<{ path: string; content: string }> = [];

  // Check if there's a selection in the explorer (multiple files)
  const selectedUris = await vscode.commands.executeCommand<vscode.Uri[]>(
    "explorer.getSelection"
  );

  if (selectedUris && selectedUris.length > 0) {
    // Multiple files selected in explorer
    for (const uri of selectedUris) {
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.type === vscode.FileType.File) {
          const doc = await vscode.workspace.openTextDocument(uri);
          filesToCopy.push({
            path: uri.fsPath,
            content: doc.getText(),
          });
        }
      } catch {
        // Skip files that can't be read
      }
    }
  } else if (editor) {
    // Single file - current editor
    const selection = editor.selection;
    if (!selection.isEmpty) {
      // Use selected text
      filesToCopy.push({
        path: editor.document.uri.fsPath,
        content: editor.document.getText(selection),
      });
    } else {
      // Use entire file
      filesToCopy.push({
        path: editor.document.uri.fsPath,
        content: editor.document.getText(),
      });
    }
  }

  if (filesToCopy.length === 0) {
    vscode.window.showWarningMessage("No files selected to copy");
    return;
  }

  // Record files in session memory
  for (const file of filesToCopy) {
    recordFileRead(file.path, file.content);
  }

  // Generate optimized copy
  const result = generateSmartCopy(filesToCopy, { signatureOnly: true });

  // Copy to clipboard
  await vscode.env.clipboard.writeText(result.optimizedCode);

  // Show results
  const fileCount = filesToCopy.length;
  const message = `Copied ${fileCount} file${fileCount > 1 ? "s" : ""} for AI: ${formatTokens(result.optimizedTokens)} tokens (saved ${result.savingsPercent.toFixed(0)}%)`;

  outputChannel.appendLine("");
  outputChannel.appendLine("╔═══════════════════════════════════════════════════════════════╗");
  outputChannel.appendLine("║              📋 SMART COPY FOR AI                             ║");
  outputChannel.appendLine("╚═══════════════════════════════════════════════════════════════╝");
  outputChannel.appendLine("");
  outputChannel.appendLine(`  Files:     ${fileCount}`);
  outputChannel.appendLine(`  Original:  ${formatTokens(result.originalTokens)} tokens`);
  outputChannel.appendLine(`  Optimized: ${formatTokens(result.optimizedTokens)} tokens`);
  outputChannel.appendLine(`  Savings:   ${formatTokens(result.savings)} tokens (${result.savingsPercent.toFixed(0)}%)`);
  outputChannel.appendLine("");
  outputChannel.appendLine("  ✅ Copied to clipboard!");
  outputChannel.appendLine("");

  vscode.window.showInformationMessage(message, "View Output").then((action) => {
    if (action === "View Output") {
      outputChannel.show();
    }
  });
}

/**
 * Pre-flight Optimizer - Shows optimization opportunity before sending
 */
async function preflightCommand(context: vscode.ExtensionContext) {
  // Get active file path (for relevance boosting)
  const editor = vscode.window.activeTextEditor;
  const activeFilePath = editor?.document.uri.fsPath;

  // Get user's prompt
  const prompt = await vscode.window.showInputBox({
    prompt: "What are you about to ask the AI?",
    placeHolder: "e.g., fix the header alignment",
    value: "", // Start empty
  });

  if (!prompt) {
    return;
  }

  // Increment turn for session tracking
  incrementTurn();

  // Store analysis result and workspace files for use after progress completes
  // NB: `analysisResult` is only ever assigned inside the `withProgress`
  // closure below. TypeScript's control-flow analysis does not track
  // assignments made inside nested closures, so a plain `= null` initializer
  // would narrow the variable to the literal `null` type for the rest of this
  // scope — making the `if (analysisResult)` truthy branch resolve to `never`
  // (TS issues #9998 / #11498). Initializing through the declared union type
  // keeps the reference type as `PreflightAnalysis | null` so the truthy
  // branch narrows correctly. No runtime change (the value is still null).
  let analysisResult: PreflightAnalysis | null = null as PreflightAnalysis | null;
  let workspaceFilesCache: Array<{ path: string; content: string; tokens: number }> = [];

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Analyzing: "${prompt.substring(0, 30)}${prompt.length > 30 ? "..." : ""}"`,
      cancellable: false,
    },
    async () => {
      try {
        // Get workspace files
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
          vscode.window.showWarningMessage("No workspace folder open");
          return;
        }

        // Find relevant files
        const files = await vscode.workspace.findFiles(
          "**/*.{js,jsx,ts,tsx,py,go,rs,java,css,scss,html,json}",
          "**/node_modules/**"
        );

        // Read file contents
        const workspaceFiles: Array<{ path: string; content: string; tokens: number }> = [];
        for (const file of files.slice(0, 50)) {
          try {
            const doc = await vscode.workspace.openTextDocument(file);
            const content = doc.getText();
            if (content.length < 200000) {
              workspaceFiles.push({
                path: file.fsPath,
                content,
                tokens: countTokens(content).tokens,
              });
            }
          } catch {
            // Skip files that can't be read
          }
        }

        // Cache for use after progress
        workspaceFilesCache = workspaceFiles;

        // Analyze
        const analysis = analyzePreFlight(prompt, workspaceFiles, 3, activeFilePath);
        analysisResult = analysis;

        // Show results in output channel
        outputChannel.appendLine("");
        outputChannel.appendLine("╔═══════════════════════════════════════════════════════════════╗");
        outputChannel.appendLine("║              ⚡ PRE-FLIGHT OPTIMIZER                          ║");
        outputChannel.appendLine("╚═══════════════════════════════════════════════════════════════╝");
        outputChannel.appendLine("");
        outputChannel.appendLine(`  📝 Your prompt: "${prompt}"`);
        outputChannel.appendLine("");
        outputChannel.appendLine("┌─────────────────────────────────────────────────────────────────┐");
        outputChannel.appendLine("│  CURRENT CONTEXT (what you'd send):                            │");
        outputChannel.appendLine("├─────────────────────────────────────────────────────────────────┤");
        outputChannel.appendLine(`│  Files:   ${analysis.currentContext.files.length.toString().padStart(4)} files                                          │`);
        outputChannel.appendLine(`│  Tokens:  ${formatTokens(analysis.currentContext.tokens).padStart(8)}                                       │`);
        outputChannel.appendLine(`│  Cost:    $${analysis.currentContext.cost.toFixed(4).padStart(7)} per request                            │`);
        outputChannel.appendLine("└─────────────────────────────────────────────────────────────────┘");
        outputChannel.appendLine("");
        outputChannel.appendLine("┌─────────────────────────────────────────────────────────────────┐");
        outputChannel.appendLine("│  ✅ RECOMMENDED (optimized):                                   │");
        outputChannel.appendLine("├─────────────────────────────────────────────────────────────────┤");
        outputChannel.appendLine(`│  Files:   ${analysis.recommendedContext.files.length.toString().padStart(4)} files                                          │`);
        outputChannel.appendLine(`│  Tokens:  ${formatTokens(analysis.recommendedContext.tokens).padStart(8)}                                       │`);
        outputChannel.appendLine(`│  Cost:    $${analysis.recommendedContext.cost.toFixed(4).padStart(7)} per request                            │`);
        outputChannel.appendLine("└─────────────────────────────────────────────────────────────────┘");
        outputChannel.appendLine("");
        outputChannel.appendLine("┌─────────────────────────────────────────────────────────────────┐");
        outputChannel.appendLine("│  💰 SAVINGS:                                                   │");
        outputChannel.appendLine("├─────────────────────────────────────────────────────────────────┤");
        outputChannel.appendLine(`│  Tokens: ${formatTokens(analysis.savings.tokens).padStart(8)} (${analysis.savings.percent.toFixed(0)}% reduction)                     │`);
        outputChannel.appendLine(`│  Cost:   $${analysis.savings.cost.toFixed(4).padStart(7)} per request                               │`);
        outputChannel.appendLine("└─────────────────────────────────────────────────────────────────┘");
        outputChannel.appendLine("");

        if (analysis.recommendations.length > 0) {
          outputChannel.appendLine("  💡 Recommendations:");
          for (const rec of analysis.recommendations) {
            outputChannel.appendLine(`     • ${rec}`);
          }
          outputChannel.appendLine("");
        }

        if (analysis.recommendedContext.files.length > 0) {
          outputChannel.appendLine("  📄 Recommended files:");
          for (const file of analysis.recommendedContext.files.slice(0, 10)) {
            outputChannel.appendLine(`     • ${path.basename(file)}`);
          }
          if (analysis.recommendedContext.files.length > 10) {
            outputChannel.appendLine(`     ... and ${analysis.recommendedContext.files.length - 10} more`);
          }
        }

        outputChannel.appendLine("");
        outputChannel.show();
      } catch (error) {
        logError("Pre-flight error:", error);
        vscode.window.showErrorMessage(
          "Pre-flight analysis failed: " + (error instanceof Error ? error.message : String(error))
        );
      }
    }
  );

  // Show notification AFTER progress completes (not inside the progress callback)
  if (analysisResult) {
    const analysis = analysisResult;
    const action = await vscode.window.showInformationMessage(
      `Pre-flight: Save ${analysis.savings.percent.toFixed(0)}% (${formatTokens(analysis.savings.tokens)} tokens)`,
      "Copy Optimized Context",
      "View Details"
    );

    if (action === "Copy Optimized Context") {
      // Generate optimized copy for recommended files
      const filesToCopy = workspaceFilesCache
        .filter(f => analysis.recommendedContext.files.includes(f.path))
        .map(f => ({ path: f.path, content: f.content }));

      const result = generateSmartCopy(filesToCopy, { signatureOnly: true });
      await vscode.env.clipboard.writeText(result.optimizedCode);
      vscode.window.showInformationMessage(
        `Copied ${filesToCopy.length} files (${formatTokens(result.optimizedTokens)} tokens)`
      );
    } else if (action === "View Details") {
      outputChannel.show();
    }
  }
}

/**
 * Session Stats - Show session memory deduplication stats
 */
async function sessionStatsCommand() {
  try {
    const stats = getSessionStats();
    const files = getSessionFiles();
    const decisions = getAllDecisions();
    const turn = getCurrentTurn();

    outputChannel.appendLine("");
    outputChannel.appendLine("╔═══════════════════════════════════════════════════════════════╗");
    outputChannel.appendLine("║              📊 SESSION MEMORY STATS                          ║");
    outputChannel.appendLine("╚═══════════════════════════════════════════════════════════════╝");
    outputChannel.appendLine("");
    outputChannel.appendLine(`  Current turn:         ${turn}`);
    outputChannel.appendLine(`  Files in memory:      ${stats.filesRead}`);
    outputChannel.appendLine(`  Total tokens cached:  ${formatTokens(stats.totalTokens)}`);
    outputChannel.appendLine(`  Duplicates avoided:   ${stats.deduplicationCount}`);
    outputChannel.appendLine(`  Tokens saved:         ${formatTokens(stats.tokensSaved)}`);
    outputChannel.appendLine(`  Files changed:        ${stats.changesDetected}`);
    outputChannel.appendLine(`  Decisions tracked:    ${decisions.length}`);
    outputChannel.appendLine(`  Session duration:     ${Math.floor(stats.sessionDuration / 60000)} min`);
    outputChannel.appendLine("");

    if (files.length > 0) {
      outputChannel.appendLine("  📄 Files in session memory:");
      for (const file of files.slice(0, 15)) {
        const fileName = path.basename(file.path);
        const tokens = formatTokens(file.tokens).padStart(6);
        const partialMark = file.isPartial ? " (partial)" : "";
        const turnInfo = `(turn ${file.turnNumber})`;
        outputChannel.appendLine(`     ${tokens}  ${fileName}${partialMark} ${turnInfo}`);
      }
      if (files.length > 15) {
        outputChannel.appendLine(`     ... and ${files.length - 15} more files`);
      }
    }

    if (decisions.length > 0) {
      outputChannel.appendLine("");
      outputChannel.appendLine("  📋 Tracked decisions:");
      for (const decision of decisions.slice(0, 5)) {
        const priorityIcon = decision.priority === "critical" ? "🔴" :
                            decision.priority === "high" ? "🟠" :
                            decision.priority === "medium" ? "🟡" : "🟢";
        outputChannel.appendLine(`     ${priorityIcon} ${decision.description}`);
      }
      if (decisions.length > 5) {
        outputChannel.appendLine(`     ... and ${decisions.length - 5} more decisions`);
      }
    }

    outputChannel.appendLine("");
    outputChannel.show();

    if (stats.tokensSaved > 0) {
      vscode.window.showInformationMessage(
        `Session saved ${formatTokens(stats.tokensSaved)} tokens via deduplication`
      );
    } else {
      vscode.window.showInformationMessage(
        `Session memory: ${stats.filesRead} files, ${formatTokens(stats.totalTokens)} tokens`
      );
    }
  } catch (error) {
    logError("Session stats error:", error);
    vscode.window.showErrorMessage(
      "Failed to get session stats: " + (error instanceof Error ? error.message : String(error))
    );
  }
}

/**
 * Reset Session - Clear session memory
 */
async function resetSessionCommand() {
  const confirm = await vscode.window.showWarningMessage(
    "Reset session memory? This will clear file tracking and decision history.",
    "Reset",
    "Cancel"
  );

  if (confirm === "Reset") {
    resetSessionMemory();
    log("Session memory reset");
    vscode.window.showInformationMessage("Session memory cleared");
  }
}

/**
 * Compaction Check - Show decisions that may be at risk
 */
async function compactionCheckCommand() {
  const atRisk = getDecisionsAtRisk();
  const reminder = generateCompactionReminder();

  outputChannel.appendLine("");
  outputChannel.appendLine("╔═══════════════════════════════════════════════════════════════╗");
  outputChannel.appendLine("║              📋 COMPACTION RECOVERY                           ║");
  outputChannel.appendLine("╚═══════════════════════════════════════════════════════════════╝");
  outputChannel.appendLine("");

  if (atRisk.length === 0) {
    outputChannel.appendLine("  ✅ No decisions at risk of being forgotten.");
    outputChannel.appendLine("");
    outputChannel.appendLine("  Tip: Use 'Track Decision' to record important architectural");
    outputChannel.appendLine("  decisions during your session.");
  } else {
    outputChannel.appendLine("  ⚠️  These decisions may be forgotten if context compacts:");
    outputChannel.appendLine("");

    for (const decision of atRisk) {
      const categoryIcon = decision.category === "architectural" ? "🏗️" :
                           decision.category === "configuration" ? "⚙️" :
                           decision.category === "requirement" ? "📋" : "🔒";
      const priorityIcon = decision.priority === "critical" ? "🔴" :
                           decision.priority === "high" ? "🟠" :
                           decision.priority === "medium" ? "🟡" : "🟢";
      outputChannel.appendLine(`  ${priorityIcon} ${categoryIcon} ${decision.description}`);
      outputChannel.appendLine(`     └─ Turn ${decision.turnNumber}, ${decision.category}, ${decision.priority}`);
    }

    outputChannel.appendLine("");
    outputChannel.appendLine("  📋 Copy this reminder to your next prompt:");
    outputChannel.appendLine("");
    outputChannel.appendLine("  ─────────────────────────────────────────────");
    for (const line of reminder.split("\n")) {
      outputChannel.appendLine(`  ${line}`);
    }
    outputChannel.appendLine("  ─────────────────────────────────────────────");
  }

  outputChannel.appendLine("");
  outputChannel.show();

  if (atRisk.length > 0) {
    const action = await vscode.window.showWarningMessage(
      `${atRisk.length} decisions may be at risk`,
      "Copy Reminder",
      "View Details"
    );

    if (action === "Copy Reminder") {
      await vscode.env.clipboard.writeText(reminder);
      vscode.window.showInformationMessage("Reminder copied to clipboard");
    } else if (action === "View Details") {
      outputChannel.show();
    }
  } else {
    vscode.window.showInformationMessage("No decisions at risk of being forgotten");
  }
}

/**
 * Track Decision - Manually add an important decision
 */
async function trackDecisionCommand() {
  try {
    // Get decision description
    const description = await vscode.window.showInputBox({
      prompt: "What decision should be remembered?",
      placeHolder: "e.g., JWT expiry set to 15 minutes",
    });

    if (!description) {
      return;
    }

    // Get category
    const categoryPick = await vscode.window.showQuickPick(
      [
        { label: "🏗️ Architectural", value: "architectural" as const, description: "Design patterns, structure" },
        { label: "⚙️ Configuration", value: "configuration" as const, description: "Settings, values, limits" },
        { label: "📋 Requirement", value: "requirement" as const, description: "Must-haves, constraints" },
        { label: "🔒 Constraint", value: "constraint" as const, description: "Order, dependencies" },
      ],
      {
        placeHolder: "Select category",
      }
    );

    if (!categoryPick) {
      return;
    }

    // Get priority
    const priorityPick = await vscode.window.showQuickPick(
      [
        { label: "🔴 Critical", value: "critical" as DecisionPriority, description: "Must not forget" },
        { label: "🟠 High", value: "high" as DecisionPriority, description: "Very important" },
        { label: "🟡 Medium", value: "medium" as DecisionPriority, description: "Important" },
        { label: "🟢 Low", value: "low" as DecisionPriority, description: "Nice to remember" },
      ],
      {
        placeHolder: "Select priority",
      }
    );

    if (!priorityPick) {
      return;
    }

    // Track the decision
    const result = trackDecision(description, categoryPick.value, priorityPick.value, "manual");

    if (result.added) {
      vscode.window.showInformationMessage(`Decision tracked: "${description}"`);
      log(`Decision tracked: ${description} [${categoryPick.value}/${priorityPick.value}]`);
    } else {
      vscode.window.showInformationMessage(`Decision already tracked (updated priority)`);
    }
  } catch (error) {
    logError("Track decision error:", error);
    vscode.window.showErrorMessage(
      "Failed to track decision: " + (error instanceof Error ? error.message : String(error))
    );
  }
}

// ============================================================================
// TCRP feature control commands
// ============================================================================

async function disableFeatureCommand(arg?: string): Promise<void> {
  if (!featureFlagStore) {
    vscode.window.showErrorMessage("Prune: feature flag store not initialized");
    return;
  }
  const idOrName = arg ?? (await pickFeatureName("disable"));
  if (!idOrName) return;
  const reason = await vscode.window.showInputBox({
    prompt: `Why disable '${idOrName}'? (optional, recorded for audit)`,
    placeHolder: "e.g. testing fallback, accuracy concern, …",
  });
  const id = featureFlagStore.disable(idOrName, reason || undefined);
  if (!id) {
    vscode.window.showErrorMessage(`Prune: unknown feature '${idOrName}'`);
    return;
  }
  vscode.window.showInformationMessage(
    `Prune: ${TCRP_FEATURE_NAMES[id]} (${id}) disabled.`
  );
  log(`Feature ${id} (${TCRP_FEATURE_NAMES[id]}) disabled${reason ? `: ${reason}` : ""}`);
}

async function enableFeatureCommand(arg?: string): Promise<void> {
  if (!featureFlagStore) {
    vscode.window.showErrorMessage("Prune: feature flag store not initialized");
    return;
  }
  const idOrName = arg ?? (await pickFeatureName("enable"));
  if (!idOrName) return;
  const id = featureFlagStore.enable(idOrName, "general");
  if (!id) {
    vscode.window.showErrorMessage(`Prune: unknown feature '${idOrName}'`);
    return;
  }
  vscode.window.showInformationMessage(
    `Prune: ${TCRP_FEATURE_NAMES[id]} (${id}) enabled (mode: general).`
  );
  log(`Feature ${id} (${TCRP_FEATURE_NAMES[id]}) enabled`);
}

async function listFeaturesCommand(): Promise<void> {
  if (!featureFlagStore) {
    vscode.window.showErrorMessage("Prune: feature flag store not initialized");
    return;
  }
  const flags = featureFlagStore.current;
  const lines = TCRP_FEATURE_IDS.map((id) => {
    const state = flags.features[id];
    const name = TCRP_FEATURE_NAMES[id];
    const status = state.enabled ? state.mode : "off";
    const reason = state.reason ? ` — ${state.reason}` : "";
    return `${id.toUpperCase()}  ${name.padEnd(22)} ${status}${reason}`;
  });
  outputChannel.appendLine("=== TCRP feature flags ===");
  outputChannel.appendLine(`Policy source: ${flags.policySource}`);
  outputChannel.appendLine(`Flag file: ${FLAG_PATH}`);
  for (const line of lines) outputChannel.appendLine(line);
  outputChannel.show(true);
}

async function installHooksCommand(context: vscode.ExtensionContext): Promise<void> {
  const hooksDir = path.join(context.extensionPath, "hooks");
  const installScript = path.join(hooksDir, "install.mjs");
  if (!fs.existsSync(installScript)) {
    vscode.window.showErrorMessage(
      "Prune: hook installer not found. The hooks ship with the monorepo " +
        "(apps/extension/hooks) and depend on the workspace packages; run the " +
        "extension from the repo to install them."
    );
    return;
  }

  // Scope: user-wide (~/.claude/settings.json) or this workspace (.claude/…).
  const scopePick = await vscode.window.showQuickPick(
    [
      { label: "User settings", description: "~/.claude/settings.json (all projects)", scope: "user" },
      { label: "Project settings", description: ".claude/settings.json (this workspace)", scope: "project" },
    ],
    { placeHolder: "Install Prune hooks into which settings file?" }
  );
  if (!scopePick) return;

  const args = [installScript, "--hooks-dir", hooksDir];
  if (scopePick.scope === "project") {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      vscode.window.showErrorMessage("Prune: no workspace folder open for project-scoped install.");
      return;
    }
    args.push("--settings", path.join(root, ".claude", "settings.json"));
  } else {
    args.push("--user");
  }

  // Preview first (dry-run), then confirm before writing.
  const preview = await runNode([...args, "--dry-run"]);
  if (preview.error) {
    vscode.window.showErrorMessage(`Prune: hook install preview failed: ${preview.error}`);
    return;
  }
  outputChannel.appendLine("=== Prune hook install (preview) ===");
  outputChannel.appendLine(preview.stdout.trim());
  outputChannel.show(true);

  const confirm = await vscode.window.showInformationMessage(
    "Prune: install hooks now? (A preview was written to the Prune output channel.)",
    { modal: true },
    "Install"
  );
  if (confirm !== "Install") return;

  const result = await runNode(args);
  if (result.error) {
    vscode.window.showErrorMessage(`Prune: hook install failed: ${result.error}`);
    return;
  }
  outputChannel.appendLine(result.stdout.trim());
  vscode.window.showInformationMessage(result.stdout.split("\n")[0] || "Prune: hooks installed.");
  log(`installHooks: ${result.stdout.split("\n")[0]}`);
}

/** Run `node <args>` and capture stdout; never throws (returns {error}). */
function runNode(
  args: string[]
): Promise<{ stdout: string; stderr: string; error?: string }> {
  return new Promise((resolve) => {
    execFile("node", args, { timeout: 20_000 }, (err, stdout, stderr) => {
      resolve({
        stdout: stdout ?? "",
        stderr: stderr ?? "",
        error: err ? (stderr?.trim() || err.message) : undefined,
      });
    });
  });
}

async function pickFeatureName(verb: string): Promise<string | undefined> {
  const items = TCRP_FEATURE_IDS.map((id) => ({
    label: TCRP_FEATURE_NAMES[id],
    description: id,
  }));
  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: `Select feature to ${verb}`,
  });
  return pick?.label;
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
