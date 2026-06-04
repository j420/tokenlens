import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocalSqliteSink } from "./local-sqlite.js";
import { recordFeatureEvent } from "./feature-event.js";
import type { EventRow } from "./sink.js";

/**
 * countEventsByFeature() — the read half of the data-driven promotion-readiness
 * reporter. It must:
 *   - GROUP BY feature_id, ignoring rows where feature_id IS NULL,
 *   - return an absent (not zero) entry for features with no telemetry,
 *   - never fabricate a count, and survive a defensive hydration of odd rows.
 *
 * An in-memory LocalSqliteSink (`:memory:`) is the seed target — no disk, no
 * lock, deterministic.
 */
describe("LocalSqliteSink.countEventsByFeature", () => {
  let sink: LocalSqliteSink;

  beforeEach(async () => {
    sink = new LocalSqliteSink({ path: ":memory:" });
    await sink.init();
  });

  afterEach(async () => {
    await sink.close();
  });

  /** Seed N feature events for a given feature id with unique event ids. */
  async function seed(featureId: string, n: number): Promise<void> {
    for (let i = 0; i < n; i++) {
      await recordFeatureEvent(sink, {
        featureId,
        qualityProof: { schemaVersion: 1, featureId },
        sessionId: `sess-${featureId}`,
        eventId: `${featureId}-evt-${i}`,
      });
    }
  }

  it("returns {} when there is no telemetry at all", async () => {
    expect(await sink.countEventsByFeature()).toEqual({});
  });

  it("groups feature-tagged events by feature_id", async () => {
    await seed("f9", 3);
    await seed("f10", 5);
    await seed("f11", 1);

    const counts = await sink.countEventsByFeature();
    expect(counts).toEqual({ f9: 3, f10: 5, f11: 1 });
  });

  it("ignores rows where feature_id IS NULL (real usage turns)", async () => {
    // A normal model-usage turn carries no feature tag.
    const usage: EventRow = {
      event_id: "usage-1",
      session_id: "sess-x",
      user_id: "local",
      team_id: null,
      timestamp: "2026-06-01T00:00:00.000Z",
      provider: "anthropic",
      tool: "claude-code",
      model: "claude-sonnet-4-5-20250929",
      tokens_in: 1000,
      tokens_out: 200,
      tokens_cached: 0,
      latency_ms: 500,
      estimated_cost_usd: 0.01,
      cumulative_session_cost_usd: 0.01,
      tool_calls: [],
      files_referenced: [],
      compaction_triggered: false,
      context_size_before: 0,
      context_size_after: 0,
      waste_flags: [],
      classification: "productive",
      roi_score: 0.5,
      task_metadata: { type: "edit", repo: null, branch: null },
      feature_id: null,
      quality_proof: null,
    };
    await sink.recordEvent(usage);
    await seed("f9", 2);

    const counts = await sink.countEventsByFeature();
    expect(counts).toEqual({ f9: 2 });
    expect(counts).not.toHaveProperty("usage-1");
  });

  it("a feature with zero events is absent, never reported as 0", async () => {
    await seed("f9", 1);
    const counts = await sink.countEventsByFeature();
    expect(counts.f12).toBeUndefined();
    expect(Object.keys(counts)).toEqual(["f9"]);
  });

  it("re-recording the same event_id upserts (idempotent), not double-counts", async () => {
    await recordFeatureEvent(sink, {
      featureId: "f9",
      qualityProof: { schemaVersion: 1 },
      sessionId: "sess-1",
      eventId: "dup-1",
    });
    await recordFeatureEvent(sink, {
      featureId: "f9",
      qualityProof: { schemaVersion: 1, again: true },
      sessionId: "sess-1",
      eventId: "dup-1", // same id → INSERT OR REPLACE
    });
    expect(await sink.countEventsByFeature()).toEqual({ f9: 1 });
  });
});
