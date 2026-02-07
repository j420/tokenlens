/**
 * Standalone Test Runner for Token Saver
 *
 * This file can be run directly with ts-node or compiled and run with node.
 * It doesn't depend on VS Code.
 *
 * Run with: npx esbuild standalone-test.ts --bundle --platform=node --outfile=standalone-test.js && node standalone-test.js
 */

// Import the token-saver module directly (without vscode dependencies)
import * as path from "path";

// Mock gpt-tokenizer for standalone testing
const mockCountTokens = (text: string) => ({
  tokens: Math.ceil(text.length / 4),
  model: "mock",
  cost: 0,
});

// ============================================================================
// Copied test implementations (to avoid vscode import issues)
// ============================================================================

// Hash function
function hashContent(content: string): string {
  let hash = 5381;
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) + hash) ^ content.charCodeAt(i);
  }
  return hash.toString(36);
}

// Strip strings and comments
function stripStringsAndComments(line: string): string {
  let result = line
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');

  const commentIndex = result.indexOf("//");
  if (commentIndex !== -1) {
    result = result.substring(0, commentIndex);
  }

  return result;
}

// Count braces
function countBraces(line: string): { open: number; close: number } {
  const cleaned = stripStringsAndComments(line);
  return {
    open: (cleaned.match(/{/g) || []).length,
    close: (cleaned.match(/}/g) || []).length,
  };
}

// Fuzzy match
function fuzzyMatch(needle: string, haystack: string): boolean {
  if (needle.length < 3) return needle === haystack;
  return haystack.includes(needle) || needle.includes(haystack);
}

// Reserved words
const RESERVED_WORDS = new Set([
  "if", "else", "for", "while", "do", "switch", "case", "try", "catch",
  "finally", "throw", "new", "return", "typeof", "instanceof", "void",
  "delete", "in", "of", "with", "yield", "await", "super", "this",
]);

// Performance limits
const MAX_LINES_PER_CHUNK = 2500;
const MAX_SIGNATURES = 100;
const MAX_IMPORTS = 20;
const MAX_TYPES = 30;

// Core signature extraction
function extractSignaturesFromLines(
  lines: string[],
  language: string,
  limits?: { maxImports?: number; maxTypes?: number; maxSignatures?: number }
): string {
  const maxImports = limits?.maxImports ?? MAX_IMPORTS;
  const maxTypes = limits?.maxTypes ?? MAX_TYPES;
  const maxSignatures = limits?.maxSignatures ?? MAX_SIGNATURES;

  let inClass = false;
  let braceDepth = 0;
  let inMultiLineComment = false;

  const imports: string[] = [];
  const types: string[] = [];
  const signatures: string[] = [];
  let pendingDecorators: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (signatures.length >= maxSignatures) break;

    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) continue;

    if (trimmed.startsWith("/*")) inMultiLineComment = true;
    if (trimmed.endsWith("*/")) {
      inMultiLineComment = false;
      continue;
    }
    if (inMultiLineComment) continue;

    if (trimmed.startsWith("//") || trimmed.startsWith("#")) continue;

    const braces = countBraces(line);
    braceDepth += braces.open - braces.close;

    // Decorators
    if (trimmed.startsWith("@") && !trimmed.includes("(") || /^@\w+(\([^)]*\))?$/.test(trimmed)) {
      pendingDecorators.push(trimmed);
      continue;
    }

    // Imports
    if (trimmed.startsWith("import ") || trimmed.startsWith("from ") ||
        (language === "go" && trimmed.startsWith("import"))) {
      if (imports.length < maxImports) {
        imports.push(trimmed);
      }
      continue;
    }

    // Types/Interfaces
    if (/^(export\s+)?(interface|type)\s+\w+/.test(trimmed) && types.length < maxTypes) {
      let typeDef = trimmed;
      let j = i + 1;
      let typeDepth = countBraces(trimmed).open - countBraces(trimmed).close;
      let typeLines = 1;

      while (j < lines.length && typeDepth > 0 && typeLines < 50) {
        const nextLine = lines[j]?.trim() || "";
        typeDef += "\n  " + nextLine;
        const nextBraces = countBraces(nextLine);
        typeDepth += nextBraces.open - nextBraces.close;
        j++;
        typeLines++;
      }
      if (typeLines >= 50) {
        typeDef += "\n  // ... (truncated)";
      }
      types.push(typeDef);
      continue;
    }

    // Class definition
    if (/^(export\s+)?(abstract\s+)?class\s+\w+/.test(trimmed)) {
      inClass = true;
      const decoratorStr = pendingDecorators.length > 0
        ? pendingDecorators.join("\n") + "\n"
        : "";
      signatures.push(`\n${decoratorStr}${trimmed}`);
      pendingDecorators = [];
      continue;
    }

    // Function signatures
    let matched = false;

    // Export default function
    if (/^export\s+default\s+(async\s+)?function/.test(trimmed)) {
      const sig = trimmed.replace(/\{.*$/, "").trim();
      signatures.push(`${sig} { /* ... */ }`);
      matched = true;
    }

    // Regular function declaration (including generators: function* and async function*)
    if (!matched && /^(export\s+)?(async\s+)?function\*?\s+\w+/.test(trimmed)) {
      let sig = trimmed;
      if (!sig.includes("{")) {
        let j = i + 1;
        while (j < lines.length && lines[j] && !lines[j].includes("{")) {
          sig += " " + lines[j].trim();
          j++;
        }
      }
      sig = sig.replace(/\{.*$/, "").trim();
      signatures.push(`${sig} { /* ... */ }`);
      matched = true;
    }

    // Arrow function: const foo = (...) => or const foo = async (...) =>
    // Also handles React components: const Component = () => <JSX> or const Component: FC = () =>
    if (!matched && /^(export\s+)?(const|let)\s+\w+\s*(:\s*\w+(\<[^>]+\>)?\s*)?=\s*(async\s*)?\(/.test(trimmed)) {
      let sig = trimmed;
      if (!sig.includes("=>")) {
        let j = i + 1;
        while (j < lines.length && lines[j] && !lines[j].includes("=>")) {
          sig += " " + lines[j].trim();
          j++;
        }
        if (j < lines.length && lines[j]) sig += " " + lines[j].trim().split("=>")[0] + "=>";
      }
      // Remove body: handles {}, <JSX>, or expression
      sig = sig.replace(/=>\s*\{.*$/, "=>").replace(/=>\s*\(.*$/, "=>").replace(/=>\s*<.*$/, "=>").replace(/=>\s*[^{(<].*$/, "=>").trim();
      signatures.push(`${sig} { /* ... */ }`);
      matched = true;
    }

    // Arrow function without parens
    if (!matched && /^(export\s+)?const\s+\w+\s*=\s*(async\s+)?\w+\s*=>/.test(trimmed)) {
      const sig = trimmed.replace(/=>\s*.*$/, "=>").trim();
      signatures.push(`${sig} { /* ... */ }`);
      matched = true;
    }

    // Getter/Setter
    if (!matched && /^(get|set)\s+\w+\s*\(/.test(trimmed)) {
      const sig = trimmed.replace(/\{.*$/, "").trim();
      const indent = inClass ? "  " : "";
      signatures.push(`${indent}${sig} { /* ... */ }`);
      matched = true;
    }

    // Class method
    if (!matched && inClass) {
      const methodMatch = trimmed.match(/^(public\s+|private\s+|protected\s+|static\s+|async\s+|readonly\s+)*(\w+)\s*\(/);
      if (methodMatch && !RESERVED_WORDS.has(methodMatch[2])) {
        let sig = trimmed;
        if (!sig.includes("{") && !sig.endsWith(";")) {
          let j = i + 1;
          while (j < lines.length && lines[j] && !lines[j].includes("{")) {
            sig += " " + lines[j].trim();
            j++;
          }
        }
        sig = sig.replace(/\{.*$/, "").trim();
        const decoratorStr = pendingDecorators.length > 0
          ? pendingDecorators.map(d => `  ${d}`).join("\n") + "\n"
          : "";
        signatures.push(`${decoratorStr}  ${sig} { /* ... */ }`);
        pendingDecorators = [];
        matched = true;
      }
    }

    // Python function
    if (!matched && language === "python" && /^(async\s+)?def\s+\w+/.test(trimmed)) {
      let sig = trimmed;
      if (!sig.endsWith(":")) {
        let j = i + 1;
        while (j < lines.length && lines[j] && !lines[j].includes(":")) {
          sig += " " + lines[j].trim();
          j++;
        }
      }
      sig = sig.replace(/:.*$/, "").trim();
      const decoratorStr = pendingDecorators.length > 0
        ? pendingDecorators.join("\n") + "\n"
        : "";
      signatures.push(`${decoratorStr}${sig}: ...`);
      pendingDecorators = [];
      matched = true;
    }

    // Go function
    if (!matched && language === "go" && /^func\s+/.test(trimmed)) {
      let sig = trimmed;
      if (!sig.includes("{")) {
        let j = i + 1;
        while (j < lines.length && lines[j] && !lines[j].includes("{")) {
          sig += " " + lines[j].trim();
          j++;
        }
      }
      sig = sig.replace(/\{.*$/, "").trim();
      signatures.push(`${sig} { /* ... */ }`);
      matched = true;
    }

    // Clear unused decorators
    if (!matched && pendingDecorators.length > 0) {
      pendingDecorators = [];
    }

    // End of class
    if (inClass && braceDepth === 0 && trimmed === "}") {
      inClass = false;
      signatures.push("}");
    }
  }

  // Build result
  const parts: string[] = [];

  if (imports.length > 0) {
    parts.push(imports.join("\n"));
  }

  if (types.length > 0) {
    parts.push("\n" + types.join("\n\n"));
  }

  if (signatures.length > 0) {
    parts.push("\n" + signatures.join("\n"));
  }

  return parts.join("\n").trim();
}

function extractSignatures(code: string, language: string): string {
  const lines = code.split("\n");

  if (lines.length > MAX_LINES_PER_CHUNK) {
    return extractSignaturesInChunks(lines, language);
  }

  return extractSignaturesFromLines(lines, language);
}

function extractSignaturesInChunks(lines: string[], language: string): string {
  const chunkSize = MAX_LINES_PER_CHUNK;
  const numChunks = Math.ceil(lines.length / chunkSize);

  const allImports: string[] = [];
  const allTypes: string[] = [];
  const allSignatures: string[] = [];
  const seenSignatures = new Set<string>();

  for (let chunkIndex = 0; chunkIndex < numChunks; chunkIndex++) {
    // Count actual signatures (not markers)
    const actualSignatureCount = allSignatures.filter(s => !s.startsWith("// ---")).length;
    if (actualSignatureCount >= MAX_SIGNATURES) break;

    const start = chunkIndex * chunkSize;
    const end = Math.min(start + chunkSize, lines.length);
    const chunkLines = lines.slice(start, end);

    const chunkMarker = numChunks > 1
      ? `// --- Chunk ${chunkIndex + 1}/${numChunks} (lines ${start + 1}-${end}) ---`
      : "";
    let chunkMarkerAdded = false;

    // Calculate remaining based on actual signatures only
    const remainingSignatures = MAX_SIGNATURES - actualSignatureCount;
    const result = extractSignaturesFromLines(chunkLines, language, {
      maxImports: MAX_IMPORTS - allImports.length,
      maxTypes: MAX_TYPES - allTypes.length,
      maxSignatures: remainingSignatures,
    });

    const resultLines = result.split("\n");
    let section: "imports" | "types" | "signatures" = "imports";

    for (const line of resultLines) {
      if (!line.trim()) continue;

      if (line.startsWith("interface ") || line.startsWith("export interface ") ||
          line.startsWith("type ") || line.startsWith("export type ")) {
        section = "types";
      } else if (line.includes("function ") || line.includes("class ") ||
                 line.includes("const ") || line.includes("async ") ||
                 line.startsWith("  ") || line.includes("{ /* ... */ }")) {
        section = "signatures";
      }

      if (section === "imports" && line.startsWith("import ")) {
        if (allImports.length < MAX_IMPORTS && !allImports.includes(line)) {
          allImports.push(line);
        }
      } else if (section === "types") {
        if (allTypes.length < MAX_TYPES) {
          allTypes.push(line);
        }
      } else if (section === "signatures") {
        // Count actual signatures (not markers)
        const currentActualCount = allSignatures.filter(s => !s.startsWith("// ---")).length;
        if (currentActualCount >= MAX_SIGNATURES) break;

        const sigKey = line.trim().replace(/\s+/g, " ");
        if (!seenSignatures.has(sigKey)) {
          seenSignatures.add(sigKey);
          // Add chunk marker once at start of each chunk (after first chunk)
          if (chunkIndex > 0 && !chunkMarkerAdded && allSignatures.length > 0) {
            allSignatures.push(chunkMarker);
            chunkMarkerAdded = true;
          }
          allSignatures.push(line);
        }
      }
    }
  }

  const parts: string[] = [];

  if (lines.length > MAX_LINES_PER_CHUNK) {
    parts.push(`// File: ${lines.length} lines, processed in ${numChunks} chunks`);
  }

  if (allImports.length > 0) {
    parts.push(allImports.join("\n"));
  }

  if (allTypes.length > 0) {
    parts.push("\n" + allTypes.join("\n"));
  }

  if (allSignatures.length > 0) {
    parts.push("\n" + allSignatures.join("\n"));
  }

  return parts.join("\n").trim();
}

// ============================================================================
// Test Runner
// ============================================================================

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

interface TestSuite {
  name: string;
  results: TestResult[];
}

function runSignatureTests(): TestResult[] {
  const results: TestResult[] = [];

  const testCases = [
    {
      name: "TypeScript function",
      code: `export function calculateTotal(items: Item[], taxRate: number): number {
  return 0;
}`,
      expected: ["calculateTotal"],
    },
    {
      name: "Arrow function",
      code: `export const processData = async (input: string): Promise<Result> => {
  return { data: input };
};`,
      expected: ["processData"],
    },
    {
      name: "Class with methods",
      code: `export class AuthService {
  async login(email: string): Promise<Token> {
    return {};
  }
  logout(): void {}
}`,
      expected: ["AuthService", "login", "logout"],
    },
    {
      name: "Interface and type",
      code: `export interface User {
  id: string;
  name: string;
}
export type Role = "admin" | "user";`,
      expected: ["User", "Role"],
    },
    {
      name: "Braces in strings",
      code: `function parseJson(input: string): object {
  const template = "{ foo: bar }";
  return JSON.parse(input);
}`,
      expected: ["parseJson"],
    },
    {
      name: "Python function",
      code: `@app.route("/api")
def get_users(request):
    return []`,
      expected: ["get_users"],
      language: "python",
    },
    {
      name: "Go function",
      code: `func (s *Server) HandleRequest(w http.ResponseWriter, r *http.Request) error {
    return nil
}`,
      expected: ["HandleRequest"],
      language: "go",
    },
  ];

  for (const test of testCases) {
    const language = (test as any).language || "typescript";
    const output = extractSignatures(test.code, language);

    let passed = true;
    let error = "";

    for (const expected of test.expected) {
      if (!output.includes(expected)) {
        passed = false;
        error = `Missing: "${expected}"`;
        break;
      }
    }

    results.push({ name: test.name, passed, error: passed ? undefined : error });
  }

  return results;
}

function runEdgeCaseTests(): TestResult[] {
  const results: TestResult[] = [];

  // Empty file
  {
    const output = extractSignatures("", "typescript");
    results.push({
      name: "Empty file",
      passed: output.trim() === "",
      error: output.trim() !== "" ? `Got: "${output}"` : undefined,
    });
  }

  // Only comments
  {
    const code = `// Comment\n/* Block */`;
    const output = extractSignatures(code, "typescript");
    results.push({
      name: "Comment-only file",
      passed: !output.includes("function"),
      error: undefined,
    });
  }

  // Special characters
  {
    const code = `function handleSpecial(x: string): string {
  const regex = /[{}]/g;
  return x;
}`;
    const output = extractSignatures(code, "typescript");
    results.push({
      name: "Special characters in code",
      passed: output.includes("handleSpecial"),
      error: !output.includes("handleSpecial") ? "Function not captured" : undefined,
    });
  }

  // Unicode
  {
    const code = `function greet(name: string): string {
  return \`Hello, \${name}! 🎉\`;
}`;
    const output = extractSignatures(code, "typescript");
    results.push({
      name: "Unicode in code",
      passed: output.includes("greet"),
      error: !output.includes("greet") ? "Function not captured" : undefined,
    });
  }

  return results;
}

function runLargeFileTests(): TestResult[] {
  const results: TestResult[] = [];

  // Large file with functions spread across chunks
  // Use 80 functions across 6000 lines (within MAX_SIGNATURES=100 limit)
  {
    const lines: string[] = [];
    // Create 80 single-line functions spread across 6000 lines
    for (let i = 0; i < 6000; i++) {
      if (i % 75 === 0 && Math.floor(i / 75) < 80) {
        const funcNum = Math.floor(i / 75);
        lines.push(`function func_${funcNum}(x: number): number { return ${funcNum}; }`);
      } else {
        lines.push(`// filler line ${i}`);
      }
    }

    const code = lines.join("\n");
    const lineCount = code.split("\n").length;
    const output = extractSignatures(code, "typescript");

    results.push({
      name: `Large file (${lineCount} lines) processed`,
      passed: output.length > 0,
      error: output.length === 0 ? "No output" : undefined,
    });

    results.push({
      name: "Large file: func_0 captured (start - chunk 1)",
      passed: output.includes("func_0"),
      error: !output.includes("func_0") ? "func_0 not found" : undefined,
    });

    // func_40 is at line 3000 (chunk 2)
    results.push({
      name: "Large file: func_40 captured (chunk 2)",
      passed: output.includes("func_40"),
      error: !output.includes("func_40") ? "func_40 not found" : undefined,
    });

    // func_70 is at line 5250 (chunk 3)
    results.push({
      name: "Large file: func_70 captured (chunk 3)",
      passed: output.includes("func_70"),
      error: !output.includes("func_70") ? "func_70 not found" : undefined,
    });

    // Count captured functions
    const capturedFuncs = output.match(/func_\d+/g) || [];
    const uniqueFuncs = new Set(capturedFuncs);

    results.push({
      name: `Large file: Most functions captured (${uniqueFuncs.size}/80)`,
      passed: uniqueFuncs.size >= 70, // Should capture at least 70 of 80 functions
      error: uniqueFuncs.size < 70 ? `Only ${uniqueFuncs.size} unique functions captured` : undefined,
    });

    // Verify chunk processing is used
    results.push({
      name: "Large file: Chunk processing used",
      passed: output.includes("Chunk") || output.includes("chunks"),
      error: !output.includes("Chunk") && !output.includes("chunks") ? "No chunk markers found" : undefined,
    });
  }

  return results;
}

function runHelperTests(): TestResult[] {
  const results: TestResult[] = [];

  // stripStringsAndComments
  {
    const input = 'const x = "{ braces }"; // comment';
    const output = stripStringsAndComments(input);
    results.push({
      name: "stripStringsAndComments removes strings",
      passed: !output.includes("braces"),
      error: output.includes("braces") ? "String not removed" : undefined,
    });
    results.push({
      name: "stripStringsAndComments removes comments",
      passed: !output.includes("comment"),
      error: output.includes("comment") ? "Comment not removed" : undefined,
    });
  }

  // countBraces
  {
    const braces = countBraces('const x = "{ }"; { }');
    results.push({
      name: "countBraces ignores strings",
      passed: braces.open === 1 && braces.close === 1,
      error: braces.open !== 1 ? `open=${braces.open}` : undefined,
    });
  }

  // hashContent
  {
    const h1 = hashContent("test");
    const h2 = hashContent("test");
    const h3 = hashContent("other");
    results.push({
      name: "hashContent is deterministic",
      passed: h1 === h2,
      error: h1 !== h2 ? "Different hashes" : undefined,
    });
    results.push({
      name: "hashContent differs for different content",
      passed: h1 !== h3,
      error: h1 === h3 ? "Same hash" : undefined,
    });
  }

  // fuzzyMatch
  {
    results.push({
      name: "fuzzyMatch: auth -> authentication",
      passed: fuzzyMatch("auth", "authentication"),
      error: !fuzzyMatch("auth", "authentication") ? "No match" : undefined,
    });
    results.push({
      name: "fuzzyMatch: xyz !-> abc",
      passed: !fuzzyMatch("xyz", "abc"),
      error: fuzzyMatch("xyz", "abc") ? "Unexpected match" : undefined,
    });
  }

  return results;
}

// ============================================================================
// Main
// ============================================================================

function runAllTests(): void {
  const suites: TestSuite[] = [
    { name: "Signature Extraction", results: runSignatureTests() },
    { name: "Edge Cases", results: runEdgeCaseTests() },
    { name: "Large Files", results: runLargeFileTests() },
    { name: "Helper Functions", results: runHelperTests() },
  ];

  console.log("");
  console.log("╔═══════════════════════════════════════════════════════════════╗");
  console.log("║         🧪 TOKENLENS COMPREHENSIVE TEST RESULTS               ║");
  console.log("╚═══════════════════════════════════════════════════════════════╝");
  console.log("");

  let totalPassed = 0;
  let totalFailed = 0;

  for (const suite of suites) {
    const passed = suite.results.filter(r => r.passed).length;
    const failed = suite.results.filter(r => !r.passed).length;
    totalPassed += passed;
    totalFailed += failed;

    const icon = failed === 0 ? "✅" : "❌";
    console.log(`${icon} ${suite.name}: ${passed}/${suite.results.length} passed`);

    for (const result of suite.results) {
      if (!result.passed) {
        console.log(`   ✗ ${result.name}`);
        if (result.error) {
          console.log(`     └─ ${result.error}`);
        }
      }
    }
  }

  console.log("");
  console.log("─────────────────────────────────────────────────────────────────");
  const overallIcon = totalFailed === 0 ? "✅" : "❌";
  console.log(`${overallIcon} Total: ${totalPassed} passed, ${totalFailed} failed`);
  console.log("");

  // Exit with appropriate code
  process.exit(totalFailed > 0 ? 1 : 0);
}

runAllTests();
