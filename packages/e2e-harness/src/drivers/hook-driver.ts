/**
 * Drives the real Claude Code hook scripts exactly as the runtime does: spawn
 * `node apps/extension/hooks/<hook>.mjs`, write a JSON payload on stdin, and
 * capture stdout / stderr / exit code. No mocking — these are the shipped hook
 * processes. State (`~/.prune/*`, sqlite, flags) is redirected into a throwaway
 * dir via env so a run never touches the developer's real home.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOKS_DIR = fileURLToPath(
  new URL("../../../../apps/extension/hooks/", import.meta.url)
);

export interface HookResult {
  hook: string;
  /** 0 = pass, 2 = block (Claude Code convention). */
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Parsed stdout JSON when the hook emitted any; null for a clean no-op. */
  parsed: Record<string, unknown> | null;
}

/** Spawn one hook with a payload on stdin. Never rejects — failures are results. */
export function runHook(
  hookFile: string,
  payload: unknown,
  env: Record<string, string> = {}
): Promise<HookResult> {
  const script = join(HOOKS_DIR, hookFile);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", () =>
      resolve({ hook: hookFile, exitCode: -1, stdout, stderr, parsed: null })
    );
    child.on("close", (code) => {
      let parsed: Record<string, unknown> | null = null;
      const trimmed = stdout.trim();
      if (trimmed) {
        try {
          const v = JSON.parse(trimmed);
          if (v && typeof v === "object") parsed = v as Record<string, unknown>;
        } catch {
          /* non-JSON stdout stays unparsed */
        }
      }
      resolve({ hook: hookFile, exitCode: code ?? 0, stdout, stderr, parsed });
    });
    const body = typeof payload === "string" ? payload : JSON.stringify(payload);
    child.stdin.write(body);
    child.stdin.end();
  });
}

/** True when a hook signalled a block: exit 2 and a `{decision:"block"}` body. */
export function isBlock(r: HookResult): boolean {
  return r.exitCode === 2 && r.parsed?.decision === "block";
}

/** True when a hook injected additional context (exit 0 with hookSpecificOutput). */
export function additionalContextOf(r: HookResult): string | null {
  const hso = r.parsed?.hookSpecificOutput as
    | { additionalContext?: unknown }
    | undefined;
  return typeof hso?.additionalContext === "string" ? hso.additionalContext : null;
}

export interface HookEnv {
  stateDir: string;
  env: Record<string, string>;
  cleanup(): void;
}

/**
 * A hermetic env for hook child processes: every PRUNE_* state path points into
 * a fresh tmp dir, and (optionally) a feature-flags file is written so f-gated
 * hooks can be exercised in `shadow` vs `general`.
 */
export function makeHookEnv(opts: {
  /** Per-feature flag overrides, e.g. { f1: "general" }. */
  flags?: Record<string, "shadow" | "canary" | "general" | "disabled">;
  /** Extra env vars (disable switches, TTLs, etc.). */
  extra?: Record<string, string>;
} = {}): HookEnv {
  const stateDir = mkdtempSync(join(tmpdir(), "prune-e2e-hookstate-"));
  // Some hooks honor PRUNE_FLAGS_PATH (via flags.mjs); others hardcode
  // `homedir()/.prune/feature-flags.json` (e.g. cache-habits-advisor.mjs:51).
  // With HOME=stateDir, writing the flags file at stateDir/.prune/feature-flags.json
  // satisfies BOTH resolution paths, and we also point PRUNE_FLAGS_PATH at it.
  mkdirSync(join(stateDir, ".prune"), { recursive: true });
  const flagsPath = join(stateDir, ".prune", "feature-flags.json");

  if (opts.flags) {
    const features: Record<string, { enabled: boolean; mode: string }> = {};
    for (const [id, mode] of Object.entries(opts.flags)) {
      features[id] = { enabled: mode === "general" || mode === "canary", mode };
    }
    writeFileSync(
      flagsPath,
      JSON.stringify({ version: 1, features, policySource: "local" })
    );
  }

  const env: Record<string, string> = {
    HOME: stateDir,
    USERPROFILE: stateDir,
    PRUNE_FLAGS_PATH: flagsPath,
    PRUNE_EVENTS_SQLITE: join(stateDir, "events.sqlite"),
    PRUNE_BUDGET_SQLITE: join(stateDir, "budget.sqlite"),
    PRUNE_VAULT_SQLITE: join(stateDir, "vault.sqlite"),
    PRUNE_SKILLS_PATH: join(stateDir, "skills.json"),
    ...opts.extra,
  };

  return {
    stateDir,
    env,
    cleanup() {
      try {
        rmSync(stateDir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    },
  };
}
