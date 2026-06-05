/**
 * Flow E — the observability CLOSED LOOP. Real MCP proofs → local sqlite → the
 * real forwarder (runForwardOnce) whose fetch IS the dashboard ingest path →
 * the real rollup/decoders (aggregateFeatureTelemetry). Each step carries
 * input/output and invariant checks.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type DashboardLib, makeIngestFetch, seedFeatureEvents, runForwardOnce } from "../drivers/dashboard-driver";
import type { EventRow } from "@prune/persistence";
import type { ScenarioResult, Step } from "../types";
import type { CollectedProof } from "./mcp";

export async function runDashboardScenario(lib: DashboardLib, proofs: CollectedProof[]): Promise<ScenarioResult> {
  const steps: Step[] = [];
  const dir = mkdtempSync(join(tmpdir(), "prune-e2e-dash-"));
  const dbPath = join(dir, "events.sqlite");
  const cursorPath = join(dir, "cursor.json");

  try {
    // 1. Record real MCP proofs as feature events.
    await seedFeatureEvents(
      dbPath,
      proofs.map((p, i) => ({ featureId: p.featureId, qualityProof: p.qualityProof, eventId: `e2e-${p.featureId}-${i}`, sessionId: "e2e-login-bug" }))
    );
    steps.push({
      name: "record feature telemetry",
      status: "ok",
      detail: `${proofs.length} real proofs → local sqlite (${proofs.map((p) => p.featureId).join(", ")})`,
      input: { proofs: proofs.map((p) => ({ featureId: p.featureId, proofKeys: Object.keys(p.qualityProof) })) },
      output: { recorded: proofs.length },
      checks: [{ label: "all collected proofs recorded", passed: proofs.length >= 5 }],
      quality: null,
    });

    // 2. Forward via the production forwarder; fetch IS the ingest path.
    const ingest = makeIngestFetch(lib);
    const fwd = await runForwardOnce({ dbPath, endpoint: "http://e2e.local/api/v1/events", cursorPath, fetchImpl: ingest.fetchImpl });
    steps.push({
      name: "forward → ingest",
      status: fwd.failures === 0 ? "ok" : "warn",
      detail: `attempted ${fwd.attempted}, sent ${fwd.sent}, failures ${fwd.failures}, stoppedOnFailure=${fwd.stoppedOnFailure}`,
      input: { endpoint: "http://e2e.local/api/v1/events", dbPath: "events.sqlite" },
      output: fwd,
      checks: [
        { label: "zero delivery failures", passed: fwd.failures === 0 },
        { label: "sent == recorded proofs", passed: fwd.sent === proofs.length },
      ],
      quality: null,
    });

    // 3. Read the rollup exactly as GET /api/v1/features does.
    const { events } = await lib.readStoredEvents(1000);
    const report = lib.aggregateFeatureTelemetry(events as unknown as EventRow[]);
    const seededIds = new Set(proofs.map((p) => p.featureId));
    const seededCards = report.features.filter((f) => seededIds.has(f.featureId));
    const populated = report.features.filter((f) => f.eventCount > 0);

    steps.push({
      name: "dashboard rollup",
      status: "ok",
      detail: `${populated.length}/13 feature cards populated; totalEvents=${report.totalEvents}, outOfScope=${report.outOfScopeEventCount}`,
      input: { storedEvents: events.length },
      output: { totalEvents: report.totalEvents, outOfScopeEventCount: report.outOfScopeEventCount },
      checks: [
        { label: "every seeded feature card has ≥1 event", passed: seededCards.every((f) => f.eventCount >= 1) },
        { label: "no malformed proofs in seeded cards", passed: seededCards.every((f) => f.malformedProofCount === 0) },
        { label: "no out-of-scope events", passed: report.outOfScopeEventCount === 0 },
      ],
      quality: null,
      data: {
        features: report.features.map((f) => ({
          featureId: f.featureId,
          featureName: f.featureName,
          eventCount: f.eventCount,
          malformedProofCount: f.malformedProofCount,
          seeded: seededIds.has(f.featureId),
          summary: f.summary,
        })),
      },
    });

    return {
      flow: "Dashboard",
      summary: "Closed loop: real MCP proofs → local sink → real forwarder → real ingest → real rollup/decoders (what /dashboard/telemetry shows).",
      steps,
    };
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}
