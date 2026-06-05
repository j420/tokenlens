/**
 * Captures repo-level "code quality degradation" signals — real, not hardcoded:
 *   - harness test pass/total (from vitest-results.json),
 *   - harness typecheck (tsc --noEmit),
 *   - monorepo build (turbo build),
 *   - monorepo test (turbo test).
 * Exit 0 ⇒ green ⇒ no regression. Each capture is fail-safe (a command that
 * can't run becomes a red item with a reason, never a thrown error).
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

export interface HealthItem {
  label: string;
  ok: boolean;
  detail: string;
}
export interface RepoHealth {
  items: HealthItem[];
  allGreen: boolean;
}

function run(cmd: string, args: string[], cwd: string): { code: number; tail: string } {
  try {
    const r = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: 300_000, maxBuffer: 64 * 1024 * 1024 });
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    return { code: r.status ?? 1, tail: lastMeaningfulLine(out) };
  } catch (e) {
    return { code: 1, tail: (e as Error).message };
  }
}

function lastMeaningfulLine(s: string): string {
  const lines = s.split("\n").map((l) => l.trim()).filter(Boolean);
  // Prefer turbo's "Tasks:" / vitest's "Tests" summary line if present.
  const summary = [...lines].reverse().find((l) => /Tasks:|Tests\s|successful|passed|failed/i.test(l));
  return (summary ?? lines[lines.length - 1] ?? "").slice(0, 160);
}

export function captureRepoHealth(
  harnessTests: { passed: number; total: number } | null,
  opts: { skipMonorepo?: boolean } = {}
): RepoHealth {
  const pkgDir = process.cwd(); // packages/e2e-harness when run via npm
  const repoRoot = resolve(pkgDir, "..", "..");
  const items: HealthItem[] = [];

  // 1. Harness tests (from the json the `ui` script already wrote).
  if (harnessTests) {
    items.push({
      label: "Harness tests",
      ok: harnessTests.passed === harnessTests.total && harnessTests.total > 0,
      detail: `${harnessTests.passed}/${harnessTests.total} passed`,
    });
  }

  // 2. Harness typecheck (fast).
  const tc = run("npx", ["tsc", "--noEmit", "-p", "tsconfig.json"], pkgDir);
  items.push({ label: "Harness typecheck (tsc)", ok: tc.code === 0, detail: tc.code === 0 ? "no type errors" : tc.tail });

  // 3 & 4. Monorepo build + test (turbo-cached, so repeat runs are fast).
  if (!opts.skipMonorepo) {
    const build = run("npx", ["turbo", "build"], repoRoot);
    items.push({ label: "Monorepo build (turbo)", ok: build.code === 0, detail: build.tail });
    const test = run("npx", ["turbo", "test"], repoRoot);
    items.push({ label: "Monorepo tests (turbo)", ok: test.code === 0, detail: test.tail });
  }

  return { items, allGreen: items.every((i) => i.ok) };
}
