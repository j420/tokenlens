// ============================================================================
// Execution-mode model — the consolidation of every Prune lever by HOW it runs.
// ============================================================================
// Mental model (the flow): the agent (Claude Code / Cursor / Codex) is the INPUT
// taker; Prune sits in the middle and TRANSFORMS what the agent reads, sends, and
// spends; the OUTPUT is the same result for fewer tokens. Every lever attaches at
// exactly one of four execution modes below. This unifies the editor commands and
// the TCRP backend catalog into one mode-grouped surface.

import { TCRP_FEATURES } from "./tcrp-catalog";

export interface ModeItem {
  /** present for editor commands (used to build the IDE deep-link) */
  commandId?: string;
  name: string;
  desc: string;
  /** concrete handle: command id, MCP tool name, hook file, or package */
  ref: string;
  keybinding?: { windows: string; mac: string };
}

export interface ExecMode {
  id: "command" | "hook" | "mcp" | "library";
  label: string;
  /** short tag shown by the label */
  tag: string;
  /** the transform this mode performs in the flow */
  transform: string;
  /** when it fires / how you reach it */
  when: string;
  items: ModeItem[];
}

// Editor commands (developer-driven). ids map to getIDEUri().
const COMMANDS: ModeItem[] = [
  { commandId: "smartCopy", name: "Smart Copy", desc: "Copy files as signatures, not full code — 70–90% smaller.", ref: "prune.smartCopy", keybinding: { windows: "Ctrl+Alt+C", mac: "Cmd+Alt+C" } },
  { commandId: "preflight", name: "Pre-flight Optimizer", desc: "See spend vs. optimized spend before you send.", ref: "prune.preflight", keybinding: { windows: "Ctrl+Alt+P", mac: "Cmd+Alt+P" } },
  { commandId: "smartContext", name: "Intelligent Context", desc: "Symbol-level dependency walk picks the right code.", ref: "prune.smartContext" },
  { commandId: "compactionCheck", name: "Compaction Recovery", desc: "Surface decisions at risk when context compacts.", ref: "prune.compactionCheck" },
  { commandId: "analyzeContext", name: "Context Analysis", desc: "Score workspace files by relevance to the task.", ref: "prune.analyzeContext", keybinding: { windows: "Ctrl+Alt+A", mac: "Cmd+Alt+A" } },
  { commandId: "sessionStats", name: "Session Memory", desc: "Track files in context; never re-read the same file.", ref: "prune.sessionStats" },
  { commandId: "squeezeFile", name: "Code Squeezer", desc: "Tree-sitter compression — lossless to telegraphic.", ref: "prune.squeezeFile" },
  { commandId: "analyzeFile", name: "Token Counter", desc: "Real-time token + cost for any file or selection.", ref: "prune.analyzeFile", keybinding: { windows: "Ctrl+Alt+T", mac: "Cmd+Alt+T" } },
  { commandId: "checkCursorUsage", name: "Usage Tracking", desc: "Read the local DB for request usage. Zero keys.", ref: "prune.checkCursorUsage" },
  { commandId: "repoProof", name: "Repo Proof (f20)", desc: "Terminal launcher for the prune-proof lifecycle: map \u00b7 mine \u00b7 verify \u00b7 prove \u00b7 promote.", ref: "prune.repoProof" },
];

const fromCatalog = (surface: "Hook" | "MCP tool" | "Library"): ModeItem[] =>
  TCRP_FEATURES.filter((f) => f.surface === surface).map((f) => ({
    name: f.name,
    desc: f.description,
    ref: f.ref,
  }));

export const EXEC_MODES: ExecMode[] = [
  {
    id: "command",
    label: "Extension command",
    tag: "you run it",
    transform: "Transforms the input you hand the agent",
    when: "In your editor, on demand — Cursor · Claude Code · Codex.",
    items: COMMANDS,
  },
  {
    id: "hook",
    label: "Hook",
    tag: "autonomous",
    transform: "Transforms the agent's actions as they happen",
    when: "Fires on the agent's lifecycle events — ships shadow, graduates to enforce.",
    items: fromCatalog("Hook"),
  },
  {
    id: "mcp",
    label: "MCP tool",
    tag: "self-regulation",
    transform: "The agent transforms its own spend",
    when: "Tools the agent calls on itself to stay inside budget.",
    items: fromCatalog("MCP tool"),
  },
  {
    id: "library",
    label: "Library",
    tag: "programmatic",
    transform: "Transforms the request before it's sent",
    when: "Composable levers used in the control plane and at request assembly.",
    items: fromCatalog("Library"),
  },
];

export const MODE_TOTAL = EXEC_MODES.reduce((n, m) => n + m.items.length, 0);
