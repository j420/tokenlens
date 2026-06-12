import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  classifyFiles,
  candidateFromCommit,
  mineCandidates,
  DEFAULT_TEST_SUFFIXES,
  DEFAULT_TEST_DIRS,
} from "./mine.js";
import { CandidateCommitSchema } from "./types.js";

// ============================================================================
// Pure classification
// ============================================================================

describe("classifyFiles", () => {
  const opts = { limit: 1, groupPrefixes: ["packages/", "apps/"] };

  it("splits impl and tests within the same group", () => {
    const m = classifyFiles(
      ["packages/foo/src/a.ts", "packages/foo/src/a.test.ts"],
      opts
    );
    expect(m.get("packages/foo")).toEqual({
      impl: ["packages/foo/src/a.ts"],
      tests: ["packages/foo/src/a.test.ts"],
    });
  });

  it("detects tests by suffix (.spec, _test.go, _test.py) and by test directory segment", () => {
    const m = classifyFiles(
      [
        "packages/p/src/x.spec.ts",
        "packages/p/pkg_test.go",
        "packages/p/mod_test.py",
        "packages/p/__tests__/y.ts",
        "packages/p/test/z.js",
      ],
      opts
    );
    expect(m.get("packages/p")?.tests).toHaveLength(5);
    expect(m.get("packages/p")?.impl).toHaveLength(0);
  });

  it("a FILE literally named 'test' is not a test directory", () => {
    const m = classifyFiles(["packages/p/test", "packages/p/src/test"], opts);
    expect(m.get("packages/p")?.impl).toEqual([
      "packages/p/test",
      "packages/p/src/test",
    ]);
  });

  it("groups by prefix; non-matching paths fall back to top-level dir; root files group as '.'", () => {
    const m = classifyFiles(
      ["packages/a/x.ts", "src/y.ts", "README.md", "apps/web/page.tsx"],
      opts
    );
    expect([...m.keys()].sort()).toEqual([".", "apps/web", "packages/a", "src"]);
  });

  it("a file directly under a prefix groups as the prefix itself", () => {
    const m = classifyFiles(["packages/README.md"], opts);
    expect([...m.keys()]).toEqual(["packages"]);
  });

  it("normalizes a prefix without a trailing slash (no sibling substring matches)", () => {
    // Without normalization, prefix "packages" would substring-match
    // "packages-extra/x.ts" into a phantom group "packages-extra".
    const m = classifyFiles(
      ["packages/foo/a.ts", "packages-extra/b.ts"],
      { limit: 1, groupPrefixes: ["packages"] }
    );
    expect([...m.keys()].sort()).toEqual(["packages-extra", "packages/foo"]);
  });

  it("default suffix/dir tables are used when none are supplied", () => {
    const m = classifyFiles(["a.test.ts", "lib/util.ts"], { limit: 1 });
    expect(m.get(".")?.tests).toEqual(["a.test.ts"]);
    expect(m.get("lib")?.impl).toEqual(["lib/util.ts"]);
    expect(DEFAULT_TEST_SUFFIXES).toContain(".spec.ts");
    expect(DEFAULT_TEST_DIRS).toContain("__tests__");
  });
});

describe("candidateFromCommit", () => {
  const meta = {
    sha: "a".repeat(40),
    parentSha: "b".repeat(40),
    date: "2026-06-11",
    subject: "fix: thing",
    body: "details",
  };
  const files = {
    impl: ["packages/foo/src/a.ts"],
    tests: ["packages/foo/src/a.test.ts"],
  };

  it("emits a null oracle command without a template — never guesses a runner", () => {
    const c = candidateFromCommit(meta, "packages/foo", files, { limit: 1 });
    expect(c.suggestedOracleCmd).toBeNull();
    expect(CandidateCommitSchema.parse(c)).toBeTruthy();
  });

  it("expands {tests} group-relative when a template is supplied", () => {
    const c = candidateFromCommit(meta, "packages/foo", files, {
      limit: 1,
      oracleTemplate: "npx vitest run {tests}",
    });
    expect(c.suggestedOracleCmd).toBe("npx vitest run src/a.test.ts");
    expect(c.suggestedOracleCwd).toBe("packages/foo");
  });

  it("the schema has no prompt field — a fabricated prompt is unrepresentable", () => {
    const c = candidateFromCommit(meta, "packages/foo", files, { limit: 1 });
    expect("prompt" in c).toBe(false);
    expect(
      CandidateCommitSchema.safeParse({ ...c, prompt: "fake" }).success
    ).toBe(false); // strict schema rejects extra keys
  });
});

// ============================================================================
// Real temp git repo
// ============================================================================

describe("mineCandidates (temp git repo)", () => {
  let repo: string;

  const git = (...args: string[]): string => {
    const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    return r.stdout.trim();
  };
  const commitAll = (msg: string): string => {
    git("add", ".");
    git("commit", "-qm", msg);
    return git("rev-parse", "HEAD");
  };
  const write = (rel: string, content: string): void => {
    const p = join(repo, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  };

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "repo-proof-mine-"));
    git("init", "-q");
    git("config", "user.email", "t@t");
    git("config", "user.name", "t");
    git("config", "commit.gpgsign", "false");

    write("pkg/lib/core.ts", "export const v = 1;\n");
    commitAll("root: impl only"); // root commit — skipped (no parent)
    write("pkg/lib/core.ts", "export const v = 2;\n");
    write("pkg/lib/core.test.ts", "// test\n");
    commitAll("fix: core with test | has a pipe and unicode ✓"); // candidate
    write("docs/readme.md", "docs\n");
    commitAll("docs only"); // no candidate (impl without tests is still scanned)
    write("pkg/lib/other.test.ts", "// test only\n");
    commitAll("test: add coverage"); // tests without impl — not a candidate
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("finds exactly the impl+test commit, with real parent SHA and intact subject", () => {
    const result = mineCandidates(repo, { limit: 50, groupPrefixes: ["pkg/"] });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.candidates).toHaveLength(1);
    const c = result.candidates[0];
    expect(c.subject).toBe("fix: core with test | has a pipe and unicode ✓");
    expect(c.group).toBe("pkg/lib");
    expect(c.implFiles).toEqual(["pkg/lib/core.ts"]);
    expect(c.testFiles).toEqual(["pkg/lib/core.test.ts"]);
    // parentSha is the REAL parent, resolvable in the repo.
    const parent = spawnSync(
      "git",
      ["-C", repo, "rev-parse", `${c.commit}~1`],
      { encoding: "utf8" }
    ).stdout.trim();
    expect(c.suggestedBaseCommit).toBe(parent);
    expect(c.suggestedOracleCmd).toBeNull();
    // Every candidate round-trips the schema.
    expect(CandidateCommitSchema.parse(c)).toBeTruthy();
  });

  it("coverage counts every scanned group, including zero-candidate ones, and notes the root commit", () => {
    const result = mineCandidates(repo, { limit: 50, groupPrefixes: ["pkg/"] });
    if ("error" in result) throw new Error(result.error);
    const byGroup = new Map(result.coverage.map((r) => [r.group, r]));
    expect(byGroup.get("pkg/lib")?.candidates).toBe(1);
    expect(byGroup.get("pkg/lib")?.commitsScanned).toBe(2); // fix + test-only (root skipped)
    expect(byGroup.get("docs")?.candidates).toBe(0); // unprovable group, still reported
    expect(result.notes.some((n) => n.includes("root commit"))).toBe(true);
  });

  it("returns a typed error (not a throw) for a non-repo", () => {
    const result = mineCandidates(join(tmpdir(), "definitely-not-a-repo-xyz"), {
      limit: 5,
    });
    expect("error" in result).toBe(true);
  });
});

describe("mineCandidates (smoke against this repository, read-only)", () => {
  // Resolve the monorepo root relative to THIS test file (src is three levels
  // below root: src → repo-proof → packages → root), so the smoke runs from
  // any checkout location — CI runner, dev box, worktree — never a hardcoded
  // /home/user/tokenlens dev path. (The earlier hardcode broke CI, where the
  // checkout lives under /home/runner/work.)
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

  /** Total reachable commits — 1 on a shallow (fetch-depth: 1) checkout. */
  const historyDepth = (): number => {
    const r = spawnSync("git", ["-C", repoRoot, "rev-list", "--count", "HEAD"], {
      encoding: "utf8",
    });
    return r.status === 0 ? Number(r.stdout.trim()) : 0;
  };

  it("produces schema-valid candidates from real history (depth-adaptive)", () => {
    const result = mineCandidates(repoRoot, {
      limit: 200,
      groupPrefixes: ["packages/", "apps/"],
    });
    // An error here means the resolved root is not a git repo — in this
    // monorepo's own test runs it always is, so surface it loudly rather
    // than masking a path-resolution regression.
    if ("error" in result) throw new Error(result.error);

    // Whatever the miner returned must be honest regardless of clone depth:
    // every candidate validates against the schema, and an unknown test
    // runner is never guessed.
    for (const c of result.candidates) {
      expect(CandidateCommitSchema.safeParse(c).success).toBe(true);
      expect(c.suggestedOracleCmd).toBeNull();
    }
    expect(Array.isArray(result.coverage)).toBe(true);

    // The strict "found something" assertion only has meaning with real
    // history. CI checks out full history (fetch-depth: 0) and dev machines
    // have it; a shallow depth-1 clone legitimately yields zero candidates,
    // so gate the assertion on depth instead of fabricating a pass.
    if (historyDepth() >= 30) {
      expect(result.candidates.length).toBeGreaterThan(0);
    }
  });
});
