/**
 * AST-based assertion census. Walks a TypeScript/JavaScript source tree with
 * the compiler API and counts assertion-bearing constructs structurally. There
 * is no regex anywhere: every classification is an exact match against an AST
 * node's identifier text or syntax kind.
 *
 * The walk is intentionally a *census*, not a proof. Its job is to make the
 * before/after of an edit comparable under one consistent rule, so a verdict
 * can reason about deltas (assertions removed, tests disabled, tautologies
 * introduced). Where a construct is ambiguous, it is simply not counted — the
 * census never invents a violation.
 */

import ts from "typescript";

import type { AssertionInventory, ScriptKind } from "./types.js";
import {
  DIRECT_ASSERT_ROOTS,
  EQUALITY_MATCHERS,
  FOCUS_IDENTIFIERS,
  MATCHER_ROOTS,
  ONLY_MEMBERS,
  SKIP_IDENTIFIERS,
  SKIP_MEMBERS,
  TEST_RUNNER_ROOTS,
  THROW_MATCHERS,
  TRUTHY_MATCHERS,
} from "./constants.js";

function toScriptKind(kind: ScriptKind): ts.ScriptKind {
  switch (kind) {
    case "tsx":
      return ts.ScriptKind.TSX;
    case "js":
      return ts.ScriptKind.JS;
    case "jsx":
      return ts.ScriptKind.JSX;
    default:
      return ts.ScriptKind.TS;
  }
}

function countSyntaxErrors(sf: ts.SourceFile): number {
  const diags = (sf as unknown as { parseDiagnostics?: unknown[] })
    .parseDiagnostics;
  return Array.isArray(diags) ? diags.length : 0;
}

/**
 * Walk a callee expression down to its left-most identifier, stepping through
 * call/property/element/non-null/parenthesized links. `expect(x).toBe` → the
 * root is `expect`; `assert.deepEqual` → `assert`. Returns undefined when the
 * chain doesn't bottom out at a plain identifier.
 */
function rootIdentifier(expr: ts.Expression): string | undefined {
  let cur: ts.Node = expr;
  // Bounded by tree depth; no unbounded loop on a finite AST.
  for (;;) {
    if (ts.isCallExpression(cur)) {
      cur = cur.expression;
    } else if (ts.isPropertyAccessExpression(cur)) {
      cur = cur.expression;
    } else if (ts.isElementAccessExpression(cur)) {
      cur = cur.expression;
    } else if (ts.isNonNullExpression(cur)) {
      cur = cur.expression;
    } else if (ts.isParenthesizedExpression(cur)) {
      cur = cur.expression;
    } else {
      break;
    }
  }
  return ts.isIdentifier(cur) ? cur.text : undefined;
}

/** The matcher name of a call whose callee is a property access (`.toBe`). */
function matcherName(call: ts.CallExpression): string | undefined {
  if (ts.isPropertyAccessExpression(call.expression)) {
    return call.expression.name.text;
  }
  return undefined;
}

/**
 * Canonical text for a *scalar literal* expression, or undefined if the node
 * is not a literal we can compare soundly. Two expressions with equal canonical
 * text are the same literal value; this is the basis of the tautology check.
 */
function scalarLiteralText(node: ts.Expression): string | undefined {
  if (ts.isStringLiteralLike(node)) return `s:${node.text}`;
  if (ts.isNumericLiteral(node)) return `n:${node.text}`;
  if (ts.isBigIntLiteral(node)) return `bi:${node.text}`;
  switch (node.kind) {
    case ts.SyntaxKind.TrueKeyword:
      return "b:true";
    case ts.SyntaxKind.FalseKeyword:
      return "b:false";
    case ts.SyntaxKind.NullKeyword:
      return "null";
    default:
      return undefined;
  }
}

const TRUTHY_LITERAL_FOR: Record<string, "truthy" | "falsy"> = {
  "b:true": "truthy",
  "b:false": "falsy",
  null: "falsy",
};

/**
 * Is `call` a structurally tautological assertion — true regardless of the code
 * under test? Three sound shapes:
 *   - `expect(LIT).toBe(LIT)` with equal scalar literals,
 *   - `expect(LIT).toBeTruthy()/toBeDefined()` on a truthy literal (and the
 *     falsy duals on a falsy literal),
 *   - `assert(LIT)` / `assert.ok(LIT)` on a truthy literal.
 * Only clear cases return true; anything else is not a tautology.
 */
function isTautology(call: ts.CallExpression): boolean {
  const matcher = matcherName(call);

  // expect(SUBJECT).MATCHER(EXPECTED)
  if (matcher && ts.isPropertyAccessExpression(call.expression)) {
    const head = call.expression.expression; // expect(SUBJECT)
    if (ts.isCallExpression(head) && head.arguments.length === 1) {
      const subjectRoot = rootIdentifier(head);
      if (subjectRoot && MATCHER_ROOTS.has(subjectRoot)) {
        const subjectLit = scalarLiteralText(head.arguments[0]);
        if (subjectLit === undefined) return false;

        if (EQUALITY_MATCHERS.has(matcher) && call.arguments.length === 1) {
          const expectedLit = scalarLiteralText(call.arguments[0]);
          return expectedLit !== undefined && expectedLit === subjectLit;
        }
        if (TRUTHY_MATCHERS.has(matcher)) {
          const polarity = TRUTHY_LITERAL_FOR[subjectLit];
          if (matcher === "toBeTruthy") return polarity === "truthy";
          if (matcher === "toBeFalsy") return polarity === "falsy";
          if (matcher === "toBeNull") return subjectLit === "null";
          // toBeDefined: any non-undefined literal is trivially defined.
          if (matcher === "toBeDefined") return true;
          // toBeUndefined on a concrete literal is never tautologically true.
          if (matcher === "toBeUndefined") return false;
        }
      }
    }
    return false;
  }

  // assert(LIT) / assert.ok(LIT) — direct truthiness assertion on a literal.
  const root = rootIdentifier(call.expression);
  if (root && DIRECT_ASSERT_ROOTS.has(root) && call.arguments.length >= 1) {
    const lit = scalarLiteralText(call.arguments[0]);
    if (lit === undefined) return false;
    // A bare `assert(x)` or `assert.ok(x)`; only flag the truthiness forms.
    const member = matcherName(call);
    if (member === undefined || member === "ok" || member === "isOk") {
      return TRUTHY_LITERAL_FOR[lit] === "truthy";
    }
  }
  return false;
}

/**
 * Build the assertion census for one source string. Returns `parsed:false` with
 * zeroed counts when the source has syntax errors — callers must treat an
 * unparseable side as "unknown", never as "zero assertions on purpose".
 */
export function inventoryAssertions(
  code: string,
  scriptKind: ScriptKind = "ts"
): AssertionInventory {
  const sf = ts.createSourceFile(
    "snippet." + scriptKind,
    code,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    toScriptKind(scriptKind)
  );

  if (countSyntaxErrors(sf) > 0) {
    return {
      parsed: false,
      assertions: 0,
      skippedTests: 0,
      focusedTests: 0,
      tautologies: 0,
      throwExpectations: 0,
    };
  }

  let assertions = 0;
  let skippedTests = 0;
  let focusedTests = 0;
  let tautologies = 0;
  let throwExpectations = 0;

  const visit = (node: ts.Node): void => {
    // --- skip / focus via bare identifiers (xit, fdescribe, ...) ---
    if (ts.isCallExpression(node)) {
      const calleeRoot = rootIdentifier(node.expression);

      if (calleeRoot && ts.isIdentifier(node.expression)) {
        if (SKIP_IDENTIFIERS.has(calleeRoot)) skippedTests++;
        else if (FOCUS_IDENTIFIERS.has(calleeRoot)) focusedTests++;
      }

      // --- skip / focus via member chains (it.skip, describe.only) ---
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        calleeRoot &&
        TEST_RUNNER_ROOTS.has(calleeRoot)
      ) {
        const member = node.expression.name.text;
        if (SKIP_MEMBERS.has(member)) skippedTests++;
        else if (ONLY_MEMBERS.has(member)) focusedTests++;
      }

      // --- assertions ---
      const matcher = matcherName(node);
      if (matcher !== undefined && calleeRoot && MATCHER_ROOTS.has(calleeRoot)) {
        // Matcher-form assertion: expect(x).toBe(y). Counts once (the inner
        // bare `expect(x)` call has an Identifier callee, not a property one).
        assertions++;
        if (THROW_MATCHERS.has(matcher)) throwExpectations++;
        if (isTautology(node)) tautologies++;
      } else if (calleeRoot && DIRECT_ASSERT_ROOTS.has(calleeRoot)) {
        // Direct assert: assert(x) or assert.equal(a, b). Skip the namespace
        // head with no call args nuance — any assert-rooted call is one check.
        assertions++;
        if (matcher !== undefined && THROW_MATCHERS.has(matcher)) {
          throwExpectations++;
        }
        if (isTautology(node)) tautologies++;
      }
    }

    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);

  return {
    parsed: true,
    assertions,
    skippedTests,
    focusedTests,
    tautologies,
    throwExpectations,
  };
}
