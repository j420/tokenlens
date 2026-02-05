/**
 * Prune VS Code Extension
 *
 * Token intelligence for AI coding assistants.
 * Zero API keys required. All processing happens locally.
 */

import * as vscode from "vscode";
import { analyzeContent, cleanup, formatTokens, countTokens } from "@prune/tokenizer";
import { type PruneConfig, DEFAULT_CONFIG } from "@prune/shared";
import { squeezeFile, type SqueezeResult } from "@prune/squeezer";

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
    vscode.commands.registerCommand("prune.copyTokenCount", copyTokenCount),
    vscode.commands.registerCommand("prune.squeezeFile", squeezeCurrentFile)
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

async function squeezeCurrentFile() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("No active editor");
    return;
  }

  const text = editor.document.getText();
  const filePath = editor.document.fileName;
  const config = getConfig();

  // Show quick pick to select compression tier
  const tier = await vscode.window.showQuickPick(
    [
      { label: "Lossless", description: "Remove comments & whitespace (~15% savings)", value: "lossless" },
      { label: "Structural", description: "Keep signatures, compress bodies (~40% savings)", value: "structural" },
      { label: "Telegraphic", description: "Types and signatures only (~70% savings)", value: "telegraphic" },
    ],
    { placeHolder: "Select compression level" }
  );

  if (!tier) return;

  try {
    const result: SqueezeResult = squeezeFile(text, filePath, {
      tier: tier.value as "lossless" | "structural" | "telegraphic",
      preserveTodos: config.preserveTodos,
      preserveTypeHints: config.preserveTypeHints,
    });

    if (result.savings === 0) {
      vscode.window.showInformationMessage("No compression possible for this file");
      return;
    }

    // Show results
    outputChannel.appendLine("---");
    outputChannel.appendLine("Squeeze: " + filePath.split(/[\\/]/).pop());
    outputChannel.appendLine("Tier: " + tier.label);
    outputChannel.appendLine("Original: " + formatTokens(result.originalTokens) + " tokens");
    outputChannel.appendLine("Compressed: " + formatTokens(result.compressedTokens) + " tokens");
    outputChannel.appendLine("Savings: " + formatTokens(result.savings) + " tokens (" + result.savingsPercent + "%)");
    outputChannel.appendLine("Summary: " + result.diffSummary);
    outputChannel.appendLine("---");

    // Ask user what to do with compressed code
    const action = await vscode.window.showInformationMessage(
      "Saved " + formatTokens(result.savings) + " tokens (" + result.savingsPercent + "%)",
      "Copy to Clipboard",
      "View in Output",
      "Replace File"
    );

    if (action === "Copy to Clipboard") {
      await vscode.env.clipboard.writeText(result.compressedCode);
      vscode.window.showInformationMessage("Compressed code copied to clipboard");
    } else if (action === "View in Output") {
      outputChannel.appendLine("\n=== COMPRESSED CODE ===\n");
      outputChannel.appendLine(result.compressedCode);
      outputChannel.appendLine("\n=== END COMPRESSED CODE ===\n");
      outputChannel.show();
    } else if (action === "Replace File") {
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(
        editor.document.positionAt(0),
        editor.document.positionAt(text.length)
      );
      edit.replace(editor.document.uri, fullRange, result.compressedCode);
      await vscode.workspace.applyEdit(edit);
      vscode.window.showInformationMessage("File compressed: " + result.savingsPercent + "% savings");
    }
  } catch (error) {
    outputChannel.appendLine("Squeeze error: " + error);
    vscode.window.showErrorMessage("Failed to squeeze file: " + (error instanceof Error ? error.message : String(error)));
  }
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
