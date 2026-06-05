import { describe, it, expect, afterEach } from "vitest";
import { existsSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  emptyStore,
  sessionStorePath,
  readSessionStore,
  updateSessionStore,
} from "./_session-store.mjs";

// Unique key per run so tests never collide with a real session.
const KEY = `/tmp/test-transcript-${process.pid}-${Date.now()}.jsonl`;

afterEach(() => {
  try {
    rmSync(sessionStorePath(KEY), { force: true });
  } catch {
    /* ignore */
  }
});

describe("_session-store", () => {
  it("emptyStore has the expected shape", () => {
    const s = emptyStore();
    expect(s.seq).toBe(0);
    expect(s.fileTimeline).toEqual([]);
    expect(s.sources).toEqual([]);
    expect(s.actions).toEqual([]);
    expect(s.lastUntrustedSourceId).toBeNull();
  });

  it("sessionStorePath is deterministic and key-specific", () => {
    expect(sessionStorePath(KEY)).toBe(sessionStorePath(KEY));
    expect(sessionStorePath(KEY)).not.toBe(sessionStorePath(KEY + "x"));
  });

  it("returns a fresh default when no file exists", () => {
    const s = readSessionStore(KEY);
    expect(s.seq).toBe(0);
    expect(s.fileTimeline).toEqual([]);
  });

  it("persists mutations atomically and reads them back", () => {
    updateSessionStore(KEY, (s) => {
      s.seq += 1;
      s.fileTimeline.push({ turn: s.seq, path: "a.ts", sha: "AAA" });
    });
    const s = readSessionStore(KEY);
    expect(s.seq).toBe(1);
    expect(s.fileTimeline).toHaveLength(1);
    expect(s.fileTimeline[0]).toEqual({ turn: 1, path: "a.ts", sha: "AAA" });
  });

  it("accumulates across updates", () => {
    updateSessionStore(KEY, (s) => {
      s.seq += 1;
      s.fileTimeline.push({ turn: s.seq, path: "a.ts", sha: "A" });
    });
    updateSessionStore(KEY, (s) => {
      s.seq += 1;
      s.fileTimeline.push({ turn: s.seq, path: "a.ts", sha: "B" });
    });
    const s = readSessionStore(KEY);
    expect(s.seq).toBe(2);
    expect(s.fileTimeline.map((e) => e.sha)).toEqual(["A", "B"]);
  });

  it("recovers from a corrupt file with a fresh default (never throws)", () => {
    const p = sessionStorePath(KEY);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, "{ not valid json ", "utf8");
    const s = readSessionStore(KEY);
    expect(s.seq).toBe(0);
    expect(s.fileTimeline).toEqual([]);
  });

  it("a throwing mutator does not break the store", () => {
    expect(() =>
      updateSessionStore(KEY, () => {
        throw new Error("boom");
      })
    ).not.toThrow();
    expect(existsSync(sessionStorePath(KEY))).toBe(true);
  });
});
