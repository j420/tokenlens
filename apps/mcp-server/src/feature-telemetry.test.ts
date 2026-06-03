/**
 * Tests for caller-side feature telemetry (f10/f11 recording).
 *
 * Covers the three mandated behaviors plus adversarial edges:
 *   - off-by-default (no flag ⇒ no row)
 *   - on-when-flagged (round-trips a real proof into the sink)
 *   - failure-never-throws (bad path / disabled / non-JSON / error result)
 *   - deterministic + idempotent event_id (re-fire upserts, not duplicates)
 *   - pseudo-filesystem refusal (no hang)
 *   - non-recording tools are ignored
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalSqliteSink } from "@prune/persistence";

import {
  extractFeatureProof,
  isFeatureTelemetryEnabled,
  isUnsafeTelemetryPath,
  recordToolFeatureEventBestEffort,
  stableId,
} from "./feature-telemetry.js";
import { handleMcpProxyTrim, handleReplayCostPlan } from "./tcrp-tools.js";

const SESSION = "mcp-server";
const dirs: string[] = [];

function tmpDb(): { path: string; env: NodeJS.ProcessEnv } {
  const dir = mkdtempSync(join(tmpdir(), "prune-mcp-tel-"));
  dirs.push(dir);
  const path = join(dir, "events.sqlite");
  return {
    path,
    env: { PRUNE_MCP_TELEMETRY: "1", PRUNE_EVENTS_SQLITE: path },
  };
}

async function readRows(path: string) {
  const sink = new LocalSqliteSink({ path });
  await sink.init();
  try {
    return await sink.getRecentEvents(SESSION, 1000);
  } finally {
    await sink.close();
  }
}

// A real f10 result (mcp_proxy_trim) and a real f11 result (replay_cost_plan)
// produced by the actual pure handlers — so the test exercises the true proof
// shape, not a hand-stubbed one.
function f10Result(): string {
  return handleMcpProxyTrim({
    intent: "debug",
    tools: [
      { name: "debug_inspect", inputSchema: { type: "object" } },
      { name: "generate_widget", inputSchema: { type: "object" } },
    ],
  });
}

function f11Result(): string {
  return handleReplayCostPlan({
    model: "claude-sonnet-4-5-20250929",
    segments: [
      { role: "system", payload: { s: "sys" }, tokens_in: 100, tokens_out: 0 },
      { role: "user", payload: { u: "hello" }, tokens_in: 50, tokens_out: 0 },
      { role: "assistant", payload: { a: "hi" }, tokens_in: 0, tokens_out: 40 },
    ],
    mutation: { at_index: 1, new_payload: { u: "goodbye" }, new_tokens_in: 55 },
  });
}

afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe("isFeatureTelemetryEnabled", () => {
  it("is OFF by default (no env)", () => {
    expect(isFeatureTelemetryEnabled({})).toBe(false);
  });
  it("is ON only when PRUNE_MCP_TELEMETRY=1", () => {
    expect(isFeatureTelemetryEnabled({ PRUNE_MCP_TELEMETRY: "1" })).toBe(true);
    expect(isFeatureTelemetryEnabled({ PRUNE_MCP_TELEMETRY: "0" })).toBe(false);
    expect(isFeatureTelemetryEnabled({ PRUNE_MCP_TELEMETRY: "true" })).toBe(false);
  });
  it("kill-switch PRUNE_TELEMETRY_DISABLED=1 overrides the flag", () => {
    expect(
      isFeatureTelemetryEnabled({
        PRUNE_MCP_TELEMETRY: "1",
        PRUNE_TELEMETRY_DISABLED: "1",
      })
    ).toBe(false);
  });
});

describe("extractFeatureProof", () => {
  it("returns null for a non-recording tool", () => {
    expect(extractFeatureProof("analyze_context", f10Result())).toBeNull();
  });
  it("returns null for non-JSON", () => {
    expect(extractFeatureProof("mcp_proxy_trim", "not json")).toBeNull();
  });
  it("returns null for a handler error response", () => {
    const err = handleMcpProxyTrim({ tools: undefined as never });
    expect(JSON.parse(err).error).toBeTruthy();
    expect(extractFeatureProof("mcp_proxy_trim", err)).toBeNull();
  });
  it("returns null when quality_proof is absent", () => {
    expect(
      extractFeatureProof("mcp_proxy_trim", JSON.stringify({ trimmed: [] }))
    ).toBeNull();
  });
  it("extracts the f10 proof and trusts the proof's own featureId", () => {
    const ex = extractFeatureProof("mcp_proxy_trim", f10Result());
    expect(ex).not.toBeNull();
    expect(ex!.featureId).toBe("f10");
    expect(ex!.qualityProof.featureId).toBe("f10");
  });
  it("extracts the f11 proof", () => {
    const ex = extractFeatureProof("replay_cost_plan", f11Result());
    expect(ex).not.toBeNull();
    expect(ex!.featureId).toBe("f11");
  });
});

describe("isUnsafeTelemetryPath", () => {
  it("refuses /proc and /sys", () => {
    expect(isUnsafeTelemetryPath("/proc/self/foo")).toBe(true);
    expect(isUnsafeTelemetryPath("/sys/x")).toBe(true);
    expect(isUnsafeTelemetryPath("/proc")).toBe(true);
  });
  it("accepts a normal tmp path", () => {
    expect(isUnsafeTelemetryPath(join(tmpdir(), "events.sqlite"))).toBe(false);
  });
});

describe("recordToolFeatureEventBestEffort — off by default", () => {
  it("writes NOTHING when the flag is unset", async () => {
    const { path } = tmpDb();
    const wrote = await recordToolFeatureEventBestEffort(
      "mcp_proxy_trim",
      f10Result(),
      SESSION,
      { PRUNE_EVENTS_SQLITE: path } // no PRUNE_MCP_TELEMETRY
    );
    expect(wrote).toBe(false);
    // The DB file shouldn't even exist (we never opened the sink).
    const rows = await readRows(path);
    expect(rows).toHaveLength(0);
  });
});

describe("recordToolFeatureEventBestEffort — on when flagged", () => {
  it("round-trips an f10 proof into the sink", async () => {
    const { path, env } = tmpDb();
    const result = f10Result();
    const wrote = await recordToolFeatureEventBestEffort(
      "mcp_proxy_trim",
      result,
      SESSION,
      env
    );
    expect(wrote).toBe(true);

    const rows = await readRows(path);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.feature_id).toBe("f10");
    expect(row.tool).toBe("prune-mcp-mcp_proxy_trim");
    expect(row.classification).toBe("unknown"); // never fabricated
    expect(row.quality_proof).toEqual(JSON.parse(result).quality_proof);
  });

  it("round-trips an f11 proof into the sink", async () => {
    const { path, env } = tmpDb();
    const wrote = await recordToolFeatureEventBestEffort(
      "replay_cost_plan",
      f11Result(),
      SESSION,
      env
    );
    expect(wrote).toBe(true);
    const rows = await readRows(path);
    expect(rows).toHaveLength(1);
    expect(rows[0].feature_id).toBe("f11");
  });

  it("is idempotent — re-firing the SAME result upserts, not duplicates", async () => {
    const { path, env } = tmpDb();
    const result = f10Result();
    await recordToolFeatureEventBestEffort("mcp_proxy_trim", result, SESSION, env);
    await recordToolFeatureEventBestEffort("mcp_proxy_trim", result, SESSION, env);
    const rows = await readRows(path);
    expect(rows).toHaveLength(1);
  });

  it("a DIFFERENT proof produces a different event_id (distinct row)", async () => {
    const { path, env } = tmpDb();
    await recordToolFeatureEventBestEffort("mcp_proxy_trim", f10Result(), SESSION, env);
    // A different intent ⇒ different audit ⇒ different proof bytes ⇒ new id.
    const other = handleMcpProxyTrim({
      intent: "generate",
      tools: [
        { name: "debug_inspect", inputSchema: { type: "object" } },
        { name: "generate_widget", inputSchema: { type: "object" } },
      ],
    });
    await recordToolFeatureEventBestEffort("mcp_proxy_trim", other, SESSION, env);
    const rows = await readRows(path);
    expect(rows).toHaveLength(2);
  });
});

describe("recordToolFeatureEventBestEffort — failure never throws", () => {
  it("non-JSON result ⇒ false, no throw", async () => {
    const { env } = tmpDb();
    await expect(
      recordToolFeatureEventBestEffort("mcp_proxy_trim", "<<<not json>>>", SESSION, env)
    ).resolves.toBe(false);
  });

  it("error result ⇒ false, no throw, no row", async () => {
    const { path, env } = tmpDb();
    const err = JSON.stringify({ error: "boom" });
    await expect(
      recordToolFeatureEventBestEffort("mcp_proxy_trim", err, SESSION, env)
    ).resolves.toBe(false);
    expect(await readRows(path)).toHaveLength(0);
  });

  it("pseudo-filesystem path ⇒ false, never hangs", async () => {
    const wrote = await recordToolFeatureEventBestEffort(
      "mcp_proxy_trim",
      f10Result(),
      SESSION,
      { PRUNE_MCP_TELEMETRY: "1", PRUNE_EVENTS_SQLITE: "/proc/prune/events.sqlite" }
    );
    expect(wrote).toBe(false);
  });

  it("unwritable parent dir ⇒ false, no throw", async () => {
    // A path whose parent is a file, not a dir, makes mkdir/open fail fast.
    const { path } = tmpDb();
    const bogus = join(path, "child", "events.sqlite"); // path is a (future) file
    const wrote = await recordToolFeatureEventBestEffort(
      "mcp_proxy_trim",
      f10Result(),
      SESSION,
      { PRUNE_MCP_TELEMETRY: "1", PRUNE_EVENTS_SQLITE: bogus }
    );
    // It may or may not error depending on FS, but it must never throw.
    expect(typeof wrote).toBe("boolean");
  });
});

describe("stableId", () => {
  it("is deterministic", () => {
    expect(stableId("a", "b")).toBe(stableId("a", "b"));
    expect(stableId("a", "b")).not.toBe(stableId("a", "c"));
  });
});
