"use strict";

// standalone-test.ts
function hashContent(content) {
  let hash = 5381;
  for (let i = 0; i < content.length; i++) {
    hash = (hash << 5) + hash ^ content.charCodeAt(i);
  }
  return hash.toString(36);
}
function stripStringsAndComments(line) {
  let result = line.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/`(?:[^`\\]|\\.)*`/g, "``");
  const commentIndex = result.indexOf("//");
  if (commentIndex !== -1) {
    result = result.substring(0, commentIndex);
  }
  return result;
}
function countBraces(line) {
  const cleaned = stripStringsAndComments(line);
  return {
    open: (cleaned.match(/{/g) || []).length,
    close: (cleaned.match(/}/g) || []).length
  };
}
function fuzzyMatch(needle, haystack) {
  if (needle.length < 3)
    return needle === haystack;
  return haystack.includes(needle) || needle.includes(haystack);
}
var RESERVED_WORDS = /* @__PURE__ */ new Set([
  "if",
  "else",
  "for",
  "while",
  "do",
  "switch",
  "case",
  "try",
  "catch",
  "finally",
  "throw",
  "new",
  "return",
  "typeof",
  "instanceof",
  "void",
  "delete",
  "in",
  "of",
  "with",
  "yield",
  "await",
  "super",
  "this"
]);
var MAX_LINES_PER_CHUNK = 2500;
var MAX_SIGNATURES = 100;
var MAX_IMPORTS = 20;
var MAX_TYPES = 30;
function extractSignaturesFromLines(lines, language, limits) {
  const maxImports = limits?.maxImports ?? MAX_IMPORTS;
  const maxTypes = limits?.maxTypes ?? MAX_TYPES;
  const maxSignatures = limits?.maxSignatures ?? MAX_SIGNATURES;
  let inClass = false;
  let braceDepth = 0;
  let inMultiLineComment = false;
  const imports = [];
  const types = [];
  const signatures = [];
  let pendingDecorators = [];
  for (let i = 0; i < lines.length; i++) {
    if (signatures.length >= maxSignatures)
      break;
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed)
      continue;
    if (trimmed.startsWith("/*"))
      inMultiLineComment = true;
    if (trimmed.endsWith("*/")) {
      inMultiLineComment = false;
      continue;
    }
    if (inMultiLineComment)
      continue;
    if (trimmed.startsWith("//") || trimmed.startsWith("#"))
      continue;
    const braces = countBraces(line);
    braceDepth += braces.open - braces.close;
    if (trimmed.startsWith("@") && !trimmed.includes("(") || /^@\w+(\([^)]*\))?$/.test(trimmed)) {
      pendingDecorators.push(trimmed);
      continue;
    }
    if (trimmed.startsWith("import ") || trimmed.startsWith("from ") || language === "go" && trimmed.startsWith("import")) {
      if (imports.length < maxImports) {
        imports.push(trimmed);
      }
      continue;
    }
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
    if (/^(export\s+)?(abstract\s+)?class\s+\w+/.test(trimmed)) {
      inClass = true;
      const decoratorStr = pendingDecorators.length > 0 ? pendingDecorators.join("\n") + "\n" : "";
      signatures.push(`
${decoratorStr}${trimmed}`);
      pendingDecorators = [];
      continue;
    }
    let matched = false;
    if (/^export\s+default\s+(async\s+)?function/.test(trimmed)) {
      const sig = trimmed.replace(/\{.*$/, "").trim();
      signatures.push(`${sig} { /* ... */ }`);
      matched = true;
    }
    if (!matched && /^(export\s+)?(async\s+)?function\s+\w+/.test(trimmed)) {
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
    if (!matched && /^(export\s+)?const\s+\w+\s*=\s*(async\s*)?\(/.test(trimmed)) {
      let sig = trimmed;
      if (!sig.includes("=>")) {
        let j = i + 1;
        while (j < lines.length && lines[j] && !lines[j].includes("=>")) {
          sig += " " + lines[j].trim();
          j++;
        }
        if (j < lines.length && lines[j])
          sig += " " + lines[j].trim().split("=>")[0] + "=>";
      }
      sig = sig.replace(/=>\s*\{.*$/, "=>").replace(/=>\s*[^{].*$/, "=>").trim();
      signatures.push(`${sig} { /* ... */ }`);
      matched = true;
    }
    if (!matched && /^(export\s+)?const\s+\w+\s*=\s*(async\s+)?\w+\s*=>/.test(trimmed)) {
      const sig = trimmed.replace(/=>\s*.*$/, "=>").trim();
      signatures.push(`${sig} { /* ... */ }`);
      matched = true;
    }
    if (!matched && /^(get|set)\s+\w+\s*\(/.test(trimmed)) {
      const sig = trimmed.replace(/\{.*$/, "").trim();
      const indent = inClass ? "  " : "";
      signatures.push(`${indent}${sig} { /* ... */ }`);
      matched = true;
    }
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
        const decoratorStr = pendingDecorators.length > 0 ? pendingDecorators.map((d) => `  ${d}`).join("\n") + "\n" : "";
        signatures.push(`${decoratorStr}  ${sig} { /* ... */ }`);
        pendingDecorators = [];
        matched = true;
      }
    }
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
      const decoratorStr = pendingDecorators.length > 0 ? pendingDecorators.join("\n") + "\n" : "";
      signatures.push(`${decoratorStr}${sig}: ...`);
      pendingDecorators = [];
      matched = true;
    }
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
    if (!matched && pendingDecorators.length > 0) {
      pendingDecorators = [];
    }
    if (inClass && braceDepth === 0 && trimmed === "}") {
      inClass = false;
      signatures.push("}");
    }
  }
  const parts = [];
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
function extractSignatures(code, language) {
  const lines = code.split("\n");
  if (lines.length > MAX_LINES_PER_CHUNK) {
    return extractSignaturesInChunks(lines, language);
  }
  return extractSignaturesFromLines(lines, language);
}
function extractSignaturesInChunks(lines, language) {
  const chunkSize = MAX_LINES_PER_CHUNK;
  const numChunks = Math.ceil(lines.length / chunkSize);
  const allImports = [];
  const allTypes = [];
  const allSignatures = [];
  const seenSignatures = /* @__PURE__ */ new Set();
  for (let chunkIndex = 0; chunkIndex < numChunks; chunkIndex++) {
    if (allSignatures.length >= MAX_SIGNATURES)
      break;
    const start = chunkIndex * chunkSize;
    const end = Math.min(start + chunkSize, lines.length);
    const chunkLines = lines.slice(start, end);
    const chunkMarker = numChunks > 1 ? `// --- Chunk ${chunkIndex + 1}/${numChunks} (lines ${start + 1}-${end}) ---` : "";
    const result = extractSignaturesFromLines(chunkLines, language, {
      maxImports: MAX_IMPORTS - allImports.length,
      maxTypes: MAX_TYPES - allTypes.length,
      maxSignatures: MAX_SIGNATURES - allSignatures.length
    });
    const resultLines = result.split("\n");
    let section = "imports";
    for (const line of resultLines) {
      if (!line.trim())
        continue;
      if (line.startsWith("interface ") || line.startsWith("export interface ") || line.startsWith("type ") || line.startsWith("export type ")) {
        section = "types";
      } else if (line.includes("function ") || line.includes("class ") || line.includes("const ") || line.includes("async ") || line.startsWith("  ") || line.includes("{ /* ... */ }")) {
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
        const sigKey = line.trim().replace(/\s+/g, " ");
        if (!seenSignatures.has(sigKey) && allSignatures.length < MAX_SIGNATURES) {
          seenSignatures.add(sigKey);
          if (chunkIndex > 0 && allSignatures.length > 0 && !allSignatures[allSignatures.length - 1].startsWith("// ---")) {
            allSignatures.push(chunkMarker);
          }
          allSignatures.push(line);
        }
      }
    }
  }
  const parts = [];
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
function runSignatureTests() {
  const results = [];
  const testCases = [
    {
      name: "TypeScript function",
      code: `export function calculateTotal(items: Item[], taxRate: number): number {
  return 0;
}`,
      expected: ["calculateTotal"]
    },
    {
      name: "Arrow function",
      code: `export const processData = async (input: string): Promise<Result> => {
  return { data: input };
};`,
      expected: ["processData"]
    },
    {
      name: "Class with methods",
      code: `export class AuthService {
  async login(email: string): Promise<Token> {
    return {};
  }
  logout(): void {}
}`,
      expected: ["AuthService", "login", "logout"]
    },
    {
      name: "Interface and type",
      code: `export interface User {
  id: string;
  name: string;
}
export type Role = "admin" | "user";`,
      expected: ["User", "Role"]
    },
    {
      name: "Braces in strings",
      code: `function parseJson(input: string): object {
  const template = "{ foo: bar }";
  return JSON.parse(input);
}`,
      expected: ["parseJson"]
    },
    {
      name: "Python function",
      code: `@app.route("/api")
def get_users(request):
    return []`,
      expected: ["get_users"],
      language: "python"
    },
    {
      name: "Go function",
      code: `func (s *Server) HandleRequest(w http.ResponseWriter, r *http.Request) error {
    return nil
}`,
      expected: ["HandleRequest"],
      language: "go"
    }
  ];
  for (const test of testCases) {
    const language = test.language || "typescript";
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
    results.push({ name: test.name, passed, error: passed ? void 0 : error });
  }
  return results;
}
function runEdgeCaseTests() {
  const results = [];
  {
    const output = extractSignatures("", "typescript");
    results.push({
      name: "Empty file",
      passed: output.trim() === "",
      error: output.trim() !== "" ? `Got: "${output}"` : void 0
    });
  }
  {
    const code = `// Comment
/* Block */`;
    const output = extractSignatures(code, "typescript");
    results.push({
      name: "Comment-only file",
      passed: !output.includes("function"),
      error: void 0
    });
  }
  {
    const code = `function handleSpecial(x: string): string {
  const regex = /[{}]/g;
  return x;
}`;
    const output = extractSignatures(code, "typescript");
    results.push({
      name: "Special characters in code",
      passed: output.includes("handleSpecial"),
      error: !output.includes("handleSpecial") ? "Function not captured" : void 0
    });
  }
  {
    const code = `function greet(name: string): string {
  return \`Hello, \${name}! \u{1F389}\`;
}`;
    const output = extractSignatures(code, "typescript");
    results.push({
      name: "Unicode in code",
      passed: output.includes("greet"),
      error: !output.includes("greet") ? "Function not captured" : void 0
    });
  }
  return results;
}
function runLargeFileTests() {
  const results = [];
  {
    const lines = [];
    for (let i = 0; i < 6e3; i++) {
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
      error: output.length === 0 ? "No output" : void 0
    });
    results.push({
      name: "Large file: func_0 captured (start - chunk 1)",
      passed: output.includes("func_0"),
      error: !output.includes("func_0") ? "func_0 not found" : void 0
    });
    results.push({
      name: "Large file: func_40 captured (chunk 2)",
      passed: output.includes("func_40"),
      error: !output.includes("func_40") ? "func_40 not found" : void 0
    });
    results.push({
      name: "Large file: func_70 captured (chunk 3)",
      passed: output.includes("func_70"),
      error: !output.includes("func_70") ? "func_70 not found" : void 0
    });
    const capturedFuncs = output.match(/func_\d+/g) || [];
    const uniqueFuncs = new Set(capturedFuncs);
    results.push({
      name: `Large file: Most functions captured (${uniqueFuncs.size}/80)`,
      passed: uniqueFuncs.size >= 70,
      // Should capture at least 70 of 80 functions
      error: uniqueFuncs.size < 70 ? `Only ${uniqueFuncs.size} unique functions captured` : void 0
    });
    results.push({
      name: "Large file: Chunk processing used",
      passed: output.includes("Chunk") || output.includes("chunks"),
      error: !output.includes("Chunk") && !output.includes("chunks") ? "No chunk markers found" : void 0
    });
  }
  return results;
}
function runHelperTests() {
  const results = [];
  {
    const input = 'const x = "{ braces }"; // comment';
    const output = stripStringsAndComments(input);
    results.push({
      name: "stripStringsAndComments removes strings",
      passed: !output.includes("braces"),
      error: output.includes("braces") ? "String not removed" : void 0
    });
    results.push({
      name: "stripStringsAndComments removes comments",
      passed: !output.includes("comment"),
      error: output.includes("comment") ? "Comment not removed" : void 0
    });
  }
  {
    const braces = countBraces('const x = "{ }"; { }');
    results.push({
      name: "countBraces ignores strings",
      passed: braces.open === 1 && braces.close === 1,
      error: braces.open !== 1 ? `open=${braces.open}` : void 0
    });
  }
  {
    const h1 = hashContent("test");
    const h2 = hashContent("test");
    const h3 = hashContent("other");
    results.push({
      name: "hashContent is deterministic",
      passed: h1 === h2,
      error: h1 !== h2 ? "Different hashes" : void 0
    });
    results.push({
      name: "hashContent differs for different content",
      passed: h1 !== h3,
      error: h1 === h3 ? "Same hash" : void 0
    });
  }
  {
    results.push({
      name: "fuzzyMatch: auth -> authentication",
      passed: fuzzyMatch("auth", "authentication"),
      error: !fuzzyMatch("auth", "authentication") ? "No match" : void 0
    });
    results.push({
      name: "fuzzyMatch: xyz !-> abc",
      passed: !fuzzyMatch("xyz", "abc"),
      error: fuzzyMatch("xyz", "abc") ? "Unexpected match" : void 0
    });
  }
  return results;
}
function runAllTests() {
  const suites = [
    { name: "Signature Extraction", results: runSignatureTests() },
    { name: "Edge Cases", results: runEdgeCaseTests() },
    { name: "Large Files", results: runLargeFileTests() },
    { name: "Helper Functions", results: runHelperTests() }
  ];
  console.log("");
  console.log("\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557");
  console.log("\u2551         \u{1F9EA} TOKENLENS COMPREHENSIVE TEST RESULTS               \u2551");
  console.log("\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D");
  console.log("");
  let totalPassed = 0;
  let totalFailed = 0;
  for (const suite of suites) {
    const passed = suite.results.filter((r) => r.passed).length;
    const failed = suite.results.filter((r) => !r.passed).length;
    totalPassed += passed;
    totalFailed += failed;
    const icon = failed === 0 ? "\u2705" : "\u274C";
    console.log(`${icon} ${suite.name}: ${passed}/${suite.results.length} passed`);
    for (const result of suite.results) {
      if (!result.passed) {
        console.log(`   \u2717 ${result.name}`);
        if (result.error) {
          console.log(`     \u2514\u2500 ${result.error}`);
        }
      }
    }
  }
  console.log("");
  console.log("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  const overallIcon = totalFailed === 0 ? "\u2705" : "\u274C";
  console.log(`${overallIcon} Total: ${totalPassed} passed, ${totalFailed} failed`);
  console.log("");
  process.exit(totalFailed > 0 ? 1 : 0);
}
runAllTests();
