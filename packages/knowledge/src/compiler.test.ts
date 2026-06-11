import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";

import {
  churnByPath,
  compile,
  loadCompiled,
  recompile,
  saveCompiled,
} from "./compiler.js";

let repo: string;

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
const commitAll = (msg: string): void => {
  git("add", ".");
  git("commit", "-qm", msg);
};

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "knowledge-compiler-"));
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  write("CODEOWNERS", "*.ts @ts-team\ndocs @writers\n");
  write(
    "src/core.ts",
    `export function formatId(id: string): string { return "id:" + id; }\n`
  );
  write(
    "src/users.ts",
    `import { formatId } from "./core.js";\nexport function loadUser(id: string): string { return formatId(id); }\n`
  );
  write("docs/guide.md", "# docs\n");
  commitAll("initial");
  write("src/core.ts", `export function formatId(id: string): string { return "ID:" + id; }\n`);
  commitAll("tweak core"); // core.ts now has churn 2, others 1
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("compile", () => {
  it("produces a row for EVERY tracked file — non-TS files keep coverage honest with zero symbols", () => {
    const r = compile(repo, { now: () => "2026-06-11T00:00:00Z" });
    if ("error" in r) throw new Error(r.error);
    const paths = r.asset.files.map((f) => f.path);
    expect(paths).toEqual(["CODEOWNERS", "docs/guide.md", "src/core.ts", "src/users.ts"]);
    const md = r.asset.files.find((f) => f.path === "docs/guide.md")!;
    expect(md.symbols).toEqual([]);
    expect(md.contentSha256).toHaveLength(64);
    expect(md.owners).toEqual(["@writers"]); // bare-dir CODEOWNERS rule
  });

  it("extracts symbols with references and resolves cross-file edges", () => {
    const r = compile(repo);
    if ("error" in r) throw new Error(r.error);
    const users = r.asset.files.find((f) => f.path === "src/users.ts")!;
    const loadUser = users.symbols.find((s) => s.name === "loadUser")!;
    expect(loadUser.references).toContain("formatId");
    expect(
      r.asset.edges.some(
        (e) => e.from === "src/users.ts#loadUser" && e.to === "src/core.ts#formatId"
      )
    ).toBe(true);
  });

  it("attaches the single-stream churn signal per path", () => {
    const churn = churnByPath(repo, 50);
    expect(churn.get("src/core.ts")).toBe(2);
    expect(churn.get("src/users.ts")).toBe(1);
    const r = compile(repo);
    if ("error" in r) throw new Error(r.error);
    expect(r.asset.files.find((f) => f.path === "src/core.ts")!.commitsInWindow).toBe(2);
  });

  it("is deterministic: same tree ⇒ same contentHash, regardless of when", () => {
    const a = compile(repo, { now: () => "2026-01-01T00:00:00Z" });
    const b = compile(repo, { now: () => "2026-12-31T00:00:00Z" });
    if ("error" in a || "error" in b) throw new Error("compile failed");
    expect(a.asset.contentHash).toBe(b.asset.contentHash);
    expect(a.asset.generatedAt).not.toBe(b.asset.generatedAt);
  });

  it("flags truncation at the file cap instead of presenting partial coverage as full", () => {
    const r = compile(repo, { maxFiles: 2 });
    if ("error" in r) throw new Error(r.error);
    expect(r.asset.truncated).toBe(true);
    expect(r.asset.files).toHaveLength(2);
  });

  it("returns a typed error for a non-git directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "knowledge-nongit-"));
    const r = compile(dir);
    expect(r).toHaveProperty("error");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("recompile (incremental)", () => {
  it("on an unchanged tree reproduces the fresh compile's contentHash exactly", () => {
    const fresh = compile(repo);
    if ("error" in fresh) throw new Error(fresh.error);
    const inc = recompile(repo, fresh.asset);
    if ("error" in inc) throw new Error(inc.error);
    expect(inc.asset.contentHash).toBe(fresh.asset.contentHash);
  });

  it("re-extracts only changed files; adds new; drops deleted", () => {
    const fresh = compile(repo);
    if ("error" in fresh) throw new Error(fresh.error);

    // Change one file, add one, delete one (working tree only — the
    // compiler reads the TREE, so uncommitted edits invalidate too).
    write("src/users.ts", `export function loadUser(id: string): string { return "u:" + id; }\n`);
    write("src/billing.ts", `export function invoice(): number { return 1; }\n`);
    git("add", "src/billing.ts"); // ls-files must see the new file
    rmSync(join(repo, "docs/guide.md"));
    git("rm", "-q", "--cached", "docs/guide.md");

    const inc = recompile(repo, fresh.asset);
    if ("error" in inc) throw new Error(inc.error);
    const paths = inc.asset.files.map((f) => f.path);
    expect(paths).toContain("src/billing.ts");
    expect(paths).not.toContain("docs/guide.md");
    // Changed file re-extracted (no formatId reference anymore).
    const users = inc.asset.files.find((f) => f.path === "src/users.ts")!;
    expect(users.symbols.find((s) => s.name === "loadUser")!.references).not.toContain("formatId");
    // Unchanged file's symbols survived intact.
    const core = inc.asset.files.find((f) => f.path === "src/core.ts")!;
    expect(core.symbols.map((s) => s.name)).toContain("formatId");
    // Edge to the removed reference is gone.
    expect(inc.asset.edges.some((e) => e.from === "src/users.ts#loadUser")).toBe(false);
    // No tree restoration: the remaining tests compile whatever tree exists
    // (determinism/persistence are tree-shape independent by design).
  });
});

describe("persistence", () => {
  it("save/load round-trips; corrupt or missing files load as null, never throw", () => {
    const r = compile(repo);
    if ("error" in r) throw new Error(r.error);
    const path = saveCompiled(repo, r.asset);
    const loaded = loadCompiled(repo);
    expect(loaded?.contentHash).toBe(r.asset.contentHash);
    writeFileSync(path, "{ corrupt");
    expect(loadCompiled(repo)).toBeNull();
    rmSync(path);
    expect(loadCompiled(repo)).toBeNull();
  });
});
