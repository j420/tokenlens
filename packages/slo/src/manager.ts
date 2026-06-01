/**
 * SloManager — orchestrator binding the persistence sink to the SLI +
 * breaker primitives. Mirrors the shape of @prune/budget-gate's
 * BudgetGate: a tiny stateful wrapper around the sink that takes care
 * of id generation, defaulting, and the read-then-decide flow.
 */

import { randomUUID } from "node:crypto";

import type {
  BudgetChargeRow,
  PersistenceSink,
  SloDefinitionRow,
} from "@prune/persistence";

import { computeSli, type SloSli } from "./sli.js";
import { decideBreaker, type BreakerDecision } from "./breaker.js";

export class SloManagerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SloManagerError";
  }
}

export interface DefineSloInput {
  name: string;
  scopeEnvelopeName: string;
  targetUsdPerTask: number;
  errorBudgetUsd: number;
  windowDays: number;
  warningPct?: number;
  taskDimension?: string;
  metadata?: Record<string, unknown>;
}

export class SloManager {
  constructor(private readonly sink: PersistenceSink) {}

  /** Create or update an SLO (idempotent on `name`). */
  async define(input: DefineSloInput): Promise<SloDefinitionRow> {
    if (!input.name) throw new SloManagerError("name is required");
    if (!(input.targetUsdPerTask > 0)) {
      throw new SloManagerError("targetUsdPerTask must be > 0");
    }
    if (input.errorBudgetUsd < 0) {
      throw new SloManagerError("errorBudgetUsd must be >= 0");
    }
    if (!(input.windowDays > 0)) {
      throw new SloManagerError("windowDays must be > 0");
    }
    const warning = input.warningPct ?? 0.5;
    if (warning < 0 || warning > 1) {
      throw new SloManagerError("warningPct must be in [0, 1]");
    }
    const envelope = await this.sink.getBudgetEnvelope(input.scopeEnvelopeName);
    if (!envelope) {
      throw new SloManagerError(
        `scope envelope "${input.scopeEnvelopeName}" not found`
      );
    }
    const existing = await this.sink.getSloDefinition(input.name);
    const row: SloDefinitionRow = {
      slo_id: existing?.slo_id ?? randomUUID(),
      name: input.name,
      scope_envelope_id: envelope.envelope_id,
      target_usd_per_task: input.targetUsdPerTask,
      error_budget_usd: input.errorBudgetUsd,
      window_days: input.windowDays,
      warning_pct: warning,
      task_dimension: input.taskDimension ?? "agent_id",
      metadata: input.metadata ?? {},
    };
    await this.sink.upsertSloDefinition(row);
    return row;
  }

  async get(name: string): Promise<SloDefinitionRow | null> {
    return this.sink.getSloDefinition(name);
  }

  async list(): Promise<SloDefinitionRow[]> {
    return this.sink.listSloDefinitions();
  }

  /**
   * Compute the SLI for a named SLO over the recent charges in its
   * scope envelope. Window length comes from the SLO definition.
   */
  async sli(name: string, asOf?: Date): Promise<SloSli> {
    const slo = await this.sink.getSloDefinition(name);
    if (!slo) throw new SloManagerError(`SLO "${name}" not found`);
    const charges = await this.fetchWindowedCharges(slo);
    return computeSli(slo, charges, { asOf });
  }

  /** Compute SLI then run the breaker policy. */
  async check(name: string, asOf?: Date): Promise<BreakerDecision> {
    const sli = await this.sli(name, asOf);
    return decideBreaker(sli);
  }

  private async fetchWindowedCharges(
    slo: SloDefinitionRow
  ): Promise<BudgetChargeRow[]> {
    // Pull a generous slice (5000 most recent) — the SLI then filters
    // by timestamp inside the window. For very high-volume envelopes,
    // we'd want a since-aware sink query; for v0.1 this matches the
    // shape used by attribution_rollup.
    return this.sink.getRecentBudgetCharges(slo.scope_envelope_id, 5000);
  }
}
