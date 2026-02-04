import * as vscode from "vscode";
import WebSocket from "ws";

interface TokenUpdateEvent {
  type: "token_update"; session_id: string; cumulative_session_cost_usd: number;
  cumulative_session_tokens: number; roi_score: number | null;
}
interface PruneSuggestionEvent {
  type: "prune_suggestion"; total_tokens: number; relevant_tokens: number;
  estimated_savings_usd: number; irrelevant_summary: string;
  auto_dismiss_seconds: number; confidence: number;
}
interface BurnAlertEvent {
  type: "burn_alert"; alert_id: string; session_id: string; pattern: string;
  severity: "warning" | "info"; message_title: string; message_body: string;
  suggestions: Array<{ label: string; action: string; detail: string }>;
}
interface CompactionEvent {
  type: "compaction_event"; session_id: string; turn_number: number;
  tokens_before: number; tokens_after: number;
  lost_references: Array<{ item: string; original_turn: number }>;
}
type StreamEvent = TokenUpdateEvent | PruneSuggestionEvent | BurnAlertEvent | CompactionEvent;

let statusBarItem: vscode.StatusBarItem;
let ws: WebSocket | null = null;
let currentSessionId: string | null = null;
let sessionCost = 0, sessionTokens = 0, roiScore: number | null = null, hasUnreadAlerts = false;
const alertCooldowns = new Map<string, number>();

export function activate(context: vscode.ExtensionContext): void {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = "prune.showQuickPick";
  updateStatusBar("idle");
  statusBarItem.show();
  context.subscriptions.push(statusBarItem,
    vscode.commands.registerCommand("prune.showQuickPick", showQuickPick),
    vscode.commands.registerCommand("prune.connect", connect),
    vscode.commands.registerCommand("prune.disconnect", disconnect));
  connect();
}

export function deactivate(): void { disconnect(); }

function getConfig() {
  const config = vscode.workspace.getConfiguration("prune");
  return {
    apiKey: config.get<string>("apiKey") || process.env["PRUNE_API_KEY"] || "",
    apiUrl: config.get<string>("apiUrl") || "wss://delimit.dev/api/v1/stream",
    thresholdAmber: config.get<number>("thresholdAmber") || 2,
    thresholdRed: config.get<number>("thresholdRed") || 5,
  };
}

function connect(): void {
  const { apiKey, apiUrl } = getConfig();
  if (!apiKey) { updateStatusBar("idle"); return; }
  disconnect();
  try {
    ws = new WebSocket(`${apiUrl}?api_key=${apiKey}`);
    ws.on("open", () => updateStatusBar("connected"));
    ws.on("message", (data) => {
      try { handleEvent(JSON.parse(data.toString()) as StreamEvent); } catch { /* ignore */ }
    });
    ws.on("close", () => { ws = null; updateStatusBar("disconnected"); setTimeout(connect, 5000); });
    ws.on("error", () => { ws = null; updateStatusBar("error"); });
  } catch { updateStatusBar("error"); }
}

function disconnect(): void { if (ws) { ws.close(); ws = null; } }

function handleEvent(event: StreamEvent): void {
  if (event.type === "token_update") handleTokenUpdate(event);
  else if (event.type === "prune_suggestion") handlePruneSuggestion(event);
  else if (event.type === "burn_alert") handleBurnAlert(event);
  else if (event.type === "compaction_event") handleCompaction(event);
}

function handleTokenUpdate(e: TokenUpdateEvent): void {
  if (currentSessionId !== e.session_id) { currentSessionId = e.session_id; hasUnreadAlerts = false; }
  sessionCost = e.cumulative_session_cost_usd;
  sessionTokens = e.cumulative_session_tokens;
  roiScore = e.roi_score;
  updateStatusBar("active");
}

function handlePruneSuggestion(e: PruneSuggestionEvent): void {
  if (e.confidence < 0.75) return;
  const msg = `Prune: Sending ${(e.total_tokens/1000).toFixed(1)}K tokens. Only ~${(e.relevant_tokens/1000).toFixed(1)}K relevant. ${e.irrelevant_summary}. Save $${e.estimated_savings_usd.toFixed(2)}`;
  let dismissed = false;
  setTimeout(() => { dismissed = true; }, (e.auto_dismiss_seconds || 8) * 1000);
  vscode.window.showInformationMessage(msg, "Trim & Send", "Send Full", "Always trim").then((sel) => {
    if (!dismissed && sel === "Always trim") vscode.window.showInformationMessage("Saved. Future similar requests will auto-trim.");
  });
}

function handleBurnAlert(e: BurnAlertEvent): void {
  const key = `${e.session_id}:${e.pattern}`;
  if (alertCooldowns.has(key) && Date.now() - alertCooldowns.get(key)! < 300000) return;
  hasUnreadAlerts = true; updateStatusBar("active");
  const btns = [...e.suggestions.filter(s => s.action !== "dismiss").map(s => s.label).slice(0, 2), "Dismiss"];
  const show = e.severity === "warning" ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
  show(`Prune: ${e.message_title}\n${e.message_body}`, ...btns).then((sel) => {
    alertCooldowns.set(key, Date.now()); hasUnreadAlerts = false; updateStatusBar("active");
    if (!sel || sel === "Dismiss") return;
    const action = e.suggestions.find(s => s.label === sel);
    if (action?.detail) vscode.window.showInformationMessage(action.detail);
    if (action?.action === "view_details") vscode.env.openExternal(vscode.Uri.parse(`https://delimit.dev/dashboard/session/${e.session_id}`));
  });
}

function handleCompaction(e: CompactionEvent): void {
  const lost = e.lost_references.slice(0, 5).map(r => `• ${r.item} (turn ${r.original_turn})`).join("\n");
  vscode.window.showInformationMessage(
    `Prune: Context compacted (${(e.tokens_before/1000).toFixed(0)}K → ${(e.tokens_after/1000).toFixed(0)}K).\nLost:\n${lost}`,
    "Copy lost items", "View diff", "Dismiss"
  ).then((sel) => {
    if (sel === "Copy lost items") {
      vscode.env.clipboard.writeText(e.lost_references.map(r => `• ${r.item} (turn ${r.original_turn})`).join("\n"));
      vscode.window.showInformationMessage("Copied to clipboard");
    } else if (sel === "View diff") {
      vscode.env.openExternal(vscode.Uri.parse(`https://delimit.dev/dashboard/session/${e.session_id}#compaction-${e.turn_number}`));
    }
  });
}

function updateStatusBar(state: "idle" | "connected" | "disconnected" | "error" | "active"): void {
  const { thresholdAmber, thresholdRed } = getConfig();
  if (state === "idle" || state === "disconnected") {
    statusBarItem.text = "Prune: idle"; statusBarItem.backgroundColor = undefined; statusBarItem.tooltip = "Click to connect"; return;
  }
  if (state === "error") {
    statusBarItem.text = "Prune: error"; statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground"); return;
  }
  if (state === "connected") {
    statusBarItem.text = "Prune: connected"; statusBarItem.backgroundColor = undefined; statusBarItem.tooltip = "Waiting for AI activity"; return;
  }
  const cost = sessionCost.toFixed(2);
  const tokens = sessionTokens >= 1000 ? `${(sessionTokens/1000).toFixed(0)}K` : `${sessionTokens}`;
  const alert = hasUnreadAlerts ? " \u26A0" : "";
  let emoji = "\uD83D\uDFE2", bg: vscode.ThemeColor | undefined;
  if (sessionCost >= thresholdRed) { emoji = "\uD83D\uDD34"; bg = new vscode.ThemeColor("statusBarItem.errorBackground"); }
  else if (sessionCost >= thresholdAmber) { emoji = "\uD83D\uDFE1"; bg = new vscode.ThemeColor("statusBarItem.warningBackground"); }
  statusBarItem.text = `${emoji} $${cost} \u00B7 ${tokens} tokens${alert}`;
  statusBarItem.backgroundColor = bg;
  statusBarItem.tooltip = `Session: $${cost}\nTokens: ${sessionTokens.toLocaleString()}\nROI: ${roiScore !== null ? `${Math.round(roiScore * 100)}%` : "N/A"}`;
}

async function showQuickPick(): Promise<void> {
  const items: vscode.QuickPickItem[] = [
    { label: `Session Cost: $${sessionCost.toFixed(2)}`, description: `${sessionTokens.toLocaleString()} tokens` },
    { label: `ROI: ${roiScore !== null ? `${Math.round(roiScore * 100)}%` : "N/A"}`, description: roiScore !== null && roiScore < 0.5 ? "Low productivity" : "" },
    { label: "", kind: vscode.QuickPickItemKind.Separator },
    { label: "$(link-external) Open in Dashboard", description: "View session details" },
  ];
  const sel = await vscode.window.showQuickPick(items, { placeHolder: "Prune - AI Token Intelligence" });
  if (sel?.label.includes("Dashboard") && currentSessionId) {
    vscode.env.openExternal(vscode.Uri.parse(`https://delimit.dev/dashboard/session/${currentSessionId}`));
  }
}
