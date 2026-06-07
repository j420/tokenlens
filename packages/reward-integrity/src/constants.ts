/**
 * Deterministic vocabularies for the interlock. Every set here is an exact
 * identifier-text match performed against AST nodes — never a regex over source
 * text. Keeping them centralized makes the structural rules auditable.
 */

/**
 * Assertion library roots that only count in *matcher* form — the bare head
 * call (`expect(x)`) is not itself an assertion; the matcher (`.toBe(y)`) is.
 * Counting matcher calls (callee is a property access rooted here) also avoids
 * double-counting the inner head call.
 */
export const MATCHER_ROOTS: ReadonlySet<string> = new Set([
  "expect",
  "expectTypeOf",
  "should",
]);

/**
 * Assertion roots that count as a direct call (`assert(x)`, `invariant(x)`) and
 * also in member form (`assert.equal(...)`). These are the node:assert / chai
 * `assert` / invariant families.
 */
export const DIRECT_ASSERT_ROOTS: ReadonlySet<string> = new Set([
  "assert",
  "invariant",
  "ok", // chai's `ok` is usually `assert.ok`, but a bare `ok(x)` import exists
]);

/** Identifiers that introduce a test or suite (the targets of `.skip`/`.only`). */
export const TEST_RUNNER_ROOTS: ReadonlySet<string> = new Set([
  "it",
  "test",
  "describe",
  "suite",
  "bench",
  "context",
]);

/** Member names that DISABLE a test when chained onto a runner root. */
export const SKIP_MEMBERS: ReadonlySet<string> = new Set(["skip", "todo"]);

/** Member names that NARROW the suite (hide sibling failures). */
export const ONLY_MEMBERS: ReadonlySet<string> = new Set(["only"]);

/** Bare identifiers that disable a test outright (Jasmine/Jest `x`-prefixes). */
export const SKIP_IDENTIFIERS: ReadonlySet<string> = new Set([
  "xit",
  "xtest",
  "xdescribe",
  "xcontext",
]);

/** Bare identifiers that focus a test (`f`-prefixes). */
export const FOCUS_IDENTIFIERS: ReadonlySet<string> = new Set([
  "fit",
  "fdescribe",
]);

/** Matcher names that express a throw/rejection expectation. */
export const THROW_MATCHERS: ReadonlySet<string> = new Set([
  "toThrow",
  "toThrowError",
  "rejects",
  "throws",
  "rejectedWith",
]);

/**
 * Equality matchers used in the tautology check: `expect(A).toBe(B)` is
 * tautological when A and B are equal literals.
 */
export const EQUALITY_MATCHERS: ReadonlySet<string> = new Set([
  "toBe",
  "toEqual",
  "toStrictEqual",
  "equal",
  "equals",
  "strictEqual",
  "deepEqual",
]);

/** Truthiness matchers that are tautological against a constant subject. */
export const TRUTHY_MATCHERS: ReadonlySet<string> = new Set([
  "toBeTruthy",
  "toBeDefined",
  "toBeFalsy",
  "toBeNull",
  "toBeUndefined",
]);

/**
 * File path suffixes that deterministically mark a test file. Matched with
 * `endsWith` against the normalized path — not a regex. `extraTestSuffixes`
 * from config is appended to this base set.
 */
export const TEST_FILE_SUFFIXES: readonly string[] = [
  ".test.ts",
  ".test.tsx",
  ".test.js",
  ".test.jsx",
  ".test.mts",
  ".test.cts",
  ".spec.ts",
  ".spec.tsx",
  ".spec.js",
  ".spec.jsx",
  ".spec.mts",
  ".spec.cts",
];

/** Path segments that mark a directory of tests (e.g. `__tests__/foo.ts`). */
export const TEST_DIR_SEGMENTS: ReadonlySet<string> = new Set([
  "__tests__",
  "__test__",
]);
