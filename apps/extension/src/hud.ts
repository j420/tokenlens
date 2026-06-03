/**
 * F5 — Spend-as-You-Type HUD: VS Code integration shell.
 *
 * Display-only. Reads the prompt buffer from chat-input documents and
 * renders projected cost in a dedicated status-bar item. All compute is
 * delegated to ./hud-compute.ts so the regression suite can exercise it
 * without a VS Code host.
 *
 * Quality-preservation invariant: this module NEVER mutates the prompt,
 * NEVER alters generation, NEVER routes. Failure modes are display
 * inaccuracy and excessive resource use. See plan §F5.
 */

import * as vscode from "vscode";
import { isFeatureEnabled, type TcrpFeatureFlags } from "@prune/shared";
import { computeHud, isChatInputSurface } from "./hud-compute.js";
import type { FeatureFlagStore } from "./feature-flags-store.js";

const FEATURE_ID = "f5" as const;
const DEBOUNCE_MS = 100;
const LATENCY_BUDGET_MS = 10;
const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

interface HudConfig {
  enabled: boolean;
  model: string;
  greenUsd: number;
  redUsd: number;
}

function readConfig(): HudConfig {
  const cfg = vscode.workspace.getConfiguration("prune.hud");
  return {
    enabled: cfg.get<boolean>("enabled", true),
    model: cfg.get<string>("model", DEFAULT_MODEL),
    greenUsd: cfg.get<number>("thresholds.greenUsd", 0.01),
    redUsd: cfg.get<number>("thresholds.redUsd", 0.1),
  };
}

function isChatInputDocument(doc: vscode.TextDocument): boolean {
  return isChatInputSurface(doc.uri?.scheme ?? "", doc.languageId ?? "");
}

/**
 * Install the HUD into the extension lifecycle. Returns a disposable that
 * tears everything down on extension deactivation or feature kill-switch.
 */
export function activateHud(
  context: vscode.ExtensionContext,
  flagStore: FeatureFlagStore,
  log: (msg: string) => void
): vscode.Disposable {
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    50
  );
  statusBarItem.name = "Prune HUD";
  statusBarItem.hide();

  let debounceTimer: NodeJS.Timeout | null = null;
  let config = readConfig();

  const featureLive = (flags: TcrpFeatureFlags): boolean =>
    isFeatureEnabled(flags, FEATURE_ID);

  const render = (text: string): void => {
    if (!featureLive(flagStore.current) || !config.enabled) {
      statusBarItem.hide();
      return;
    }
    const t0 = performance.now();
    const c = computeHud(text, config.model, {
      greenUsd: config.greenUsd,
      redUsd: config.redUsd,
    });
    const elapsed = performance.now() - t0;
    if (elapsed > LATENCY_BUDGET_MS) {
      // Soft-warn on budget breach (plan §F5: "HUD update latency p99 ≤ 10ms").
      log(`[hud] update took ${elapsed.toFixed(1)}ms (budget ${LATENCY_BUDGET_MS}ms)`);
    }
    if (c.tokens === 0) {
      statusBarItem.hide();
      return;
    }
    statusBarItem.text = c.displayText;
    statusBarItem.tooltip = c.tooltipText;
    statusBarItem.backgroundColor =
      c.severity === "red"
        ? new vscode.ThemeColor("statusBarItem.errorBackground")
        : c.severity === "yellow"
          ? new vscode.ThemeColor("statusBarItem.warningBackground")
          : undefined;
    statusBarItem.show();
  };

  const onDocChange = (event: vscode.TextDocumentChangeEvent): void => {
    if (!isChatInputDocument(event.document)) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(
      () => render(event.document.getText()),
      DEBOUNCE_MS
    );
  };

  const onActiveEditorChange = (
    editor: vscode.TextEditor | undefined
  ): void => {
    if (!editor || !isChatInputDocument(editor.document)) {
      statusBarItem.hide();
      return;
    }
    render(editor.document.getText());
  };

  const subscriptions: vscode.Disposable[] = [
    statusBarItem,
    vscode.workspace.onDidChangeTextDocument(onDocChange),
    vscode.window.onDidChangeActiveTextEditor(onActiveEditorChange),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("prune.hud")) return;
      config = readConfig();
      const editor = vscode.window.activeTextEditor;
      if (editor) onActiveEditorChange(editor);
    }),
  ];

  // Re-render on flag changes (e.g., user runs `prune.disableFeature hud`).
  const unsubscribeFlags = flagStore.onChange(() => {
    const editor = vscode.window.activeTextEditor;
    if (editor) onActiveEditorChange(editor);
    else statusBarItem.hide();
  });

  context.subscriptions.push(...subscriptions);
  log(`[hud] activated (model: ${config.model})`);

  return new vscode.Disposable(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    unsubscribeFlags();
    for (const sub of subscriptions) {
      try {
        sub.dispose();
      } catch {
        // ignore
      }
    }
  });
}
