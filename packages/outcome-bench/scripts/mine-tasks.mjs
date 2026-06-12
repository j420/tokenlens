#!/usr/bin/env node
/**
 * mine-tasks.mjs — propose SWE-bench-style task candidates from git history.
 *
 * A candidate is a non-merge commit that touches BOTH implementation files
 * and test files inside the same `packages/<pkg>/` workspace: the agent
 * works at C~1 (never seeing C's tests), C's test files become the hidden
 * FAIL_TO_PASS patch applied at grading time, and a known-achievable
 * reference solution (C itself) exists.
 *
 * Output: JSON lines, one candidate per line, for HUMAN curation into
 * `tasks/self/*.json` manifests. This script never writes a manifest itself —
 * prompts must be authored by a person, issue-style: they describe the
 * observable failing behavior without leaking the oracle, the reference
 * diff, or the existence of the hidden tests.
 *
 * Usage: node scripts/mine-tasks.mjs [--repo <root>] [--limit <n>]
 */

import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
}
const repo = flag("--repo", process.cwd());
const limit = Number(flag("--limit", "400"));

function git(...a) {
  const r = spawnSync("git", ["-C", repo, ...a], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) {
    console.error(r.stderr);
    process.exit(1);
  }
  return r.stdout;
}

const log = git(
  "log",
  "--no-merges",
  `-n${limit}`,
  "--pretty=format:%H|%ad|%s",
  "--date=short"
);

const isTest = (f) => /\.test\.(ts|tsx|mjs|js)$/.test(f);
const pkgOf = (f) => {
  const m = f.match(/^packages\/([^/]+)\//);
  return m ? m[1] : null;
};

for (const line of log.split("\n")) {
  if (!line.trim()) continue;
  const [sha, date, ...rest] = line.split("|");
  const subject = rest.join("|");
  const files = git("show", "--name-only", "--format=", sha)
    .split("\n")
    .filter(Boolean);

  // Group touched files by package; require impl+test in the SAME package.
  const byPkg = new Map();
  for (const f of files) {
    const pkg = pkgOf(f);
    if (!pkg) continue;
    const entry = byPkg.get(pkg) ?? { impl: [], tests: [] };
    (isTest(f) ? entry.tests : entry.impl).push(f);
    byPkg.set(pkg, entry);
  }
  const eligible = [...byPkg.entries()].filter(
    ([, e]) => e.impl.length > 0 && e.tests.length > 0
  );
  if (eligible.length === 0) continue;

  for (const [pkg, e] of eligible) {
    console.log(
      JSON.stringify({
        commit: sha,
        date,
        subject,
        package: pkg,
        implFiles: e.impl,
        testFiles: e.tests,
        suggestedOracleCwd: `packages/${pkg}`,
        suggestedOracleCmd: `npx vitest run ${e.tests
          .map((t) => t.replace(`packages/${pkg}/`, ""))
          .join(" ")}`,
      })
    );
  }
}
