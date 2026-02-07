/**
 * Token Saver Tests
 *
 * Comprehensive tests for all Token Saver features:
 * - Signature extraction (Smart Copy)
 * - Chunk-based processing for large files
 * - Session memory deduplication
 * - Pre-flight optimizer
 * - Compaction recovery
 */

import {
  _testing,
  generateSmartCopy,
  analyzePreFlight,
  recordFileRead,
  getSessionStats,
  resetSessionMemory,
  trackDecision,
  getDecisionsAtRisk,
  generateCompactionReminder,
  extractDecisionsFromText,
  incrementTurn,
  getAllDecisions,
  isFileInContext,
  isFileContentCurrent,
  getFileFromMemory,
} from "./token-saver";

const {
  extractSignatures,
  extractSignaturesFromLines,
  stripStringsAndComments,
  countBraces,
  hashContent,
  fuzzyMatch,
  MAX_LINES_PER_CHUNK,
  MAX_SIGNATURES,
} = _testing;

// ============================================================================
// Test Cases
// ============================================================================

interface TestCase {
  name: string;
  code: string;
  language?: string;
  expected: string[];
  notExpected?: string[];
}

const signatureTestCases: TestCase[] = [
  {
    name: "TypeScript function",
    code: `
export function calculateTotal(items: Item[], taxRate: number): number {
  let total = 0;
  for (const item of items) {
    total += item.price;
  }
  return total * (1 + taxRate);
}
`,
    expected: ["calculateTotal"],
  },
  {
    name: "Arrow function with parens",
    code: `
export const processData = async (input: string): Promise<Result> => {
  const parsed = JSON.parse(input);
  return { data: parsed };
};
`,
    expected: ["processData"],
  },
  {
    name: "Arrow function without parens",
    code: `
const double = x => x * 2;
`,
    expected: ["double"],
  },
  {
    name: "Class with methods",
    code: `
export class AuthService {
  private token: string;

  async login(email: string, password: string): Promise<Token> {
    return { value: "token" };
  }

  logout(): void {
    this.token = "";
  }

  get isLoggedIn(): boolean {
    return !!this.token;
  }

  set currentToken(t: string) {
    this.token = t;
  }
}
`,
    expected: ["AuthService", "login", "logout", "isLoggedIn", "currentToken"],
  },
  {
    name: "Interface and type",
    code: `
export interface User {
  id: string;
  name: string;
  email: string;
}

export type UserRole = "admin" | "user" | "guest";
`,
    expected: ["User", "UserRole"],
  },
  {
    name: "Braces in strings shouldn't confuse",
    code: `
function parseJson(input: string): object {
  const template = "{ foo: bar }";
  return JSON.parse(input);
}
`,
    expected: ["parseJson"],
    notExpected: ["foo"],
  },
  {
    name: "Python function with decorator",
    code: `
@app.route("/api/users")
@authenticate
def get_users(request):
    return User.objects.all()
`,
    expected: ["get_users"],
    language: "python",
  },
  {
    name: "Go function",
    code: `
func (s *Server) HandleRequest(w http.ResponseWriter, r *http.Request) error {
    return nil
}
`,
    expected: ["HandleRequest"],
    language: "go",
  },
  {
    name: "Export default function",
    code: `
export default function Main() {
  return <div>Hello</div>;
}
`,
    expected: ["default function Main"],
  },
  {
    name: "Reserved words not captured as methods",
    code: `
class Parser {
  parse(input: string): AST {
    if (input.length === 0) {
      return null;
    }
    for (const char of input) {
      // process
    }
    return this.buildAST(input);
  }
}
`,
    expected: ["Parser", "parse"],
    notExpected: ["if", "for", "return"],
  },
  {
    name: "Imports are captured",
    code: `
import { useState, useEffect } from "react";
import * as path from "path";
import fs from "fs";

export function MyComponent() {
  return <div />;
}
`,
    expected: ["useState", "useEffect", "path", "fs", "MyComponent"],
  },
  {
    name: "Multi-line function signature",
    code: `
export async function complexFunction(
  param1: string,
  param2: number,
  param3: { foo: string; bar: number }
): Promise<Result> {
  return { success: true };
}
`,
    expected: ["complexFunction"],
  },
  {
    name: "Static and private methods",
    code: `
class Utils {
  static formatDate(date: Date): string {
    return date.toISOString();
  }

  private internalMethod(): void {
    console.log("internal");
  }
}
`,
    expected: ["Utils", "formatDate", "internalMethod"],
  },
];

// ============================================================================
// Test Runner
// ============================================================================

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

function runSignatureTests(): TestResult[] {
  const results: TestResult[] = [];

  for (const test of signatureTestCases) {
    const language = test.language || "typescript";
    const output = extractSignatures(test.code, language);

    let passed = true;
    let error = "";

    // Check expected items are present
    for (const expected of test.expected) {
      if (!output.includes(expected)) {
        passed = false;
        error = `Missing expected: "${expected}"`;
        break;
      }
    }

    // Check notExpected items are absent
    if (passed && test.notExpected) {
      for (const notExpected of test.notExpected) {
        // Check for word boundaries to avoid false matches
        const pattern = new RegExp(`\\b${notExpected}\\s*[({]`);
        if (pattern.test(output)) {
          passed = false;
          error = `Unexpected match: "${notExpected}"`;
          break;
        }
      }
    }

    results.push({ name: test.name, passed, error });
  }

  return results;
}

function runChunkProcessingTests(): TestResult[] {
  const results: TestResult[] = [];

  // Test 1: Small file should not use chunks
  {
    const smallCode = Array(100)
      .fill("function test() { return 1; }")
      .join("\n");
    const output = extractSignatures(smallCode, "typescript");
    results.push({
      name: "Small file uses single pass",
      passed: !output.includes("Chunk"),
      error: output.includes("Chunk") ? "Small file incorrectly chunked" : undefined,
    });
  }

  // Test 2: Large file should use chunks
  {
    const largeLines: string[] = [];
    for (let i = 0; i < 6000; i++) {
      if (i % 500 === 0) {
        largeLines.push(`function func${i}() { return ${i}; }`);
      } else {
        largeLines.push(`  // Line ${i}`);
      }
    }
    const output = extractSignatures(largeLines.join("\n"), "typescript");

    results.push({
      name: "Large file uses chunk processing",
      passed: output.includes("Chunk") || output.includes("chunks"),
      error: !output.includes("Chunk") && !output.includes("chunks")
        ? "Large file not chunked"
        : undefined,
    });

    // Check signatures from different chunks are captured
    const hasFunc0 = output.includes("func0");
    const hasFunc3000 = output.includes("func3000");
    results.push({
      name: "Signatures from multiple chunks captured",
      passed: hasFunc0 && hasFunc3000,
      error:
        !hasFunc0 || !hasFunc3000
          ? `Missing: func0=${hasFunc0}, func3000=${hasFunc3000}`
          : undefined,
    });
  }

  // Test 3: Deduplication across chunks
  {
    const lines: string[] = [];
    for (let i = 0; i < 5000; i++) {
      if (i % 1000 === 0) {
        // Same import in different chunks
        lines.push('import { shared } from "./shared";');
      }
      lines.push(`// filler line ${i}`);
    }
    const output = extractSignatures(lines.join("\n"), "typescript");
    const importCount = (output.match(/import \{ shared \}/g) || []).length;

    results.push({
      name: "Duplicate imports deduplicated",
      passed: importCount === 1,
      error: importCount !== 1 ? `Import appeared ${importCount} times` : undefined,
    });
  }

  return results;
}

function runSessionMemoryTests(): TestResult[] {
  const results: TestResult[] = [];

  // Reset session first
  resetSessionMemory();

  // Test 1: Record first file read
  {
    const result = recordFileRead("/test/file1.ts", "const x = 1;");
    results.push({
      name: "First file read is not duplicate",
      passed: !result.isDuplicate && result.tokensSaved === 0,
      error: result.isDuplicate ? "First read marked as duplicate" : undefined,
    });
  }

  // Test 2: Same content is duplicate
  {
    const result = recordFileRead("/test/file1.ts", "const x = 1;");
    results.push({
      name: "Same content detected as duplicate",
      passed: result.isDuplicate && result.tokensSaved > 0,
      error: !result.isDuplicate ? "Same content not detected as duplicate" : undefined,
    });
  }

  // Test 3: Changed content is not duplicate
  {
    const result = recordFileRead("/test/file1.ts", "const x = 2; // changed");
    results.push({
      name: "Changed content detected",
      passed: !result.isDuplicate && result.contentChanged,
      error: !result.contentChanged ? "Content change not detected" : undefined,
    });
  }

  // Test 4: isFileInContext works
  {
    results.push({
      name: "isFileInContext returns true for tracked file",
      passed: isFileInContext("/test/file1.ts"),
      error: !isFileInContext("/test/file1.ts") ? "File not found in context" : undefined,
    });

    results.push({
      name: "isFileInContext returns false for unknown file",
      passed: !isFileInContext("/test/unknown.ts"),
      error: isFileInContext("/test/unknown.ts")
        ? "Unknown file found in context"
        : undefined,
    });
  }

  // Test 5: Session stats are correct
  {
    const stats = getSessionStats();
    results.push({
      name: "Session stats track files correctly",
      passed: stats.filesRead >= 1 && stats.deduplicationCount >= 1,
      error:
        stats.filesRead < 1
          ? "No files tracked"
          : stats.deduplicationCount < 1
            ? "No duplications tracked"
            : undefined,
    });
  }

  // Clean up
  resetSessionMemory();

  return results;
}

function runPreflightTests(): TestResult[] {
  const results: TestResult[] = [];

  const testFiles = [
    { path: "/src/auth/login.ts", content: "function login() {}", tokens: 100 },
    { path: "/src/auth/logout.ts", content: "function logout() {}", tokens: 80 },
    { path: "/src/components/Header.tsx", content: "<div>Header</div>", tokens: 50 },
    { path: "/src/utils/format.ts", content: "function format() {}", tokens: 60 },
    { path: "/package.json", content: '{"name": "test"}', tokens: 20 },
  ];

  // Test 1: Auth-related prompt boosts auth files
  {
    const analysis = analyzePreFlight("fix the login authentication", testFiles, 3);
    const topFiles = analysis.recommendedContext.files.slice(0, 2);

    results.push({
      name: "Auth prompt boosts auth files",
      passed: topFiles.some((f) => f.includes("login") || f.includes("auth")),
      error: !topFiles.some((f) => f.includes("login") || f.includes("auth"))
        ? `Top files: ${topFiles.join(", ")}`
        : undefined,
    });
  }

  // Test 2: Config files are deprioritized
  {
    const analysis = analyzePreFlight("fix the code", testFiles, 3);
    const recommended = analysis.recommendedContext.files;

    results.push({
      name: "Config files deprioritized for code tasks",
      passed: !recommended.includes("/package.json"),
      error: recommended.includes("/package.json")
        ? "package.json included for code task"
        : undefined,
    });
  }

  // Test 3: Active file gets boosted
  {
    const analysis = analyzePreFlight(
      "something unrelated",
      testFiles,
      3,
      "/src/utils/format.ts"
    );
    const topFile = analysis.recommendedContext.files[0];

    results.push({
      name: "Active file gets highest score",
      passed: topFile === "/src/utils/format.ts",
      error:
        topFile !== "/src/utils/format.ts"
          ? `Top file was ${topFile} instead of active file`
          : undefined,
    });
  }

  // Test 4: Fuzzy matching works
  {
    const testFilesWithAuth = [
      { path: "/src/authentication.ts", content: "auth logic", tokens: 100 },
      { path: "/src/other.ts", content: "other code", tokens: 100 },
    ];
    const analysis = analyzePreFlight("fix auth", testFilesWithAuth, 3);

    results.push({
      name: "Fuzzy match: 'auth' matches 'authentication'",
      passed: analysis.recommendedContext.files.includes("/src/authentication.ts"),
      error: !analysis.recommendedContext.files.includes("/src/authentication.ts")
        ? "auth did not match authentication"
        : undefined,
    });
  }

  return results;
}

function runCompactionTests(): TestResult[] {
  const results: TestResult[] = [];

  // Reset first
  resetSessionMemory();

  // Test 1: Track decision
  {
    const result = trackDecision("Use bcrypt for passwords", "requirement", "critical");
    results.push({
      name: "Decision tracked successfully",
      passed: result.added,
      error: !result.added ? "Decision not added" : undefined,
    });
  }

  // Test 2: Duplicate detection
  {
    const result = trackDecision("Use bcrypt for passwords", "requirement", "critical");
    results.push({
      name: "Duplicate decision detected",
      passed: !result.added,
      error: result.added ? "Duplicate not detected" : undefined,
    });
  }

  // Test 3: Get all decisions
  {
    trackDecision("JWT expiry 15 min", "configuration", "high");
    const decisions = getAllDecisions();

    results.push({
      name: "getAllDecisions returns tracked decisions",
      passed: decisions.length >= 2,
      error: decisions.length < 2 ? `Only ${decisions.length} decisions` : undefined,
    });
  }

  // Test 4: Decisions at risk (after turn advancement)
  {
    incrementTurn();
    incrementTurn();
    incrementTurn();
    incrementTurn();
    const atRisk = getDecisionsAtRisk();

    results.push({
      name: "Old decisions flagged as at risk",
      passed: atRisk.length >= 1,
      error: atRisk.length < 1 ? "No decisions at risk after 4 turns" : undefined,
    });
  }

  // Test 5: Compaction reminder generation
  {
    const reminder = generateCompactionReminder();
    results.push({
      name: "Compaction reminder generated",
      passed: reminder.length > 0 && reminder.includes("Remember"),
      error:
        reminder.length === 0
          ? "Empty reminder"
          : !reminder.includes("Remember")
            ? "Missing 'Remember' header"
            : undefined,
    });
  }

  // Test 6: Extract decisions from text
  {
    const text = `
      Set JWT expiry to 30 minutes.
      The rate limiter must run before authentication.
      Use argon2 instead of bcrypt.
    `;
    const extracted = extractDecisionsFromText(text);

    results.push({
      name: "Decisions extracted from text",
      passed: extracted.length >= 1,
      error: extracted.length < 1 ? "No decisions extracted" : undefined,
    });
  }

  // Clean up
  resetSessionMemory();

  return results;
}

function runHelperTests(): TestResult[] {
  const results: TestResult[] = [];

  // Test stripStringsAndComments
  {
    const input = 'const x = "{ braces }"; // comment';
    const output = stripStringsAndComments(input);

    results.push({
      name: "stripStringsAndComments removes string content",
      passed: !output.includes("braces"),
      error: output.includes("braces") ? "String content not removed" : undefined,
    });

    results.push({
      name: "stripStringsAndComments removes comments",
      passed: !output.includes("comment"),
      error: output.includes("comment") ? "Comment not removed" : undefined,
    });
  }

  // Test countBraces
  {
    const braces = countBraces('const x = "{ }"; { }');
    results.push({
      name: "countBraces ignores braces in strings",
      passed: braces.open === 1 && braces.close === 1,
      error:
        braces.open !== 1 || braces.close !== 1
          ? `Got open=${braces.open}, close=${braces.close}`
          : undefined,
    });
  }

  // Test hashContent consistency
  {
    const hash1 = hashContent("test content");
    const hash2 = hashContent("test content");
    const hash3 = hashContent("different content");

    results.push({
      name: "hashContent is deterministic",
      passed: hash1 === hash2,
      error: hash1 !== hash2 ? "Same content produced different hashes" : undefined,
    });

    results.push({
      name: "hashContent produces different hashes for different content",
      passed: hash1 !== hash3,
      error: hash1 === hash3 ? "Different content produced same hash" : undefined,
    });
  }

  // Test fuzzyMatch
  {
    results.push({
      name: "fuzzyMatch: 'auth' matches 'authentication'",
      passed: fuzzyMatch("auth", "authentication"),
      error: !fuzzyMatch("auth", "authentication") ? "Match failed" : undefined,
    });

    results.push({
      name: "fuzzyMatch: 'xyz' does not match 'abc'",
      passed: !fuzzyMatch("xyz", "abc"),
      error: fuzzyMatch("xyz", "abc") ? "Unexpected match" : undefined,
    });

    results.push({
      name: "fuzzyMatch: short words require exact match",
      passed: !fuzzyMatch("ab", "abc"),
      error: fuzzyMatch("ab", "abc") ? "Short word matched incorrectly" : undefined,
    });
  }

  return results;
}

function runSmartCopyIntegrationTests(): TestResult[] {
  const results: TestResult[] = [];

  // Test generateSmartCopy end-to-end
  {
    const files = [
      {
        path: "/src/auth.ts",
        content: `
import { Token } from "./types";

export interface AuthConfig {
  secret: string;
  expiry: number;
}

export class AuthService {
  private token: string;

  async login(email: string, password: string): Promise<Token> {
    // Full implementation here
    const hash = await bcrypt.hash(password, 10);
    const user = await db.findUser(email);
    if (!user) throw new Error("Not found");
    const valid = await bcrypt.compare(password, user.hash);
    if (!valid) throw new Error("Invalid");
    return this.generateToken(user);
  }

  logout(): void {
    this.token = "";
  }
}
`,
      },
    ];

    const result = generateSmartCopy(files, { signatureOnly: true });

    results.push({
      name: "Smart copy generates output",
      passed: result.optimizedCode.length > 0,
      error: result.optimizedCode.length === 0 ? "Empty output" : undefined,
    });

    results.push({
      name: "Smart copy reduces tokens",
      passed: result.savings > 0 && result.savingsPercent > 0,
      error:
        result.savings <= 0
          ? "No savings"
          : result.savingsPercent <= 0
            ? "No percent savings"
            : undefined,
    });

    results.push({
      name: "Smart copy includes class signature",
      passed: result.optimizedCode.includes("AuthService"),
      error: !result.optimizedCode.includes("AuthService")
        ? "Missing class"
        : undefined,
    });

    results.push({
      name: "Smart copy includes method signatures",
      passed:
        result.optimizedCode.includes("login") &&
        result.optimizedCode.includes("logout"),
      error:
        !result.optimizedCode.includes("login")
          ? "Missing login method"
          : !result.optimizedCode.includes("logout")
            ? "Missing logout method"
            : undefined,
    });

    results.push({
      name: "Smart copy excludes implementation details",
      passed: !result.optimizedCode.includes("bcrypt"),
      error: result.optimizedCode.includes("bcrypt")
        ? "Implementation leaked"
        : undefined,
    });
  }

  return results;
}

// ============================================================================
// Main Test Runner
// ============================================================================

export interface TestSuite {
  name: string;
  results: TestResult[];
}

export function runAllTokenSaverTests(): {
  suites: TestSuite[];
  totalPassed: number;
  totalFailed: number;
  summary: string[];
} {
  const suites: TestSuite[] = [
    { name: "Signature Extraction", results: runSignatureTests() },
    { name: "Chunk Processing", results: runChunkProcessingTests() },
    { name: "Session Memory", results: runSessionMemoryTests() },
    { name: "Pre-flight Optimizer", results: runPreflightTests() },
    { name: "Compaction Recovery", results: runCompactionTests() },
    { name: "Helper Functions", results: runHelperTests() },
    { name: "Smart Copy Integration", results: runSmartCopyIntegrationTests() },
  ];

  let totalPassed = 0;
  let totalFailed = 0;
  const summary: string[] = [];

  summary.push("╔═══════════════════════════════════════════════════════════════╗");
  summary.push("║              🧪 TOKEN SAVER TEST RESULTS                      ║");
  summary.push("╚═══════════════════════════════════════════════════════════════╝");
  summary.push("");

  for (const suite of suites) {
    const passed = suite.results.filter((r) => r.passed).length;
    const failed = suite.results.filter((r) => !r.passed).length;
    totalPassed += passed;
    totalFailed += failed;

    const icon = failed === 0 ? "✅" : "❌";
    summary.push(`${icon} ${suite.name}: ${passed}/${suite.results.length} passed`);

    for (const result of suite.results) {
      if (!result.passed) {
        summary.push(`   ✗ ${result.name}`);
        if (result.error) {
          summary.push(`     └─ ${result.error}`);
        }
      }
    }
  }

  summary.push("");
  summary.push("─────────────────────────────────────────────────────────────────");
  const overallIcon = totalFailed === 0 ? "✅" : "❌";
  summary.push(
    `${overallIcon} Total: ${totalPassed} passed, ${totalFailed} failed`
  );

  return { suites, totalPassed, totalFailed, summary };
}

// ============================================================================
// Edge Case Tests
// ============================================================================

function runEdgeCaseTests(): TestResult[] {
  const results: TestResult[] = [];

  // Test 1: Empty file
  {
    const output = extractSignatures("", "typescript");
    results.push({
      name: "Empty file returns empty output",
      passed: output.trim() === "",
      error: output.trim() !== "" ? `Got: "${output}"` : undefined,
    });
  }

  // Test 2: File with only comments
  {
    const code = `
// This is a comment
/* Multi-line
   comment */
# Python style comment
`;
    const output = extractSignatures(code, "typescript");
    results.push({
      name: "Comment-only file returns empty signatures",
      passed: !output.includes("function") && !output.includes("class"),
      error: undefined,
    });
  }

  // Test 3: File with special characters in strings
  {
    const code = `
function handleSpecialChars(input: string): string {
  const regex = /[{}()\\[\\]]/g;
  const template = \`{ "key": "value with {braces}" }\`;
  return input.replace(regex, "");
}
`;
    const output = extractSignatures(code, "typescript");
    results.push({
      name: "Special characters in strings don't break parsing",
      passed: output.includes("handleSpecialChars"),
      error: !output.includes("handleSpecialChars") ? "Function not captured" : undefined,
    });
  }

  // Test 4: Deeply nested code
  {
    const code = `
class DeepNesting {
  method() {
    if (true) {
      while (true) {
        for (let i = 0; i < 10; i++) {
          switch (i) {
            case 0:
              break;
          }
        }
      }
    }
  }
}
`;
    const output = extractSignatures(code, "typescript");
    results.push({
      name: "Deeply nested code handles brace counting",
      passed: output.includes("DeepNesting") && output.includes("method"),
      error: !output.includes("method") ? "Method not captured" : undefined,
    });
  }

  // Test 5: Unicode in code
  {
    const code = `
function greet(name: string): string {
  return \`こんにちは, \${name}! 🎉\`;
}
`;
    const output = extractSignatures(code, "typescript");
    results.push({
      name: "Unicode characters don't break parsing",
      passed: output.includes("greet"),
      error: !output.includes("greet") ? "Function not captured" : undefined,
    });
  }

  // Test 6: Very long single line
  {
    const longParams = Array(50).fill("param: string").join(", ");
    const code = `function veryLongFunction(${longParams}): void { console.log("done"); }`;
    const output = extractSignatures(code, "typescript");
    results.push({
      name: "Very long single line is handled",
      passed: output.includes("veryLongFunction"),
      error: !output.includes("veryLongFunction") ? "Function not captured" : undefined,
    });
  }

  // Test 7: Mixed language indicators (should not crash)
  {
    const code = `
// TypeScript file with Python-like syntax in comments
# This looks like Python
def not_python():
    pass

function actualTS(): void {
  console.log("hello");
}
`;
    const output = extractSignatures(code, "typescript");
    results.push({
      name: "Mixed syntax doesn't crash",
      passed: output.includes("actualTS"),
      error: !output.includes("actualTS") ? "TS function not captured" : undefined,
    });
  }

  // Test 8: Abstract class
  {
    const code = `
export abstract class BaseService {
  abstract process(data: unknown): Promise<void>;

  protected log(message: string): void {
    console.log(message);
  }
}
`;
    const output = extractSignatures(code, "typescript");
    results.push({
      name: "Abstract class captured correctly",
      passed: output.includes("abstract class BaseService"),
      error: !output.includes("abstract class") ? "Abstract not captured" : undefined,
    });
  }

  // Test 9: Async generators
  {
    const code = `
async function* asyncGenerator(): AsyncGenerator<number> {
  yield 1;
  yield 2;
}
`;
    const output = extractSignatures(code, "typescript");
    results.push({
      name: "Async generator function captured",
      passed: output.includes("asyncGenerator"),
      error: !output.includes("asyncGenerator") ? "Async generator not captured" : undefined,
    });
  }

  // Test 10: Overloaded functions
  {
    const code = `
function overloaded(x: string): string;
function overloaded(x: number): number;
function overloaded(x: string | number): string | number {
  return x;
}
`;
    const output = extractSignatures(code, "typescript");
    results.push({
      name: "Overloaded functions captured",
      passed: output.includes("overloaded"),
      error: !output.includes("overloaded") ? "Overload not captured" : undefined,
    });
  }

  return results;
}

function runFileTypeTests(): TestResult[] {
  const results: TestResult[] = [];

  // JavaScript
  {
    const jsCode = `
const express = require('express');

function createServer(port) {
  const app = express();
  app.listen(port);
  return app;
}

module.exports = { createServer };
`;
    const output = extractSignatures(jsCode, "javascript");
    results.push({
      name: "JavaScript: CommonJS module captured",
      passed: output.includes("createServer"),
      error: !output.includes("createServer") ? "JS function not captured" : undefined,
    });
  }

  // Python with async
  {
    const pyCode = `
import asyncio
from typing import List

async def fetch_data(url: str) -> dict:
    async with aiohttp.ClientSession() as session:
        response = await session.get(url)
        return await response.json()

class DataProcessor:
    def __init__(self, config):
        self.config = config

    def process(self, data: List[dict]) -> List[dict]:
        return [self._transform(d) for d in data]
`;
    const output = extractSignatures(pyCode, "python");
    results.push({
      name: "Python: Async function captured",
      passed: output.includes("fetch_data"),
      error: !output.includes("fetch_data") ? "Python async not captured" : undefined,
    });
    results.push({
      name: "Python: Class method captured",
      passed: output.includes("process"),
      error: !output.includes("process") ? "Python method not captured" : undefined,
    });
  }

  // Go
  {
    const goCode = `
package main

import "fmt"

type Server struct {
    Port int
    Host string
}

func (s *Server) Start() error {
    return nil
}

func NewServer(host string, port int) *Server {
    return &Server{Host: host, Port: port}
}
`;
    const output = extractSignatures(goCode, "go");
    results.push({
      name: "Go: Method receiver captured",
      passed: output.includes("Start"),
      error: !output.includes("Start") ? "Go method not captured" : undefined,
    });
    results.push({
      name: "Go: Constructor function captured",
      passed: output.includes("NewServer"),
      error: !output.includes("NewServer") ? "Go function not captured" : undefined,
    });
  }

  // TypeScript with decorators
  {
    const tsCode = `
import { Controller, Get, Post } from '@nestjs/common';

@Controller('users')
export class UserController {
  @Get()
  findAll(): User[] {
    return [];
  }

  @Post()
  create(@Body() dto: CreateUserDto): User {
    return {} as User;
  }
}
`;
    const output = extractSignatures(tsCode, "typescript");
    results.push({
      name: "TypeScript: NestJS decorators captured",
      passed: output.includes("@Controller") || output.includes("UserController"),
      error: !output.includes("UserController") ? "Decorated class not captured" : undefined,
    });
  }

  // React TSX
  {
    const tsxCode = `
import React, { useState, useEffect } from 'react';

interface Props {
  title: string;
  onClose: () => void;
}

export const Modal: React.FC<Props> = ({ title, onClose }) => {
  const [isOpen, setIsOpen] = useState(true);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  return (
    <div className="modal">
      <h1>{title}</h1>
      <button onClick={onClose}>Close</button>
    </div>
  );
};
`;
    const output = extractSignatures(tsxCode, "typescript");
    results.push({
      name: "TSX: React component captured",
      passed: output.includes("Modal"),
      error: !output.includes("Modal") ? "React component not captured" : undefined,
    });
    results.push({
      name: "TSX: Interface captured",
      passed: output.includes("Props"),
      error: !output.includes("Props") ? "Interface not captured" : undefined,
    });
  }

  return results;
}

function runLargeFileTests(): TestResult[] {
  const results: TestResult[] = [];

  // Test with 10,000 lines
  {
    const lines: string[] = [];
    lines.push('import { utils } from "./utils";');
    lines.push("");

    for (let i = 0; i < 100; i++) {
      lines.push(`export function func_${i}(param: string): number {`);
      for (let j = 0; j < 95; j++) {
        lines.push(`  const line_${j} = ${j}; // filler`);
      }
      lines.push("  return 0;");
      lines.push("}");
      lines.push("");
    }

    const code = lines.join("\n");
    const lineCount = code.split("\n").length;
    const output = extractSignatures(code, "typescript");

    results.push({
      name: `Large file (${lineCount} lines) processed`,
      passed: output.length > 0,
      error: output.length === 0 ? "No output generated" : undefined,
    });

    // Check that functions from different parts are captured
    const hasFunc0 = output.includes("func_0");
    const hasFunc50 = output.includes("func_50");
    const hasFunc99 = output.includes("func_99");

    results.push({
      name: "Large file: Functions from start captured",
      passed: hasFunc0,
      error: !hasFunc0 ? "func_0 not found" : undefined,
    });

    results.push({
      name: "Large file: Functions from middle captured",
      passed: hasFunc50,
      error: !hasFunc50 ? "func_50 not found" : undefined,
    });

    results.push({
      name: "Large file: Functions from end captured",
      passed: hasFunc99,
      error: !hasFunc99 ? "func_99 not found" : undefined,
    });
  }

  // Test Smart Copy with large file
  {
    const lines: string[] = [];
    for (let i = 0; i < 5000; i++) {
      if (i % 100 === 0) {
        lines.push(`function bigFunc${i}(x: number): number { return x * ${i}; }`);
      } else {
        lines.push(`// Comment line ${i}`);
      }
    }
    const code = lines.join("\n");

    const result = generateSmartCopy([{ path: "/large.ts", content: code }], { signatureOnly: true });

    results.push({
      name: "Smart Copy: Large file has savings > 50%",
      passed: result.savingsPercent > 50,
      error: result.savingsPercent <= 50 ? `Only ${result.savingsPercent.toFixed(1)}% savings` : undefined,
    });

    results.push({
      name: "Smart Copy: Large file output is reasonable size",
      passed: result.optimizedTokens < result.originalTokens * 0.5,
      error: undefined,
    });
  }

  return results;
}

// ============================================================================
// Extended Main Test Runner
// ============================================================================

export function runAllTokenSaverTestsExtended(): {
  suites: TestSuite[];
  totalPassed: number;
  totalFailed: number;
  summary: string[];
} {
  const suites: TestSuite[] = [
    { name: "Signature Extraction", results: runSignatureTests() },
    { name: "Chunk Processing", results: runChunkProcessingTests() },
    { name: "Session Memory", results: runSessionMemoryTests() },
    { name: "Pre-flight Optimizer", results: runPreflightTests() },
    { name: "Compaction Recovery", results: runCompactionTests() },
    { name: "Helper Functions", results: runHelperTests() },
    { name: "Smart Copy Integration", results: runSmartCopyIntegrationTests() },
    { name: "Edge Cases", results: runEdgeCaseTests() },
    { name: "File Type Support", results: runFileTypeTests() },
    { name: "Large File Handling", results: runLargeFileTests() },
  ];

  let totalPassed = 0;
  let totalFailed = 0;
  const summary: string[] = [];

  summary.push("╔═══════════════════════════════════════════════════════════════╗");
  summary.push("║         🧪 TOKEN SAVER COMPREHENSIVE TEST RESULTS             ║");
  summary.push("╚═══════════════════════════════════════════════════════════════╝");
  summary.push("");

  for (const suite of suites) {
    const passed = suite.results.filter((r) => r.passed).length;
    const failed = suite.results.filter((r) => !r.passed).length;
    totalPassed += passed;
    totalFailed += failed;

    const icon = failed === 0 ? "✅" : "❌";
    summary.push(`${icon} ${suite.name}: ${passed}/${suite.results.length} passed`);

    for (const result of suite.results) {
      if (!result.passed) {
        summary.push(`   ✗ ${result.name}`);
        if (result.error) {
          summary.push(`     └─ ${result.error}`);
        }
      }
    }
  }

  summary.push("");
  summary.push("─────────────────────────────────────────────────────────────────");
  const overallIcon = totalFailed === 0 ? "✅" : "❌";
  summary.push(
    `${overallIcon} Total: ${totalPassed} passed, ${totalFailed} failed`
  );

  return { suites, totalPassed, totalFailed, summary };
}

// Export for VS Code command
export { signatureTestCases, runEdgeCaseTests, runFileTypeTests, runLargeFileTests };
