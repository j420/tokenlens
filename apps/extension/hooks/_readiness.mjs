/**
 * Promotion-readiness reporting — pure logic shared by `flags.mjs readiness`.
 *
 * Promoting a TCRP feature shadow→general should be DATA-DRIVEN: how many
 * shadow telemetry events the feature has actually produced is the signal an
 * operator weighs. This module turns a `{ featureId: count }` map (read from
 * the events sink) plus a threshold into a per-feature READY / NOT-READY
 * report.
 *
 * Discipline:
 *   - It ONLY reports. It never mutates flags, never promotes. A human/operator
 *     reads the table and decides — `flags.mjs enable` is a separate, explicit
 *     step. This separation is load-bearing: telemetry volume is necessary but
 *     not sufficient for promotion (quality of the shadow proofs matters too),
 *     so auto-promoting on a raw count would be dishonest.
 *   - Pure: no disk, no clock, no process exit. The CLI shell injects the
 *     counts it read and renders the rows. Fully unit-testable.
 *   - Honest zeros: a feature with no telemetry is reported with count 0 and
 *     NOT-READY — never hidden, never fabricated.
 */

/** Default events-since threshold a feature must clear to be promotion-READY. */
export const DEFAULT_READINESS_THRESHOLD = 50;

/**
 * Build the readiness rows. Pure.
 *
 * @param {string[]} featureIds   Canonical ordered list of TCRP feature ids.
 * @param {Record<string, number>} counts  Map of featureId → shadow-event count
 *        (as returned by the sink). Missing/odd entries are treated as 0.
 * @param {number} threshold      Min events to be READY (must be a positive int;
 *        a non-positive/non-finite value falls back to the default).
 * @returns {{ rows: Array<{ id: string, count: number, ready: boolean }>,
 *            threshold: number, readyCount: number }}
 */
export function buildReadinessReport(featureIds, counts, threshold) {
  const thr = normalizeThreshold(threshold);
  const safeCounts = counts && typeof counts === "object" ? counts : {};
  const rows = featureIds.map((id) => {
    const raw = safeCounts[id];
    const count =
      typeof raw === "number" && Number.isFinite(raw) && raw >= 0
        ? Math.trunc(raw)
        : 0;
    return { id, count, ready: count >= thr };
  });
  const readyCount = rows.reduce((acc, r) => acc + (r.ready ? 1 : 0), 0);
  return { rows, threshold: thr, readyCount };
}

/** Coerce a threshold to a positive integer, falling back to the default. */
export function normalizeThreshold(threshold) {
  if (
    typeof threshold === "number" &&
    Number.isFinite(threshold) &&
    threshold > 0
  ) {
    return Math.trunc(threshold);
  }
  return DEFAULT_READINESS_THRESHOLD;
}

/**
 * Render the report as plain lines (no color). Pure. `nameFor(id)` maps an id to
 * its human name; `hasTelemetry` distinguishes "DB present but empty" (clean
 * "no telemetry yet" footer) from "some counts present".
 *
 * @param {{ rows: Array<{ id: string, count: number, ready: boolean }>,
 *           threshold: number, readyCount: number }} report
 * @param {(id: string) => string} nameFor
 * @returns {string}
 */
export function formatReadiness(report, nameFor) {
  const header = `promotion readiness — shadow events per feature (threshold: ${report.threshold})`;
  const lines = report.rows.map((r) => {
    const name = nameFor(r.id) ?? r.id;
    return [
      r.id.padEnd(4),
      name.padEnd(20),
      `events=${String(r.count).padStart(6)}`,
      r.ready ? "READY" : "NOT-READY",
    ].join("  ");
  });
  const total = report.rows.reduce((a, r) => a + r.count, 0);
  const footer =
    total === 0
      ? "no telemetry yet — features need shadow events before they can be promoted."
      : `${report.readyCount}/${report.rows.length} feature(s) at or above threshold. ` +
        `Promotion is NOT automatic — review proofs, then run: flags enable <id> general`;
  return [header, ...lines, "", footer].join("\n");
}
