#!/usr/bin/env node
/**
 * Billing-Tier Drift Detector — Stop hook  (Cost-Security, L4-35).
 *
 * `usage.service_tier` is parsed by the telemetry schema and was consumed
 * by nothing: a mid-session tier flip (standard ↔ priority) silently
 * changes EVERY subsequent token's rate. This hook walks the observed tier
 * per assistant message and advises on:
 *   - a flip between consecutive tagged turns, or
 *   - a mismatch vs the operator-pinned PRUNE_EXPECTED_TIER.
 *
 * String equality only; absent tiers are NO signal (never inferred); the
 * cost differential is reported only when both tiers' rates are known to
 * the caller — this hook passes none, so the advisory states the flip
 * without inventing a dollar figure. Advisory; never blocks.
 *
 * Config:
 *   PRUNE_TIER_DRIFT_DISABLED  "1" → no-op.
 *   PRUNE_EXPECTED_TIER        pin, e.g. "standard".
 */

import { loadCachedSessionView } from "@prune/telemetry";
import { assessTierDrift } from "@prune/cost-security";

import { emitAdditionalContext, emitNoop, readHookPayload, safeRun } from "./_runtime.mjs";
import { deriveSessionId, recordFeatureEventBestEffort, stableId } from "./_telemetry.mjs";

safeRun(async () => {
  if (process.env.PRUNE_TIER_DRIFT_DISABLED === "1") return emitNoop();

  const start = Date.now();
  const payload = await readHookPayload();
  if (!payload.transcript_path) return emitNoop();

  const { turns } = await loadCachedSessionView(payload.transcript_path);
  if (turns.length === 0) return emitNoop();

  // One observation per assistant message, in order. service_tier rides the
  // schema's passthrough; anything non-string is null (no signal).
  const observations = [];
  for (const turn of turns) {
    for (const m of turn.assistantMessages ?? []) {
      const tier = m?.usage?.service_tier;
      observations.push({ tier: typeof tier === "string" ? tier : null });
    }
  }

  const expected = process.env.PRUNE_EXPECTED_TIER;
  const report = assessTierDrift(observations, {
    expectedTier: typeof expected === "string" && expected.length > 0 ? expected : null,
  });

  await recordFeatureEventBestEffort({
    featureId: "billing-tier-drift",
    qualityProof: {
      schemaVersion: 1,
      featureId: "billing-tier-drift",
      verdict: report.verdict,
      taggedCount: report.taggedCount,
      flip: report.flip,
      unexpected: report.unexpected,
    },
    sessionId: deriveSessionId(payload),
    eventId: `tier-drift-${stableId(payload.transcript_path ?? "", String(turns.length))}`,
    latencyMs: Date.now() - start,
  });

  if (report.verdict === "drift" && report.flip) {
    return emitAdditionalContext(
      `⚠️ Cost-guard (billing tier): this session's service_tier flipped from ` +
        `"${report.flip.fromTier}" to "${report.flip.toTier}" mid-session — every token since ` +
        `is billed at the new tier's rate. If this was not intentional, check the request ` +
        `configuration (PRUNE_EXPECTED_TIER pins the expectation).`,
      payload.hook_event_name ?? "Stop",
    );
  }
  if (report.verdict === "unexpected_tier" && report.unexpected) {
    return emitAdditionalContext(
      `⚠️ Cost-guard (billing tier): observed service_tier "${report.unexpected.observed}" ` +
        `differs from the pinned expectation "${report.unexpected.expected}".`,
      payload.hook_event_name ?? "Stop",
    );
  }
  return emitNoop();
});
