import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleRepoProofStatus } from "./repo-proof-tools.js";

describe("repo_proof_status (read-only MCP tool)", () => {
  it("rejects malformed args with a JSON error, never a throw", () => {
    for (const bad of [null, 42, "x", {}, { repoRoot: "" }, { repoRoot: 7 }]) {
      const out = JSON.parse(handleRepoProofStatus(bad));
      expect(out.error).toBeTruthy();
    }
  });

  it("returns the degraded all-absent state for a fresh directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-repo-proof-"));
    const state = JSON.parse(handleRepoProofStatus({ repoRoot: dir }));
    expect(state.error).toBeUndefined();
    expect(state.candidates).toBeNull();
    expect(state.promotion).toBeNull();
    expect(state.tasks).toEqual({ ready: 0, draft: 0, errors: 0 });
  });

  it("surfaces persisted proof state (coverage + verdict)", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-repo-proof-full-"));
    const proofDir = join(dir, ".prune", "proof");
    mkdirSync(join(proofDir, "verify"), { recursive: true });
    writeFileSync(
      join(proofDir, "coverage.json"),
      JSON.stringify([{ group: "src", commitsScanned: 4, candidates: 1 }])
    );
    writeFileSync(
      join(proofDir, "verify", "t1.json"),
      JSON.stringify({
        taskId: "t1",
        s1: "pass",
        s2: "fail",
        s3: "pass",
        valid: true,
        checkedAt: "2026-06-11T00:00:00Z",
        failures: [],
      })
    );
    const state = JSON.parse(handleRepoProofStatus({ repoRoot: dir }));
    expect(state.coverage).toHaveLength(1);
    expect(state.verdicts[0].valid).toBe(true);
  });
});
