/**
 * Per-arm environment setup (pure planner).
 *
 * The naive arm gets a hermetic env with NO TokenLens state. The governed arm
 * gets the same hermetic env plus:
 *  - a feature-flags file promoting the benchmark's governance hooks to
 *    `general` (read-gate f16, observation-mask f15) for this workspace only;
 *  - PRUNE_* state paths inside the trial's private state dir, mirroring the
 *    e2e-harness `makeHookEnv` hermetic pattern (HOME points at the state dir
 *    so hooks that hardcode `~/.prune/...` also resolve inside it);
 *  - the project-scoped `.claude/settings.json` hook wiring, produced by the
 *    canonical installer (`apps/extension/hooks/install.mjs#computeHooksInstall`)
 *    which the Phase-2 executor imports dynamically — this module only plans
 *    paths and file contents that are knowable without side effects.
 *
 * The ONLY difference between arms is this setup; everything else (model,
 * caps, prompt, workspace) is identical by construction.
 */

import { join } from "node:path";
import type { ArmId } from "./types.js";

export interface ArmPlan {
  arm: ArmId;
  /** Env vars for the agent process (merged over process.env). */
  env: Record<string, string>;
  /** Files to write before the agent starts: absolute path → content. */
  files: Record<string, string>;
  /**
   * Governed arm only: the settings file the hook installer must populate
   * (via computeHooksInstall) before the agent starts. null for naive.
   */
  settingsPath: string | null;
}

/** Hooks promoted to `general` in the governed arm (flag ids, case-sensitive). */
export const GOVERNED_FLAGS: Record<string, "general"> = {
  f15: "general", // observation-mask
  f16: "general", // read-gate
};

export function planArmSetup(opts: {
  arm: ArmId;
  worktreeDir: string;
  /** Private per-trial state dir (fresh tmp dir; caller owns lifecycle). */
  stateDir: string;
}): ArmPlan {
  const { arm, worktreeDir, stateDir } = opts;
  const flagsPath = join(stateDir, ".prune", "feature-flags.json");
  const env: Record<string, string> = {
    HOME: stateDir,
    USERPROFILE: stateDir,
    PRUNE_FLAGS_PATH: flagsPath,
    PRUNE_EVENTS_SQLITE: join(stateDir, "events.sqlite"),
    PRUNE_BUDGET_SQLITE: join(stateDir, "budget.sqlite"),
    PRUNE_VAULT_SQLITE: join(stateDir, "vault.sqlite"),
    PRUNE_SKILLS_PATH: join(stateDir, "skills.json"),
  };

  if (arm === "naive") {
    // Hermetic but empty: no flags file, no settings, no hooks.
    return { arm, env, files: {}, settingsPath: null };
  }

  const features: Record<string, { enabled: boolean; mode: string }> = {};
  for (const [id, mode] of Object.entries(GOVERNED_FLAGS)) {
    features[id] = { enabled: true, mode };
  }
  return {
    arm,
    env,
    files: {
      [flagsPath]: JSON.stringify(
        { version: 1, features, policySource: "local" },
        null,
        2
      ),
    },
    settingsPath: join(worktreeDir, ".claude", "settings.json"),
  };
}
