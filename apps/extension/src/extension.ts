/**
 * Prune VS Code Extension
 *
 * Token intelligence for AI coding assistants.
 * Zero API keys required. All processing happens locally.
 */

import * as vscode from "vscode";
import { countTokens, analyzeContent, cleanup, formatTokens } from "@prune/tokenizer";
import { squeezeFile } from "@prune/squeezer";
import { type SqueezeTier, type PruneConfig, DEFAULT_CONFIG } from "@prune/shared";

// ============================================================================
// State
// ============================================================================

let statusBarItem: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;
let lastSqueezeResult: { original: string; compressed: string } | null = null;

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
  statusBarItem.tooltip = "Click to analyze selection";
  context.subscriptions.push(statusBarItem);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand("prune.analyzeSelection", analyzeSelection),
    vscode.commands.registerCommand("prune.squeezeSelection", squeezeSelection),
    vscode.commands.registerCommand("prune.squeezeFile", squeezeCurrentFile),
    vscode.commands.registerCommand("prune.showDiff", showDiff)
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

  // Show welcome message on first install
  const hasShownWelcome = context.globalState.get("prune.hasShownWelcome");
  if (!hasShownWelcome) {
    showWelcomeMessage();
    context.globalState.update("prune.hasShownWelcome", true);
  }
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
      statusBarItem.tooltip = "Large context detected! Click to squeeze.";
      statusBarItem.command = "prune.squeezeSelection";
    } else {
      statusBarItem.text = "$(symbol-misc) " + analysis.formatted.tokens;
      statusBarItem.backgroundColor = undefined;
      statusBarItem.tooltip = analysis.formatted.tokens + " tokens (~" + analysis.formatted.cost + ")";
      statusBarItem.command = "prune.analyzeSelection";
    }
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
  const text = selection.isEmpty
    ? editor.document.getText()
    : editor.document.getText(selection);

  const config = getConfig();
  const analysis = analyzeContent(text, "gpt-4o", config.autoSqueezeThreshold);

  const message = [
    "Tokens: " + analysis.formatted.tokens,
    "Cost: " + analysis.formatted.cost,
    "Recommendation: " + analysis.recommendation,
  ].join(" | ");

  if (analysis.isLarge) {
    const action = await vscode.window.showWarningMessage(
      message,
      "Squeeze",
      "Dismiss"
    );
    if (action === "Squeeze") {
      await squeezeSelection();
    }
  } else {
    vscode.window.showInformationMessage(message);
  }
}

async function squeezeSelection() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("No active editor");
    return;
  }

  const selection = editor.selection;
  const text = selection.isEmpty
    ? editor.document.getText()
    : editor.document.getText(selection);

  const filePath = editor.document.fileName;
  const config = getConfig();

  // Ask user for compression tier
  const tier = await askForTier(config.defaultTier);
  if (!tier) return;

  // Perform squeeze
  const result = squeezeFile(text, filePath, {
    tier,
    preserveTodos: config.preserveTodos,
    preserveTypeHints: config.preserveTypeHints,
  });

  if (!result.isValid) {
    vscode.window.showErrorMessage(
      "Squeeze failed validation. Original code preserved."
    );
    return;
  }

  // Store for diff view
  lastSqueezeResult = {
    original: text,
    compressed: result.compressedCode,
  };

  // Show result
  const savingsMessage = [
    "Squeezed: " + formatTokens(result.originalTokens),
    " -> " + formatTokens(result.compressedTokens),
    " (saved " + result.savingsPercent + "%)",
  ].join("");

  const action = await vscode.window.showInformationMessage(
    savingsMessage,
    "Apply",
    "View Diff",
    "Copy",
    "Dismiss"
  );

  switch (action) {
    case "Apply":
      await applySqueezeResult(editor, selection, result.compressedCode);
      break;
    case "View Diff":
      await showDiff();
      break;
    case "Copy":
      await vscode.env.clipboard.writeText(result.compressedCode);
      vscode.window.showInformationMessage("Squeezed code copied to clipboard");
      break;
  }
}

async function squeezeCurrentFile() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("No active editor");
    return;
  }

  // Select all and squeeze
  const fullRange = new vscode.Range(
    editor.document.positionAt(0),
    editor.document.positionAt(editor.document.getText().length)
  );
  editor.selection = new vscode.Selection(fullRange.start, fullRange.end);
  await squeezeSelection();
}

async function showDiff() {
  if (!lastSqueezeResult) {
    vscode.window.showWarningMessage("No squeeze result to show. Run squeeze first.");
    return;
  }

  const originalUri = vscode.Uri.parse("prune:Original");
  const compressedUri = vscode.Uri.parse("prune:Compressed");

  // Register content provider
  const provider = new (class implements vscode.TextDocumentContentProvider {
    provideTextDocumentContent(uri: vscode.Uri): string {
      if (uri.path === "Original") {
        return lastSqueezeResult!.original;
      }
      return lastSqueezeResult!.compressed;
    }
  })();

  const disposable = vscode.workspace.registerTextDocumentContentProvider(
    "prune",
    provider
  );

  await vscode.commands.executeCommand(
    "vscode.diff",
    originalUri,
    compressedUri,
    "Original <-> Squeezed"
  );

  // Clean up after a delay
  setTimeout(() => disposable.dispose(), 60000);
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

async function askForTier(
  defaultTier: SqueezeTier
): Promise<SqueezeTier | undefined> {
  const items: vscode.QuickPickItem[] = [
    {
      label: "Lossless",
      description: "Strip comments and whitespace (~15% savings)",
      picked: defaultTier === "lossless",
    },
    {
      label: "Structural",
      description: "Keep signatures, prune bodies (~40% savings)",
      picked: defaultTier === "structural",
    },
    {
      label: "Telegraphic",
      description: "Interface definitions only (~70% savings)",
      picked: defaultTier === "telegraphic",
    },
  ];

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: "Select compression tier",
  });

  if (!selected) return undefined;

  return selected.label.toLowerCase() as SqueezeTier;
}

async function applySqueezeResult(
  editor: vscode.TextEditor,
  selection: vscode.Selection,
  compressedCode: string
) {
  await editor.edit((editBuilder) => {
    if (selection.isEmpty) {
      // Replace entire document
      const fullRange = new vscode.Range(
        editor.document.positionAt(0),
        editor.document.positionAt(editor.document.getText().length)
      );
      editBuilder.replace(fullRange, compressedCode);
    } else {
      editBuilder.replace(selection, compressedCode);
    }
  });

  vscode.window.showInformationMessage("Squeeze applied!");
}

function showWelcomeMessage() {
  vscode.window
    .showInformationMessage(
      "Welcome to Prune! Select code and use the context menu to analyze or squeeze.",
      "Learn More"
    )
    .then((action) => {
      if (action === "Learn More") {
        vscode.env.openExternal(
          vscode.Uri.parse("https://delimit.dev/docs/prune")
        );
      }
    });
}
