import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalSqliteSink } from "@prune/persistence";

import { recordHudTransition, isUnsafeSinkPath } from "./hud-recorder.js";

// A realistic f5 quality_proof, shaped exactly like buildHudQualityProof output.
function f5Proof(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    featureId: "f5",
    event: "severity_transition",
    from: "green",
    to: "red",
    escalated: true,
    tokens: 42000,
    costUsd: 0.63,
    costSource: "tokenizer",
    pricedModel: true,
    thresholds: { greenUsd: 0.1, redUsd: 0.5 },
    ...over,
  };
}

let dir: string;
let dbPath: string;
const savedDisabled = process.env.PRUNE_TELEMETRY_DISABLED;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "prune-hud-rec-"));
  dbPath = join(dir, "events.sqlite");
  delete process.env.PRUNE_TELEMETRY_DISABLED;
});

afterEach(() => {
  if (savedDisabled === undefined) delete process.env.PRUNE_TELEMETRY_DISABLED;
  else process.env.PRUNE_TELEMETRY_DISABLED = savedDisabled;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("recordHudTransition — happy path", () => {
  it("records the f5 proof as a feature event the sink can read back", async () => {
    const ok = await recordHudTransition({
      qualityProof: f5Proof(),
      sinkPath: dbPath,
      sessionId: "sess-1",
      model: "claude-sonnet-4-5",
    });
    expect(ok).toBe(true);
    expect(existsSync(dbPath)).toBe(true);

    // Reopen independently and verify the row landed with real (not fabricated)
    // figures copied from the proof.
    const sink = new LocalSqliteSink({ path: dbPath });
    await sink.init();
    try {
      const rows = await sink.getRecentEvents("sess-1", 10);
      expect(rows.length).toBe(1);
      const row = rows[0];
      expect(row.feature_id).toBe("f5");
      expect(row.session_id).toBe("sess-1");
      expect(row.model).toBe("claude-sonnet-4-5");
      expect(row.estimated_cost_usd).toBeCloseTo(0.63, 6);
      expect(row.tokens_in).toBe(42000);
      expect(row.quality_proof).toMatchObject({ from: "green", to: "red", escalated: true });
    } finally {
      await sink.close();
    }
  });

  it("re-recording the same transition upserts (deterministic eventId), not duplicates", async () => {
    const params = { qualityProof: f5Proof(), sinkPath: dbPath, sessionId: "sess-2" };
    expect(await recordHudTransition(params)).toBe(true);
    expect(await recordHudTransition(params)).toBe(true);

    const sink = new LocalSqliteSink({ path: dbPath });
    await sink.init();
    try {
      const rows = await sink.getRecentEvents("sess-2", 10);
      expect(rows.length).toBe(1); // upsert, not duplicate
    } finally {
      await sink.close();
    }
  });

  it("a caller-supplied eventId produces a distinct row per occurrence", async () => {
    await recordHudTransition({ qualityProof: f5Proof(), sinkPath: dbPath, sessionId: "s", eventId: "e1" });
    await recordHudTransition({ qualityProof: f5Proof(), sinkPath: dbPath, sessionId: "s", eventId: "e2" });
    const sink = new LocalSqliteSink({ path: dbPath });
    await sink.init();
    try {
      const rows = await sink.getRecentEvents("s", 10);
      expect(rows.length).toBe(2);
    } finally {
      await sink.close();
    }
  });
});

describe("recordHudTransition — fail-safe (never throws, returns false)", () => {
  it("returns false and writes nothing when PRUNE_TELEMETRY_DISABLED=1", async () => {
    process.env.PRUNE_TELEMETRY_DISABLED = "1";
    const ok = await recordHudTransition({ qualityProof: f5Proof(), sinkPath: dbPath, sessionId: "x" });
    expect(ok).toBe(false);
    expect(existsSync(dbPath)).toBe(false); // gated BEFORE any filesystem work
  });

  it("refuses /proc and /sys paths without throwing", async () => {
    expect(isUnsafeSinkPath("/proc/self/mem")).toBe(true);
    expect(isUnsafeSinkPath("/sys/kernel")).toBe(true);
    expect(isUnsafeSinkPath("/proc")).toBe(true);
    expect(isUnsafeSinkPath(dbPath)).toBe(false);

    const ok = await recordHudTransition({ qualityProof: f5Proof(), sinkPath: "/proc/self/x.sqlite", sessionId: "x" });
    expect(ok).toBe(false);
  });

  it("returns false on a missing / non-object qualityProof", async () => {
    const a = await recordHudTransition({
      qualityProof: null as unknown as Record<string, unknown>,
      sinkPath: dbPath,
      sessionId: "x",
    });
    const b = await recordHudTransition({
      qualityProof: "nope" as unknown as Record<string, unknown>,
      sinkPath: dbPath,
      sessionId: "x",
    });
    expect(a).toBe(false);
    expect(b).toBe(false);
  });

  it("returns false on a missing / empty sinkPath", async () => {
    const a = await recordHudTransition({ qualityProof: f5Proof(), sinkPath: "", sessionId: "x" });
    const b = await recordHudTransition({
      qualityProof: f5Proof(),
      sinkPath: undefined as unknown as string,
      sessionId: "x",
    });
    expect(a).toBe(false);
    expect(b).toBe(false);
  });

  it("returns false (never throws) when the sink path is unwritable", async () => {
    // Parent path is a file, so mkdir of a child dir fails — a normal ENOTDIR
    // that the best-effort try/catch must swallow.
    const filePath = join(dir, "a-file");
    rmSync(filePath, { force: true });
    // create a file then try to use it as a directory parent
    const sink = new LocalSqliteSink({ path: dbPath });
    await sink.init();
    await sink.close();
    // Now point at a nested path under the existing DB FILE (not a dir).
    const bad = join(dbPath, "nested", "events.sqlite");
    const ok = await recordHudTransition({ qualityProof: f5Proof(), sinkPath: bad, sessionId: "x" });
    expect(ok).toBe(false);
  });

  it("defaults featureId to f5 and tolerates a proof missing optional figures", async () => {
    const ok = await recordHudTransition({
      qualityProof: { event: "severity_transition", from: "yellow", to: "green" },
      sinkPath: dbPath,
      sessionId: "sess-min",
    });
    expect(ok).toBe(true);
    const sink = new LocalSqliteSink({ path: dbPath });
    await sink.init();
    try {
      const rows = await sink.getRecentEvents("sess-min", 10);
      expect(rows.length).toBe(1);
      expect(rows[0].feature_id).toBe("f5");
      // No costUsd/tokens in the proof ⇒ neutral zeros, never fabricated.
      expect(rows[0].estimated_cost_usd).toBe(0);
      expect(rows[0].tokens_in).toBe(0);
    } finally {
      await sink.close();
    }
  });
});
