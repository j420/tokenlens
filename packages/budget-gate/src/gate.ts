/**
 * BudgetGate — the orchestrator. Combines the persistence sink, the
 * accountant (pricing), the envelope projector, and the decision policy
 * into a small surface a caller can drive from any of:
 *   - The Claude Code hooks (PreToolUse / Stop)
 *   - The MCP server (`budget_status` tool)
 *   - The Agent SDK adapter (planned v0.2 wrapper around @anthropic-ai/sdk)
 *
 * The gate is stateless across calls; all state lives in the underlying
 * `PersistenceSink`. Multi-process safety inherits from the sink — for
 * `LocalSqliteSink` that's the `proper-lockfile` exclusive-init lock we
 * shipped in the third pass.
 */

import { randomUUID } from "node:crypto";

import type {
  BudgetChargeRow,
  BudgetEnvelopeRow,
  PersistenceSink,
} from "@prune/persistence";
import type { Provider } from "@prune/shared";
import {
  detectDimensions,
  encodeDimensions,
  type AttributionDimensions,
} from "@prune/attribution";

import {
  computeRecordedCost,
  estimateUpcomingCost,
  type RecordedUsage,
} from "./accountant.js";
import { summarizeEnvelope, type BudgetState } from "./envelope.js";
import { decide, type BudgetDecision } from "./decision.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface EnvelopeSpec {
  name: string;
  limitUsd: number;
  /** "month" rolls on calendar month UTC. "custom" requires explicit dates. */
  periodKind: BudgetEnvelopeRow["period_kind"];
  /** Required when periodKind === "custom". */
  periodStart?: Date;
  /** Required when periodKind === "custom". */
  periodEnd?: Date;
  softCapPct?: number;
  hardCapPct?: number;
  parentEnvelopeName?: string;
  metadata?: Record<string, unknown>;
}

export interface CheckRequest {
  envelopeName: string;
  model: string;
  provider?: Provider;
  estimatedTokensIn: number;
  estimatedTokensOut?: number;
  agentId?: string;
  /**
   * Burn-rate projection window in hours. Default 24h. Lower values
   * make projections more reactive to recent bursts; higher values
   * smooth across quiet periods. 1-72 are reasonable.
   */
  burnRateWindowHours?: number;
}

export interface RecordRequest {
  envelopeName: string;
  usage: RecordedUsage;
  agentId?: string;
  /**
   * Optional metadata to attach to the charge row (call id, session id,
   * which tool was invoked, etc.). Stored verbatim in the audit log.
   * Note: attribution dimensions are merged in automatically by the
   * gate (unless `skipAttribution` is set) — caller doesn't need to
   * stamp them by hand.
   */
  metadata?: Record<string, unknown>;
  /** Override the `now` recorded on the charge. Mostly for tests. */
  at?: Date;
  /**
   * Stable id for idempotent recording. When supplied, re-recording the
   * same id (e.g. on hook re-fire for the same turn) replaces the row
   * via the underlying sink's INSERT OR REPLACE rather than appending a
   * duplicate charge. Parent rollups use derived ids of the form
   * `${chargeId}#roll:${parentId}` so they're also idempotent.
   */
  chargeId?: string;
  /**
   * Explicit attribution dimensions to stamp on the charge. Merged with
   * detectDimensions() output unless `skipAttribution` is true.
   */
  attribution?: AttributionDimensions;
  /** Skip the auto-detect attribution probe (useful in tests / CI). */
  skipAttribution?: boolean;
}

export class BudgetGateError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "BudgetGateError";
  }
}

function periodBounds(
  spec: Pick<EnvelopeSpec, "periodKind" | "periodStart" | "periodEnd">,
  now: Date
): { start: Date; end: Date } {
  switch (spec.periodKind) {
    case "day": {
      const start = new Date(Date.UTC(
        now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
        0, 0, 0, 0
      ));
      const end = new Date(start.getTime() + MS_PER_DAY - 1);
      return { start, end };
    }
    case "week": {
      // Start on Monday UTC.
      const day = now.getUTCDay(); // 0=Sun
      const daysSinceMonday = (day + 6) % 7;
      const start = new Date(Date.UTC(
        now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday,
        0, 0, 0, 0
      ));
      const end = new Date(start.getTime() + 7 * MS_PER_DAY - 1);
      return { start, end };
    }
    case "month": {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const end = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) - 1
      );
      return { start, end };
    }
    case "custom":
      if (!spec.periodStart || !spec.periodEnd) {
        throw new BudgetGateError(
          'periodKind="custom" requires both periodStart and periodEnd'
        );
      }
      if (spec.periodEnd.getTime() <= spec.periodStart.getTime()) {
        throw new BudgetGateError("periodEnd must be after periodStart");
      }
      return { start: spec.periodStart, end: spec.periodEnd };
  }
}

export class BudgetGate {
  constructor(private readonly sink: PersistenceSink) {}

  /**
   * Create or update a named envelope. Calling this with an existing
   * name and the same period bounds just updates limits/caps. To roll
   * to a new period, change `periodStart`/`periodEnd` (custom) or call
   * `rollPeriod()`.
   */
  async createEnvelope(
    spec: EnvelopeSpec,
    now: Date = new Date()
  ): Promise<BudgetEnvelopeRow> {
    if (!spec.name) throw new BudgetGateError("name is required");
    if (!Number.isFinite(spec.limitUsd) || spec.limitUsd <= 0) {
      throw new BudgetGateError("limitUsd must be a positive number");
    }
    const softCap = spec.softCapPct ?? 0.75;
    const hardCap = spec.hardCapPct ?? 1.0;
    if (softCap < 0 || softCap > hardCap || hardCap > 1) {
      throw new BudgetGateError(
        "Caps must satisfy 0 <= soft_cap_pct <= hard_cap_pct <= 1"
      );
    }
    let parentId: string | null = null;
    if (spec.parentEnvelopeName) {
      const parent = await this.sink.getBudgetEnvelope(spec.parentEnvelopeName);
      if (!parent) {
        throw new BudgetGateError(
          `parent envelope "${spec.parentEnvelopeName}" not found`
        );
      }
      parentId = parent.envelope_id;
    }

    const bounds = periodBounds(spec, now);
    const existing = await this.sink.getBudgetEnvelope(spec.name);
    const row: BudgetEnvelopeRow = {
      envelope_id: existing?.envelope_id ?? randomUUID(),
      name: spec.name,
      period_kind: spec.periodKind,
      period_start: bounds.start.toISOString(),
      period_end: bounds.end.toISOString(),
      limit_usd: spec.limitUsd,
      soft_cap_pct: softCap,
      hard_cap_pct: hardCap,
      parent_envelope_id: parentId,
      metadata: spec.metadata ?? {},
    };
    await this.sink.upsertBudgetEnvelope(row);
    return row;
  }

  async getEnvelope(name: string): Promise<BudgetEnvelopeRow | null> {
    return this.sink.getBudgetEnvelope(name);
  }

  /**
   * Pre-call check. Returns a BudgetDecision the caller can route on
   * (allow → proceed; warn → proceed but log; block → refuse and
   * surface `reason` to the user / Claude Code via decision JSON).
   *
   * The decision does NOT mutate state — callers should still call
   * `record()` after the actual call returns with the exact usage.
   */
  async check(req: CheckRequest): Promise<BudgetDecision> {
    const envelope = await this.sink.getBudgetEnvelope(req.envelopeName);
    if (!envelope) {
      throw new BudgetGateError(`envelope "${req.envelopeName}" does not exist`);
    }
    const estimate = estimateUpcomingCost({
      model: req.model,
      provider: req.provider,
      estimatedTokensIn: req.estimatedTokensIn,
      estimatedTokensOut: req.estimatedTokensOut,
    });
    const charges = await this.sink.getRecentBudgetCharges(envelope.envelope_id, 1000);
    const state = summarizeEnvelope(envelope, charges, {
      burnRateWindow: { hours: req.burnRateWindowHours ?? 24 },
    });
    return decide({
      state,
      estimatedCostUsd: estimate.costUsd,
      estimateIsApproximate: estimate.source === "estimated",
    });
  }

  /**
   * Record a real charge after the call lands. The cost is computed
   * from the exact returned usage via the accountant. Returns the
   * updated envelope state so callers can chain into further
   * decision-making (e.g. emit an alert if we crossed soft_cap).
   */
  async record(req: RecordRequest): Promise<BudgetState> {
    const envelope = await this.sink.getBudgetEnvelope(req.envelopeName);
    if (!envelope) {
      throw new BudgetGateError(`envelope "${req.envelopeName}" does not exist`);
    }
    const cost = computeRecordedCost(req.usage);
    const baseChargeId = req.chargeId ?? randomUUID();
    // Stamp attribution dimensions on every charge so the per-dev / per-PR /
    // per-project rollup works without callers having to instrument by hand.
    // Skip when explicitly requested (tests, CI hot paths).
    const dims: AttributionDimensions = req.skipAttribution
      ? (req.attribution ?? {})
      : { ...detectDimensions(), ...(req.attribution ?? {}) };
    const attributionMeta = encodeDimensions(dims);
    const charge: BudgetChargeRow = {
      charge_id: baseChargeId,
      envelope_id: envelope.envelope_id,
      timestamp: (req.at ?? new Date()).toISOString(),
      agent_id: req.agentId ?? null,
      model: cost.model,
      provider: cost.provider,
      tokens_in: cost.tokensIn,
      tokens_out: cost.tokensOut,
      tokens_cached: cost.tokensCached,
      tokens_cache_creation: req.usage.tokensCacheCreation ?? 0,
      cost_usd: cost.costUsd,
      source: "recorded",
      metadata: { ...attributionMeta, ...(req.metadata ?? {}) },
    };
    await this.sink.recordBudgetCharge(charge);

    // Recursively bubble the charge to ancestor envelopes (parent → grandparent → …).
    // Lets enterprise users define a $5K/mo company envelope with $500/dev
    // sub-envelopes: a dev's call counts against both. Derived rollup ids
    // are deterministic from the base id so re-recording is idempotent.
    let parentId = envelope.parent_envelope_id;
    const seen = new Set<string>([envelope.envelope_id]);
    while (parentId) {
      if (seen.has(parentId)) break; // defensive — guard against cycles
      seen.add(parentId);
      const parent = await this.sink.getBudgetEnvelopeById(parentId);
      if (!parent) break;
      await this.sink.recordBudgetCharge({
        ...charge,
        charge_id: `${baseChargeId}#roll:${parent.envelope_id}`,
        envelope_id: parent.envelope_id,
        metadata: { ...charge.metadata, rolled_up_from: envelope.envelope_id },
      });
      parentId = parent.parent_envelope_id;
    }

    return this.getState(req.envelopeName);
  }

  /** Current envelope state (spent, projections, decisions ready). */
  async getState(envelopeName: string): Promise<BudgetState> {
    const envelope = await this.sink.getBudgetEnvelope(envelopeName);
    if (!envelope) {
      throw new BudgetGateError(`envelope "${envelopeName}" does not exist`);
    }
    const charges = await this.sink.getRecentBudgetCharges(envelope.envelope_id, 1000);
    return summarizeEnvelope(envelope, charges);
  }
}
