/**
 * @prune/pull-context (F3 — Negotiated Pull-Context)
 *
 * Push→pull context protocol: manifest (signatures + ids) → caller-fed FETCH →
 * inject only requested bodies + their transitive mandatory deps (DAG closure),
 * with a coverage-floor candidate for omitted criticals and a retry-economics
 * gate that declines to push when the margin is too thin. Deterministic; no
 * model call; no regex; fail-safe to push on any malformed input.
 */

export {
  buildManifest,
  resolvePull,
  type PullSymbol,
  type ManifestPlan,
  type ResolveOptions,
  type PullDecision,
  type ResolvePlan,
} from "./pull.js";
