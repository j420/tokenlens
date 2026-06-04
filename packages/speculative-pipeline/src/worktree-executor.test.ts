/**
 * Tests for the real read-only worktree executor (E5 / pending 2.2).
 *
 * The security invariants (confinement, read-only, bounded, abortable) are the
 * headline — a speculative executor that could escape the worktree or apply a
 * side effect would be categorically unsafe. We build a real throwaway tree on
 * disk and exercise Read/LS/Grep/Glob plus the adversarial escape attempts.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createWorktreeExecutor,
  globToRegExp,
  WorktreeSecurityError,
} from "./worktree-executor.js";
import { SpeculativeHost } from "./host.js";
import { flushMicrotasks } from "./test-harness.js";
import { speculationKey } from "./canonical-input.js";
import type { Speculation, ToolCall } from "./types.js";

let root: string;
let outside: string;
const cleanup: string[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "wt-root-"));
  outside = mkdtempSync(join(tmpdir(), "wt-out-"));
  cleanup.push(root, outside);
  // Tree:
  //   root/a.ts            "export const a = 1;\nconst secret = 2;\n"
  //   root/src/b.ts        "import {a} from '../a';\n"
  //   root/src/c.js        "console.log('c');\n"
  //   root/node_modules/x  (must be skipped by walks)
  writeFileSync(join(root, "a.ts"), "export const a = 1;\nconst secret = 2;\n");
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "b.ts"), "import {a} from '../a';\n");
  writeFileSync(join(root, "src", "c.js"), "console.log('c');\n");
  mkdirSync(join(root, "node_modules"));
  writeFileSync(join(root, "node_modules", "x.ts"), "should be skipped\n");
  // A secret file OUTSIDE the worktree, for escape tests.
  writeFileSync(join(outside, "secret.txt"), "TOP SECRET\n");
});

afterEach(() => {
  for (const d of cleanup.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

const call = (name: string, input: Record<string, unknown>): ToolCall => ({ name, input });

describe("Read", () => {
  it("reads a file inside the worktree and measures real elapsed time", async () => {
    const exec = createWorktreeExecutor(root);
    const out = await exec(call("Read", { file_path: "a.ts" }));
    expect(out.result).toContain("export const a = 1;");
    expect(typeof out.elapsedMs).toBe("number");
    expect(out.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("is deterministic — same call, identical bytes (byte-equality precondition)", async () => {
    const exec = createWorktreeExecutor(root);
    const a = await exec(call("Read", { file_path: "src/b.ts" }));
    const b = await exec(call("Read", { file_path: "src/b.ts" }));
    expect(a.result).toBe(b.result);
  });

  it("returns a clean not-found marker for a missing file (no throw)", async () => {
    const exec = createWorktreeExecutor(root);
    const out = await exec(call("Read", { file_path: "nope.ts" }));
    expect(out.result).toContain("[not found]");
  });

  it("truncates a file beyond the byte cap", async () => {
    writeFileSync(join(root, "big.txt"), "x".repeat(10_000));
    const exec = createWorktreeExecutor(root, { maxFileBytes: 100 });
    const out = await exec(call("Read", { file_path: "big.txt" }));
    expect(out.result).toContain("[truncated]");
    expect(out.result.length).toBeLessThan(200);
  });
});

describe("SECURITY: confinement", () => {
  it("rejects a ../ path escape", async () => {
    const exec = createWorktreeExecutor(root);
    await expect(exec(call("Read", { file_path: "../wt-out-x/secret.txt" }))).rejects.toBeInstanceOf(
      WorktreeSecurityError
    );
  });

  it("rejects an absolute path outside the root", async () => {
    const exec = createWorktreeExecutor(root);
    await expect(
      exec(call("Read", { file_path: join(outside, "secret.txt") }))
    ).rejects.toBeInstanceOf(WorktreeSecurityError);
  });

  it("rejects a deep traversal sequence", async () => {
    const exec = createWorktreeExecutor(root);
    await expect(
      exec(call("Read", { file_path: "src/../../../../etc/passwd" }))
    ).rejects.toBeInstanceOf(WorktreeSecurityError);
  });

  it("rejects following a symlink that points OUTSIDE the worktree", async () => {
    // root/escape -> outside  (a symlink leading out of the tree)
    symlinkSync(outside, join(root, "escape"));
    const exec = createWorktreeExecutor(root);
    await expect(
      exec(call("Read", { file_path: "escape/secret.txt" }))
    ).rejects.toBeInstanceOf(WorktreeSecurityError);
  });

  it("ALLOWS a symlink that stays inside the worktree", async () => {
    symlinkSync(join(root, "a.ts"), join(root, "link-a.ts"));
    const exec = createWorktreeExecutor(root);
    const out = await exec(call("Read", { file_path: "link-a.ts" }));
    expect(out.result).toContain("export const a = 1;");
  });

  // Regression: the recursive Grep/Glob walk must ALSO confine symlinks, not
  // just the explicit Read/LS path. A symlinked DIR pointing outside the root
  // previously leaked outside file contents (Grep) and listings (Glob).
  it("Grep does NOT follow a symlinked directory out of the worktree", async () => {
    writeFileSync(join(outside, "id_rsa"), "-----BEGIN PRIVATE KEY-----\nLEAKED\n");
    mkdirSync(join(outside, "sub"));
    writeFileSync(join(outside, "sub", "creds.env"), "AWS_SECRET=hunter2\n");
    symlinkSync(outside, join(root, "evil")); // symlinked dir → outside
    const exec = createWorktreeExecutor(root);
    const out = await exec(call("Grep", { pattern: "PRIVATE|SECRET" }));
    expect(out.result).not.toContain("LEAKED");
    expect(out.result).not.toContain("hunter2");
    expect(out.result).not.toContain("evil/");
  });

  it("Glob does NOT enumerate files through a symlinked directory out of the worktree", async () => {
    writeFileSync(join(outside, "id_rsa"), "secret\n");
    symlinkSync(outside, join(root, "evil"));
    const exec = createWorktreeExecutor(root);
    const out = await exec(call("Glob", { pattern: "**/*" }));
    expect(out.result.split("\n")).not.toContain("evil/id_rsa");
    expect(out.result).not.toContain("evil/");
  });

  it("Grep/Glob STILL walk an in-tree symlinked directory (functionality preserved)", async () => {
    mkdirSync(join(root, "real"));
    writeFileSync(join(root, "real", "inside.ts"), "const INSIDE_MARKER = 1;\n");
    symlinkSync(join(root, "real"), join(root, "linkdir")); // in-root symlinked dir
    const exec = createWorktreeExecutor(root);
    const grep = await exec(call("Grep", { pattern: "INSIDE_MARKER" }));
    // The real path is found; the symlinked view may also appear but never escapes.
    expect(grep.result).toContain("INSIDE_MARKER");
    expect(grep.result).toContain("real/inside.ts");
  });

  it("a symlink CYCLE inside the worktree terminates (bounded, no hang)", async () => {
    mkdirSync(join(root, "a"));
    writeFileSync(join(root, "a", "f.ts"), "x\n");
    symlinkSync(join(root, "a"), join(root, "a", "loop")); // a/loop -> a (cycle)
    const exec = createWorktreeExecutor(root);
    const out = await exec(call("Glob", { pattern: "**/*.ts" }));
    expect(out.result).toContain("a/f.ts"); // returns; did not hang
  });
});

describe("SECURITY: read-only — ineligible tools refused", () => {
  it.each(["Write", "Edit", "Bash", "NotebookEdit", "MultiEdit"])(
    "refuses %s outright",
    async (tool) => {
      const exec = createWorktreeExecutor(root);
      await expect(exec(call(tool, { file_path: "a.ts" }))).rejects.toBeInstanceOf(
        WorktreeSecurityError
      );
    }
  );
});

describe("LS / Glob / Grep", () => {
  it("LS lists a directory, marking subdirs with a trailing slash", async () => {
    const exec = createWorktreeExecutor(root);
    const out = await exec(call("LS", { path: "." }));
    expect(out.result).toContain("a.ts");
    expect(out.result).toContain("src/");
  });

  it("Glob matches **/*.ts and skips node_modules", async () => {
    const exec = createWorktreeExecutor(root);
    const out = await exec(call("Glob", { pattern: "**/*.ts" }));
    const lines = out.result.split("\n").filter(Boolean);
    expect(lines).toContain("a.ts");
    expect(lines).toContain("src/b.ts");
    expect(lines.some((l) => l.includes("node_modules"))).toBe(false);
    expect(lines).not.toContain("src/c.js"); // .js excluded by the pattern
  });

  it("Grep finds matching lines as file:line:text, bounded by maxMatches", async () => {
    const exec = createWorktreeExecutor(root);
    const out = await exec(call("Grep", { pattern: "const" }));
    expect(out.result).toMatch(/a\.ts:1:export const a = 1;/);
    // node_modules content is never scanned.
    expect(out.result).not.toContain("node_modules");
  });

  it("Grep surfaces an invalid regex as a clear error", async () => {
    const exec = createWorktreeExecutor(root);
    await expect(exec(call("Grep", { pattern: "(" }))).rejects.toThrow(/invalid pattern/);
  });
});

describe("abort", () => {
  it("throws AbortError when the signal is already aborted", async () => {
    const exec = createWorktreeExecutor(root);
    const controller = new AbortController();
    controller.abort();
    await expect(
      exec(call("Read", { file_path: "a.ts" }), controller.signal)
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("globToRegExp", () => {
  it("translates *, **, ? and escapes metachars", () => {
    expect(globToRegExp("*.ts").test("a.ts")).toBe(true);
    expect(globToRegExp("*.ts").test("src/a.ts")).toBe(false); // * doesn't cross /
    expect(globToRegExp("**/*.ts").test("src/a.ts")).toBe(true);
    expect(globToRegExp("**/*.ts").test("a.ts")).toBe(true);
    expect(globToRegExp("a?c").test("abc")).toBe(true);
    expect(globToRegExp("a?c").test("a/c")).toBe(false);
    // A literal dot must not act as regex `.`
    expect(globToRegExp("a.ts").test("axts")).toBe(false);
  });
});

describe("integration with SpeculativeHost", () => {
  function speculation(c: ToolCall): Speculation {
    return { call: c, key: speculationKey(c), probability: 1, source: "caller-candidate" };
  }

  it("speculatively executes the predicted Read; the result byte-matches the real read", async () => {
    const exec = createWorktreeExecutor(root);
    const host = new SpeculativeHost(exec);
    const priorCall = call("LS", { path: "." });
    const nextCall = call("Read", { file_path: "a.ts" });

    // Launch the speculation off-path and let the REAL executor settle it.
    host.beginTurn(priorCall, [speculation(nextCall)]);
    await flushMicrotasks();
    await flushMicrotasks();

    // Resolve the agent's real call; default sync-verify byte-checks the
    // speculation against a shadow run (both produced by this executor).
    const resolved = await host.resolve(nextCall);

    expect(resolved.result).toContain("export const a = 1;");
    // A real pipeline hit: the speculation byte-matched (sync-verify reports the
    // hit as gross "potential", net ~0 because the shadow was awaited).
    expect(resolved.source).toBe("verified-no-latency-saved");
    expect(resolved.speculativeElapsedMs).toBeGreaterThanOrEqual(0);
    expect(resolved.reconcile.hit).toBe(true);
    expect(resolved.reconcile.classification).toBe("hit");
  });

  it("falls through to a correct real execution on a speculation miss", async () => {
    const exec = createWorktreeExecutor(root);
    const host = new SpeculativeHost(exec);
    // Speculate a DIFFERENT read than the agent ends up making.
    host.beginTurn(call("LS", { path: "." }), [speculation(call("Read", { file_path: "src/b.ts" }))]);
    await flushMicrotasks();
    const resolved = await host.resolve(call("Read", { file_path: "src/c.js" }));
    expect(resolved.result).toContain("console.log('c');");
    expect(resolved.source).toBe("real-execution");
  });
});
