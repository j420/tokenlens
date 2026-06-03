import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalSqliteSink } from "./local-sqlite.js";
import {
  buildFeatureEventRow,
  recordFeatureEvent,
  type FeatureEventParams,
} from "./feature-event.js";

function params(overrides: Partial<FeatureEventParams> = {}): FeatureEventParams {
  return {
    featureId: "f9",
    qualityProof: { schemaVersion: 1, featureId: "f9", verdict: "warn" },
    sessionId: "sess-1",
    eventId: "evt-1",
    ...overrides,
  };
}

describe("buildFeatureEventRow", () => {
  it("produces a complete EventRow with the feature tagging set", () => {
    const row = buildFeatureEventRow(params());
    expect(row.feature_id).toBe("f9");
    expect(row.quality_proof).toEqual({ schemaVersion: 1, featureId: "f9", verdict: "warn" });
    expect(row.session_id).toBe("sess-1");
    expect(row.event_id).toBe("evt-1");
  });

  it("defaults the usage-centric fields to neutral, non-fabricated values", () => {
    const row = buildFeatureEventRow(params());
    expect(row.tokens_in).toBe(0);
    expect(row.tokens_out).toBe(0);
    expect(row.tokens_cached).toBe(0);
    expect(row.latency_ms).toBe(0);
    expect(row.estimated_cost_usd).toBe(0);
    expect(row.cumulative_session_cost_usd).toBe(0);
    // Honest classification — a feature event is not a productive/recursive turn.
    expect(row.classification).toBe("unknown");
    expect(row.roi_score).toBe(0);
    expect(row.tool_calls).toEqual([]);
    expect(row.files_referenced).toEqual([]);
    expect(row.compaction_triggered).toBe(false);
  });

  it("defaults provider/user/tool/task_metadata sensibly", () => {
    const row = buildFeatureEventRow(params());
    expect(row.provider).toBe("anthropic");
    expect(row.user_id).toBe("local");
    expect(row.team_id).toBeNull();
    expect(row.tool).toBe("prune-f9");
    expect(row.model).toBe("unknown");
    expect(row.task_metadata).toEqual({ type: "feature:f9", repo: null, branch: null });
  });

  it("carries supplied usage context through", () => {
    const row = buildFeatureEventRow(
      params({ tokensIn: 1200, tokensOut: 50, estimatedCostUsd: 0.004, latencyMs: 30, model: "claude-sonnet-4-5-20250929" })
    );
    expect(row.tokens_in).toBe(1200);
    expect(row.tokens_out).toBe(50);
    expect(row.estimated_cost_usd).toBe(0.004);
    expect(row.cumulative_session_cost_usd).toBe(0.004);
    expect(row.latency_ms).toBe(30);
    expect(row.model).toBe("claude-sonnet-4-5-20250929");
  });

  it("clamps negative / non-finite usage figures to 0 (no garbage rows)", () => {
    const row = buildFeatureEventRow(
      params({ tokensIn: -5, tokensOut: Number.NaN, estimatedCostUsd: Number.POSITIVE_INFINITY })
    );
    expect(row.tokens_in).toBe(0);
    expect(row.tokens_out).toBe(0);
    expect(row.estimated_cost_usd).toBe(0);
  });

  it("uses a provided timestamp or defaults to a valid ISO string", () => {
    expect(buildFeatureEventRow(params({ timestamp: "2026-06-03T12:00:00.000Z" })).timestamp).toBe(
      "2026-06-03T12:00:00.000Z"
    );
    const auto = buildFeatureEventRow(params()).timestamp;
    expect(Number.isNaN(Date.parse(auto))).toBe(false);
  });

  it("throws on a missing required field (caller bug surfaces immediately)", () => {
    expect(() => buildFeatureEventRow(params({ featureId: "" }))).toThrow(/featureId is required/);
    expect(() => buildFeatureEventRow(params({ sessionId: "" }))).toThrow(/sessionId is required/);
    expect(() => buildFeatureEventRow(params({ eventId: "" }))).toThrow(/eventId is required/);
    expect(() =>
      buildFeatureEventRow(params({ qualityProof: null as unknown as Record<string, unknown> }))
    ).toThrow(/qualityProof must be an object/);
  });

  it("is deterministic for the same params", () => {
    const p = params({ timestamp: "2026-06-03T12:00:00.000Z" });
    expect(buildFeatureEventRow(p)).toEqual(buildFeatureEventRow(p));
  });
});

describe("recordFeatureEvent — real sink round-trip", () => {
  let dir = "";
  let sink: LocalSqliteSink;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "prune-feat-"));
    sink = new LocalSqliteSink({ path: join(dir, "events.sqlite") });
    await sink.init();
  });
  afterEach(async () => {
    await sink.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("persists a feature event and reads it back with feature_id + quality_proof intact", async () => {
    await recordFeatureEvent(
      sink,
      params({
        featureId: "f12",
        qualityProof: { schemaVersion: 1, featureId: "f12", event: "capture", discoveryTokens: 2400 },
        sessionId: "sess-A",
        eventId: "evt-cap-1",
      })
    );
    const rows = await sink.getRecentEvents("sess-A");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.feature_id).toBe("f12");
    expect(rows[0]!.quality_proof).toEqual({
      schemaVersion: 1,
      featureId: "f12",
      event: "capture",
      discoveryTokens: 2400,
    });
  });

  it("is idempotent on event_id (INSERT OR REPLACE upserts, no duplicate)", async () => {
    const p = params({ sessionId: "sess-B", eventId: "evt-dup" });
    await recordFeatureEvent(sink, p);
    await recordFeatureEvent(sink, { ...p, qualityProof: { v: 2 } });
    const rows = await sink.getRecentEvents("sess-B");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.quality_proof).toEqual({ v: 2 }); // last write wins
  });

  it("round-trips events for all five new feature ids", async () => {
    for (const fid of ["f9", "f10", "f11", "f12", "f13"]) {
      await recordFeatureEvent(
        sink,
        params({ featureId: fid, sessionId: "sess-multi", eventId: `evt-${fid}`, qualityProof: { featureId: fid } })
      );
    }
    const rows = await sink.getRecentEvents("sess-multi");
    expect(rows.map((r) => r.feature_id).sort()).toEqual(["f10", "f11", "f12", "f13", "f9"]);
  });
});
