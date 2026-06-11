import { describe, expect, it } from "vitest";
import { ownersFor, parseCodeowners } from "./codeowners.js";

describe("parseCodeowners", () => {
  it("parses rules, skips comments/blanks, handles tab separators", () => {
    const parsed = parseCodeowners(
      [
        "# comment",
        "",
        "*.ts @ts-team",
        "/docs/\t@docs-team @writers",
        "packages/core/ @core",
      ].join("\n")
    );
    expect(parsed.rules).toHaveLength(3);
    expect(parsed.rules[1]).toEqual({
      pattern: "/docs/",
      owners: ["@docs-team", "@writers"],
    });
    expect(parsed.skipped).toEqual([]);
  });

  it("skips unsupported patterns WITH reasons, never guesses", () => {
    const parsed = parseCodeowners(
      [
        "*.[jt]s @x", // character class
        "!excluded @x", // negation
        "file\\ name.ts @x", // escape
        "what?.ts @x", // ?
        "orphan-pattern-no-owner",
      ].join("\n")
    );
    expect(parsed.rules).toHaveLength(0);
    expect(parsed.skipped).toHaveLength(5);
    expect(parsed.skipped.map((s) => s.reason)).toEqual([
      'unsupported glob character "["',
      "negation patterns are not supported",
      "escaped characters are not supported",
      'unsupported glob character "?"',
      "no owners listed",
    ]);
  });
});

describe("ownersFor", () => {
  const parsed = parseCodeowners(
    [
      "* @default",
      "*.ts @ts-team",
      "docs @docs-team",
      "/packages/core/ @core",
      "/apps/*/hooks/ @hooks-team",
      "/legal/**/contracts @lawyers",
      "*.test.ts @qa",
    ].join("\n")
  );

  it("basename glob matches at any depth; LAST matching rule wins", () => {
    expect(ownersFor("src/deep/nested/x.ts", parsed)).toEqual(["@ts-team"]);
    // *.test.ts comes after *.ts → wins on test files.
    expect(ownersFor("src/a.test.ts", parsed)).toEqual(["@qa"]);
  });

  it("a bare directory name owns everything beneath it", () => {
    expect(ownersFor("docs/guide/readme.md", parsed)).toEqual(["@docs-team"]);
  });

  it("anchored directory rules own their subtree only", () => {
    expect(ownersFor("packages/core/src/x.md", parsed)).toEqual(["@core"]);
    // Same shape elsewhere does NOT match the anchored rule.
    expect(ownersFor("other/packages/core/x.md", parsed)).toEqual(["@default"]);
  });

  it("single-star segment matches exactly one segment", () => {
    expect(ownersFor("apps/extension/hooks/a.mjs", parsed)).toEqual(["@hooks-team"]);
    expect(ownersFor("apps/a/b/hooks/x.mjs", parsed)).toEqual(["@default"]);
  });

  it("** spans zero or more segments", () => {
    expect(ownersFor("legal/contracts", parsed)).toEqual(["@lawyers"]);
    expect(ownersFor("legal/eu/2026/contracts", parsed)).toEqual(["@lawyers"]);
  });

  it("falls back to the catch-all; empty when no rules at all", () => {
    expect(ownersFor("Makefile", parsed)).toEqual(["@default"]);
    expect(ownersFor("anything", { rules: [], skipped: [] })).toEqual([]);
  });
});
