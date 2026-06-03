/**
 * `quality_proof` schema for cache-habits findings.
 *
 * Every advisory the linter emits MUST be recorded to the persistence sink
 * (`PersistenceSink.recordEvent`) under `feature_id = "f7"` with the
 * `quality_proof` field populated by `buildQualityProof()` below. The
 * post-hoc auditor can then re-verify that the rule fired correctly by
 * re-running the rule against the recorded `signal` and asserting the same
 * verdict.
 *
 * Schema is intentionally flat and small: a single audit row should be
 * inspectable by hand from sqlite without joins.
 *
 * Schema version is pinned; bumping requires a migration path. v1 ships
 * with the package; v2 is reserved for future additions.
 */

import type { LintFinding, LintReport, ProposedAction, SessionSnapshot } from "./types.js";

export const CACHE_HABITS_FEATURE_ID = "f7" as const;
export const QUALITY_PROOF_SCHEMA_VERSION = 1 as const;

/** Audit-row payload. Goes into `EventRow.quality_proof`. */
export interface CacheHabitsQualityProof {
  schemaVersion: 1;
  featureId: "f7";
  verdict: LintReport["verdict"];
  findings: ReadonlyArray<{
    ruleId: string;
    ruleName: string;
    severity: LintFinding["severity"];
    /** Wasted USD if non-null, else null (linter never fabricates). */
    estimatedWasteUsd: number | null;
    estimatedWasteTokens: number | null;
    /** The typed signal that drove the decision — sufficient to replay the rule. */
    signal: Record<string, unknown>;
  }>;
  totals: {
    estimatedWasteUsd: number;
    estimatedWasteTokens: number;
    findingCount: number;
  };
  /** Snapshot of the action shape — sufficient to replay all rules. */
  inputs: {
    model: string;
    modelFamily: ProposedAction["modelFamily"];
    ttl: ProposedAction["ttl"];
    pastedBlockCount: number;
    /** Total pasted tokens across all blocks. PII-safe: count only. */
    pastedTokens: number;
    changes: {
      systemPromptTokens: number | null;
      toolListOrderHash: string | null;
      reasoningEffort: ProposedAction["changes"]["reasoningEffort"];
      temperature: number | null;
      mcpServersAddedCount: number;
      mcpServersRemovedCount: number;
    };
    now: string;
  };
  /** Snapshot inputs — sufficient to replay all rules. */
  snapshot: {
    currentModel: string;
    currentTtl: SessionSnapshot["currentTtl"];
    lastTurnAt: string | null;
    turnsSoFar: number;
    cacheReadTokensSoFar: number;
    cacheCreationTokensSoFar: number;
    systemPromptTokens: number | null;
    toolListOrderHash: string | null;
    reasoningEffort: SessionSnapshot["reasoningEffort"];
    temperature: number | undefined;
    mcpServerCount: number;
  };
}

/**
 * Build the `quality_proof` payload from a lint report. Pure: same inputs
 * always produce the same payload (test-pinned).
 */
export function buildQualityProof(
  report: LintReport,
  action: ProposedAction,
  snapshot: SessionSnapshot
): CacheHabitsQualityProof {
  let pastedTokens = 0;
  for (const b of action.prompt.pastedBlocks) pastedTokens += Math.max(0, b.tokens);

  return {
    schemaVersion: QUALITY_PROOF_SCHEMA_VERSION,
    featureId: CACHE_HABITS_FEATURE_ID,
    verdict: report.verdict,
    findings: report.findings.map((f) => ({
      ruleId: f.ruleId,
      ruleName: f.ruleName,
      severity: f.severity,
      estimatedWasteUsd: f.estimatedWasteUsd,
      estimatedWasteTokens: f.estimatedWasteTokens,
      signal: f.signal,
    })),
    totals: {
      estimatedWasteUsd: report.totalEstimatedWasteUsd,
      estimatedWasteTokens: report.totalEstimatedWasteTokens,
      findingCount: report.findings.length,
    },
    inputs: {
      model: action.model,
      modelFamily: action.modelFamily,
      ttl: action.ttl,
      pastedBlockCount: action.prompt.pastedBlocks.length,
      pastedTokens,
      changes: {
        systemPromptTokens: action.changes.systemPromptTokens,
        toolListOrderHash: action.changes.toolListOrderHash,
        reasoningEffort: action.changes.reasoningEffort,
        temperature: action.changes.temperature,
        mcpServersAddedCount: action.changes.mcpServersAdded.length,
        mcpServersRemovedCount: action.changes.mcpServersRemoved.length,
      },
      now: action.now,
    },
    snapshot: {
      currentModel: snapshot.currentModel,
      currentTtl: snapshot.currentTtl,
      lastTurnAt: snapshot.lastTurnAt,
      turnsSoFar: snapshot.turnsSoFar,
      cacheReadTokensSoFar: snapshot.cacheReadTokensSoFar,
      cacheCreationTokensSoFar: snapshot.cacheCreationTokensSoFar,
      systemPromptTokens: snapshot.systemPromptTokens,
      toolListOrderHash: snapshot.toolListOrderHash,
      reasoningEffort: snapshot.reasoningEffort,
      temperature: snapshot.temperature,
      mcpServerCount: snapshot.mcpServers.length,
    },
  };
}
