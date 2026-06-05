/**
 * Renders ScenarioResult[] as a narrated, sectioned console report — the
 * "show outputs" deliverable. Pure string building; no assertions.
 */

import type { ScenarioResult, StepStatus } from "./types";

const GLYPH: Record<StepStatus, string> = {
  ok: "✓",
  warn: "⚠",
  block: "⛔",
  info: "•",
};

const RULE = "═".repeat(78);
const THIN = "─".repeat(78);

export function renderReport(results: ScenarioResult[]): string {
  const out: string[] = [];
  out.push(RULE);
  out.push("  PRUNE — END-TO-END SCENARIO REPORT");
  out.push("  one synthetic session ('fix the login bug') driven through every product face");
  out.push(RULE);

  for (const r of results) {
    out.push("");
    out.push(`▌ FLOW: ${r.flow}`);
    out.push(`▌ ${r.summary}`);
    out.push(THIN);
    for (const s of r.steps) {
      out.push(`  ${GLYPH[s.status]} ${s.name}`);
      out.push(`      ${s.detail}`);
    }
    // Special render: the dashboard rollup table.
    const rollup = r.steps.find((s) => s.name === "dashboard rollup");
    if (rollup?.data?.features) {
      out.push("");
      out.push("      ┌─ dashboard /telemetry rollup ───────────────────────────────────");
      const feats = rollup.data.features as Array<{
        featureId: string;
        featureName: string;
        eventCount: number;
        malformedProofCount: number;
        seeded: boolean;
        summary: Record<string, unknown>;
      }>;
      for (const f of feats) {
        const mark = f.eventCount > 0 ? "●" : "·";
        const detail =
          f.eventCount > 0
            ? `events=${f.eventCount} ${summarizeFeature(f.summary)}`
            : "(no telemetry yet)";
        out.push(`      │ ${mark} ${f.featureId.padEnd(4)} ${f.featureName.padEnd(20)} ${detail}`);
      }
      out.push("      └──────────────────────────────────────────────────────────────");
    }
  }

  out.push("");
  out.push(RULE);
  const totalSteps = results.reduce((n, r) => n + r.steps.length, 0);
  const blocks = results.flatMap((r) => r.steps).filter((s) => s.status === "block").length;
  out.push(`  ${results.length} flows · ${totalSteps} steps · ${blocks} security block(s) demonstrated`);
  out.push(RULE);
  return out.join("\n");
}

function summarizeFeature(summary: Record<string, unknown>): string {
  const kind = summary.kind ?? "?";
  const data = (summary.data ?? summary) as Record<string, unknown>;
  const interesting = Object.entries(data)
    .filter(([k, v]) => k !== "kind" && v !== null && v !== undefined && typeof v !== "object")
    .slice(0, 3)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  return `[${kind}] ${interesting}`.trim();
}
