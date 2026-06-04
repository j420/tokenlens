/**
 * Tests for the Prune hook installer's PURE planner.
 *
 * Run on demand (the extension package has no turbo `test` task):
 *   npx vitest run apps/extension/hooks/install.test.mjs
 */

import { describe, it, expect } from "vitest";
import {
  HOOK_REGISTRY,
  hookCommand,
  computeHooksInstall,
} from "./install.mjs";

const HOOKS_DIR = "/abs/hooks";

function eventCommands(settings, event) {
  return (settings.hooks[event] || []).flatMap((e) =>
    (e.hooks || []).map((h) => h.command)
  );
}

describe("HOOK_REGISTRY", () => {
  it("references real hook files only (.mjs, no private/_ files)", () => {
    for (const r of HOOK_REGISTRY) {
      expect(r.file).toMatch(/^[a-z-]+\.mjs$/);
      expect(r.file.startsWith("_")).toBe(false);
      expect(["UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop", "PostCompact"]).toContain(
        r.event
      );
    }
  });

  it("orders budget-gate BEFORE slo-breaker within Stop (charge then evaluate)", () => {
    const stop = HOOK_REGISTRY.filter((r) => r.event === "Stop").map((r) => r.file);
    expect(stop.indexOf("budget-gate.mjs")).toBeLessThan(stop.indexOf("slo-breaker.mjs"));
    expect(stop.indexOf("budget-gate.mjs")).toBeGreaterThanOrEqual(0);
  });

  it("carries the documented matchers (subagent-warden=Task, speculative-record=Read)", () => {
    const warden = HOOK_REGISTRY.find((r) => r.file === "subagent-warden.mjs");
    expect(warden).toMatchObject({ event: "PreToolUse", matcher: "Task" });
    const specRec = HOOK_REGISTRY.find((r) => r.file === "speculative-record.mjs");
    expect(specRec).toMatchObject({ event: "PostToolUse", matcher: "Read" });
  });
});

describe("computeHooksInstall — fresh install", () => {
  it("adds every registry entry to an empty settings object", () => {
    const { settings, added, skipped } = computeHooksInstall({}, { hooksDir: HOOKS_DIR });
    expect(added).toHaveLength(HOOK_REGISTRY.length);
    expect(skipped).toHaveLength(0);
    // Each command is `node <hooksDir>/<file>`.
    const stopCmds = eventCommands(settings, "Stop");
    expect(stopCmds).toContain(hookCommand(HOOKS_DIR, "budget-gate.mjs"));
  });

  it("sets matcher on tool-scoped entries and omits it otherwise", () => {
    const { settings } = computeHooksInstall({}, { hooksDir: HOOKS_DIR });
    const pre = settings.hooks.PreToolUse;
    const warden = pre.find((e) =>
      e.hooks.some((h) => h.command.endsWith("subagent-warden.mjs"))
    );
    expect(warden.matcher).toBe("Task");
    const traj = pre.find((e) =>
      e.hooks.some((h) => h.command.endsWith("trajectory-diet.mjs"))
    );
    expect(traj.matcher).toBeUndefined();
  });

  it("produces the canonical command shape { type: 'command', command }", () => {
    const { settings } = computeHooksInstall({}, { hooksDir: HOOKS_DIR });
    const entry = settings.hooks.Stop[0];
    expect(entry.hooks[0].type).toBe("command");
    expect(entry.hooks[0].command).toMatch(/^node \/abs\/hooks\/[a-z-]+\.mjs$/);
  });
});

describe("computeHooksInstall — idempotency", () => {
  it("a second run over its own output adds nothing", () => {
    const first = computeHooksInstall({}, { hooksDir: HOOKS_DIR });
    const second = computeHooksInstall(first.settings, { hooksDir: HOOKS_DIR });
    expect(second.added).toHaveLength(0);
    expect(second.skipped).toHaveLength(HOOK_REGISTRY.length);
    // No duplication: Stop command count is stable across runs.
    expect(eventCommands(second.settings, "Stop")).toEqual(
      eventCommands(first.settings, "Stop")
    );
  });

  it("only the MISSING hooks are added when some are already present", () => {
    // Pre-seed just budget-gate on Stop.
    const seeded = {
      hooks: {
        Stop: [
          {
            hooks: [
              { type: "command", command: hookCommand(HOOKS_DIR, "budget-gate.mjs") },
            ],
          },
        ],
      },
    };
    const { added, skipped } = computeHooksInstall(seeded, { hooksDir: HOOKS_DIR });
    expect(skipped.map((s) => s.file)).toContain("budget-gate.mjs");
    expect(added.map((s) => s.file)).not.toContain("budget-gate.mjs");
    expect(added.length).toBe(HOOK_REGISTRY.length - 1);
  });
});

describe("computeHooksInstall — non-destructive", () => {
  it("preserves unrelated top-level settings and a user's own hook", () => {
    const existing = {
      model: "claude-opus-4-5",
      permissions: { allow: ["Bash(npm:*)"] },
      hooks: {
        Stop: [
          { hooks: [{ type: "command", command: "node /my/own/hook.mjs" }] },
        ],
      },
    };
    const { settings } = computeHooksInstall(existing, { hooksDir: HOOKS_DIR });
    expect(settings.model).toBe("claude-opus-4-5");
    expect(settings.permissions).toEqual({ allow: ["Bash(npm:*)"] });
    // The user's own Stop hook is still there...
    expect(eventCommands(settings, "Stop")).toContain("node /my/own/hook.mjs");
    // ...alongside the Prune ones.
    expect(eventCommands(settings, "Stop")).toContain(
      hookCommand(HOOKS_DIR, "budget-gate.mjs")
    );
  });

  it("does not mutate the input object", () => {
    const existing = { hooks: { Stop: [] } };
    const snapshot = JSON.stringify(existing);
    computeHooksInstall(existing, { hooksDir: HOOKS_DIR });
    expect(JSON.stringify(existing)).toBe(snapshot);
  });

  it("repairs a malformed hooks field instead of throwing", () => {
    const { settings, added } = computeHooksInstall(
      { hooks: "garbage" },
      { hooksDir: HOOKS_DIR }
    );
    expect(typeof settings.hooks).toBe("object");
    expect(added.length).toBe(HOOK_REGISTRY.length);
  });

  it("tolerates a non-object settings input", () => {
    expect(() => computeHooksInstall(null, { hooksDir: HOOKS_DIR })).not.toThrow();
    const { added } = computeHooksInstall(null, { hooksDir: HOOKS_DIR });
    expect(added.length).toBe(HOOK_REGISTRY.length);
  });
});
