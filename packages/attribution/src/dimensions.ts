/**
 * Attribution dimensions — the (developer, project, branch, PR, commit)
 * tuple TokenLens stamps onto each charge so spend rolls up cleanly in
 * the per-dev / per-PR / per-project dashboard.
 *
 * Anthropic Enterprise Analytics (Finout 2026 writeup) ships per-user
 * attribution but is Claude-only and Enterprise-plan-only. The schema
 * here is provider-agnostic so the rollup runs across every coding
 * agent on every plan.
 */

export interface AttributionDimensions {
  /** Human-readable developer id (email or login). */
  developer?: string;
  /** Project / repository name. */
  project?: string;
  /** Git branch. */
  branch?: string;
  /** GitHub / GitLab PR or MR number. */
  prNumber?: number;
  /** Full commit SHA. */
  commitSha?: string;
  /** Free-form additional dimensions (team, cost-center, etc.). */
  extra?: Record<string, string>;
}

/**
 * Encode a dimensions object into the metadata-bag shape stored on
 * BudgetCharge.metadata. Stays a flat JSON object so downstream tools
 * that don't import this package still see the keys.
 */
export function encodeDimensions(d: AttributionDimensions): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (d.developer) out["attribution.developer"] = d.developer;
  if (d.project) out["attribution.project"] = d.project;
  if (d.branch) out["attribution.branch"] = d.branch;
  if (d.prNumber !== undefined && d.prNumber !== null) {
    out["attribution.pr_number"] = d.prNumber;
  }
  if (d.commitSha) out["attribution.commit_sha"] = d.commitSha;
  if (d.extra) {
    for (const [k, v] of Object.entries(d.extra)) {
      out[`attribution.extra.${k}`] = v;
    }
  }
  return out;
}

/** Inverse of encodeDimensions. */
export function decodeDimensions(
  metadata: Record<string, unknown>
): AttributionDimensions {
  const out: AttributionDimensions = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (!k.startsWith("attribution.")) continue;
    const tail = k.slice("attribution.".length);
    if (tail === "developer" && typeof v === "string") out.developer = v;
    else if (tail === "project" && typeof v === "string") out.project = v;
    else if (tail === "branch" && typeof v === "string") out.branch = v;
    else if (tail === "pr_number" && typeof v === "number") out.prNumber = v;
    else if (tail === "commit_sha" && typeof v === "string") out.commitSha = v;
    else if (tail.startsWith("extra.") && typeof v === "string") {
      out.extra = out.extra ?? {};
      out.extra[tail.slice("extra.".length)] = v;
    }
  }
  return out;
}
