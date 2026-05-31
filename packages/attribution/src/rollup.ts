/**
 * Aggregate charges by attribution dimension(s).
 *
 * Output schema is intentionally simple — one row per group, with cost
 * and token aggregates plus charge count. Consumers can fan out to
 * second-level rollups by piping the result through groupBy again.
 *
 * The aggregator decodes dimensions from each charge's metadata via
 * decodeDimensions, so charges that were stamped manually (without
 * detectDimensions) still roll up correctly.
 */

import type { BudgetChargeRow } from "@prune/persistence";

import { decodeDimensions, type AttributionDimensions } from "./dimensions.js";

export type RollupKey =
  | "developer"
  | "project"
  | "branch"
  | "prNumber"
  | "commitSha"
  | "model"
  | "provider"
  | `extra.${string}`;

export interface RollupGroup {
  /** Each key in `key` corresponds to one entry in `keys`. */
  key: string;
  /** The (decoded) dimension values that produced this group's key. */
  dimensions: Partial<AttributionDimensions> & {
    model?: string;
    provider?: string;
  };
  totalCostUsd: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalTokensCached: number;
  chargeCount: number;
}

export interface RollupOptions {
  /** Which dimension(s) to group by. Order is preserved in the composite key. */
  groupBy: RollupKey[];
  /** Restrict charges to timestamps >= since. ISO string. */
  since?: string;
  /** Restrict charges to timestamps <= until. ISO string. */
  until?: string;
  /** Pre-filter by exact dimension match. */
  whereEquals?: Partial<Record<RollupKey, string | number>>;
}

function dimValue(
  charge: BudgetChargeRow,
  key: RollupKey,
  dims: AttributionDimensions
): string | number | undefined {
  if (key === "model") return charge.model;
  if (key === "provider") return charge.provider;
  if (key === "developer") return dims.developer;
  if (key === "project") return dims.project;
  if (key === "branch") return dims.branch;
  if (key === "prNumber") return dims.prNumber;
  if (key === "commitSha") return dims.commitSha;
  if (key.startsWith("extra.")) {
    return dims.extra?.[key.slice("extra.".length)];
  }
  return undefined;
}

const UNATTRIBUTED = "(unattributed)";

export function rollup(
  charges: BudgetChargeRow[],
  opts: RollupOptions
): RollupGroup[] {
  const since = opts.since ? Date.parse(opts.since) : -Infinity;
  const until = opts.until ? Date.parse(opts.until) : Infinity;

  const groups = new Map<string, RollupGroup>();
  for (const c of charges) {
    const t = Date.parse(c.timestamp);
    if (!Number.isFinite(t)) continue;
    if (t < since || t > until) continue;

    const dims = decodeDimensions(c.metadata);
    let pass = true;
    if (opts.whereEquals) {
      for (const [k, v] of Object.entries(opts.whereEquals) as Array<[RollupKey, string | number]>) {
        const got = dimValue(c, k, dims);
        if (got !== v) {
          pass = false;
          break;
        }
      }
    }
    if (!pass) continue;

    const values = opts.groupBy.map((k) =>
      String(dimValue(c, k, dims) ?? UNATTRIBUTED)
    );
    const compositeKey = values.join("|");
    let group = groups.get(compositeKey);
    if (!group) {
      const groupDims: RollupGroup["dimensions"] = {};
      for (let i = 0; i < opts.groupBy.length; i++) {
        const k = opts.groupBy[i];
        const v = values[i];
        if (v === UNATTRIBUTED) continue;
        if (k === "model") groupDims.model = v;
        else if (k === "provider") groupDims.provider = v;
        else if (k === "developer") groupDims.developer = v;
        else if (k === "project") groupDims.project = v;
        else if (k === "branch") groupDims.branch = v;
        else if (k === "prNumber") {
          const n = Number(v);
          if (Number.isFinite(n)) groupDims.prNumber = n;
        }
        else if (k === "commitSha") groupDims.commitSha = v;
        else if (k.startsWith("extra.")) {
          groupDims.extra = groupDims.extra ?? {};
          groupDims.extra[k.slice("extra.".length)] = v;
        }
      }
      group = {
        key: compositeKey,
        dimensions: groupDims,
        totalCostUsd: 0,
        totalTokensIn: 0,
        totalTokensOut: 0,
        totalTokensCached: 0,
        chargeCount: 0,
      };
      groups.set(compositeKey, group);
    }
    group.totalCostUsd += c.cost_usd;
    group.totalTokensIn += c.tokens_in;
    group.totalTokensOut += c.tokens_out;
    group.totalTokensCached += c.tokens_cached;
    group.chargeCount += 1;
  }

  return Array.from(groups.values()).sort(
    (a, b) => b.totalCostUsd - a.totalCostUsd
  );
}
