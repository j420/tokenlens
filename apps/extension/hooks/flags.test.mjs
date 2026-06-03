/**
 * Tests for the feature-flag promotion CLI (flags.mjs).
 *
 * Pure logic (parseArgs / applyCommand / formatList) plus the full run()
 * round-trip against a temp flag file. Adversarial: unknown id/name, bad mode,
 * extra args, malformed pre-existing file, and the atomic-write durability.
 *
 * Not wired into a turbo task (the extension package has no vitest runner and
 * we must keep the 64-task count). Run on demand:
 *   npx vitest run apps/extension/hooks/flags.test.mjs
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parseArgs,
  applyCommand,
  formatList,
  readFlags,
  run,
} from "./flags.mjs";
import { validateFlags } from "@prune/shared";

const dirs = [];
function tmpPath() {
  const dir = mkdtempSync(join(tmpdir(), "prune-flags-"));
  dirs.push(dir);
  return join(dir, "feature-flags.json");
}
function capture() {
  const buf = { out: "", err: "" };
  return {
    buf,
    out: (s) => (buf.out += s),
    err: (s) => (buf.err += s),
  };
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

describe("parseArgs", () => {
  it("help on empty / help / -h", () => {
    expect(parseArgs([]).kind).toBe("help");
    expect(parseArgs(["help"]).kind).toBe("help");
    expect(parseArgs(["-h"]).kind).toBe("help");
  });
  it("list takes no args", () => {
    expect(parseArgs(["list"]).kind).toBe("list");
    expect(parseArgs(["list", "extra"]).error).toBeTruthy();
  });
  it("enable by id and by name", () => {
    expect(parseArgs(["enable", "f10", "general"])).toEqual({
      kind: "enable",
      id: "f10",
      mode: "general",
    });
    expect(parseArgs(["enable", "mcpProxy", "canary"])).toEqual({
      kind: "enable",
      id: "f10",
      mode: "canary",
    });
  });
  it("enable refuses an unknown id/name", () => {
    expect(parseArgs(["enable", "f99", "general"]).error).toContain("unknown feature");
    expect(parseArgs(["enable", "nope", "general"]).error).toContain("unknown feature");
  });
  it("enable refuses a non-promotable mode (shadow/disabled)", () => {
    expect(parseArgs(["enable", "f10", "shadow"]).error).toContain("invalid mode");
    expect(parseArgs(["enable", "f10", "disabled"]).error).toContain("invalid mode");
  });
  it("enable requires both args", () => {
    expect(parseArgs(["enable", "f10"]).error).toBeTruthy();
    expect(parseArgs(["enable"]).error).toBeTruthy();
  });
  it("disable by id/name, exactly one arg", () => {
    expect(parseArgs(["disable", "f12"])).toEqual({ kind: "disable", id: "f12" });
    expect(parseArgs(["disable", "skillLibrary"])).toEqual({ kind: "disable", id: "f12" });
    expect(parseArgs(["disable"]).error).toBeTruthy();
    expect(parseArgs(["disable", "f12", "x"]).error).toBeTruthy();
  });
  it("rejects an unknown subcommand", () => {
    expect(parseArgs(["frobnicate"]).error).toContain("unknown subcommand");
  });
});

describe("applyCommand", () => {
  const base = validateFlags(null);
  it("enable sets enabled+mode and never touches other features", () => {
    const next = applyCommand(base, { kind: "enable", id: "f10", mode: "canary" });
    expect(next.features.f10).toMatchObject({ enabled: true, mode: "canary" });
    expect(next.features.f9).toEqual(base.features.f9);
    expect(next.policySource).toBe("local");
  });
  it("disable sets enabled=false + mode=disabled", () => {
    const enabled = applyCommand(base, { kind: "enable", id: "f11", mode: "general" });
    const next = applyCommand(enabled, { kind: "disable", id: "f11" });
    expect(next.features.f11).toMatchObject({ enabled: false, mode: "disabled" });
  });
});

describe("formatList", () => {
  it("marks LIVE only enabled general/canary features", () => {
    const flags = validateFlags(null); // f5 is general+enabled
    const text = formatList(flags);
    expect(text).toMatch(/f5\s+hud.*LIVE/);
    expect(text).toMatch(/f10\s+mcpProxy.*mode=shadow/);
    expect(text.split("\n").filter((l) => l.endsWith("LIVE"))).toHaveLength(1);
  });
});

describe("run — round-trip", () => {
  it("enable persists and is readable back; idempotent re-write", () => {
    const path = tmpPath();
    const c1 = capture();
    expect(run(["enable", "f10", "canary"], { env: { PRUNE_FLAGS_PATH: path }, ...c1 })).toBe(0);
    expect(c1.buf.out).toContain("f10 (mcpProxy) → enabled=true mode=canary");

    const onDisk = readFlags(path);
    expect(onDisk.features.f10).toMatchObject({ enabled: true, mode: "canary" });
    expect(onDisk.policySource).toBe("local");

    // Re-run identical command — stable result.
    const c2 = capture();
    expect(run(["enable", "f10", "canary"], { env: { PRUNE_FLAGS_PATH: path }, ...c2 })).toBe(0);
    expect(readFlags(path).features.f10).toMatchObject({ enabled: true, mode: "canary" });
  });

  it("disable persists", () => {
    const path = tmpPath();
    run(["enable", "f12", "general"], { env: { PRUNE_FLAGS_PATH: path }, ...capture() });
    const c = capture();
    expect(run(["disable", "f12"], { env: { PRUNE_FLAGS_PATH: path }, ...c })).toBe(0);
    expect(readFlags(path).features.f12).toMatchObject({ enabled: false, mode: "disabled" });
  });

  it("list prints without mutating the file", () => {
    const path = tmpPath();
    const c = capture();
    expect(run(["list"], { env: { PRUNE_FLAGS_PATH: path }, ...c })).toBe(0);
    expect(c.buf.out).toContain("f5    hud");
  });

  it("unknown id ⇒ exit 1, nothing written", () => {
    const path = tmpPath();
    const c = capture();
    expect(run(["enable", "f99", "general"], { env: { PRUNE_FLAGS_PATH: path }, ...c })).toBe(1);
    expect(c.buf.err).toContain("unknown feature");
    // No file created.
    expect(() => readFileSync(path, "utf8")).toThrow();
  });

  it("bad mode ⇒ exit 1", () => {
    const path = tmpPath();
    const c = capture();
    expect(run(["enable", "f10", "shadow"], { env: { PRUNE_FLAGS_PATH: path }, ...c })).toBe(1);
    expect(c.buf.err).toContain("invalid mode");
  });

  it("repairs a malformed pre-existing file to defaults before mutating", () => {
    const path = tmpPath();
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "{ this is : not json", "utf8");
    const c = capture();
    expect(run(["enable", "f9", "general"], { env: { PRUNE_FLAGS_PATH: path }, ...c })).toBe(0);
    const onDisk = readFlags(path);
    // f9 mutated, f5 default (general) preserved — the file is now valid.
    expect(onDisk.features.f9).toMatchObject({ enabled: true, mode: "general" });
    expect(onDisk.features.f5).toMatchObject({ enabled: true, mode: "general" });
    expect(onDisk.version).toBe(1);
  });

  it("help ⇒ exit 0", () => {
    const c = capture();
    expect(run([], { env: {}, ...c })).toBe(0);
    expect(c.buf.out).toContain("promote/demote");
  });
});
