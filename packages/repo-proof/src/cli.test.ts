import { describe, expect, it, beforeAll, afterAll } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import type { TrialRunner, TrialSpec } from "@prune/outcome-bench";
import { isFeatureEnabled, validateFlags } from "@prune/shared";

import { parseArgs, run, type CliIo } from "./cli.js";
import { proofPaths } from "./paths.js";
import { syntheticTrial } from "./synthetic-records.js";

// ============================================================================
// parseArgs (pure)
// ============================================================================

describe("parseArgs", () => {
  it("rejects a missing command, unknown command, and unknown flags", () => {
    expect(parseArgs([])).toHaveProperty("error");
    expect(parseArgs(["dance", "--repo", "."])).toHaveProperty("error");
    expect(parseArgs(["mine", "--repo", ".", "--bogus", "x"])).toHaveProperty("error");
  });

  it("requires --repo everywhere", () => {
    for (const cmd of ["mine", "verify", "prove", "promote", "status"]) {
      expect(parseArgs([cmd])).toHaveProperty("error");
    }
  });

  it("prove WITHOUT --budget is a parse error — spend is never implicit", () => {
    const r = parseArgs(["prove", "--repo", "."]);
    expect(r).toHaveProperty("error");
    if ("error" in r) expect(r.error).toContain("never happens implicitly");
  });

  it("prove rejects a non-positive or non-numeric budget", () => {
    expect(parseArgs(["prove", "--repo", ".", "--budget", "0"])).toHaveProperty("error");
    expect(parseArgs(["prove", "--repo", ".", "--budget", "-5"])).toHaveProperty("error");
    expect(parseArgs(["prove", "--repo", ".", "--budget", "lots"])).toHaveProperty("error");
  });

  it("mine validates --limit and collects repeated --group-prefix", () => {
    expect(parseArgs(["mine", "--repo", ".", "--limit", "nope"])).toHaveProperty("error");
    const r = parseArgs([
      "mine", "--repo", ".",
      "--group-prefix", "packages/",
      "--group-prefix", "apps/",
    ]);
    expect(r).toMatchObject({
      kind: "mine",
      limit: 400,
      groupPrefixes: ["packages/", "apps/"],
      oracleTemplate: null,
    });
  });

  it("a flag at the end without a value errors instead of swallowing the next flag", () => {
    expect(parseArgs(["mine", "--repo"])).toHaveProperty("error");
    expect(parseArgs(["prove", "--repo", ".", "--budget", "--model"])).toHaveProperty("error");
  });

  it("status --json parses; defaults are explicit", () => {
    expect(parseArgs(["status", "--repo", "/r", "--json"])).toEqual({
      kind: "status",
      repo: "/r",
      json: true,
    });
    expect(parseArgs(["prove", "--repo", "/r", "--budget", "10"])).toMatchObject({
      kind: "prove",
      budgetUsd: 10,
      trials: 3, // PRE_REGISTRATION default
      model: "claude-sonnet-4-6",
    });
  });
});

// ============================================================================
// End-to-end: mine → curate → verify → prove (injected) → promote → status
// ============================================================================

describe("end-to-end lifecycle on a temp repo (zero model spend)", () => {
  let repo: string;
  let lines: string[];
  let errs: string[];
  const io: CliIo = {
    out: (l) => lines.push(l),
    err: (l) => errs.push(l),
  };
  const reset = () => {
    lines = [];
    errs = [];
  };

  const git = (...args: string[]): string => {
    const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const write = (rel: string, content: string): void => {
    const p = join(repo, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  };
  const commitAll = (msg: string): string => {
    git("add", ".");
    git("commit", "-qm", msg);
    return git("rev-parse", "HEAD");
  };

  let base = "";
  let ref = "";

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "repo-proof-cli-e2e-"));
    git("init", "-q");
    git("config", "user.email", "t@t");
    git("config", "user.name", "t");
    git("config", "commit.gpgsign", "false");
    write("lib.mjs", `export const VALUE = "broken";\n`);
    write(
      "runner.mjs",
      `import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
let failed = 0;
for (const f of readdirSync(".")) {
  if (!f.endsWith(".test.mjs")) continue;
  if (spawnSync(process.execPath, [f]).status !== 0) failed++;
}
process.exit(failed === 0 ? 0 : 1);
`
    );
    base = commitAll("broken impl");
    write("lib.mjs", `export const VALUE = "fixed";\n`);
    write(
      "check.test.mjs",
      `import { VALUE } from "./lib.mjs";\nprocess.exit(VALUE === "fixed" ? 0 : 1);\n`
    );
    ref = commitAll("fix: export the correct value, with test");
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("mine finds the fix commit and writes candidates + coverage", async () => {
    reset();
    const code = await run(["mine", "--repo", repo, "--limit", "10"], io);
    expect(code).toBe(0);
    const paths = proofPaths(repo);
    expect(existsSync(paths.candidates)).toBe(true);
    const candidates = readFileSync(paths.candidates, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(candidates).toHaveLength(1);
    expect(candidates[0].commit).toBe(ref);
    expect(candidates[0].suggestedBaseCommit).toBe(base);
    expect(candidates[0].suggestedOracleCmd).toBeNull(); // no template given
    expect(lines.some((l) => l.includes("prompts are never auto-generated"))).toBe(true);
  });

  it("verify flips the human-curated draft to ready via the three-state protocol", async () => {
    // Human curation step: write the manifest WITH a prompt (the part the
    // machine refuses to do).
    const paths = proofPaths(repo);
    mkdirSync(paths.tasksDir, { recursive: true });
    writeFileSync(
      join(paths.tasksDir, "fix-value.json"),
      JSON.stringify(
        {
          taskId: "fix-value",
          track: "external",
          status: "draft",
          repoUrl: null,
          baseCommit: base,
          testRefCommit: ref,
          hiddenTestPaths: ["check.test.mjs"],
          setupCmds: [],
          prompt: "The library exports the wrong value. Consumers see 'broken'. Make it correct.",
          oracleCmd: "node runner.mjs",
          oracleCwd: ".",
          intentClass: "debug",
          referenceCommit: ref,
          difficulty: "<15min",
          maxTurns: 10,
          maxBudgetUsd: 0.5,
          cutoffSafe: true,
        },
        null,
        2
      )
    );
    reset();
    const code = await run(["verify", "--repo", repo], io);
    expect(code).toBe(0);
    expect(lines.some((l) => l.includes("fix-value: S1=pass S2=fail S3=pass VALID → ready"))).toBe(true);
    const manifest = JSON.parse(
      readFileSync(join(paths.tasksDir, "fix-value.json"), "utf8")
    );
    expect(manifest.status).toBe("ready");
    expect(existsSync(join(paths.verifyDir, "fix-value.json"))).toBe(true);
  });

  it("prove (injected runner) produces analysis + attestation; promote actuates repo-locally", async () => {
    // Injected runner: governed cheaper, both pass — but n=1 task can never
    // reach Wilcoxon significance, so promote must land on the HONEST no-op.
    const runner: TrialRunner = {
      runTrial: async (spec: TrialSpec) =>
        syntheticTrial({
          taskId: spec.task.taskId,
          arm: spec.arm,
          trialIndex: spec.trialIndex,
          inputTokens: spec.arm === "naive" ? 100_000 : 50_000,
          oracle: "pass",
          billedUsd: spec.arm === "naive" ? 0.1 : 0.05,
          fixture: false,
        }),
    };
    reset();
    const proveCode = await run(
      ["prove", "--repo", repo, "--budget", "5", "--trials", "2"],
      io,
      { makeRunner: () => runner }
    );
    expect(proveCode).toBe(0);
    const paths = proofPaths(repo);
    expect(existsSync(paths.analysis)).toBe(true);
    expect(existsSync(paths.attestation)).toBe(true);

    // Promote: gate must FAIL honestly (1 task ⇒ no significance), exit 0,
    // and write ONLY the decision record.
    reset();
    const fakeInstall = async () => (existing: unknown) => ({
      settings: { ...(existing as object), hooks: { marker: true } },
    });
    const promoteCode = await run(["promote", "--repo", repo], io, {
      loadInstallHooks: fakeInstall as never,
    });
    expect(promoteCode).toBe(0);
    expect(lines.some((l) => l.includes("gates not met — honest no-op"))).toBe(true);
    expect(existsSync(paths.promotion)).toBe(true);
    expect(existsSync(paths.flagsFile)).toBe(false); // nothing actuated
  });

  it("a hand-forged PASSING decision is what actuates — promote writes repo-local flags + settings", async () => {
    // Simulate a passing proof by replaying promote against artifacts from a
    // statistically sufficient synthetic matrix (6 tasks × 10 trials).
    const { analyzeOutcomes, buildAttestation, PRE_REGISTRATION } =
      await import("@prune/outcome-bench");
    const { syntheticMatrix } = await import("./synthetic-records.js");
    const paths = proofPaths(repo);
    const analysis = analyzeOutcomes(
      syntheticMatrix({ tasks: 6, trialsPerTask: 10, fixture: false }),
      PRE_REGISTRATION
    );
    const attestation = buildAttestation(
      analysis,
      new Map(analysis.tasks.map((t) => [t.taskId, 500])),
      { issuedAt: "2026-06-11T00:00:00Z" }
    );
    writeFileSync(paths.analysis, JSON.stringify(analysis));
    writeFileSync(paths.attestation, JSON.stringify(attestation));
    writeFileSync(
      join(paths.root, "prove-meta.json"),
      JSON.stringify({ governedFeatureIds: ["f15", "f16"] })
    );

    reset();
    const fakeInstall = async () => (existing: unknown) => ({
      settings: { ...(existing as object), hooks: { marker: true } },
    });
    const code = await run(
      ["promote", "--repo", repo, "--hooks-dir", "/unused-by-fake"],
      io,
      { loadInstallHooks: fakeInstall as never }
    );
    expect(code).toBe(0);
    expect(lines.some((l) => l.startsWith("PROMOTED for this repo: f15, f16"))).toBe(true);

    const flags = validateFlags(JSON.parse(readFileSync(paths.flagsFile, "utf8")));
    expect(isFeatureEnabled(flags, "f15")).toBe(true);
    expect(isFeatureEnabled(flags, "f16")).toBe(true);
    const settings = JSON.parse(readFileSync(paths.settingsFile, "utf8"));
    expect(settings.hooks.marker).toBe(true); // canonical installer's output
    expect(settings.env.PRUNE_FLAGS_PATH).toBe(paths.flagsFile);
  });

  it("status reports the full lifecycle, including provenance, and --json round-trips", async () => {
    reset();
    const code = await run(["status", "--repo", repo], io);
    expect(code).toBe(0);
    const md = lines.join("\n");
    expect(md).toContain("VALID"); // verification table
    expect(md).toContain("PROMOTED");
    expect(md).toContain("Repo-local flag provenance");

    reset();
    const jsonCode = await run(["status", "--repo", repo, "--json"], io);
    expect(jsonCode).toBe(0);
    const state = JSON.parse(lines.join("\n"));
    expect(state.tasks.ready).toBe(1);
    expect(state.flagProvenance.some((f: { id: string }) => f.id === "f15")).toBe(true);
  });

  it("prove against a budget below the worst case refuses before any trial", async () => {
    reset();
    const code = await run(
      ["prove", "--repo", repo, "--budget", "0.5", "--trials", "2"],
      io,
      {
        makeRunner: () => ({
          runTrial: async () => {
            throw new Error("must never be called");
          },
        }),
      }
    );
    // worst case: 1 task × $0.5 × 2 trials × 2 arms = $2 > $0.5
    expect(code).toBe(0); // honest refusal, not an error
    expect(lines.some((l) => l.includes("budget pre-flight refused"))).toBe(true);
  });
});
