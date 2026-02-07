/**
 * Token Saver Features
 *
 * High-impact features for reducing token consumption:
 * 1. Smart Copy - Right-click → "Copy for AI (optimized)"
 * 2. Pre-flight Optimizer - Show optimization before send
 * 3. Session Memory Deduplication - Track files read per session
 * 4. Compaction Recovery - Detect compaction, show what was lost
 */

import * as vscode from "vscode";
import * as path from "path";
import { countTokens, formatTokens } from "@prune/tokenizer";

// ============================================================================
// Session Memory Deduplication
// ============================================================================

interface FileReadRecord {
  path: string;
  contentHash: string; // Hash instead of full content (memory efficient)
  tokens: number;
  readAt: Date;
  turnNumber: number;
  isPartial: boolean; // Whether this was a partial read (selection)
  lineRange?: { start: number; end: number }; // For partial reads
}

interface SessionMemory {
  filesRead: Map<string, FileReadRecord>;
  totalTokensSaved: number;
  deduplicationCount: number;
  sessionStart: Date;
  changesDetected: number; // Files that changed since last read
}

// Memory limits
const MAX_FILES_IN_MEMORY = 200;
const MAX_SESSION_DURATION_MS = 4 * 60 * 60 * 1000; // 4 hours

// Global session memory (persists during extension lifetime)
let sessionMemory: SessionMemory = {
  filesRead: new Map(),
  totalTokensSaved: 0,
  deduplicationCount: 0,
  changesDetected: 0,
  sessionStart: new Date(),
};

let currentTurnNumber = 0;

/**
 * Simple hash function for content comparison
 * Uses djb2 algorithm - fast and good enough for our purposes
 */
function hashContent(content: string): string {
  let hash = 5381;
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) + hash) ^ content.charCodeAt(i);
  }
  return hash.toString(36);
}

/**
 * Clean up old entries if memory is getting large
 */
function pruneMemoryIfNeeded(): void {
  // Check session duration
  if (Date.now() - sessionMemory.sessionStart.getTime() > MAX_SESSION_DURATION_MS) {
    resetSessionMemory();
    return;
  }

  // Prune if too many files
  if (sessionMemory.filesRead.size > MAX_FILES_IN_MEMORY) {
    const files = Array.from(sessionMemory.filesRead.entries())
      .sort((a, b) => a[1].readAt.getTime() - b[1].readAt.getTime());

    // Remove oldest 20%
    const toRemove = Math.floor(files.length * 0.2);
    for (let i = 0; i < toRemove; i++) {
      sessionMemory.filesRead.delete(files[i][0]);
    }
  }
}

/**
 * Record a file as read in the current session
 */
export function recordFileRead(
  filePath: string,
  content: string,
  options?: { isPartial?: boolean; lineRange?: { start: number; end: number } }
): {
  isDuplicate: boolean;
  tokensSaved: number;
  originalTurn: number | null;
  contentChanged: boolean;
} {
  pruneMemoryIfNeeded();

  const normalizedPath = path.normalize(filePath);
  const tokens = countTokens(content).tokens;
  const contentHash = hashContent(content);
  const isPartial = options?.isPartial ?? false;

  const existing = sessionMemory.filesRead.get(normalizedPath);

  if (existing) {
    // Check if content has changed
    if (existing.contentHash !== contentHash) {
      // File was modified since last read - update our record
      sessionMemory.changesDetected++;
      sessionMemory.filesRead.set(normalizedPath, {
        path: normalizedPath,
        contentHash,
        tokens,
        readAt: new Date(),
        turnNumber: currentTurnNumber,
        isPartial,
        lineRange: options?.lineRange,
      });

      return {
        isDuplicate: false,
        tokensSaved: 0,
        originalTurn: existing.turnNumber,
        contentChanged: true,
      };
    }

    // Same content - this is a duplicate
    sessionMemory.totalTokensSaved += tokens;
    sessionMemory.deduplicationCount++;

    return {
      isDuplicate: true,
      tokensSaved: tokens,
      originalTurn: existing.turnNumber,
      contentChanged: false,
    };
  }

  // First time reading this file
  sessionMemory.filesRead.set(normalizedPath, {
    path: normalizedPath,
    contentHash,
    tokens,
    readAt: new Date(),
    turnNumber: currentTurnNumber,
    isPartial,
    lineRange: options?.lineRange,
  });

  return {
    isDuplicate: false,
    tokensSaved: 0,
    originalTurn: null,
    contentChanged: false,
  };
}

/**
 * Check if a file has been read in this session
 */
export function isFileInContext(filePath: string): boolean {
  const normalizedPath = path.normalize(filePath);
  return sessionMemory.filesRead.has(normalizedPath);
}

/**
 * Check if file content matches what's in memory
 */
export function isFileContentCurrent(filePath: string, content: string): boolean {
  const normalizedPath = path.normalize(filePath);
  const existing = sessionMemory.filesRead.get(normalizedPath);
  if (!existing) return false;
  return existing.contentHash === hashContent(content);
}

/**
 * Get the record of a file from session memory
 */
export function getFileFromMemory(filePath: string): FileReadRecord | null {
  const normalizedPath = path.normalize(filePath);
  return sessionMemory.filesRead.get(normalizedPath) || null;
}

/**
 * Increment turn number (call when user sends a new prompt)
 */
export function incrementTurn(): number {
  return ++currentTurnNumber;
}

/**
 * Get current turn number
 */
export function getCurrentTurn(): number {
  return currentTurnNumber;
}

/**
 * Get session memory statistics
 */
export function getSessionStats(): {
  filesRead: number;
  totalTokens: number;
  tokensSaved: number;
  deduplicationCount: number;
  changesDetected: number;
  sessionDuration: number;
} {
  const totalTokens = Array.from(sessionMemory.filesRead.values())
    .reduce((sum, f) => sum + f.tokens, 0);

  return {
    filesRead: sessionMemory.filesRead.size,
    totalTokens,
    tokensSaved: sessionMemory.totalTokensSaved,
    deduplicationCount: sessionMemory.deduplicationCount,
    changesDetected: sessionMemory.changesDetected,
    sessionDuration: Date.now() - sessionMemory.sessionStart.getTime(),
  };
}

/**
 * Reset session memory (call when starting a new session)
 */
export function resetSessionMemory(): void {
  sessionMemory = {
    filesRead: new Map(),
    totalTokensSaved: 0,
    deduplicationCount: 0,
    changesDetected: 0,
    sessionStart: new Date(),
  };
  currentTurnNumber = 0;
  // Also reset compaction tracking
  resetCompactionTracking();
}

/**
 * Get list of files in session memory
 */
export function getSessionFiles(): FileReadRecord[] {
  return Array.from(sessionMemory.filesRead.values())
    .sort((a, b) => b.readAt.getTime() - a.readAt.getTime());
}

// ============================================================================
// Smart Copy (Optimized for AI)
// ============================================================================

interface SmartCopyOptions {
  includeImports: boolean;
  includeTypes: boolean;
  signatureOnly: boolean;
  maxTokensPerFile: number;
}

const DEFAULT_SMART_COPY_OPTIONS: SmartCopyOptions = {
  includeImports: true,
  includeTypes: true,
  signatureOnly: true,
  maxTokensPerFile: 500,
};

/**
 * Remove string literals and comments to avoid false brace matches
 */
function stripStringsAndComments(line: string): string {
  // Remove string literals (handles escaped quotes)
  let result = line
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');

  // Remove single-line comments
  const commentIndex = result.indexOf("//");
  if (commentIndex !== -1) {
    result = result.substring(0, commentIndex);
  }

  return result;
}

/**
 * Count braces in a line, excluding those in strings/comments
 */
function countBraces(line: string): { open: number; close: number } {
  const cleaned = stripStringsAndComments(line);
  return {
    open: (cleaned.match(/{/g) || []).length,
    close: (cleaned.match(/}/g) || []).length,
  };
}

// Reserved words that look like function calls but aren't
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

/**
 * Extract function/method signatures from code
 * Uses regex-based extraction (fast, works without tree-sitter)
 * For large files, processes in chunks to capture signatures throughout
 */
function extractSignatures(code: string, language: string): string {
  const lines = code.split("\n");

  // For large files, process in chunks and merge results
  if (lines.length > MAX_LINES_PER_CHUNK) {
    return extractSignaturesInChunks(lines, language);
  }

  return extractSignaturesFromLines(lines, language);
}

/**
 * Process large files in chunks to capture signatures throughout
 */
function extractSignaturesInChunks(lines: string[], language: string): string {
  const chunkSize = MAX_LINES_PER_CHUNK;
  const numChunks = Math.ceil(lines.length / chunkSize);

  // Collect results from all chunks
  const allImports: string[] = [];
  const allTypes: string[] = [];
  const allSignatures: string[] = [];
  const seenSignatures = new Set<string>(); // Dedupe

  for (let chunkIndex = 0; chunkIndex < numChunks; chunkIndex++) {
    // Early exit if we have enough
    if (allSignatures.length >= MAX_SIGNATURES) break;

    const start = chunkIndex * chunkSize;
    const end = Math.min(start + chunkSize, lines.length);
    const chunkLines = lines.slice(start, end);

    // Add chunk marker for context
    const chunkMarker = numChunks > 1
      ? `// --- Chunk ${chunkIndex + 1}/${numChunks} (lines ${start + 1}-${end}) ---`
      : "";

    // Process this chunk
    const result = extractSignaturesFromLines(chunkLines, language, {
      maxImports: MAX_IMPORTS - allImports.length,
      maxTypes: MAX_TYPES - allTypes.length,
      maxSignatures: MAX_SIGNATURES - allSignatures.length,
    });

    // Parse and merge results
    const resultLines = result.split("\n");
    let section: "imports" | "types" | "signatures" = "imports";

    for (const line of resultLines) {
      if (!line.trim()) continue;

      // Detect section changes
      if (line.startsWith("interface ") || line.startsWith("export interface ") ||
          line.startsWith("type ") || line.startsWith("export type ")) {
        section = "types";
      } else if (line.includes("function ") || line.includes("class ") ||
                 line.includes("const ") || line.includes("async ") ||
                 line.startsWith("  ") || line.includes("{ /* ... */ }")) {
        section = "signatures";
      }

      // Add to appropriate collection (with deduplication)
      if (section === "imports" && line.startsWith("import ")) {
        if (allImports.length < MAX_IMPORTS && !allImports.includes(line)) {
          allImports.push(line);
        }
      } else if (section === "types") {
        if (allTypes.length < MAX_TYPES) {
          allTypes.push(line);
        }
      } else if (section === "signatures") {
        // Dedupe signatures by their core content
        const sigKey = line.trim().replace(/\s+/g, " ");
        if (!seenSignatures.has(sigKey) && allSignatures.length < MAX_SIGNATURES) {
          seenSignatures.add(sigKey);
          // Add chunk marker before first signature in each chunk (after first)
          if (chunkIndex > 0 && allSignatures.length > 0 &&
              !allSignatures[allSignatures.length - 1].startsWith("// ---")) {
            allSignatures.push(chunkMarker);
          }
          allSignatures.push(line);
        }
      }
    }
  }

  // Build final result
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

/**
 * Core signature extraction logic for a set of lines
 */
function extractSignaturesFromLines(
  lines: string[],
  language: string,
  limits?: { maxImports?: number; maxTypes?: number; maxSignatures?: number }
): string {
  const maxImports = limits?.maxImports ?? MAX_IMPORTS;
  const maxTypes = limits?.maxTypes ?? MAX_TYPES;
  const maxSignatures = limits?.maxSignatures ?? MAX_SIGNATURES;

  let inClass = false;
  let classIndent = 0;
  let currentClass = "";
  let braceDepth = 0;
  let inMultiLineComment = false;

  // Track imports, types, decorators, and signatures
  const imports: string[] = [];
  const types: string[] = [];
  const signatures: string[] = [];
  let pendingDecorators: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    // Performance: early exit if we have enough
    if (signatures.length >= maxSignatures) break;

    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) continue;

    // Handle multi-line comments
    if (trimmed.startsWith("/*")) inMultiLineComment = true;
    if (trimmed.endsWith("*/")) {
      inMultiLineComment = false;
      continue;
    }
    if (inMultiLineComment) continue;

    // Skip single-line comments
    if (trimmed.startsWith("//") || trimmed.startsWith("#")) continue;

    // Track brace depth (excluding strings/comments)
    const braces = countBraces(line);
    braceDepth += braces.open - braces.close;

    // Python/TypeScript decorators
    if (trimmed.startsWith("@") && !trimmed.includes("(") || /^@\w+(\([^)]*\))?$/.test(trimmed)) {
      pendingDecorators.push(trimmed);
      continue;
    }

    // Imports (with limit)
    if (trimmed.startsWith("import ") || trimmed.startsWith("from ") ||
        (language === "go" && trimmed.startsWith("import"))) {
      if (imports.length < MAX_IMPORTS) {
        imports.push(trimmed);
      }
      continue;
    }

    // Types/Interfaces (TypeScript) with limit
    if (/^(export\s+)?(interface|type)\s+\w+/.test(trimmed) && types.length < MAX_TYPES) {
      let typeDef = trimmed;
      let j = i + 1;
      let typeDepth = countBraces(trimmed).open - countBraces(trimmed).close;

      // Limit type definition size
      let typeLines = 1;
      while (j < lines.length && typeDepth > 0 && typeLines < 50) {
        const nextLine = lines[j].trim();
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
      classIndent = line.search(/\S/);
      currentClass = trimmed.match(/class\s+(\w+)/)?.[1] || "";
      // Include decorators with class
      const decoratorStr = pendingDecorators.length > 0
        ? pendingDecorators.join("\n") + "\n"
        : "";
      signatures.push(`\n${decoratorStr}${trimmed}`);
      pendingDecorators = [];
      continue;
    }

    // Function/method signatures
    let matched = false;

    // Export default function
    if (/^export\s+default\s+(async\s+)?function/.test(trimmed)) {
      const sig = trimmed.replace(/\{.*$/, "").trim();
      signatures.push(`${sig} { /* ... */ }`);
      matched = true;
    }

    // Regular function declaration
    if (!matched && /^(export\s+)?(async\s+)?function\s+\w+/.test(trimmed)) {
      let sig = trimmed;
      if (!sig.includes("{")) {
        // Multi-line signature
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
    if (!matched && /^(export\s+)?const\s+\w+\s*=\s*(async\s*)?\(/.test(trimmed)) {
      let sig = trimmed;
      // Handle multi-line
      if (!sig.includes("=>")) {
        let j = i + 1;
        while (j < lines.length && lines[j] && !lines[j].includes("=>")) {
          sig += " " + lines[j].trim();
          j++;
        }
        if (j < lines.length && lines[j]) sig += " " + lines[j].trim().split("=>")[0] + "=>";
      }
      sig = sig.replace(/=>\s*\{.*$/, "=>").replace(/=>\s*[^{].*$/, "=>").trim();
      signatures.push(`${sig} { /* ... */ }`);
      matched = true;
    }

    // Arrow function without parens: const foo = x =>
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

    // Class method (must be in class context and not a reserved word)
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
        // Include decorators
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

    // Clear decorators if we didn't use them
    if (!matched && pendingDecorators.length > 0) {
      pendingDecorators = [];
    }

    // End of class
    if (inClass && braceDepth === 0 && trimmed === "}") {
      inClass = false;
      signatures.push("}");
      currentClass = "";
    }
  }

  // Build result
  const parts: string[] = [];

  if (imports.length > 0) {
    parts.push(imports.join("\n"));
    if (imports.length > 10) {
      parts.push(`// ... ${imports.length - 10} more imports`);
    }
  }

  if (types.length > 0) {
    parts.push("\n" + types.join("\n\n"));
  }

  if (signatures.length > 0) {
    parts.push("\n" + signatures.join("\n"));
  }

  return parts.join("\n").trim();
}

/**
 * Generate optimized code for AI consumption
 */
export function generateSmartCopy(
  files: Array<{ path: string; content: string }>,
  options: Partial<SmartCopyOptions> = {}
): {
  optimizedCode: string;
  originalTokens: number;
  optimizedTokens: number;
  savings: number;
  savingsPercent: number;
} {
  const opts = { ...DEFAULT_SMART_COPY_OPTIONS, ...options };
  const parts: string[] = [];
  let originalTokens = 0;
  let optimizedTokens = 0;

  for (const file of files) {
    const ext = path.extname(file.path).toLowerCase();
    const langMap: Record<string, string> = {
      ".ts": "typescript",
      ".tsx": "typescript",
      ".js": "javascript",
      ".jsx": "javascript",
      ".py": "python",
      ".go": "go",
      ".rs": "rust",
      ".java": "java",
    };
    const language = langMap[ext] || "unknown";
    const fileName = path.basename(file.path);

    originalTokens += countTokens(file.content).tokens;

    if (opts.signatureOnly && language !== "unknown") {
      // Extract signatures only
      const signatures = extractSignatures(file.content, language);
      const header = `// === ${fileName} ===`;
      const fileOutput = `${header}\n${signatures}`;
      parts.push(fileOutput);
      optimizedTokens += countTokens(fileOutput).tokens;
    } else {
      // Include full file (but might truncate if too large)
      const header = `// === ${fileName} ===`;
      let content = file.content;

      if (countTokens(content).tokens > opts.maxTokensPerFile) {
        // Truncate with note
        const lines = content.split("\n");
        let truncated = "";
        let tokens = 0;
        for (const line of lines) {
          const lineTokens = countTokens(line).tokens;
          if (tokens + lineTokens > opts.maxTokensPerFile - 20) {
            truncated += "\n// ... (truncated for brevity)";
            break;
          }
          truncated += line + "\n";
          tokens += lineTokens;
        }
        content = truncated;
      }

      const fileOutput = `${header}\n${content}`;
      parts.push(fileOutput);
      optimizedTokens += countTokens(fileOutput).tokens;
    }
  }

  const optimizedCode = parts.join("\n\n");
  const savings = originalTokens - optimizedTokens;
  const savingsPercent = originalTokens > 0 ? (savings / originalTokens) * 100 : 0;

  return {
    optimizedCode,
    originalTokens,
    optimizedTokens,
    savings,
    savingsPercent,
  };
}

// ============================================================================
// Pre-flight Optimizer
// ============================================================================

export interface PreflightAnalysis {
  prompt: string;
  currentContext: {
    files: string[];
    tokens: number;
    cost: number;
  };
  recommendedContext: {
    files: string[];
    tokens: number;
    cost: number;
  };
  savings: {
    tokens: number;
    cost: number;
    percent: number;
  };
  recommendations: string[];
}

// Config/metadata files that are less relevant for code tasks
const LOW_PRIORITY_FILES = new Set([
  "package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
  "tsconfig.json", "jsconfig.json", ".eslintrc", ".prettierrc",
  "webpack.config.js", "vite.config.js", "rollup.config.js",
  ".gitignore", ".env.example", "dockerfile", "docker-compose.yml",
]);

// Intent keywords that indicate specific file types
const INTENT_PATTERNS: Array<{
  keywords: string[];
  boostPatterns: RegExp[];
  boost: number;
}> = [
  {
    keywords: ["test", "testing", "spec", "unit", "integration"],
    boostPatterns: [/\.test\.[jt]sx?$/, /\.spec\.[jt]sx?$/, /__tests__/],
    boost: 25,
  },
  {
    keywords: ["style", "css", "styling", "layout", "design"],
    boostPatterns: [/\.(css|scss|sass|less|styl)$/, /styles?\//],
    boost: 25,
  },
  {
    keywords: ["api", "endpoint", "route", "handler", "controller"],
    boostPatterns: [/api\//, /routes?\//, /controllers?\//, /handlers?\//],
    boost: 20,
  },
  {
    keywords: ["component", "ui", "view", "page", "screen"],
    boostPatterns: [/components?\//, /views?\//, /pages?\//, /screens?\//],
    boost: 15,
  },
  {
    keywords: ["config", "configuration", "settings", "env"],
    boostPatterns: [/config/, /\.env/, /settings/],
    boost: 15,
  },
  {
    keywords: ["auth", "authentication", "login", "session", "token"],
    boostPatterns: [/auth/, /login/, /session/, /token/],
    boost: 20,
  },
  {
    keywords: ["database", "db", "model", "schema", "migration"],
    boostPatterns: [/models?\//, /schemas?\//, /migrations?\//, /db\//],
    boost: 20,
  },
];

/**
 * Check if word A is a prefix/substring match for word B
 * "auth" matches "authentication", "authorize", etc.
 */
function fuzzyMatch(needle: string, haystack: string): boolean {
  if (needle.length < 3) return needle === haystack;
  return haystack.includes(needle) || needle.includes(haystack);
}

/**
 * Analyze a prompt and suggest optimal context
 */
export function analyzePreFlight(
  prompt: string,
  workspaceFiles: Array<{ path: string; content: string; tokens: number }>,
  modelCostPerMillion: number = 3, // $3 per 1M tokens for Claude Sonnet
  activeFilePath?: string // Currently open file
): PreflightAnalysis {
  // Extract words, keeping short ones if they're meaningful
  const promptLower = prompt.toLowerCase();
  const promptWords = promptLower
    .split(/\W+/)
    .filter(w => w.length >= 2); // Keep 2-char words like "go", "ui", "db"

  const promptWordSet = new Set(promptWords);

  // Detect intent from prompt
  const detectedIntents: typeof INTENT_PATTERNS = [];
  for (const intent of INTENT_PATTERNS) {
    if (intent.keywords.some(k => promptWords.some(pw => fuzzyMatch(pw, k)))) {
      detectedIntents.push(intent);
    }
  }

  // Score each file
  const scoredFiles = workspaceFiles.map(file => {
    const filePath = file.path.toLowerCase();
    const fileName = path.basename(file.path).toLowerCase();
    const fileNameNoExt = fileName.replace(/\.[^.]+$/, "");
    const content = file.content.toLowerCase();

    let score = 0;
    const matchReasons: string[] = [];

    // Active file always gets high score
    if (activeFilePath && path.normalize(file.path) === path.normalize(activeFilePath)) {
      score += 100;
      matchReasons.push("Currently open file");
    }

    // File name matches prompt words (with fuzzy matching)
    for (const word of promptWords) {
      if (word.length >= 3) {
        // Fuzzy match on filename
        if (fuzzyMatch(word, fileNameNoExt)) {
          score += 15;
          matchReasons.push(`Filename matches "${word}"`);
        }
        // Fuzzy match on path segments
        if (filePath.includes(word)) {
          score += 8;
        }
        // Content matches (limited to avoid false positives)
        const contentMatches = (content.match(new RegExp(`\\b${word}`, "g")) || []).length;
        if (contentMatches > 0) {
          score += Math.min(contentMatches * 2, 10); // Cap at 10
        }
      }
    }

    // Intent-based scoring
    for (const intent of detectedIntents) {
      for (const pattern of intent.boostPatterns) {
        if (pattern.test(filePath)) {
          score += intent.boost;
          matchReasons.push(`Matches ${intent.keywords[0]} intent`);
          break;
        }
      }
    }

    // Boost for certain prompt patterns
    if (promptWordSet.has("fix") || promptWordSet.has("bug") || promptWordSet.has("error")) {
      if (content.includes("throw ") || content.includes("catch ") ||
          content.includes("error") || content.includes("exception")) {
        score += 8;
        matchReasons.push("Contains error handling");
      }
    }

    // Penalize low-priority files for code tasks
    if (LOW_PRIORITY_FILES.has(fileName)) {
      score = Math.floor(score * 0.3);
    }

    // Penalize very large files slightly (prefer smaller focused files)
    if (file.tokens > 5000) {
      score = Math.floor(score * 0.8);
    }

    return { ...file, score, matchReasons };
  });

  // Sort by score (descending)
  scoredFiles.sort((a, b) => b.score - a.score);

  // Current context: all files
  const allFiles = workspaceFiles.map(f => f.path);
  const allTokens = workspaceFiles.reduce((sum, f) => sum + f.tokens, 0);
  const allCost = (allTokens / 1_000_000) * modelCostPerMillion;

  // Recommended: high-scoring files (score > 5), max 15 files, max 50k tokens
  let tokenBudget = 50000;
  const relevantFiles: typeof scoredFiles = [];

  for (const file of scoredFiles) {
    if (file.score <= 5) break; // Stop at low-relevance files
    if (relevantFiles.length >= 15) break; // Max files
    if (tokenBudget - file.tokens < 0 && relevantFiles.length > 0) continue; // Skip if over budget

    relevantFiles.push(file);
    tokenBudget -= file.tokens;
  }

  const recommendedPaths = relevantFiles.map(f => f.path);
  const recommendedTokens = relevantFiles.reduce((sum, f) => sum + f.tokens, 0);
  const recommendedCost = (recommendedTokens / 1_000_000) * modelCostPerMillion;

  // Calculate savings
  const tokensSaved = allTokens - recommendedTokens;
  const costSaved = allCost - recommendedCost;
  const percentSaved = allTokens > 0 ? (tokensSaved / allTokens) * 100 : 0;

  // Generate recommendations
  const recommendations: string[] = [];

  if (relevantFiles.length < workspaceFiles.length) {
    recommendations.push(
      `Skip ${workspaceFiles.length - relevantFiles.length} unrelated files to save ${formatTokens(tokensSaved)} tokens`
    );
  }

  const largeRelevantFiles = relevantFiles.filter(f => f.tokens > 2000);
  if (largeRelevantFiles.length > 0) {
    recommendations.push(
      `Use signatures-only for ${largeRelevantFiles.length} large file${largeRelevantFiles.length > 1 ? "s" : ""} to save more`
    );
  }

  // Show why files were selected
  const topMatches = relevantFiles.slice(0, 3);
  if (topMatches.length > 0 && topMatches[0]?.matchReasons && topMatches[0].matchReasons.length > 0) {
    recommendations.push(
      `Top matches: ${topMatches.map(f => path.basename(f.path)).join(", ")}`
    );
  }

  return {
    prompt,
    currentContext: {
      files: allFiles,
      tokens: allTokens,
      cost: allCost,
    },
    recommendedContext: {
      files: recommendedPaths,
      tokens: recommendedTokens,
      cost: recommendedCost,
    },
    savings: {
      tokens: tokensSaved,
      cost: costSaved,
      percent: percentSaved,
    },
    recommendations,
  };
}

// ============================================================================
// Compaction Recovery
// ============================================================================

export type DecisionPriority = "critical" | "high" | "medium" | "low";

export interface TrackedDecision {
  id: string; // Unique ID for deduplication
  description: string;
  turnNumber: number;
  timestamp: Date;
  category: "architectural" | "configuration" | "requirement" | "constraint";
  priority: DecisionPriority;
  source: "manual" | "auto"; // How the decision was added
}

interface CompactionSession {
  decisions: Map<string, TrackedDecision>; // Map for deduplication
  contextSizeHistory: number[];
  lastKnownSize: number;
  compactionEvents: Array<{ turn: number; tokensLost: number; timestamp: Date }>;
}

let compactionSession: CompactionSession = {
  decisions: new Map(),
  contextSizeHistory: [],
  lastKnownSize: 0,
  compactionEvents: [],
};

/**
 * Generate a unique ID for a decision based on content
 */
function generateDecisionId(description: string, category: string): string {
  const normalized = description.toLowerCase().replace(/\s+/g, " ").trim();
  return `${category}:${hashContent(normalized)}`;
}

/**
 * Track an important decision made during the session
 */
export function trackDecision(
  description: string,
  category: TrackedDecision["category"] = "architectural",
  priority: DecisionPriority = "medium",
  source: "manual" | "auto" = "manual"
): { added: boolean; id: string } {
  const id = generateDecisionId(description, category);

  // Check for duplicate
  if (compactionSession.decisions.has(id)) {
    // Update turn number if it's from a later turn
    const existing = compactionSession.decisions.get(id)!;
    if (currentTurnNumber > existing.turnNumber) {
      existing.turnNumber = currentTurnNumber;
      existing.timestamp = new Date();
    }
    // Upgrade priority if new one is higher
    const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
    if (priorityOrder[priority] > priorityOrder[existing.priority]) {
      existing.priority = priority;
    }
    return { added: false, id };
  }

  compactionSession.decisions.set(id, {
    id,
    description: description.trim(),
    turnNumber: currentTurnNumber,
    timestamp: new Date(),
    category,
    priority,
    source,
  });

  return { added: true, id };
}

/**
 * Remove a tracked decision
 */
export function removeDecision(id: string): boolean {
  return compactionSession.decisions.delete(id);
}

/**
 * Get all tracked decisions
 */
export function getAllDecisions(): TrackedDecision[] {
  return Array.from(compactionSession.decisions.values());
}

/**
 * Record the current context size
 * Returns true if compaction was detected
 */
export function recordContextSize(size: number): {
  compactionDetected: boolean;
  tokensLost: number;
  percentReduction: number;
} {
  const lastSize = compactionSession.lastKnownSize;
  compactionSession.contextSizeHistory.push(size);
  compactionSession.lastKnownSize = size;

  // Detect significant reduction (>50% drop suggests compaction)
  if (lastSize > 0 && size < lastSize * 0.5) {
    compactionSession.compactionEvents.push({
      turn: currentTurnNumber,
      tokensLost: lastSize - size,
      timestamp: new Date(),
    });

    return {
      compactionDetected: true,
      tokensLost: lastSize - size,
      percentReduction: ((lastSize - size) / lastSize) * 100,
    };
  }

  return {
    compactionDetected: false,
    tokensLost: 0,
    percentReduction: 0,
  };
}

/**
 * Get decisions that may have been lost due to compaction
 */
export function getDecisionsAtRisk(): TrackedDecision[] {
  const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };

  return Array.from(compactionSession.decisions.values())
    .filter(d => d.turnNumber < currentTurnNumber - 2)
    .sort((a, b) => {
      // Sort by priority first, then by turn number
      const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return b.turnNumber - a.turnNumber;
    });
}

/**
 * Generate a reminder string for lost decisions
 */
export function generateCompactionReminder(): string {
  const atRisk = getDecisionsAtRisk();

  if (atRisk.length === 0) {
    return "";
  }

  const lines = ["Remember these decisions:"];

  // Group by category
  const byCategory = new Map<string, TrackedDecision[]>();
  for (const d of atRisk.slice(0, 8)) {
    const cat = d.category;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(d);
  }

  for (const [category, decisions] of byCategory) {
    for (const decision of decisions) {
      const priorityMarker = decision.priority === "critical" ? "🔴 " :
                             decision.priority === "high" ? "🟠 " : "";
      lines.push(`• ${priorityMarker}${decision.description}`);
    }
  }

  if (atRisk.length > 8) {
    lines.push(`• ... and ${atRisk.length - 8} more decisions`);
  }

  return lines.join("\n");
}

/**
 * Get compaction history
 */
export function getCompactionHistory(): Array<{ turn: number; tokensLost: number; timestamp: Date }> {
  return [...compactionSession.compactionEvents];
}

/**
 * Reset compaction tracking
 */
export function resetCompactionTracking(): void {
  compactionSession = {
    decisions: new Map(),
    contextSizeHistory: [],
    lastKnownSize: 0,
    compactionEvents: [],
  };
}

/**
 * Auto-detect decisions from text (for assistant responses)
 * More conservative patterns to reduce noise
 */
export function extractDecisionsFromText(text: string): TrackedDecision[] {
  const decisions: TrackedDecision[] = [];
  const seen = new Set<string>();

  // More specific patterns that are less likely to produce noise
  const patterns: Array<{
    regex: RegExp;
    category: TrackedDecision["category"];
    priority: DecisionPriority;
    extractor: (match: RegExpExecArray) => string | null;
  }> = [
    // Configuration with specific values
    {
      regex: /(?:set|configure|use)\s+(\w+(?:\s+\w+)?)\s+(?:to|as|=)\s*["']?(\d+\s*(?:ms|s|sec|min|minutes?|hours?|days?|MB|GB|KB)?)["']?/gi,
      category: "configuration",
      priority: "high",
      extractor: (m) => `${m[1]} = ${m[2]}`,
    },
    // JWT/token/session expiry
    {
      regex: /(?:jwt|token|session|cache)\s+(?:expir(?:y|es?|ation)|ttl|timeout)[:\s]+(\d+\s*\w+)/gi,
      category: "configuration",
      priority: "high",
      extractor: (m) => `${m[0]}`,
    },
    // Order/sequence constraints
    {
      regex: /(\w+(?:\s+\w+)?)\s+(?:must|should)\s+(?:run|execute|happen|come)\s+(before|after)\s+(\w+(?:\s+\w+)?)/gi,
      category: "constraint",
      priority: "high",
      extractor: (m) => `${m[1]} ${m[2]} ${m[3]}`,
    },
    // Use X instead of Y
    {
      regex: /use\s+(\w+)\s+(?:instead of|not|rather than)\s+(\w+)/gi,
      category: "architectural",
      priority: "medium",
      extractor: (m) => `Use ${m[1]} instead of ${m[2]}`,
    },
    // Implement pattern/approach
    {
      regex: /implement(?:ed|ing)?\s+((?:the\s+)?(?:\w+\s+){1,3}(?:pattern|approach|strategy|design))/gi,
      category: "architectural",
      priority: "medium",
      extractor: (m) => `Implement ${m[1]}`,
    },
    // Critical security decisions
    {
      regex: /(?:must|always|never)\s+(encrypt|hash|validate|sanitize|escape|authenticate)\s+([^.,!?]{5,40})/gi,
      category: "requirement",
      priority: "critical",
      extractor: (m) => `${m[0].trim()}`,
    },
  ];

  for (const { regex, category, priority, extractor } of patterns) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const description = extractor(match);
      if (!description || description.length < 8 || description.length > 100) continue;

      const id = generateDecisionId(description, category);
      if (seen.has(id)) continue;
      seen.add(id);

      decisions.push({
        id,
        description,
        turnNumber: currentTurnNumber,
        timestamp: new Date(),
        category,
        priority,
        source: "auto",
      });
    }
  }

  return decisions;
}

// ============================================================================
// Export session state for persistence
// ============================================================================

export interface SessionState {
  memory: {
    filesCount: number;
    tokensSaved: number;
    deduplicationCount: number;
  };
  decisions: TrackedDecision[];
  turnNumber: number;
}

export function exportSessionState(): SessionState {
  return {
    memory: {
      filesCount: sessionMemory.filesRead.size,
      tokensSaved: sessionMemory.totalTokensSaved,
      deduplicationCount: sessionMemory.deduplicationCount,
    },
    decisions: Array.from(compactionSession.decisions.values()),
    turnNumber: currentTurnNumber,
  };
}

// ============================================================================
// Test Exports (for unit testing)
// ============================================================================

/**
 * Export internal functions for testing
 * Only use these in test files
 */
export const _testing = {
  extractSignatures,
  extractSignaturesFromLines,
  extractSignaturesInChunks,
  stripStringsAndComments,
  countBraces,
  hashContent,
  fuzzyMatch,
  generateDecisionId,
  MAX_LINES_PER_CHUNK,
  MAX_SIGNATURES,
  MAX_IMPORTS,
  MAX_TYPES,
};
