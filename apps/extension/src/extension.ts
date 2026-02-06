/**
 * Prune VS Code Extension
 *
 * Token intelligence for AI coding assistants.
 * Zero API keys required. All processing happens locally.
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { analyzeContent, cleanup, formatTokens, countTokens } from "@prune/tokenizer";
import { type PruneConfig, DEFAULT_CONFIG } from "@prune/shared";
import { SemanticSqueezer, initParser, loadLanguage, setDebugMode } from "./squeezer";
import { analyzeContext, type ContextAnalysis, type FileRelevance } from "./context-analyzer";
import { PruneIntelligenceEngine, runTests as runIntelligenceTests } from "./prune-intelligence";
import { testSamples } from "./prune-intelligence.test";

// ============================================================================
// State
// ============================================================================

let statusBarItem: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;
let squeezerInstance: SemanticSqueezer | null = null;
let wasmDir: string | null = null;
let sqliteWarningShown = false; // Only show sqlite warning once
let intelligenceEngine: PruneIntelligenceEngine | null = null;

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

  // Initialize Intelligence Engine
  intelligenceEngine = new PruneIntelligenceEngine();
  log("Prune Intelligence Engine initialized");

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand("prune.analyzeSelection", analyzeSelection),
    vscode.commands.registerCommand("prune.analyzeFile", analyzeCurrentFile),
    vscode.commands.registerCommand("prune.copyTokenCount", copyTokenCount),
    vscode.commands.registerCommand("prune.squeezeFile", () => squeezeCurrentFile(context)),
    vscode.commands.registerCommand("prune.checkCursorUsage", checkCursorUsage),
    vscode.commands.registerCommand("prune.analyzeContext", () => analyzeContextCommand(context)),
    vscode.commands.registerCommand("prune.smartContext", () => smartContextCommand(context)),
    vscode.commands.registerCommand("prune.runTests", runTestsCommand)
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
          // Only show sqlite warning once to avoid spamming the output
          const isSqliteError = status.error?.includes("sqlite3");
          if (isSqliteError && sqliteWarningShown) {
            return; // Skip duplicate sqlite warnings
          }
          if (isSqliteError) {
            sqliteWarningShown = true;
            log("Note: SQLite CLI not installed - Cursor usage tracking disabled (optional feature)");
          } else {
            vscode.window.showWarningMessage("Cursor Usage: " + (status.error || "Not available"));
            logError("Cursor usage check failed:", status.error);
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

        // Show results in output channel
        outputChannel.appendLine("");
        outputChannel.appendLine("═══════════════════════════════════════════════════════");
        outputChannel.appendLine("  SMART CONTEXT ANALYSIS");
        outputChannel.appendLine("═══════════════════════════════════════════════════════");
        outputChannel.appendLine("");
        outputChannel.appendLine(`📝 Your task: "${prompt}"`);
        outputChannel.appendLine(`📄 Active file: ${path.basename(activeFilePath)}`);
        outputChannel.appendLine("");
        outputChannel.appendLine("───────────────────────────────────────────────────────");
        outputChannel.appendLine("  ✅ RELEVANT FILES (send these)");
        outputChannel.appendLine("───────────────────────────────────────────────────────");

        for (const file of analysis.relevantFiles) {
          const score = file.relevanceScore.toString().padStart(3);
          const tokens = formatTokens(file.tokens).padStart(8);
          const reasons = file.relevanceReasons.slice(0, 2).join(", ");
          outputChannel.appendLine(`  [${score}%] ${tokens}  ${file.fileName}`);
          outputChannel.appendLine(`         └─ ${reasons}`);
        }

        outputChannel.appendLine("");
        outputChannel.appendLine(`  Subtotal: ${formatTokens(analysis.relevantTokens)} tokens`);

        outputChannel.appendLine("");
        outputChannel.appendLine("───────────────────────────────────────────────────────");
        outputChannel.appendLine("  ❌ EXCLUDED FILES (not relevant)");
        outputChannel.appendLine("───────────────────────────────────────────────────────");

        for (const file of analysis.excludedFiles.slice(0, 10)) {
          const tokens = formatTokens(file.tokens).padStart(8);
          outputChannel.appendLine(`  ${tokens}  ${file.fileName}`);
          outputChannel.appendLine(`         └─ ${file.relevanceReasons[0]}`);
        }

        if (analysis.excludedFiles.length > 10) {
          outputChannel.appendLine(`  ... and ${analysis.excludedFiles.length - 10} more files`);
        }

        outputChannel.appendLine("");
        outputChannel.appendLine(`  Subtotal: ${formatTokens(analysis.excludedTokens)} tokens`);

        outputChannel.appendLine("");
        outputChannel.appendLine("───────────────────────────────────────────────────────");
        outputChannel.appendLine("  💰 SUMMARY");
        outputChannel.appendLine("───────────────────────────────────────────────────────");
        outputChannel.appendLine(`  Total tokens:     ${formatTokens(analysis.totalTokens)}`);
        outputChannel.appendLine(`  Relevant tokens:  ${formatTokens(analysis.relevantTokens)}`);
        outputChannel.appendLine(`  Excluded tokens:  ${formatTokens(analysis.excludedTokens)}`);
        outputChannel.appendLine(`  Savings:          ${analysis.savingsPercent.toFixed(1)}%`);

        const costPerMillion = 3; // $3 per million input tokens (approximate)
        const savingsDollars = (analysis.excludedTokens / 1000000) * costPerMillion;
        outputChannel.appendLine(`  Est. savings:     ~$${savingsDollars.toFixed(4)} per request`);

        outputChannel.appendLine("");
        outputChannel.appendLine("═══════════════════════════════════════════════════════");
        outputChannel.show();

        // Show summary notification
        const action = await vscode.window.showInformationMessage(
          `Context analysis: ${analysis.relevantFiles.length} relevant files (${formatTokens(analysis.relevantTokens)} tokens), ` +
          `${analysis.excludedFiles.length} excluded (${analysis.savingsPercent.toFixed(0)}% savings)`,
          "View Details"
        );

        if (action === "View Details") {
          outputChannel.show();
        }
      } catch (error) {
        logError("Context analysis error:", error);
        vscode.window.showErrorMessage(
          "Failed to analyze context: " + (error instanceof Error ? error.message : String(error))
        );
      }
    }
  );
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

  await vscode.window.withProgress(
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

        // Show summary notification
        const totalSelected = selection.selectedSymbols.length;
        const compressionPct = ((1 - selection.compressionRatio) * 100).toFixed(0);

        vscode.window.showInformationMessage(
          `Prune v2: Selected ${totalSelected} symbols (${formatTokens(selection.totalTokens)} tokens), ${compressionPct}% reduction`,
          "View Details",
          "Copy Context"
        ).then(async (action) => {
          if (action === "View Details") {
            outputChannel.show();
          } else if (action === "Copy Context") {
            // Generate concatenated context
            const contextText = selection.selectedSymbols
              .map(s => `// === ${s.symbol.filePath}:${s.symbol.startLine} ===\n${s.content}`)
              .join("\n\n");
            await vscode.env.clipboard.writeText(contextText);
            vscode.window.showInformationMessage("Context copied to clipboard");
          }
        });
      } catch (error) {
        logError("Smart context error:", error);
        vscode.window.showErrorMessage(
          "Failed to analyze: " + (error instanceof Error ? error.message : String(error))
        );
      }
    }
  );
}

async function runTestsCommand() {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Running Prune Intelligence Engine tests...",
      cancellable: false,
    },
    async () => {
      try {
        outputChannel.appendLine("");
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

        // Import and run tests
        const { TestRunner } = await import("./prune-intelligence.test");
        const runner = new TestRunner();
        await runner.runAllTests();

        // Restore console
        console.log = originalLog;
        console.error = originalError;

        // Output to channel
        for (const line of logLines) {
          outputChannel.appendLine(line);
        }

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
