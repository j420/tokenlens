/**
 * Three-tier routing policy: (intent, difficulty) → model tier.
 *
 * Tier mapping (Skywork-style, Jun 2026 model lineup):
 *   FAST   — Haiku 4.5  ($1 input / $5 output per 1M)
 *   STD    — Sonnet 4.6 ($3 input / $15 output per 1M)
 *   STRONG — Opus 4.8   ($5 input / $25 output per 1M)
 *
 * Sources for the tier prices (May 2026 baseline, verified via deep
 * research round 1 in the post-research plan):
 *   - https://www.cloudzero.com/blog/claude-api-pricing/
 *   - https://platform.claude.com/docs/en/about-claude/pricing
 *
 * Policy rules (each rule cites the cost-class it represents):
 *   1. classify, retrieve, format, or any TRIVIAL difficulty → FAST.
 *      Cheapest tier handles intent triage + lookups + boilerplate
 *      formatting with high accuracy at 1/5th the per-token cost.
 *   2. debug intent → STRONG, regardless of size. Debug failures are
 *      where extra reasoning pays back fastest (matches RouteLLM's
 *      observation that hard queries are the ones worth escalating).
 *   3. hard difficulty → STRONG. Multi-file refactors, codebase-wide
 *      changes, large input. Cost amortizes over a single Opus call
 *      vs. multiple Sonnet retries.
 *   4. Everything else → STD. The Sonnet tier is the workhorse.
 *
 * The policy is intentionally explicit — caller can read this file and
 * audit every (intent, difficulty) → tier decision. v0.2 adds a
 * confidence-cascade pre-step (Haiku probe + escalate on low
 * confidence), preserving the rule audit trail.
 */

import type { Classification, DifficultyTier, IntentKind } from "./classifier.js";

export type Tier = "FAST" | "STD" | "STRONG";

export interface TierModelMap {
  FAST: string;
  STD: string;
  STRONG: string;
}

export const DEFAULT_TIER_MAP: TierModelMap = {
  FAST: "claude-haiku-4-5",
  STD: "claude-sonnet-4-5",
  STRONG: "claude-opus-4",
};

export interface RoutingDecision {
  tier: Tier;
  model: string;
  rule: string;
  rationale: string;
  classification: Classification;
}

export interface PolicyOptions {
  /** Override the tier → model id mapping (e.g. for non-Anthropic providers). */
  tierMap?: Partial<TierModelMap>;
  /**
   * Force the floor tier — e.g. "STD" means we never pick FAST.
   * Useful when a team wants higher baseline quality with capped escalation.
   */
  floor?: Tier;
}

const TIER_ORDER: Tier[] = ["FAST", "STD", "STRONG"];

function escalateAtLeast(want: Tier, floor?: Tier): Tier {
  if (!floor) return want;
  const wi = TIER_ORDER.indexOf(want);
  const fi = TIER_ORDER.indexOf(floor);
  return wi >= fi ? want : floor;
}

function isTrivialOrTriage(intent: IntentKind, difficulty: DifficultyTier): boolean {
  if (difficulty === "trivial") return true;
  return intent === "classify" || intent === "retrieve" || intent === "format";
}

export function route(
  classification: Classification,
  opts: PolicyOptions = {}
): RoutingDecision {
  const tierMap = { ...DEFAULT_TIER_MAP, ...(opts.tierMap ?? {}) };
  const { intent, difficulty } = classification;

  let tier: Tier;
  let rule: string;
  let rationale: string;

  if (isTrivialOrTriage(intent, difficulty)) {
    tier = "FAST";
    rule = "rule:1_trivial_or_triage";
    rationale = `intent=${intent}, difficulty=${difficulty} → FAST tier (cheapest model handles triage + trivial work).`;
  } else if (intent === "debug") {
    tier = "STRONG";
    rule = "rule:2_debug_escalates";
    rationale = "Debug intent escalates to STRONG — reasoning headroom amortizes fewer retries.";
  } else if (difficulty === "hard") {
    tier = "STRONG";
    rule = "rule:3_hard_difficulty";
    rationale = `difficulty=${difficulty} → STRONG (multi-file / hard signal / large context).`;
  } else {
    tier = "STD";
    rule = "rule:4_workhorse_default";
    rationale = "Standard intent and difficulty → STD (Sonnet) workhorse tier.";
  }

  tier = escalateAtLeast(tier, opts.floor);

  return {
    tier,
    model: tierMap[tier],
    rule,
    rationale,
    classification,
  };
}
