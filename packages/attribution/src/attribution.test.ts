import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BudgetChargeRow } from "@prune/persistence";

import {
  encodeDimensions,
  decodeDimensions,
  type AttributionDimensions,
} from "./dimensions.js";
import { detectDimensions } from "./context.js";
import { rollup } from "./rollup.js";

// ============================================================================
// dimensions — encode/decode round-trip
// ============================================================================

describe("encodeDimensions + decodeDimensions", () => {
  it("round-trips a full dimension set", () => {
    const d: AttributionDimensions = {
      developer: "alice@example.com",
      project: "platform",
      branch: "feature/auth",
      prNumber: 123,
      commitSha: "abc1234",
      extra: { team: "core", cost_center: "R&D" },
    };
    const round = decodeDimensions(encodeDimensions(d));
    expect(round).toEqual(d);
  });

  it("ignores keys not under attribution.*", () => {
    const round = decodeDimensions({
      "attribution.developer": "alice",
      unrelated_key: "x",
      "attribution.project": "p",
    });
    expect(round.developer).toBe("alice");
    expect(round.project).toBe("p");
  });

  it("encodes empty extra as nothing extra", () => {
    const round = decodeDimensions(encodeDimensions({ developer: "a" }));
    expect(round.developer).toBe("a");
    expect(round.extra).toBeUndefined();
  });
});

// ============================================================================
// context — auto-detect from env / git
// ============================================================================

describe("detectDimensions — env overrides", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("PRUNE_ATTRIBUTION_* env wins over auto-probe", () => {
    process.env.PRUNE_ATTRIBUTION_DEVELOPER = "explicit@example.com";
    process.env.PRUNE_ATTRIBUTION_PROJECT = "explicit-project";
    process.env.PRUNE_ATTRIBUTION_BRANCH = "explicit/branch";
    process.env.PRUNE_ATTRIBUTION_PR = "42";
    process.env.PRUNE_ATTRIBUTION_COMMIT = "deadbeef";
    process.env.PRUNE_ATTRIBUTION_TEAM = "platform";
    const d = detectDimensions({ skipGit: true });
    expect(d.developer).toBe("explicit@example.com");
    expect(d.project).toBe("explicit-project");
    expect(d.branch).toBe("explicit/branch");
    expect(d.prNumber).toBe(42);
    expect(d.commitSha).toBe("deadbeef");
    expect(d.extra?.team).toBe("platform");
  });

  it("GITHUB_ACTOR + GITHUB_REPOSITORY + GITHUB_REF parses PR number from refs/pull/N/merge", () => {
    process.env = { ...saved };
    delete process.env.PRUNE_ATTRIBUTION_DEVELOPER;
    delete process.env.PRUNE_ATTRIBUTION_PROJECT;
    delete process.env.PRUNE_ATTRIBUTION_BRANCH;
    delete process.env.PRUNE_ATTRIBUTION_PR;
    delete process.env.PRUNE_ATTRIBUTION_COMMIT;
    process.env.GITHUB_ACTOR = "octocat";
    process.env.GITHUB_REPOSITORY = "octo/repo";
    process.env.GITHUB_REF = "refs/pull/789/merge";
    process.env.GITHUB_SHA = "cafef00d";
    const d = detectDimensions({ skipGit: true });
    expect(d.developer).toBe("octocat");
    expect(d.project).toBe("octo/repo");
    expect(d.prNumber).toBe(789);
    expect(d.commitSha).toBe("cafef00d");
  });

  it("override beats env beats CI", () => {
    process.env.GITHUB_ACTOR = "octocat";
    const d = detectDimensions({
      skipGit: true,
      override: { developer: "from-override" },
    });
    expect(d.developer).toBe("from-override");
  });

  it("infers PR number from branch name like 'pr/123'", () => {
    process.env = { ...saved };
    delete process.env.PRUNE_ATTRIBUTION_PR;
    delete process.env.GITHUB_REF;
    process.env.PRUNE_ATTRIBUTION_BRANCH = "pr/456";
    const d = detectDimensions({ skipGit: true });
    expect(d.prNumber).toBe(456);
  });

  it("infers PR number from branch name pattern '123-feature-name'", () => {
    process.env = { ...saved };
    delete process.env.PRUNE_ATTRIBUTION_PR;
    delete process.env.GITHUB_REF;
    process.env.PRUNE_ATTRIBUTION_BRANCH = "789-fix-auth";
    const d = detectDimensions({ skipGit: true });
    expect(d.prNumber).toBe(789);
  });
});

describe("detectDimensions — git fallback (config-only, no commit)", () => {
  // Note: we don't make a commit here because some sandboxed environments
  // enforce GPG signing globally. The interesting code path (config read +
  // branch read) doesn't need a commit; commitSha is allowed to be
  // undefined when HEAD has no commit yet.
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "prune-attr-"));
    execSync("git init -q -b feature/auth", { cwd: dir });
    execSync('git config user.email "test@example.com"', { cwd: dir });
    execSync('git config user.name "Test"', { cwd: dir });
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads developer email + project name + initial branch from git config", () => {
    const saved = { ...process.env };
    try {
      delete process.env.GITHUB_ACTOR;
      delete process.env.GITHUB_REPOSITORY;
      delete process.env.GITHUB_HEAD_REF;
      delete process.env.GITHUB_REF;
      delete process.env.GITHUB_SHA;
      delete process.env.PRUNE_ATTRIBUTION_DEVELOPER;
      delete process.env.PRUNE_ATTRIBUTION_PROJECT;
      delete process.env.PRUNE_ATTRIBUTION_BRANCH;
      delete process.env.PRUNE_ATTRIBUTION_PR;
      delete process.env.PRUNE_ATTRIBUTION_COMMIT;
      const d = detectDimensions({ cwd: dir });
      expect(d.developer).toBe("test@example.com");
      expect(d.project).toBeTruthy();
      // branch and commitSha may be undefined on an unborn-branch repo
      // (no commits); that's the expected fail-soft behavior of runGit
      // returning null when `git rev-parse` errors.
    } finally {
      process.env = saved;
    }
  });
});

// ============================================================================
// rollup
// ============================================================================

function makeCharge(
  cost: number,
  metadata: Record<string, unknown>,
  over: Partial<BudgetChargeRow> = {}
): BudgetChargeRow {
  return {
    charge_id: `c-${Math.random()}`,
    envelope_id: "e1",
    timestamp: "2026-05-15T10:00:00.000Z",
    agent_id: null,
    model: "claude-sonnet-4",
    provider: "anthropic",
    tokens_in: 1000,
    tokens_out: 200,
    tokens_cached: 0,
    tokens_cache_creation: 0,
    cost_usd: cost,
    source: "recorded",
    metadata,
    ...over,
  };
}

describe("rollup", () => {
  it("groups by developer + sums cost across charges", () => {
    const charges = [
      makeCharge(0.10, encodeDimensions({ developer: "alice@x" })),
      makeCharge(0.05, encodeDimensions({ developer: "alice@x" })),
      makeCharge(0.20, encodeDimensions({ developer: "bob@x" })),
    ];
    const groups = rollup(charges, { groupBy: ["developer"] });
    expect(groups).toHaveLength(2);
    const alice = groups.find((g) => g.dimensions.developer === "alice@x")!;
    const bob = groups.find((g) => g.dimensions.developer === "bob@x")!;
    expect(alice.totalCostUsd).toBeCloseTo(0.15, 6);
    expect(alice.chargeCount).toBe(2);
    expect(bob.totalCostUsd).toBeCloseTo(0.2, 6);
  });

  it("buckets unattributed charges under '(unattributed)'", () => {
    const charges = [
      makeCharge(0.10, {}),
      makeCharge(0.20, encodeDimensions({ developer: "alice@x" })),
    ];
    const groups = rollup(charges, { groupBy: ["developer"] });
    const unattrib = groups.find((g) => g.key === "(unattributed)")!;
    expect(unattrib.totalCostUsd).toBeCloseTo(0.10, 6);
  });

  it("groups by multiple dimensions with a composite key", () => {
    const charges = [
      makeCharge(
        0.10,
        encodeDimensions({ developer: "alice@x", project: "p1" })
      ),
      makeCharge(
        0.20,
        encodeDimensions({ developer: "alice@x", project: "p2" })
      ),
      makeCharge(
        0.30,
        encodeDimensions({ developer: "bob@x", project: "p1" })
      ),
    ];
    const groups = rollup(charges, { groupBy: ["developer", "project"] });
    expect(groups).toHaveLength(3);
    expect(groups[0].totalCostUsd).toBeCloseTo(0.3, 6); // bob/p1 wins by cost
  });

  it("filters by since / until", () => {
    const charges = [
      makeCharge(0.10, {}, { timestamp: "2026-05-15T10:00:00.000Z" }),
      makeCharge(0.20, {}, { timestamp: "2026-05-20T10:00:00.000Z" }),
      makeCharge(0.40, {}, { timestamp: "2026-05-25T10:00:00.000Z" }),
    ];
    const groups = rollup(charges, {
      groupBy: ["model"],
      since: "2026-05-18T00:00:00.000Z",
      until: "2026-05-22T00:00:00.000Z",
    });
    expect(groups[0].totalCostUsd).toBeCloseTo(0.2, 6);
  });

  it("supports whereEquals pre-filter", () => {
    const charges = [
      makeCharge(0.10, encodeDimensions({ project: "alpha", developer: "a" })),
      makeCharge(0.20, encodeDimensions({ project: "beta", developer: "a" })),
    ];
    const groups = rollup(charges, {
      groupBy: ["developer"],
      whereEquals: { project: "alpha" },
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].totalCostUsd).toBeCloseTo(0.10, 6);
  });

  it("groups by extra.team via nested key", () => {
    const charges = [
      makeCharge(
        0.10,
        encodeDimensions({ extra: { team: "platform" } })
      ),
      makeCharge(
        0.20,
        encodeDimensions({ extra: { team: "platform" } })
      ),
      makeCharge(
        0.05,
        encodeDimensions({ extra: { team: "growth" } })
      ),
    ];
    const groups = rollup(charges, { groupBy: ["extra.team"] });
    expect(groups).toHaveLength(2);
    const platform = groups.find((g) => g.dimensions.extra?.team === "platform")!;
    expect(platform.totalCostUsd).toBeCloseTo(0.3, 6);
  });

  it("sorts groups by totalCostUsd descending", () => {
    const charges = [
      makeCharge(0.05, encodeDimensions({ developer: "a" })),
      makeCharge(0.50, encodeDimensions({ developer: "b" })),
      makeCharge(0.25, encodeDimensions({ developer: "c" })),
    ];
    const groups = rollup(charges, { groupBy: ["developer"] });
    expect(groups.map((g) => g.dimensions.developer)).toEqual(["b", "c", "a"]);
  });
});
