import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { extractSymbolsFromSource, isSupportedSource } from "./parser.js";
import { buildGraph } from "./graph.js";
import { pagerank } from "./pagerank.js";
import { indexRepo, queryMap } from "./map.js";

// ============================================================================
// Parser
// ============================================================================

describe("parser", () => {
  it("isSupportedSource — true for ts/tsx/js/jsx/mjs/cjs, false otherwise", () => {
    expect(isSupportedSource("a.ts")).toBe(true);
    expect(isSupportedSource("a.tsx")).toBe(true);
    expect(isSupportedSource("a.js")).toBe(true);
    expect(isSupportedSource("a.jsx")).toBe(true);
    expect(isSupportedSource("a.mjs")).toBe(true);
    expect(isSupportedSource("a.cjs")).toBe(true);
    expect(isSupportedSource("a.py")).toBe(false);
    expect(isSupportedSource("a.go")).toBe(false);
  });

  it("extracts top-level function declarations", () => {
    const src = `
      export function foo(x: number): number { return x + 1; }
      function bar() { return foo(0); }
    `;
    const syms = extractSymbolsFromSource("/x/y.ts", src);
    const names = syms.map((s) => s.name).sort();
    expect(names).toEqual(["bar", "foo"]);
    const foo = syms.find((s) => s.name === "foo")!;
    expect(foo.kind).toBe("function");
    expect(foo.exported).toBe(true);
    const bar = syms.find((s) => s.name === "bar")!;
    expect(bar.references).toContain("foo");
  });

  it("extracts class, interface, type, enum", () => {
    const src = `
      export class Service { do() {} }
      interface Config { x: number }
      type Id = string;
      enum Status { Ok, Error }
    `;
    const syms = extractSymbolsFromSource("/x/y.ts", src);
    const kinds = Object.fromEntries(syms.map((s) => [s.name, s.kind]));
    expect(kinds["Service"]).toBe("class");
    expect(kinds["Config"]).toBe("interface");
    expect(kinds["Id"]).toBe("type");
    expect(kinds["Status"]).toBe("enum");
  });

  it("captures references inside function bodies but not the symbol's own name", () => {
    const src = `
      function helper() { return 1; }
      function compute() {
        const x = helper();
        return helper() + compute_inner();
      }
      function compute_inner() { return 0; }
    `;
    const syms = extractSymbolsFromSource("/x/y.ts", src);
    const compute = syms.find((s) => s.name === "compute")!;
    expect(compute.references).toContain("helper");
    expect(compute.references).toContain("compute_inner");
    expect(compute.references).not.toContain("compute");
  });

  it("treats `const fn = () => ...` as a function-kind symbol", () => {
    const src = `export const greet = (name: string) => "hi " + name;`;
    const syms = extractSymbolsFromSource("/x/y.ts", src);
    expect(syms).toHaveLength(1);
    expect(syms[0].name).toBe("greet");
    expect(syms[0].kind).toBe("function");
    expect(syms[0].exported).toBe(true);
  });

  it("non-source files yield no symbols", () => {
    const syms = extractSymbolsFromSource("/x/y.md", "function foo() {}");
    expect(syms).toEqual([]);
  });

  it("does NOT use regex parsing (smoke: handles TypeScript generics correctly)", () => {
    const src = `
      function id<T extends {a: number; b: string}>(x: T): T { return x; }
      function caller() { return id({a: 1, b: "x"}); }
    `;
    const syms = extractSymbolsFromSource("/x/y.ts", src);
    const id = syms.find((s) => s.name === "id");
    const caller = syms.find((s) => s.name === "caller");
    expect(id).toBeDefined();
    expect(caller!.references).toContain("id");
  });
});

// ============================================================================
// Graph
// ============================================================================

describe("buildGraph", () => {
  it("connects A → B when A references B by name", () => {
    const symbols = [
      ...extractSymbolsFromSource(
        "/a.ts",
        "function b() { return 1; } function a() { return b(); }"
      ),
    ];
    const g = buildGraph(symbols);
    const a = symbols.find((s) => s.name === "a")!;
    const b = symbols.find((s) => s.name === "b")!;
    expect(g.nodes.get(a.id)!.outNeighbors).toContain(b.id);
    expect(g.nodes.get(b.id)!.inNeighbors).toContain(a.id);
  });

  it("skips self-references", () => {
    const symbols = extractSymbolsFromSource(
      "/r.ts",
      "function recurse() { return recurse(); }"
    );
    const g = buildGraph(symbols);
    const r = symbols.find((s) => s.name === "recurse")!;
    expect(g.nodes.get(r.id)!.outNeighbors).toEqual([]);
  });
});

// ============================================================================
// PageRank
// ============================================================================

describe("pagerank — pure power-method", () => {
  it("uniform on a graph with no edges", () => {
    const symbols = extractSymbolsFromSource("/x.ts", "function a() {} function b() {}");
    const g = buildGraph(symbols);
    const { scores, iterations } = pagerank(g);
    const vals = Array.from(scores.values());
    expect(vals[0]).toBeCloseTo(vals[1], 5);
    expect(iterations).toBeGreaterThan(0);
  });

  it("hub node gets a higher score than leaves", () => {
    const src = `
      function hub() { return 1; }
      function leaf1() { return hub(); }
      function leaf2() { return hub(); }
      function leaf3() { return hub(); }
    `;
    const symbols = extractSymbolsFromSource("/x.ts", src);
    const g = buildGraph(symbols);
    const { scores } = pagerank(g);
    const hub = symbols.find((s) => s.name === "hub")!;
    const leaf1 = symbols.find((s) => s.name === "leaf1")!;
    expect(scores.get(hub.id)!).toBeGreaterThan(scores.get(leaf1.id)!);
  });

  it("scores sum to ~1 (probability mass preserved)", () => {
    const src = `
      function a() { b(); }
      function b() { c(); }
      function c() {}
    `;
    const symbols = extractSymbolsFromSource("/x.ts", src);
    const g = buildGraph(symbols);
    const { scores } = pagerank(g);
    const total = Array.from(scores.values()).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it("personalized PageRank concentrates score near the bias node", () => {
    const src = `
      function a() {}
      function b() {}
      function c() { a(); }
    `;
    const symbols = extractSymbolsFromSource("/x.ts", src);
    const g = buildGraph(symbols);
    const a = symbols.find((s) => s.name === "a")!;
    const biased = pagerank(g, { bias: new Map([[a.id, 1]]) });
    const unbiased = pagerank(g);
    expect(biased.scores.get(a.id)!).toBeGreaterThan(unbiased.scores.get(a.id)!);
  });

  it("converges in fewer than maxIterations on a small graph", () => {
    const src = `
      function a() { b(); }
      function b() { c(); }
      function c() { a(); }
    `;
    const symbols = extractSymbolsFromSource("/x.ts", src);
    const g = buildGraph(symbols);
    const { iterations } = pagerank(g, { maxIterations: 50, tolerance: 1e-6 });
    expect(iterations).toBeLessThan(50);
  });
});

// ============================================================================
// End-to-end on a synthetic repo
// ============================================================================

describe("indexRepo + queryMap — end to end", () => {
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "prune-rm-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("indexes a small TS repo and ranks the hub symbol higher", async () => {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(
      join(dir, "src", "auth.ts"),
      `
        export function loginUser(email: string, password: string): string {
          return verifyPassword(password) ? signToken(email) : "";
        }
        export function signToken(email: string): string { return "tok:" + email; }
        function verifyPassword(p: string): boolean { return p.length > 0; }
      `
    );
    writeFileSync(
      join(dir, "src", "router.ts"),
      `
        import { loginUser } from "./auth";
        export function handleLogin(req: { email: string; pw: string }) {
          return loginUser(req.email, req.pw);
        }
      `
    );
    writeFileSync(
      join(dir, "src", "ignored.md"),
      "# this should never be indexed"
    );
    // node_modules should be ignored by default.
    mkdirSync(join(dir, "node_modules", "fake"), { recursive: true });
    writeFileSync(
      join(dir, "node_modules", "fake", "index.ts"),
      "export function shouldBeIgnored() {}"
    );

    const map = await indexRepo(dir);
    expect(map.filesScanned).toBe(2);
    expect(map.symbols.length).toBeGreaterThanOrEqual(4);
    expect(map.symbols.some((s) => s.name === "shouldBeIgnored")).toBe(false);

    const ranked = queryMap(map, { topK: 5 });
    expect(ranked.length).toBeGreaterThan(0);
    // loginUser is referenced from handleLogin AND uses signToken/verifyPassword.
    // It should appear near the top.
    const top = ranked.slice(0, 3).map((r) => r.name);
    expect(top).toContain("loginUser");
  });

  it("taskQuery bias surfaces matching symbols first", async () => {
    writeFileSync(
      join(dir, "core.ts"),
      `
        export function setupCache() {}
        export function setupLogger() {}
        export function setupDatabase() {}
      `
    );
    const map = await indexRepo(dir);
    const unbiased = queryMap(map, { topK: 3 });
    const biased = queryMap(map, { taskQuery: "cache", topK: 3 });
    // With no graph edges between siblings, unbiased gives all equal weight;
    // the bias should lift the cache match to top.
    expect(biased[0].name).toBe("setupCache");
    void unbiased;
  });

  it("queryMap returns at most topK results", async () => {
    let src = "";
    for (let i = 0; i < 30; i++) src += `function fn${i}() {}\n`;
    writeFileSync(join(dir, "big.ts"), src);
    const map = await indexRepo(dir);
    const ranked = queryMap(map, { topK: 7 });
    expect(ranked.length).toBe(7);
  });
});
