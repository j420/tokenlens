/**
 * Prune VS Code Extension
 *
 * Token intelligence for AI coding assistants.
 * Zero API keys required. All processing happens locally.
 */

import * as vscode from "vscode";
import { analyzeContent, cleanup, formatTokens, countTokens } from "@prune/tokenizer";
import { type PruneConfig, DEFAULT_CONFIG } from "@prune/shared";

// ============================================================================
// State
// ============================================================================

let statusBarItem: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;

// ============================================================================
// Activation
// ============================================================================

export function activate(context: vscode.ExtensionContext) {
  // Create output channel
  outputChannel = vscode.window.createOutputChannel("Prune");
  outputChannel.appendLine("Prune extension activated");

  // Create status bar item
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = "prune.analyzeSelection";
  statusBarItem.tooltip = "Click to analyze token count";
  context.subscriptions.push(statusBarItem);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand("prune.analyzeSelection", analyzeSelection),
    vscode.commands.registerCommand("prune.analyzeFile", analyzeCurrentFile),
    vscode.commands.registerCommand("prune.copyTokenCount", copyTokenCount)
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

  outputChannel.appendLine("Prune ready - token counting active");
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
    outputChannel.appendLine("Token count error: " + error);
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
