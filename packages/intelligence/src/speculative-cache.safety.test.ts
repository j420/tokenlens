/**
 * Adversarial write-safety tests for the F3 bash read-classifier.
 *
 * F3 substitutes a cached result for a "pure read" command. If a command that
 * can WRITE or EXECUTE is misclassified as a read, it enters the substitution
 * cache — a direct quality/safety hazard. Every command below that can mutate
 * state MUST be rejected. Several were real bugs found by adversarial probing
 * and fixed (`find -delete`, `find -exec`, newline-smuggled chains).
 */

import { describe, expect, it } from "vitest";
import {
  contentToken,
  dirStatToken,
  fileListStatToken,
  isPureReadBash,
  scopeForToolUse,
  SpeculativeCache,
} from "./speculative-cache.js";

describe("F3 bash classifier — must REJECT anything that can write/execute", () => {
  const mustReject = [
    ["find . -type f -delete", "find -delete removes files"],
    ["find . -type f -exec rm {} ;", "find -exec runs commands"],
    ["find . -type f -exec cat {} +", "find -exec executes"],
    ["find . -type f -execdir mv {} /tmp ;", "find -execdir"],
    ["find . -type f -ok rm {} ;", "find -ok"],
    ["find . -type f -fprint out.txt", "find -fprint writes a file"],
    ["cat a.txt > b.txt", "stdout redirect"],
    ["cat a.txt >> b.txt", "append redirect"],
    ["cat < input", "stdin redirect"],
    ["cat a.txt | sh", "pipe to shell"],
    ["cat a.txt && rm b", "&& chain"],
    ["cat a.txt; rm b", "; chain"],
    ["cat a.txt & rm b", "& background"],
    ["cat $(rm -rf /)", "command substitution $()"],
    ["cat `whoami`", "backtick substitution"],
    ["cat a\nrm b", "newline-smuggled command"],
    ["cat a\r\nrm b", "CRLF-smuggled command"],
    ["git stash", "git stash mutates"],
    ["git checkout main", "git checkout mutates"],
    ["git commit -m x", "git commit"],
    ["git reset --hard", "git reset"],
    ["sed -i 's/a/b/' f", "sed -i edits in place"],
    ["rm file.txt", "rm"],
    ["npm install", "npm install"],
    ["echo hi > f", "echo redirect"],
    ["tee out.txt", "tee writes"],
    ["sort f.txt", "sort not in allowlist"],
    ["mv a b", "mv"],
    ["cp a b", "cp"],
    ["chmod +x f", "chmod"],
  ];
  for (const [cmd, why] of mustReject) {
    it(`rejects: ${why}`, () => {
      expect(isPureReadBash(cmd)).toBe(false);
      // And it must not yield a substitution scope via the Bash path.
      expect(scopeForToolUse("Bash", { command: cmd })).toBeNull();
    });
  }
});

describe("F3 bash classifier — ACCEPTS genuine pure reads", () => {
  const mustAccept = [
    "git log --oneline -20",
    "git diff HEAD~1",
    "git show abc123",
    "git status",
    "git ls-files -s",
    "cat package.json",
    "head -100 log.txt",
    "tail -50 log.txt",
    "ls -la src",
    "find . -type f",
    "find . -name '*.ts' -type f",
    "wc -l src/index.ts",
    "grep -rn TODO src",
    "rg pattern src",
    "   git   log   ", // leading/internal whitespace
  ];
  for (const cmd of mustAccept) {
    it(`accepts: ${cmd.trim()}`, () => {
      expect(isPureReadBash(cmd)).toBe(true);
      expect(scopeForToolUse("Bash", { command: cmd })).toBe("BashReadOnly");
    });
  }
});

describe("F3 classifier — case sensitivity fails safe", () => {
  it("uppercased commands are not matched (rejected, not wrongly accepted)", () => {
    expect(isPureReadBash("CAT file")).toBe(false);
    expect(isPureReadBash("GIT log")).toBe(false);
  });
  it("commands prefixed by env assignment are rejected", () => {
    expect(isPureReadBash("FOO=bar cat x")).toBe(false);
  });
  it("backslash-escaped command name is rejected", () => {
    expect(isPureReadBash("\\cat x")).toBe(false);
  });
});

describe("F3 freshness soundness hierarchy", () => {
  it("content-sha is exact: any byte change ⇒ no substitution (Read is sound)", () => {
    const cache = new SpeculativeCache({ enabledScopes: ["Read"] });
    const original = "export const TIMEOUT = 5000;";
    cache.store("Read", { file_path: "c.ts" }, original, contentToken(original), 1);
    // A one-character edit changes the SHA ⇒ refuse to substitute.
    const edited = contentToken("export const TIMEOUT = 5001;");
    expect(cache.decide("Read", { file_path: "c.ts" }, edited).substitute).toBe(
      false
    );
  });

  it("filelist-stat catches an in-place edit that dir-stat would MISS", () => {
    // Same directory mtime + same entry count, but a file was edited in place
    // (its mtime and size changed). dir-stat tokens collide (stale!) while
    // filelist-stat tokens correctly differ.
    const before = [
      { path: "src/a.ts", mtimeMs: 1000, size: 100 },
      { path: "src/b.ts", mtimeMs: 1000, size: 200 },
    ];
    const after = [
      { path: "src/a.ts", mtimeMs: 1000, size: 100 },
      { path: "src/b.ts", mtimeMs: 2000, size: 240 }, // edited in place
    ];

    // dir-stat (mtime+count) is BLIND to the edit — tokens match (the hazard).
    expect(dirStatToken(5000, 2).value).toBe(dirStatToken(5000, 2).value);

    // filelist-stat SEES the edit — tokens differ (the fix).
    expect(fileListStatToken(before).value).not.toBe(
      fileListStatToken(after).value
    );

    // Wired through the cache: a Grep cached against the strong token refuses
    // to substitute after the in-place edit.
    const cache = new SpeculativeCache({ enabledScopes: ["Grep"] });
    cache.store(
      "Grep",
      { pattern: "TODO", path: "src" },
      "src/b.ts:1:TODO",
      fileListStatToken(before),
      1
    );
    const d = cache.decide(
      "Grep",
      { pattern: "TODO", path: "src" },
      fileListStatToken(after)
    );
    expect(d.substitute).toBe(false);
  });

  it("filelist-stat is order-independent", () => {
    const a = [
      { path: "x", mtimeMs: 1, size: 1 },
      { path: "y", mtimeMs: 2, size: 2 },
    ];
    const b = [
      { path: "y", mtimeMs: 2, size: 2 },
      { path: "x", mtimeMs: 1, size: 1 },
    ];
    expect(fileListStatToken(a).value).toBe(fileListStatToken(b).value);
  });

  it("a freshness token of a different KIND never matches (no cross-kind aliasing)", () => {
    const cache = new SpeculativeCache({ enabledScopes: ["Read"] });
    const content = "data";
    cache.store("Read", { file_path: "f" }, content, contentToken(content), 1);
    // Supplying a dir-stat token whose string value happened to collide must
    // still fail because the KIND differs.
    const sneaky = dirStatToken(0, 0);
    expect(cache.decide("Read", { file_path: "f" }, sneaky).substitute).toBe(
      false
    );
  });
});
