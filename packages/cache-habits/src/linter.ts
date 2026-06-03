/**
 * Linter runner — walks the rule registry over a proposed action, applies
 * caller-supplied suppressions and severity overrides, and aggregates the
 * findings into a `LintReport`.
 *
 * The runner is the only place that touches the rule list as a collection.
 * Each individual rule is invoked exactly once per call; rules are pure
 * (see types.ts:RuleFn) so the order of invocation is irrelevant.
 *
 * Fail-safe contract (Phase 7 hard rule #4): a thrown rule never aborts
 * the run. The thrown error is captured, the rule is marked skipped, and
 * the remaining rules continue. This guarantees a UserPromptSubmit hook
 * that wraps `lint()` in `safeRun` never blocks a user send because one
 * rule has a bug.
 */

import { CACHE_HABIT_RULES } from "./rules.js";
import type {
  FindingSeverity,
  LintFinding,
  LintOptions,
  LintReport,
  ProposedAction,
  Rule,
  SessionSnapshot,
} from "./types.js";

const SEVERITY_RANK: Record<FindingSeverity, number> = {
  info: 0,
  warn: 1,
  block: 2,
};

function maxSeverity(a: FindingSeverity, b: FindingSeverity): FindingSeverity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/**
 * Run all enabled rules. Pure: same `action` + `snapshot` + `options`
 * always produces the same report (test-pinned). No I/O.
 */
export function lint(
  action: ProposedAction,
  snapshot: SessionSnapshot,
  options: LintOptions = {}
): LintReport {
  const suppressed = new Set(options.suppress ?? []);
  const overrides = options.severityOverrides ?? {};
  const findings: LintFinding[] = [];
  const skipped: string[] = [];
  let totalUsd = 0;
  let totalTokens = 0;
  let verdict: FindingSeverity = "info";

  for (const rule of CACHE_HABIT_RULES) {
    if (suppressed.has(rule.id)) {
      skipped.push(rule.id);
      continue;
    }
    let finding: LintFinding | null = null;
    try {
      finding = rule.run(action, snapshot);
    } catch {
      // Fail-safe per Phase 7 rule #4: a buggy rule never blocks a send.
      skipped.push(rule.id);
      continue;
    }
    if (!finding) continue;
    const override = overrides[rule.id];
    if (override) finding = { ...finding, severity: override };
    findings.push(finding);
    if (finding.estimatedWasteUsd !== null) totalUsd += finding.estimatedWasteUsd;
    if (finding.estimatedWasteTokens !== null) totalTokens += finding.estimatedWasteTokens;
    verdict = maxSeverity(verdict, finding.severity);
  }

  return {
    verdict,
    findings,
    totalEstimatedWasteUsd: totalUsd,
    totalEstimatedWasteTokens: totalTokens,
    skipped,
  };
}

/** Public re-export so callers can introspect the catalog. */
export function listRules(): readonly Rule[] {
  return CACHE_HABIT_RULES;
}
