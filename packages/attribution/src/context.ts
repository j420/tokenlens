/**
 * Auto-detect attribution dimensions from git + environment.
 *
 * Hard rule (CLAUDE.md): no opaque ML; every dimension's source is
 * transparent. We document where each value comes from so a platform
 * engineer can override at any layer.
 *
 * Precedence (highest wins):
 *   1. Explicit `override` argument
 *   2. PRUNE_ATTRIBUTION_* environment variables
 *   3. CI env (GITHUB_ACTOR, GITHUB_HEAD_REF, GITHUB_SHA, etc.)
 *   4. Git CLI output (user.email, current branch, HEAD)
 *   5. Process env ($USER) or null
 */

import { execFileSync } from "node:child_process";

import type { AttributionDimensions } from "./dimensions.js";

export interface DetectOptions {
  /** Working dir for git probes. Default process.cwd(). */
  cwd?: string;
  /** Hardcoded overrides — win over everything. */
  override?: AttributionDimensions;
  /** Skip git probes (e.g. for unit tests that don't want shelling out). */
  skipGit?: boolean;
}

function runGit(cwd: string, args: string[]): string | null {
  try {
    const out = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

function intOrUndef(s: string | null | undefined): number | undefined {
  if (!s) return undefined;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Heuristic: branch names like `pr/123`, `feature/PR-456`, `123-foo`
 * carry the PR number in the name. Extract conservatively — null when
 * unsure.
 */
function prFromBranchName(branch: string | null | undefined): number | undefined {
  if (!branch) return undefined;
  const m =
    branch.match(/(?:^|[/_-])pr[/_-]?(\d+)\b/i) ||
    branch.match(/(?:^|[/_-])(\d{2,6})(?:[/_-]|$)/);
  return m ? intOrUndef(m[1]) : undefined;
}

export function detectDimensions(opts: DetectOptions = {}): AttributionDimensions {
  const cwd = opts.cwd ?? process.cwd();
  const e = process.env;
  const override = opts.override ?? {};

  let developer =
    override.developer ??
    e.PRUNE_ATTRIBUTION_DEVELOPER ??
    e.GITHUB_ACTOR ??
    e.GITLAB_USER_LOGIN ??
    undefined;
  if (!developer && !opts.skipGit) {
    developer = runGit(cwd, ["config", "user.email"]) ?? undefined;
  }
  if (!developer) developer = e.USER || e.USERNAME || undefined;

  let project =
    override.project ??
    e.PRUNE_ATTRIBUTION_PROJECT ??
    e.GITHUB_REPOSITORY ??
    e.CI_PROJECT_PATH ??
    undefined;
  if (!project && !opts.skipGit) {
    // Use the top-level directory name of the git repo.
    const top = runGit(cwd, ["rev-parse", "--show-toplevel"]);
    if (top) project = top.split("/").pop() ?? undefined;
  }

  let branch =
    override.branch ??
    e.PRUNE_ATTRIBUTION_BRANCH ??
    e.GITHUB_HEAD_REF ??
    e.CI_COMMIT_REF_NAME ??
    undefined;
  if (!branch && !opts.skipGit) {
    branch = runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]) ?? undefined;
  }

  let prNumber =
    override.prNumber ??
    intOrUndef(e.PRUNE_ATTRIBUTION_PR) ??
    intOrUndef(e.GITHUB_PR_NUMBER) ??
    intOrUndef(e.CI_MERGE_REQUEST_IID) ??
    undefined;
  if (prNumber === undefined) {
    // Try GITHUB_REF — looks like refs/pull/123/merge.
    const ref = e.GITHUB_REF;
    if (ref) {
      const m = ref.match(/^refs\/pull\/(\d+)\//);
      if (m) prNumber = intOrUndef(m[1]);
    }
  }
  if (prNumber === undefined) prNumber = prFromBranchName(branch);

  let commitSha =
    override.commitSha ??
    e.PRUNE_ATTRIBUTION_COMMIT ??
    e.GITHUB_SHA ??
    e.CI_COMMIT_SHA ??
    undefined;
  if (!commitSha && !opts.skipGit) {
    commitSha = runGit(cwd, ["rev-parse", "HEAD"]) ?? undefined;
  }

  const extra = { ...(override.extra ?? {}) };
  // Pick up team / cost-center from env, if set.
  if (e.PRUNE_ATTRIBUTION_TEAM) extra.team = e.PRUNE_ATTRIBUTION_TEAM;
  if (e.PRUNE_ATTRIBUTION_COST_CENTER)
    extra.cost_center = e.PRUNE_ATTRIBUTION_COST_CENTER;

  return {
    developer,
    project,
    branch,
    prNumber,
    commitSha,
    extra: Object.keys(extra).length > 0 ? extra : undefined,
  };
}
