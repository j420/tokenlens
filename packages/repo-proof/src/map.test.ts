import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { countTokens } from "@prune/tokenizer";

import { buildRepoMapArtifact } from "./map.js";

let repo: string;

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "repo-proof-map-"));
  const write = (rel: string, content: string): void => {
    const p = join(repo, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  };
  // A small dependency chain so PageRank has structure: core is depended on
  // by both services, so it must outrank them.
  write(
    "src/core.ts",
    `export function formatId(id: string): string { return "id:" + id; }
export interface Entity { id: string; name: string; }
`
  );
  write(
    "src/users.ts",
    `import { formatId, type Entity } from "./core.js";
export function loadUser(id: string): Entity { return { id: formatId(id), name: "u" }; }
`
  );
  write(
    "src/billing.ts",
    `import { formatId } from "./core.js";
export function invoiceFor(id: string): string { return "inv-" + formatId(id); }
export function taxRate(): number { return 0.19; }
`
  );
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("buildRepoMapArtifact", () => {
  it("renders an outline with real symbols, scan envelope, and measured token size", async () => {
    const a = await buildRepoMapArtifact(repo, {
      tokenBudget: 1024,
      now: () => "2026-06-11T00:00:00Z",
    });
    expect(a.hasSymbols).toBe(true);
    expect(a.text).toContain("formatId");
    expect(a.text).toContain("loadUser");
    expect(a.text).toContain("src/core.ts:");
    expect(a.text).toContain("│ "); // outline bars
    expect(a.text).toContain("1024-token budget");
    // The header's measured size is the REAL local count of the body.
    expect(a.tokens).toBeGreaterThan(0);
    expect(a.symbolCount).toBeGreaterThanOrEqual(4);
  });

  it("fits the rendered body to the token budget (Aider-style binary search)", async () => {
    const generous = await buildRepoMapArtifact(repo, { tokenBudget: 4096 });
    const tight = await buildRepoMapArtifact(repo, { tokenBudget: 60 });
    // Where fitting is possible, the measured body size respects the budget
    // and the tight map shows strictly fewer symbols.
    expect(tight.tokens).toBeLessThanOrEqual(60);
    expect(tight.symbolCount).toBeLessThan(generous.symbolCount);
    // A budget below even ONE symbol's line still yields a one-symbol map —
    // the documented honest floor (never an empty shell) — and the header
    // reports the real measured size, which may exceed the budget.
    const tiny = await buildRepoMapArtifact(repo, { tokenBudget: 1 });
    expect(tiny.symbolCount).toBe(1);
    expect(tiny.tokens).toBeGreaterThan(1); // measured truthfully, not clamped
  });

  it("personalizes ranking toward a query", async () => {
    const a = await buildRepoMapArtifact(repo, {
      tokenBudget: 60,
      query: "invoice tax billing",
    });
    // Under a tight budget, the query-biased map must surface billing
    // symbols.
    expect(a.text).toContain("invoiceFor");
  });

  it("declines honestly on a repo with no parseable sources", async () => {
    const empty = mkdtempSync(join(tmpdir(), "repo-proof-map-empty-"));
    writeFileSync(join(empty, "main.py"), "def f():\n    return 1\n");
    const a = await buildRepoMapArtifact(empty);
    expect(a.hasSymbols).toBe(false);
    expect(a.text).toContain("No symbols could be indexed");
    expect(a.text).toContain("TypeScript/JavaScript"); // the limitation, stated
    rmSync(empty, { recursive: true, force: true });
  });

  it("the reported token count is a real measurement bounded by the full text", async () => {
    const a = await buildRepoMapArtifact(repo, { tokenBudget: 512 });
    // The header reports the BODY's measured size: positive, and strictly
    // smaller than the whole document (header included) — i.e. a real count
    // of a real subset, not a fabricated figure.
    const whole = countTokens(a.text).tokens;
    expect(a.tokens).toBeGreaterThan(0);
    expect(a.tokens).toBeLessThan(whole);
    expect(a.text).toContain(`measured: ${a.tokens} tokens, local BPE count`);
  });
});
