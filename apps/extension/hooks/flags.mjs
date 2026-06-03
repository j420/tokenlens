#!/usr/bin/env node
/**
 * Prune feature-flag promotion CLI.
 *
 * Reads / mutates ~/.prune/feature-flags.json — the same file every hook reads
 * to decide whether a TCRP feature (f1..f13) is live. Lets an operator promote a
 * feature out of shadow (enable it in `general` or `canary`) or take it back
 * down, without hand-editing JSON and risking a malformed flag blob.
 *
 * Subcommands:
 *   list                       Print every feature's id, name, enabled, mode.
 *   enable  <id|name> <mode>   Set enabled=true, mode=<general|canary>.
 *   disable <id|name>          Set enabled=false, mode="disabled".
 *
 * <id|name> accepts either the id ("f10") or the canonical name ("mcpProxy");
 * an unknown identifier is REFUSED with a non-zero exit and the valid set.
 * Mutations go through @prune/shared's `withFeatureMutation` (the single pure
 * transform the watcher/readers agree on) and validate-on-read via
 * `validateFlags`, so a pre-existing malformed file is repaired to defaults
 * rather than propagated. The write is atomic (tmp + rename), mirroring
 * context-health-advisor.mjs, so a concurrent reader never sees a torn file.
 *
 * This is an operator tool, not a hook: it prints human output and uses real
 * exit codes (0 ok, 1 usage/validation error). It never calls a model.
 */

import { homedir } from "node:os";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

import {
  TCRP_FEATURE_IDS,
  TCRP_FEATURE_NAMES,
  resolveFeatureId,
  validateFlags,
  withFeatureMutation,
} from "@prune/shared";

export const DEFAULT_FLAG_PATH = join(homedir(), ".prune", "feature-flags.json");

/** The two modes a feature may be promoted INTO via `enable`. */
const ENABLE_MODES = new Set(["general", "canary"]);

export function flagPath(env = process.env) {
  return env.PRUNE_FLAGS_PATH || DEFAULT_FLAG_PATH;
}

/** Read + validate the flag file. A missing/malformed file ⇒ validated defaults. */
export function readFlags(path) {
  try {
    return validateFlags(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return validateFlags(null);
  }
}

/** Atomic tmp+rename write — a concurrent reader never sees a torn file. */
export function writeFlags(path, flags) {
  mkdirSync(dirname(path), { recursive: true });
  const json = JSON.stringify(flags, null, 2);
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, json, "utf8");
  renameSync(tmp, path);
}

/**
 * Pure parse of argv (minus node + script). Returns either a typed command or
 * an `{ error }`. Never throws, never touches disk.
 */
export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    return { kind: "help" };
  }
  if (cmd === "list") {
    if (rest.length > 0) return { error: `list takes no arguments` };
    return { kind: "list" };
  }
  if (cmd === "enable") {
    const [idOrName, mode] = rest;
    if (!idOrName || !mode) {
      return { error: `usage: enable <id|name> <general|canary>` };
    }
    if (!ENABLE_MODES.has(mode)) {
      return {
        error: `invalid mode "${mode}"; enable accepts: ${[...ENABLE_MODES].join(", ")}`,
      };
    }
    const id = resolveFeatureId(idOrName);
    if (!id) return { error: unknownIdMsg(idOrName) };
    return { kind: "enable", id, mode };
  }
  if (cmd === "disable") {
    const [idOrName] = rest;
    if (!idOrName) return { error: `usage: disable <id|name>` };
    if (rest.length > 1) return { error: `disable takes exactly one argument` };
    const id = resolveFeatureId(idOrName);
    if (!id) return { error: unknownIdMsg(idOrName) };
    return { kind: "disable", id };
  }
  return { error: `unknown subcommand "${cmd}". Try: list | enable | disable` };
}

function unknownIdMsg(idOrName) {
  const valid = TCRP_FEATURE_IDS.map((id) => `${id} (${TCRP_FEATURE_NAMES[id]})`).join(", ");
  return `unknown feature "${idOrName}". Valid: ${valid}`;
}

/**
 * Pure: derive the mutated flag blob for a parsed command. Returns the new
 * flags. `enable` sets enabled=true + mode; `disable` sets enabled=false +
 * mode="disabled". policySource becomes "local" (operator override).
 */
export function applyCommand(flags, command) {
  if (command.kind === "enable") {
    return withFeatureMutation(flags, command.id, { enabled: true, mode: command.mode });
  }
  if (command.kind === "disable") {
    return withFeatureMutation(flags, command.id, { enabled: false, mode: "disabled" });
  }
  return flags;
}

/** Render the `list` view as plain lines. Pure. */
export function formatList(flags) {
  const lines = TCRP_FEATURE_IDS.map((id) => {
    const s = flags.features[id];
    const live = s.enabled && (s.mode === "general" || s.mode === "canary");
    return [
      id.padEnd(4),
      TCRP_FEATURE_NAMES[id].padEnd(20),
      `enabled=${String(s.enabled).padEnd(5)}`,
      `mode=${s.mode.padEnd(8)}`,
      live ? "LIVE" : "",
    ]
      .join("  ")
      .trimEnd();
  });
  return lines.join("\n");
}

const HELP = `prune flags — promote/demote TCRP feature flags (${"~/.prune/feature-flags.json"})

  list                       Show every feature's id, name, enabled, mode.
  enable  <id|name> <mode>   Enable a feature; mode is "general" or "canary".
  disable <id|name>          Disable a feature (enabled=false, mode="disabled").

  <id|name> accepts an id (f10) or a name (mcpProxy).
  Override the file with PRUNE_FLAGS_PATH.`;

/**
 * Run the CLI. Returns an exit code. Injectable env/out/err for tests; defaults
 * to the real process streams.
 */
export function run(
  argv,
  { env = process.env, out = (s) => process.stdout.write(s), err = (s) => process.stderr.write(s) } = {}
) {
  const command = parseArgs(argv);

  if ("error" in command) {
    err(`${command.error}\n`);
    return 1;
  }
  if (command.kind === "help") {
    out(`${HELP}\n`);
    return 0;
  }

  const path = flagPath(env);
  const flags = readFlags(path);

  if (command.kind === "list") {
    out(`${formatList(flags)}\n`);
    return 0;
  }

  const next = applyCommand(flags, command);
  try {
    writeFlags(path, next);
  } catch (e) {
    err(`failed to write ${path}: ${e?.message ?? e}\n`);
    return 1;
  }
  const s = next.features[command.id];
  out(
    `${command.id} (${TCRP_FEATURE_NAMES[command.id]}) → enabled=${s.enabled} mode=${s.mode}\n`
  );
  return 0;
}

// CLI entry — only when invoked directly, so the module stays importable in tests.
const invokedDirectly =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  process.exit(run(process.argv.slice(2)));
}
