/**
 * Adversarial semantic-safety tests for AST equivalence.
 *
 * The single most dangerous failure mode for the whole TCRP program: a
 * cost-reduction feature (F1 diet, F4 bench) calling a SEMANTICALLY CHANGED
 * output "equivalent", thereby masking a quality regression. Every case below
 * is a pair of snippets that differ in meaning and MUST be reported as not
 * equivalent. Several of these were real bugs found by adversarial probing and
 * fixed (const/let/var, regex text, template text, prefix/postfix unary
 * operators).
 *
 * Rule under test: astEquivalent(a, b).equivalent === false for every pair.
 */

import { describe, expect, it } from "vitest";
import { astEquivalent } from "./ast.js";

/**
 * Assert two snippets are NOT equivalent under the STRICT default mode that
 * actually ships as a safety gate. This is the safe direction the whole
 * program depends on.
 */
function notEquivalent(a: string, b: string, mode: "alpha" | "literal" = "literal") {
  const r = astEquivalent(a, b, { identifierMode: mode });
  expect(r.parsedBoth, `both should parse: ${a} | ${b}`).toBe(true);
  expect(r.equivalent, `MUST differ: <<${a}>> vs <<${b}>>`).toBe(false);
}

/** Assert two snippets ARE equivalent (only-trivia / consistent-rename). */
function isEquivalent(a: string, b: string, mode: "alpha" | "literal" = "literal") {
  const r = astEquivalent(a, b, { identifierMode: mode });
  expect(r.equivalent, `should match: <<${a}>> vs <<${b}>>`).toBe(true);
}

describe("declaration mutability is semantic", () => {
  it("const vs let vs var are all distinct", () => {
    notEquivalent("const x = 1;", "let x = 1;");
    notEquivalent("let x = 1;", "var x = 1;");
    notEquivalent("const x = 1;", "var x = 1;");
  });
  it("same keyword still equivalent under alpha-rename", () => {
    isEquivalent("const apple = 1;", "const banana = 1;", "alpha");
    isEquivalent("let a = f(b);", "let x = f(y);", "alpha");
  });
});

describe("regex literals are semantic", () => {
  it("different pattern or flags differ", () => {
    notEquivalent("const re = /foo/;", "const re = /bar/;");
    notEquivalent("const re = /foo/g;", "const re = /foo/i;");
    notEquivalent("const re = /a+/;", "const re = /a*/;");
  });
  it("identical regex is equivalent", () => {
    isEquivalent("const re = /foo/g;", "const x = /foo/g;", "alpha");
  });
});

describe("template literals are semantic", () => {
  it("different static text differs (head/middle/tail)", () => {
    notEquivalent("const s = `hello ${x}`;", "const s = `goodbye ${x}`;");
    notEquivalent("const s = `a${x}b${y}c`;", "const s = `a${x}Z${y}c`;");
    notEquivalent("const s = `end ${x} tail`;", "const s = `end ${x} TAIL`;");
  });
  it("no-substitution template text differs", () => {
    notEquivalent("const s = `hi`;", "const s = `bye`;");
  });
  it("identical template is equivalent under rename", () => {
    isEquivalent("const s = `v=${a}`;", "const s = `v=${b}`;", "alpha");
  });
});

describe("unary operators are semantic", () => {
  it("prefix operators are distinct", () => {
    notEquivalent("const a = -x;", "const a = !x;");
    notEquivalent("const a = -x;", "const a = +x;");
    notEquivalent("const a = ~x;", "const a = !x;");
    notEquivalent("const a = !x;", "const a = !!x;");
  });
  it("postfix increment vs decrement differ", () => {
    notEquivalent("x++;", "x--;");
  });
  it("prefix vs postfix differ", () => {
    notEquivalent("const a = ++x;", "const a = x++;");
  });
  it("same operator still equivalent under rename", () => {
    isEquivalent("const a = -x;", "const a = -y;", "alpha");
  });
});

describe("binary operators are semantic (regression guard)", () => {
  it("arithmetic operators differ", () => {
    notEquivalent("const a = x + y;", "const a = x - y;");
    notEquivalent("const a = x * y;", "const a = x / y;");
    notEquivalent("const a = x % y;", "const a = x ** y;");
  });
  it("comparison/equality operators differ", () => {
    notEquivalent("const a = x == y;", "const a = x === y;");
    notEquivalent("const a = x != y;", "const a = x !== y;");
    notEquivalent("const a = x < y;", "const a = x <= y;");
    notEquivalent("const a = x > y;", "const a = x >= y;");
  });
  it("logical/nullish operators differ", () => {
    notEquivalent("const a = x && y;", "const a = x || y;");
    notEquivalent("const a = x ?? y;", "const a = x || y;");
  });
  it("compound assignment operators differ", () => {
    notEquivalent("a += b;", "a -= b;");
    notEquivalent("a += b;", "a = b;");
    notEquivalent("a &&= b;", "a ||= b;");
  });
});

describe("control flow and structure are semantic", () => {
  it("throw vs return differ", () => {
    notEquivalent("function f() { throw x; }", "function f() { return x; }");
  });
  it("optional chaining differs from plain access", () => {
    notEquivalent("const a = obj?.b;", "const a = obj.b;");
  });
  it("await is semantic", () => {
    notEquivalent(
      "async function f() { return await g(); }",
      "async function f() { return g(); }"
    );
  });
  it("async vs sync differ", () => {
    notEquivalent("function f() {}", "async function f() {}");
  });
  it("optional vs required parameter differ", () => {
    notEquivalent("function f(a?: number) {}", "function f(a: number) {}");
  });
  it("spread vs plain differ", () => {
    notEquivalent("const a = [x];", "const a = [...x];");
  });
  it("if/else branch swap differs", () => {
    notEquivalent(
      "if (c) { a(); } else { b(); }",
      "if (c) { b(); } else { a(); }"
    );
  });
  it("negated condition differs", () => {
    notEquivalent("if (c) { a(); }", "if (!c) { a(); }");
  });
});

describe("type-level changes are semantic", () => {
  it("different type annotations differ", () => {
    notEquivalent("const x: number = f();", "const x: string = f();");
    notEquivalent("function f(): void {}", "function f(): number { return 0; }");
  });
  it("as-cast target type differs", () => {
    notEquivalent("const a = x as string;", "const a = x as number;");
  });
  it("optional vs required property differ", () => {
    notEquivalent("interface I { a?: number }", "interface I { a: number }");
  });
  it("readonly modifier is semantic", () => {
    notEquivalent(
      "interface I { readonly a: number }",
      "interface I { a: number }"
    );
  });
});

describe("literal value changes are semantic (regression guard)", () => {
  it("numeric/string/boolean literals differ", () => {
    notEquivalent("const x = 1;", "const x = 2;");
    notEquivalent('const x = "a";', 'const x = "b";');
    notEquivalent("const x = true;", "const x = false;");
    notEquivalent("const x = null;", "const x = undefined;");
  });
  it("bigint literals differ", () => {
    notEquivalent("const x = 1n;", "const x = 2n;");
  });
});

describe("trivia and consistent renaming remain equivalent", () => {
  it("comments and whitespace are ignored", () => {
    isEquivalent(
      "function add(x:number,y:number){return x+y;}",
      `function add(x: number, y: number) {
         // add two numbers
         return x + y;
       }`
    );
  });
  it("a consistent rename is credited only under explicit alpha mode", () => {
    isEquivalent(
      "const total = items.reduce((s, i) => s + i.price, 0);",
      "const sum = products.reduce((acc, p) => acc + p.price, 0);",
      "alpha"
    );
  });
});

describe("alpha mode is permissive (opt-in, NOT a ship gate)", () => {
  // These pin the KNOWN limitation of alpha-renaming so it can never surprise
  // us silently: consistent renaming of FREE identifiers (references to
  // distinct functions/globals) is treated as equivalent, which is unsound for
  // free references. This is exactly why the DEFAULT is "literal" and why no
  // ship decision (F3 substitution) ever uses alpha equivalence.
  it("consistent free-identifier swap looks equivalent under alpha (limitation)", () => {
    const r = astEquivalent(
      "if (c) { a(); } else { b(); }",
      "if (c) { b(); } else { a(); }",
      { identifierMode: "alpha" }
    );
    expect(r.equivalent).toBe(true); // unsound — documented, not relied upon
  });
  it("the same swap is correctly DIFFERENT under the strict default", () => {
    const r = astEquivalent(
      "if (c) { a(); } else { b(); }",
      "if (c) { b(); } else { a(); }"
    );
    expect(r.equivalent).toBe(false); // the gate that actually ships
  });
});
