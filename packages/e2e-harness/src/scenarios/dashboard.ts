/**
 * Flow E — the observability CLOSED LOOP. The real `quality_proof` bundles
 * collected in Flow B are recorded to a local sqlite sink, shipped by the REAL
 * forwarder (runForwardOnce) whose fetch IS the dashboard ingest path
 * (normalizeEvent + storeEvent), then read back through the REAL rollup
 * (aggregateFeatureTelemetry) — the exact report `/dashboard/telemetry` renders.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type DashboardLib,
  makeIngestFetch,
  seedFeatureEvents,
  runForwardOnce,
} from "../drivers/dashboard-driver";
import type { EventRow } from "@prune/persistence";
import { step, type ScenarioResult, type Step } from "../types";
import type { CollectedProof } from "./mcp";

export async function runDashboardScenario(
  lib: DashboardLib,
  proofs: CollectedProof[]
): Promise<ScenarioResult> {
  const steps: Step[] = [];
  const dir = mkdtempSync(join(tmpdir(), "prune-e2e-dash-"));
  const dbPath = join(dir, "events.sqlite");
  const cursorPath = join(dir, "cursor.json");

  try {
    // 1. Record the real MCP proofs as feature events into the local sink.
    await seedFeatureEvents(
      dbPath,
      proofs.map((p, i) => ({
        featureId: p.featureId,
        qualityProof: p.qualityProof,
        eventId: `e2e-${p.featureId}-${i}`,
        sessionId: "e2e-login-bug",
      }))
    );
    steps.push(
      step("record feature telemetry", "ok", `${proofs.length} real proofs → local sqlite (${proofs.map((p) => p.featureId).join(", ")})`, {
        featureIds: proofs.map((p) => p.featureId),
      })
    );

    // 2. Forward via the production forwarder; fetch IS the ingest path.
    const ingest = makeIngestFetch(lib);
    const fwd = await runForwardOnce({
      dbPath,
      endpoint: "http://e2e.local/api/v1/events",
      cursorPath,
      fetchImpl: ingest.fetchImpl,
    });
    steps.push(
      step(
        "forward → ingest",
        fwd.failures === 0 ? "ok" : "warn",
        `attempted ${fwd.attempted}, sent ${fwd.sent}, failures ${fwd.failures}, stoppedOnFailure=${fwd.stoppedOnFailure}`,
        { attempted: fwd.attempted, sent: fwd.sent, failures: fwd.failures }
      )
    );

    // 3. Read the rollup back exactly as GET /api/v1/features does.
    const { events } = await lib.readStoredEvents(1000);
    const report = lib.aggregateFeatureTelemetry(events as unknown as EventRow[]);

    const seededIds = new Set(proofs.map((p) => p.featureId));
    const populated = report.features.filter((f) => f.eventCount > 0);
    steps.push(
      step(
        "dashboard rollup",
        "ok",
        `${populated.length}/13 feature cards populated; totalEvents=${report.totalEvents}, outOfScope=${report.outOfScopeEventCount}`,
        {
          totalEvents: report.totalEvents,
          outOfScopeEventCount: report.outOfScopeEventCount,
          features: report.features.map((f) => ({
            featureId: f.featureId,
            featureName: f.featureName,
            eventCount: f.eventCount,
            malformedProofCount: f.malformedProofCount,
            seeded: seededIds.has(f.featureId),
            summary: f.summary,
          })),
        }
      )
    );

    return {
      flow: "Dashboard",
      summary: "Closed loop: real MCP proofs → local sink → real forwarder → real ingest normalization → real rollup/decoders (what /dashboard/telemetry shows).",
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
