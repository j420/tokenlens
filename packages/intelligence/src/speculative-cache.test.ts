import { describe, expect, it } from "vitest";
import {
  contentToken,
  dirStatToken,
  isEligibleTool,
  isPureReadBash,
  scopeForToolUse,
  canonicalizeInput,
  SpeculativeCache,
  worktreeToken,
} from "./speculative-cache.js";

describe("eligibility (structural write-safety guarantee)", () => {
  it("read-only tools are eligible", () => {
    for (const t of ["Read", "Glob", "LS", "Grep"]) {
      expect(isEligibleTool(t)).toBe(true);
    }
  });

  it("write/destructive tools are NEVER eligible", () => {
    for (const t of ["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash"]) {
      expect(isEligibleTool(t)).toBe(false);
    }
  });

  it("scopeForToolUse returns null for write tools", () => {
    expect(scopeForToolUse("Write", { file_path: "a.ts" })).toBeNull();
    expect(scopeForToolUse("Edit", { file_path: "a.ts" })).toBeNull();
  });

  it("Bash is eligible only for pure-read forms with no write metachars", () => {
    expect(isPureReadBash("git log --oneline -10")).toBe(true);
    expect(isPureReadBash("cat package.json")).toBe(true);
    expect(isPureReadBash("ls -la src")).toBe(true);
    // write metacharacters disqualify even a read-looking command
    expect(isPureReadBash("cat a.txt > b.txt")).toBe(false);
    expect(isPureReadBash("git log | tee out.txt")).toBe(false);
    expect(isPureReadBash("cat a; rm b")).toBe(false);
    expect(isPureReadBash("echo $(rm -rf /)")).toBe(false);
    // non-read commands
    expect(isPureReadBash("npm install")).toBe(false);
    expect(isPureReadBash("rm file.txt")).toBe(false);
  });

  it("scopeForToolUse maps pure-read bash to BashReadOnly, writes to null", () => {
    expect(scopeForToolUse("Bash", { command: "git diff" })).toBe(
      "BashReadOnly"
    );
    expect(scopeForToolUse("Bash", { command: "rm -rf node_modules" })).toBeNull();
  });
});

describe("canonicalizeInput", () => {
  it("normalizes equivalent Read paths to the same key", () => {
    const a = canonicalizeInput("Read", { file_path: "src/app.ts" });
    const b = canonicalizeInput("Read", { file_path: "src/app.ts/" });
    expect(a).toBe(b);
  });

  it("distinguishes different grep patterns", () => {
    const a = canonicalizeInput("Grep", { pattern: "foo", path: "src" });
    const b = canonicalizeInput("Grep", { pattern: "bar", path: "src" });
    expect(a).not.toBe(b);
  });
});

describe("SpeculativeCache.decide", () => {
  it("misses when nothing cached", () => {
    const cache = new SpeculativeCache();
    const d = cache.decide("Read", { file_path: "a.ts" }, contentToken("x"));
    expect(d.substitute).toBe(false);
    expect(d.reason).toContain("cache miss");
  });

  it("substitutes when freshness token matches", () => {
    const cache = new SpeculativeCache();
    const content = "export const x = 1;";
    cache.store("Read", { file_path: "a.ts" }, content, contentToken(content), 1);
    const d = cache.decide(
      "Read",
      { file_path: "a.ts" },
      contentToken(content)
    );
    expect(d.substitute).toBe(true);
    expect(d.result).toBe(content);
    expect(d.estimatedTokensSaved).toBeGreaterThan(0);
  });

  it("refuses substitution when the source changed (token differs)", () => {
    const cache = new SpeculativeCache();
    const original = "export const x = 1;";
    cache.store("Read", { file_path: "a.ts" }, original, contentToken(original), 1);
    // File now has different content ⇒ different token.
    const changed = contentToken("export const x = 2;");
    const d = cache.decide("Read", { file_path: "a.ts" }, changed);
    expect(d.substitute).toBe(false);
    expect(d.reason).toContain("source changed");
  });

  it("refuses substitution when no freshness probe is supplied", () => {
    const cache = new SpeculativeCache();
    const content = "data";
    cache.store("Read", { file_path: "a.ts" }, content, contentToken(content), 1);
    const d = cache.decide("Read", { file_path: "a.ts" }, null);
    expect(d.substitute).toBe(false);
    expect(d.reason).toContain("no freshness probe");
  });

  it("does not substitute for a scope that is not enabled", () => {
    const cache = new SpeculativeCache({ enabledScopes: ["Read"] });
    cache.store("Grep", { pattern: "x", path: "src" }, "match", {
      kind: "dir-stat",
      value: "1:1",
    }, 1);
    const d = cache.decide(
      "Grep",
      { pattern: "x", path: "src" },
      dirStatToken(1, 1)
    );
    expect(d.substitute).toBe(false);
    expect(d.reason).toContain("not enabled");
  });

  it("substitutes Glob/Grep when those scopes are enabled and dir unchanged", () => {
    const cache = new SpeculativeCache({ enabledScopes: ["Read", "Grep"] });
    cache.store(
      "Grep",
      { pattern: "TODO", path: "src" },
      "src/a.ts:1:TODO",
      dirStatToken(1000, 5),
      1
    );
    const d = cache.decide(
      "Grep",
      { pattern: "TODO", path: "src" },
      dirStatToken(1000, 5)
    );
    expect(d.substitute).toBe(true);
  });
});

describe("SpeculativeCache verification + auto-disable", () => {
  it("auto-disables a scope when miss-rate exceeds threshold", () => {
    const cache = new SpeculativeCache({
      missRateThreshold: 0.02,
      windowSize: 100,
    });
    // 98 hits, 2 misses = 2% — at threshold, not over.
    for (let i = 0; i < 98; i++) cache.recordVerification("Read", true);
    cache.recordVerification("Read", false);
    cache.recordVerification("Read", false);
    expect(cache.isScopeDisabled("Read")).toBe(false);
    // One more miss pushes to 3/101→ but window caps at 100. Add misses to exceed.
    for (let i = 0; i < 5; i++) cache.recordVerification("Read", false);
    expect(cache.stats("Read").missRate).toBeGreaterThan(0.02);
    expect(cache.isScopeDisabled("Read")).toBe(true);
  });

  it("does not trip on a single early miss (n<10)", () => {
    const cache = new SpeculativeCache({ missRateThreshold: 0.02 });
    cache.recordVerification("Read", false);
    expect(cache.isScopeDisabled("Read")).toBe(false);
  });

  it("a disabled scope refuses substitution even with a fresh hit", () => {
    const cache = new SpeculativeCache({ missRateThreshold: 0.02 });
    const content = "data";
    cache.store("Read", { file_path: "a.ts" }, content, contentToken(content), 1);
    // Force disable.
    for (let i = 0; i < 20; i++) cache.recordVerification("Read", false);
    expect(cache.isScopeDisabled("Read")).toBe(true);
    const d = cache.decide("Read", { file_path: "a.ts" }, contentToken(content));
    expect(d.substitute).toBe(false);
    expect(d.reason).toContain("auto-disabled");
  });

  it("re-enables after cooldown elapses", () => {
    const cache = new SpeculativeCache({
      missRateThreshold: 0.02,
      cooldownMs: 1000,
    });
    const t0 = 10_000;
    for (let i = 0; i < 20; i++) cache.recordVerification("Read", false, t0);
    expect(cache.isScopeDisabled("Read", t0)).toBe(true);
    // After cooldown.
    expect(cache.isScopeDisabled("Read", t0 + 2000)).toBe(false);
  });

  it("tracks stats accurately", () => {
    const cache = new SpeculativeCache();
    for (let i = 0; i < 10; i++) cache.recordVerification("Read", true);
    cache.recordVerification("Read", false);
    const s = cache.stats("Read");
    expect(s.substitutions).toBe(11);
    expect(s.misses).toBe(1);
    expect(s.missRate).toBeCloseTo(1 / 11, 5);
  });
});

describe("SpeculativeCache.invalidate", () => {
  it("drops a cached entry so subsequent decide misses", () => {
    const cache = new SpeculativeCache();
    const content = "data";
    cache.store("Read", { file_path: "a.ts" }, content, contentToken(content), 1);
    expect(cache.size()).toBe(1);
    cache.invalidate("Read", { file_path: "a.ts" });
    expect(cache.size()).toBe(0);
    const d = cache.decide("Read", { file_path: "a.ts" }, contentToken(content));
    expect(d.substitute).toBe(false);
  });
});

describe("freshness tokens", () => {
  it("content token is content-addressed", () => {
    expect(contentToken("abc").value).toBe(contentToken("abc").value);
    expect(contentToken("abc").value).not.toBe(contentToken("abd").value);
  });

  it("worktree token reflects ls-files output", () => {
    expect(worktreeToken("a b c").value).not.toBe(worktreeToken("a b d").value);
  });
});
