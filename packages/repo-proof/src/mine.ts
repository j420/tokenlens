/**
 * Task mining — propose SWE-bench-style task candidates from ANY repository's
 * git history.
 *
 * A candidate is a non-merge commit that touches BOTH implementation files and
 * test files inside the same directory group: the agent would work at C~1
 * (never seeing C's tests), C's test files become the hidden FAIL_TO_PASS
 * patch, and C itself is the known-achievable reference solution.
 *
 * Honesty properties, enforced structurally:
 *  - Output is `CandidateCommit` (no prompt field) — prompts are written by a
 *    human from the attached commit message, never fabricated here.
 *  - `suggestedOracleCmd` is null unless the caller supplied an oracle
 *    template: we never guess a foreign repository's test runner.
 *  - Test detection is deterministic path matching (suffix + directory-segment
 *    lists). No regex, no content sniffing, no model.
 *  - Coverage reports every group scanned — including the groups that yielded
 *    nothing — so "this part of your repo is unprovable" is a first-class
 *    result, not a silent omission.
 *
 * Pure classification core; the only impurity is the injectable git reader.
 */

import { spawnSync } from "node:child_process";
import type { CandidateCommit, CoverageRow } from "./types.js";

// ============================================================================
// Options
// ============================================================================

export interface MineOptions {
  /** How many recent non-merge commits to scan. */
  limit: number;
  /**
   * Directory prefixes that define candidate groups (e.g. ["packages/",
   * "apps/"] for a monorepo): a file `packages/foo/src/x.ts` groups as
   * `packages/foo`. Files matching no prefix fall back to their top-level
   * directory; root-level files group as ".".
   */
  groupPrefixes?: string[];
  /** Path suffixes identifying test files. */
  testSuffixes?: string[];
  /** Directory segment names identifying test files (matched per segment). */
  testDirs?: string[];
  /**
   * Oracle command template; `{tests}` expands to the group-relative test
   * paths, space-joined. Omit (or null) when the repo's runner is unknown —
   * candidates then carry `suggestedOracleCmd: null` for the curator to fill.
   */
  oracleTemplate?: string | null;
}

export const DEFAULT_TEST_SUFFIXES: readonly string[] = [
  ".test.ts",
  ".test.tsx",
  ".test.js",
  ".test.jsx",
  ".test.mjs",
  ".test.cjs",
  ".spec.ts",
  ".spec.tsx",
  ".spec.js",
  ".spec.mjs",
  "_test.go",
  "_test.py",
];

export const DEFAULT_TEST_DIRS: readonly string[] = [
  "__tests__",
  "test",
  "tests",
];

// ============================================================================
// Pure classification
// ============================================================================

function isTestPath(path: string, suffixes: readonly string[], dirs: readonly string[]): boolean {
  for (const s of suffixes) {
    if (path.endsWith(s)) return true;
  }
  const segments = path.split("/");
  // Only DIRECTORY segments count — a file literally named "test" is not a
  // test directory, so the final segment is excluded.
  for (let i = 0; i < segments.length - 1; i++) {
    if (dirs.includes(segments[i])) return true;
  }
  return false;
}

function groupOf(path: string, prefixes: readonly string[]): string {
  for (const prefix of prefixes) {
    if (path.startsWith(prefix)) {
      const rest = path.slice(prefix.length);
      const firstSegment = rest.split("/")[0];
      if (firstSegment && rest.includes("/")) {
        return prefix + firstSegment;
      }
      // A file directly under the prefix (no deeper dir) groups as the prefix
      // itself minus its trailing slash.
      return prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
    }
  }
  const slash = path.indexOf("/");
  return slash === -1 ? "." : path.slice(0, slash);
}

/**
 * Split a commit's touched files into per-group {impl, tests} buckets.
 * Pure: same inputs, same answer, no environment access.
 */
export function classifyFiles(
  files: string[],
  opts: MineOptions
): Map<string, { impl: string[]; tests: string[] }> {
  const suffixes = opts.testSuffixes ?? DEFAULT_TEST_SUFFIXES;
  const dirs = opts.testDirs ?? DEFAULT_TEST_DIRS;
  // Normalize to directory prefixes: without the trailing slash, "packages"
  // would substring-match the sibling "packages-foo/x.ts" into a phantom
  // group.
  const prefixes = (opts.groupPrefixes ?? []).map((p) =>
    p.endsWith("/") ? p : p + "/"
  );
  const byGroup = new Map<string, { impl: string[]; tests: string[] }>();
  for (const file of files) {
    if (file.length === 0) continue;
    const group = groupOf(file, prefixes);
    const entry = byGroup.get(group) ?? { impl: [], tests: [] };
    if (isTestPath(file, suffixes, dirs)) entry.tests.push(file);
    else entry.impl.push(file);
    byGroup.set(group, entry);
  }
  return byGroup;
}

export interface CommitMeta {
  sha: string;
  /** C~1, resolved by the caller from real history — never synthesized. */
  parentSha: string;
  date: string;
  subject: string;
  body: string;
}

/** Build one candidate from a qualifying (group, files) pair. Pure. */
export function candidateFromCommit(
  meta: CommitMeta,
  group: string,
  files: { impl: string[]; tests: string[] },
  opts: MineOptions
): CandidateCommit {
  const template = opts.oracleTemplate ?? null;
  const groupPrefix = group === "." ? "" : group + "/";
  const relativeTests = files.tests.map((t) =>
    t.startsWith(groupPrefix) ? t.slice(groupPrefix.length) : t
  );
  return {
    commit: meta.sha,
    suggestedBaseCommit: meta.parentSha,
    date: meta.date,
    subject: meta.subject,
    body: meta.body,
    group,
    implFiles: files.impl,
    testFiles: files.tests,
    suggestedOracleCwd: group,
    suggestedOracleCmd:
      template === null ? null : template.split("{tests}").join(relativeTests.join(" ")),
  };
}

// ============================================================================
// Thin impure shell (injectable git reader)
// ============================================================================

export type GitRunner = (repoRoot: string, args: string[]) => {
  status: number | null;
  stdout: string;
  stderr: string;
};

export const defaultGitRunner: GitRunner = (repoRoot, args) => {
  const r = spawnSync("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.error ? String(r.error.message) : (r.stderr ?? ""),
  };
};

export interface MiningResult {
  candidates: CandidateCommit[];
  coverage: CoverageRow[];
  /** Non-fatal anomalies (e.g. a root commit with no parent), reported. */
  notes: string[];
}

/**
 * Field separators chosen to be unambiguous in git output: %x1f (unit
 * separator) between fields, %x1e (record separator) between commits — commit
 * subjects/bodies can contain anything printable, so printable delimiters
 * would corrupt parsing. Written as unicode escapes (repo convention:
 * no raw control bytes in source).
 */
const FIELD_SEP = "\u001f";
const RECORD_SEP = "\u001e";

export function mineCandidates(
  repoRoot: string,
  opts: MineOptions,
  git: GitRunner = defaultGitRunner
): MiningResult | { error: string } {
  const log = git(repoRoot, [
    "log",
    "--no-merges",
    `-n${opts.limit}`,
    `--pretty=format:%H${FIELD_SEP}%P${FIELD_SEP}%ad${FIELD_SEP}%s${FIELD_SEP}%b${RECORD_SEP}`,
    "--date=short",
  ]);
  if (log.status !== 0) {
    return { error: `git log failed: ${log.stderr.trim()}` };
  }

  const candidates: CandidateCommit[] = [];
  const notes: string[] = [];
  const coverageByGroup = new Map<string, { commitsScanned: number; candidates: number }>();

  for (const record of log.stdout.split(RECORD_SEP)) {
    const trimmed = record.startsWith("\n") ? record.slice(1) : record;
    if (trimmed.length === 0) continue;
    const parts = trimmed.split(FIELD_SEP);
    if (parts.length < 5) continue;
    const [sha, parents, date, subject] = parts;
    const body = parts.slice(4).join(FIELD_SEP);
    const parentList = parents.trim().split(" ").filter((p) => p.length > 0);
    if (parentList.length === 0) {
      notes.push(`${sha.slice(0, 10)}: root commit (no parent) — skipped`);
      continue;
    }

    const show = git(repoRoot, ["show", "--name-only", "--format=", sha]);
    if (show.status !== 0) {
      notes.push(`${sha.slice(0, 10)}: git show failed — skipped`);
      continue;
    }
    const files = show.stdout.split("\n").filter((f) => f.length > 0);
    const byGroup = classifyFiles(files, opts);

    for (const [group, entry] of byGroup) {
      const row = coverageByGroup.get(group) ?? { commitsScanned: 0, candidates: 0 };
      row.commitsScanned += 1;
      const qualifies = entry.impl.length > 0 && entry.tests.length > 0;
      if (qualifies) {
        row.candidates += 1;
        candidates.push(
          candidateFromCommit(
            {
              sha,
              parentSha: parentList[0],
              date,
              subject: subject ?? "",
              body: body.trim(),
            },
            group,
            entry,
            opts
          )
        );
      }
      coverageByGroup.set(group, row);
    }
  }

  const coverage: CoverageRow[] = [...coverageByGroup.entries()]
    .map(([group, row]) => ({ group, ...row }))
    .sort((a, b) => b.candidates - a.candidates || a.group.localeCompare(b.group));

  return { candidates, coverage, notes };
}
