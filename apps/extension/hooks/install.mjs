#!/usr/bin/env node
/**
 * Prune hook installer (pending action 1.6).
 *
 * The Prune hooks (23 distinct scripts, 25 event bindings — loop-breaker and
 * replay-recorder each fire on two events) were wired by hand into
 * ~/.claude/settings.json. This automates that: it merges the canonical
 * hook→event(+matcher) mapping (HOOK_REGISTRY below) into a
 * Claude Code settings.json, idempotently (re-running adds nothing) and
 * non-destructively (existing settings and unrelated hooks are preserved). The
 * planner is a PURE function (computeHooksInstall) so it is fully unit-tested;
 * the CLI is the thin I/O wrapper.
 *
 * Usage:
 *   node install.mjs                 # install into ~/.claude/settings.json (user scope)
 *   node install.mjs --project       # install into ./.claude/settings.json (project scope)
 *   node install.mjs --dry-run       # print the plan + resulting hooks, write nothing
 *   node install.mjs --settings PATH # target an explicit settings.json
 *   node install.mjs --hooks-dir DIR # point the commands at a specific hooks dir
 *
 * Exit codes: 0 ok, 1 usage/IO error. Never partially writes (tmp + rename).
 */

import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
} from "node:fs";

const SELF_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Canonical hook → Claude Code event mapping. Single source of truth, ordered.
 * Order matters within an event: budget-gate must run BEFORE slo-breaker so the
 * latest turn's charge is recorded before the SLO is evaluated (README). A hook
 * with two events appears twice. `matcher` is a tool-name pattern for
 * PreToolUse/PostToolUse; omitted means match-all ("any matcher").
 */
export const HOOK_REGISTRY = [
  // UserPromptSubmit — pre-prompt advisories / scanners.
  { file: "sentinel-prompt.mjs", event: "UserPromptSubmit" },
  { file: "cache-stabilize.mjs", event: "UserPromptSubmit" },
  { file: "skill-advisor.mjs", event: "UserPromptSubmit" },
  { file: "cache-habits-advisor.mjs", event: "UserPromptSubmit" },
  { file: "context-health-advisor.mjs", event: "UserPromptSubmit" },
  { file: "preturn-forecast.mjs", event: "UserPromptSubmit" },
  // PreToolUse — pre-action guards.
  { file: "subagent-warden.mjs", event: "PreToolUse", matcher: "Task" },
  { file: "fanout-acceleration.mjs", event: "PreToolUse", matcher: "Task" },
  { file: "edit-amplification.mjs", event: "PreToolUse", matcher: "Write" },
  { file: "reward-integrity.mjs", event: "PreToolUse", matcher: "Write|Edit|MultiEdit" },
  { file: "trajectory-diet.mjs", event: "PreToolUse" },
  { file: "speculative-prune.mjs", event: "PreToolUse" },
  // PostToolUse — post-action recorders / shields.
  { file: "speculative-record.mjs", event: "PostToolUse", matcher: "Read" },
  { file: "sentinel-mcp.mjs", event: "PostToolUse" },
  { file: "cost-guard.mjs", event: "PostToolUse" },
  { file: "thrash-detector.mjs", event: "PostToolUse" },
  { file: "injection-cost.mjs", event: "PostToolUse" },
  { file: "loop-breaker.mjs", event: "PostToolUse" },
  { file: "replay-recorder.mjs", event: "PostToolUse" },
  // Stop — end-of-turn. budget-gate BEFORE slo-breaker (charge then evaluate).
  { file: "budget-gate.mjs", event: "Stop" },
  { file: "slo-breaker.mjs", event: "Stop" },
  { file: "loop-breaker.mjs", event: "Stop" },
  { file: "skill-capture.mjs", event: "Stop" },
  { file: "replay-recorder.mjs", event: "Stop" },
  { file: "telemetry-forward.mjs", event: "Stop" },
  // PostCompact — compaction recovery.
  { file: "compaction-recover.mjs", event: "PostCompact" },
];

/** Build the `node <abs path>` command string for a hook file. */
export function hookCommand(hooksDir, file) {
  return `node ${join(hooksDir, file)}`;
}

/**
 * Does this event's existing entry list already carry this exact command?
 * Defensive against hand-edited / unexpected shapes — never throws.
 */
function commandPresent(entries, command) {
  if (!Array.isArray(entries)) return false;
  for (const entry of entries) {
    const hooks = entry && typeof entry === "object" ? entry.hooks : null;
    if (!Array.isArray(hooks)) continue;
    for (const h of hooks) {
      if (h && typeof h === "object" && h.command === command) return true;
    }
  }
  return false;
}

/**
 * PURE planner. Given the existing settings object and a hooks directory,
 * returns { settings, added, skipped } where `settings` is a NEW object with the
 * missing Prune hook entries appended. Idempotent: a command already present
 * (by exact string) is skipped. Non-destructive: unrelated settings and any
 * pre-existing hook entries are preserved in place. Never mutates the input.
 */
export function computeHooksInstall(existingSettings, options = {}) {
  const hooksDir = options.hooksDir || SELF_DIR;
  // Deep-ish clone of the parts we touch; structuredClone keeps it simple and
  // total (settings is JSON, so it's always cloneable).
  const base =
    existingSettings && typeof existingSettings === "object" && !Array.isArray(existingSettings)
      ? structuredClone(existingSettings)
      : {};
  if (!base.hooks || typeof base.hooks !== "object" || Array.isArray(base.hooks)) {
    base.hooks = {};
  }

  const added = [];
  const skipped = [];

  for (const reg of HOOK_REGISTRY) {
    const command = hookCommand(hooksDir, reg.file);
    const event = reg.event;
    if (!Array.isArray(base.hooks[event])) base.hooks[event] = [];

    if (commandPresent(base.hooks[event], command)) {
      skipped.push({ file: reg.file, event, matcher: reg.matcher ?? null });
      continue;
    }

    const entry = { hooks: [{ type: "command", command }] };
    if (reg.matcher) entry.matcher = reg.matcher;
    base.hooks[event].push(entry);
    added.push({ file: reg.file, event, matcher: reg.matcher ?? null });
  }

  return { settings: base, added, skipped };
}

// ---------------------------------------------------------------------------
// CLI (thin I/O wrapper over the pure planner).
// ---------------------------------------------------------------------------

function defaultSettingsPath(scope) {
  return scope === "project"
    ? join(process.cwd(), ".claude", "settings.json")
    : join(homedir(), ".claude", "settings.json");
}

function readSettings(path) {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    throw new Error(`settings file ${path} is not valid JSON: ${e.message}`);
  }
}

function writeSettingsAtomic(path, settings) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  try {
    writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n");
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      /* tmp may not exist */
    }
    throw err;
  }
}

function parseArgs(argv) {
  const opts = { scope: "user", dryRun: false, settings: null, hooksDir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--project") opts.scope = "project";
    else if (a === "--user") opts.scope = "user";
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--settings") opts.settings = argv[++i];
    else if (a === "--hooks-dir") opts.hooksDir = argv[++i];
    else if (a === "--help" || a === "-h") opts.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return opts;
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`prune-install: ${e.message}\n`);
    process.exit(1);
  }
  if (opts.help) {
    process.stdout.write(
      "Usage: node install.mjs [--user|--project] [--dry-run] " +
        "[--settings PATH] [--hooks-dir DIR]\n"
    );
    process.exit(0);
  }

  const settingsPath = resolve(opts.settings || defaultSettingsPath(opts.scope));
  const hooksDir = resolve(opts.hooksDir || SELF_DIR);

  let existing;
  try {
    existing = readSettings(settingsPath);
  } catch (e) {
    process.stderr.write(`prune-install: ${e.message}\n`);
    process.exit(1);
  }

  const plan = computeHooksInstall(existing, { hooksDir });

  const summarize = (list) =>
    list.map((x) => `${x.event}${x.matcher ? `[${x.matcher}]` : ""}:${x.file}`).join(", ");

  if (opts.dryRun) {
    process.stdout.write(
      `prune-install (dry run) → ${settingsPath}\n` +
        `  would add (${plan.added.length}): ${summarize(plan.added) || "—"}\n` +
        `  already present (${plan.skipped.length}): ${summarize(plan.skipped) || "—"}\n` +
        `  resulting hooks:\n${JSON.stringify(plan.settings.hooks, null, 2)}\n`
    );
    process.exit(0);
  }

  if (plan.added.length === 0) {
    process.stdout.write(
      `prune-install: all ${plan.skipped.length} hooks already installed in ${settingsPath}; nothing to do.\n`
    );
    process.exit(0);
  }

  try {
    writeSettingsAtomic(settingsPath, plan.settings);
  } catch (e) {
    process.stderr.write(`prune-install: failed to write ${settingsPath}: ${e.message}\n`);
    process.exit(1);
  }

  process.stdout.write(
    `prune-install: added ${plan.added.length} hook(s) to ${settingsPath} ` +
      `(${plan.skipped.length} already present).\n  ${summarize(plan.added)}\n`
  );
  process.exit(0);
}

// Only run the CLI when invoked directly (not when imported by a test).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
