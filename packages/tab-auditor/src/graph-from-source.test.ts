/**
 * Tests for buildImportEdges — deriving the auditor's import graph from REAL
 * source via @prune/repo-map (W6: not only caller-supplied edges).
 */

import { describe, it, expect } from "vitest";
import { buildImportEdges } from "./graph-from-source.js";
import { auditOpenTabs } from "./auditor.js";

describe("buildImportEdges (real import graph from source)", () => {
  it("creates a file↔file edge when one file references a symbol defined in another", () => {
    const files = [
      { path: "src/a.ts", content: `export function foo() { return 1; }` },
      {
        path: "src/b.ts",
        content: `import { foo } from "./a";\nexport function useFoo() { return foo() + 1; }`,
      },
    ];
    const edges = buildImportEdges(files);
    expect(edges).toContainEqual({ from: "src/a.ts", to: "src/b.ts" });
  });

  it("produces no edge for genuinely unrelated files", () => {
    const files = [
      { path: "a.ts", content: `export function alpha() { return 1; }` },
      { path: "b.ts", content: `export function beta() { return 2; }` },
    ];
    expect(buildImportEdges(files)).toHaveLength(0);
  });

  it("is deterministic and de-duplicates multiple cross-file references to one edge", () => {
    const files = [
      { path: "a.ts", content: `export const X = 1;\nexport const Y = 2;` },
      {
        path: "b.ts",
        content: `import { X, Y } from "./a";\nexport function f() { return X + Y; }`,
      },
    ];
    const e1 = buildImportEdges(files);
    const e2 = buildImportEdges(files);
    expect(e1).toEqual(e2); // deterministic
    const ab = e1.filter(
      (e) =>
        (e.from === "a.ts" && e.to === "b.ts") ||
        (e.from === "b.ts" && e.to === "a.ts")
    );
    expect(ab).toHaveLength(1); // X and Y collapse to ONE undirected edge
  });

  it("never throws on garbage / unsupported / empty input", () => {
    expect(() =>
      buildImportEdges([
        { path: "x.ts", content: "@@@ not(((valid typescript" },
        null as never,
        { path: "readme.md", content: "# not code" },
      ])
    ).not.toThrow();
    expect(buildImportEdges([])).toEqual([]);
  });

  it("integrates with auditOpenTabs: a graph-adjacent tab outranks a far-away unrelated one", () => {
    // Distinct directories so the ONLY thing favouring `helper` is the derived
    // import edge (not a coincidental shared directory).
    const files = [
      {
        path: "src/core/active.ts",
        content: `import { helper } from "../util/helper";\nexport function main() { return helper(); }`,
      },
      { path: "src/util/helper.ts", content: `export function helper() { return 42; }` },
      { path: "vendor/misc/unrelated.ts", content: `export function lonely() { return 0; }` },
    ];
    const importEdges = buildImportEdges(files);
    expect(importEdges).toContainEqual({ from: "src/core/active.ts", to: "src/util/helper.ts" });
    const report = auditOpenTabs({
      tabs: [
        { path: "src/core/active.ts", tokenCount: 100 },
        { path: "src/util/helper.ts", tokenCount: 100 },
        { path: "vendor/misc/unrelated.ts", tokenCount: 100 },
      ],
      activeFile: "src/core/active.ts",
      importEdges,
    });
    const helper = report.tabs.find((t) => t.path === "src/util/helper.ts")!;
    const unrelated = report.tabs.find((t) => t.path === "vendor/misc/unrelated.ts")!;
    // helper is import-adjacent (graph hop 1 → 0.6); unrelated shares no path
    // prefix and no edge, so the derived graph makes helper clearly more relevant.
    expect(helper.relevanceScore).toBeGreaterThan(unrelated.relevanceScore);
  });
});
