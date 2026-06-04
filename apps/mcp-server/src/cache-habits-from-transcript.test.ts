/**
 * Tests for handleCacheHabitsFromTranscript — the F9 surface that DERIVES the
 * cache-habits session snapshot from a real Claude Code transcript and lints the
 * caller's proposed next action against it.
 *
 * These assert the load-bearing behaviors, not the framing:
 *   - the snapshot is genuinely derived (active model, cumulative cache tokens,
 *     idle gap), so rules that need it (CH-001 model switch, CH-004 idle) fire;
 *   - the proposed action is honestly caller-supplied (the `derived` block says
 *     so, and proposed model == active model ⇒ NO spurious model-switch finding);
 *   - it is fail-safe (missing/garbage transcript ⇒ valid JSON, no throw, no
 *     fabricated model) and validates input (⇒ JSON `error`, never a throw).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { handleCacheHabitsFromTranscript } from "./tcrp-tools.js";

const ACTIVE_MODEL = "claude-sonnet-4-5-20250929";
const OTHER_MODEL = "claude-opus-4-1-20250805";

const testDir = path.join(os.tmpdir(), "prune-chft-test-" + Date.now());

/** Two-turn transcript on ACTIVE_MODEL with 2000 cache-creation tokens on T1. */
function writeTranscript(file: string): void {
  const lines = [
    JSON.stringify({
      type: "user",
      sessionId: "s1",
      timestamp: "2026-05-30T10:00:00Z",
      message: { role: "user", content: "explain auth" },
    }),
    JSON.stringify({
      type: "assistant",
      sessionId: "s1",
      timestamp: "2026-05-30T10:00:01Z",
      message: {
        role: "assistant",
        model: ACTIVE_MODEL,
        content: [{ type: "text", text: "ok" }],
        usage: {
          input_tokens: 2000,
          output_tokens: 200,
          cache_creation_input_tokens: 2000,
          cache_read_input_tokens: 0,
        },
      },
    }),
    JSON.stringify({
      type: "user",
      sessionId: "s1",
      timestamp: "2026-05-30T10:00:05Z",
      message: { role: "user", content: "now write a test" },
    }),
    JSON.stringify({
      type: "assistant",
      sessionId: "s1",
      timestamp: "2026-05-30T10:00:06Z",
      message: {
        role: "assistant",
        model: ACTIVE_MODEL,
        content: [{ type: "text", text: "done" }],
        usage: {
          input_tokens: 100,
          output_tokens: 200,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 2000,
        },
      },
    }),
  ];
  fs.writeFileSync(file, lines.join("\n") + "\n");
}

// Each test uses its own cache dir indirectly via a fresh transcript path; the
// loader writes a session cache under ~/.prune by default, which is harmless.
let transcriptPath: string;

beforeAll(() => {
  fs.mkdirSync(testDir, { recursive: true });
  transcriptPath = path.join(testDir, "transcript.jsonl");
  writeTranscript(transcriptPath);
});

afterAll(() => {
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe("handleCacheHabitsFromTranscript — snapshot derivation", () => {
  it("derives the active model, turn count, and cumulative cache tokens from the transcript", async () => {
    const out = JSON.parse(
      await handleCacheHabitsFromTranscript({
        transcript_path: transcriptPath,
        proposed_action: { model: ACTIVE_MODEL }, // no switch
      })
    );
    expect(out.error).toBeUndefined();
    expect(out.featureId).toBe("f9");
    expect(out.derived.transcriptHadTurns).toBe(true);
    expect(out.derived.turnsObserved).toBe(2);
    expect(out.derived.currentModel).toBe(ACTIVE_MODEL);
    // 2000 (T1) + 0 (T2) cache-creation; 0 + 2000 cache-read.
    expect(out.derived.cacheCreationTokensSoFar).toBe(2000);
    expect(out.derived.cacheReadTokensSoFar).toBe(2000);
    // Last turn's timestamp, derived — never fabricated.
    expect(out.derived.lastTurnAt).toBe("2026-05-30T10:00:06Z");
  });

  it("fires CH-001 when the proposed model differs from the transcript's active model", async () => {
    const out = JSON.parse(
      await handleCacheHabitsFromTranscript({
        transcript_path: transcriptPath,
        proposed_action: { model: OTHER_MODEL },
      })
    );
    const ch001 = out.findings.find((f: { ruleId: string }) => f.ruleId === "CH-001");
    expect(ch001).toBeTruthy();
    expect(ch001.signal.previousModel).toBe(ACTIVE_MODEL);
    expect(ch001.signal.newModel).toBe(OTHER_MODEL);
    // The waste is computed from the DERIVED cache-creation tokens, not a guess.
    expect(ch001.signal.cacheCreationTokensLost).toBe(2000);
  });

  it("does NOT fire CH-001 when the proposed model equals the active model", async () => {
    const out = JSON.parse(
      await handleCacheHabitsFromTranscript({
        transcript_path: transcriptPath,
        proposed_action: { model: ACTIVE_MODEL },
      })
    );
    expect(out.findings.find((f: { ruleId: string }) => f.ruleId === "CH-001")).toBeUndefined();
  });

  it("fires CH-004 when the proposed firing time exceeds the host-declared TTL since the last turn", async () => {
    const out = JSON.parse(
      await handleCacheHabitsFromTranscript({
        transcript_path: transcriptPath,
        proposed_action: {
          model: ACTIVE_MODEL,
          now: "2026-05-30T10:30:00Z", // 30m after the last turn (10:00:06)
        },
        snapshot_context: { currentTtl: "5m" },
      })
    );
    const ch004 = out.findings.find((f: { ruleId: string }) => f.ruleId === "CH-004");
    expect(ch004).toBeTruthy();
    expect(ch004.signal.ttl).toBe("5m");
    expect(ch004.signal.idleMinutes).toBeGreaterThan(5);
  });

  it("does NOT fire CH-004 when no firing time is declared (zero idle gap, not a fabricated clock)", async () => {
    const out = JSON.parse(
      await handleCacheHabitsFromTranscript({
        transcript_path: transcriptPath,
        proposed_action: { model: ACTIVE_MODEL }, // now defaults to lastTurnAt ⇒ 0 gap
        snapshot_context: { currentTtl: "5m" },
      })
    );
    expect(out.findings.find((f: { ruleId: string }) => f.ruleId === "CH-004")).toBeUndefined();
  });

  it("detects an MCP-server add by diffing the proposal against host-declared context", async () => {
    const out = JSON.parse(
      await handleCacheHabitsFromTranscript({
        transcript_path: transcriptPath,
        proposed_action: { model: ACTIVE_MODEL, mcpServers: ["github", "linear"] },
        snapshot_context: { mcpServers: ["github"] },
      })
    );
    // CH-007 is the MCP server add/remove rule; the added server is "linear".
    const mcpFinding = out.findings.find(
      (f: { signal?: { added?: string[]; mcpServersAdded?: string[] } }) =>
        JSON.stringify(f.signal ?? {}).includes("linear")
    );
    expect(mcpFinding).toBeTruthy();
  });
});

describe("handleCacheHabitsFromTranscript — fail-safe & validation", () => {
  it("is fail-safe on a missing transcript: empty snapshot, model falls back to the proposal, no spurious switch", async () => {
    const out = JSON.parse(
      await handleCacheHabitsFromTranscript({
        transcript_path: path.join(testDir, "does-not-exist.jsonl"),
        proposed_action: { model: OTHER_MODEL },
      })
    );
    expect(out.error).toBeUndefined();
    expect(out.derived.transcriptHadTurns).toBe(false);
    expect(out.derived.turnsObserved).toBe(0);
    // currentModel falls back to the proposed model ⇒ CH-001 must NOT fire.
    expect(out.derived.currentModel).toBe(OTHER_MODEL);
    expect(out.findings.find((f: { ruleId: string }) => f.ruleId === "CH-001")).toBeUndefined();
  });

  it("never throws on a garbage transcript (malformed JSONL lines)", async () => {
    const garbage = path.join(testDir, "garbage.jsonl");
    fs.writeFileSync(garbage, "@@@ not json\n{not:valid}\n\n");
    const out = JSON.parse(
      await handleCacheHabitsFromTranscript({
        transcript_path: garbage,
        proposed_action: { model: ACTIVE_MODEL },
      })
    );
    expect(out.error).toBeUndefined();
    expect(out.derived.turnsObserved).toBe(0);
  });

  it("returns a JSON error (not a throw) when transcript_path is missing", async () => {
    const out = JSON.parse(
      await handleCacheHabitsFromTranscript({
        proposed_action: { model: ACTIVE_MODEL },
      } as never)
    );
    expect(typeof out.error).toBe("string");
  });

  it("returns a JSON error when proposed_action is absent", async () => {
    const out = JSON.parse(
      await handleCacheHabitsFromTranscript({
        transcript_path: transcriptPath,
      } as never)
    );
    expect(typeof out.error).toBe("string");
  });

  it("returns a JSON error when proposed_action.model is missing", async () => {
    const out = JSON.parse(
      await handleCacheHabitsFromTranscript({
        transcript_path: transcriptPath,
        proposed_action: { ttl: "5m" },
      })
    );
    expect(typeof out.error).toBe("string");
    expect(out.error).toContain("model");
  });

  it("is deterministic: identical inputs produce an identical response", async () => {
    const args = {
      transcript_path: transcriptPath,
      proposed_action: { model: OTHER_MODEL },
      snapshot_context: { currentTtl: "5m" as const },
    };
    const a = await handleCacheHabitsFromTranscript(args);
    const b = await handleCacheHabitsFromTranscript(args);
    expect(a).toBe(b);
  });
});
