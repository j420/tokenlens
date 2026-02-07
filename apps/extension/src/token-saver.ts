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
  content: string;
  tokens: number;
  readAt: Date;
  turnNumber: number;
}

interface SessionMemory {
  filesRead: Map<string, FileReadRecord>;
  totalTokensSaved: number;
  deduplicationCount: number;
  sessionStart: Date;
}

// Global session memory (persists during extension lifetime)
let sessionMemory: SessionMemory = {
  filesRead: new Map(),
  totalTokensSaved: 0,
  deduplicationCount: 0,
  sessionStart: new Date(),
};

let currentTurnNumber = 0;

/**
 * Record a file as read in the current session
 */
export function recordFileRead(filePath: string, content: string): {
  isDuplicate: boolean;
  tokensSaved: number;
  originalTurn: number | null;
} {
  const normalizedPath = path.normalize(filePath);
  const tokens = countTokens(content);

  const existing = sessionMemory.filesRead.get(normalizedPath);

  if (existing) {
    // File was already read - this is a duplicate
    sessionMemory.totalTokensSaved += tokens;
    sessionMemory.deduplicationCount++;

    return {
      isDuplicate: true,
      tokensSaved: tokens,
      originalTurn: existing.turnNumber,
    };
  }

  // First time reading this file
  sessionMemory.filesRead.set(normalizedPath, {
    path: normalizedPath,
    content,
    tokens,
    readAt: new Date(),
    turnNumber: currentTurnNumber,
  });

  return {
    isDuplicate: false,
    tokensSaved: 0,
    originalTurn: null,
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
 * Get the content of a file from session memory
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
 * Get session memory statistics
 */
export function getSessionStats(): {
  filesRead: number;
  totalTokens: number;
  tokensSaved: number;
  deduplicationCount: number;
  sessionDuration: number;
} {
  const totalTokens = Array.from(sessionMemory.filesRead.values())
    .reduce((sum, f) => sum + f.tokens, 0);

  return {
    filesRead: sessionMemory.filesRead.size,
    totalTokens,
    tokensSaved: sessionMemory.totalTokensSaved,
    deduplicationCount: sessionMemory.deduplicationCount,
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
    sessionStart: new Date(),
  };
  currentTurnNumber = 0;
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
 * Extract function/method signatures from code
 * Uses regex-based extraction (fast, works without tree-sitter)
 */
function extractSignatures(code: string, language: string): string {
  const lines = code.split("\n");
  const result: string[] = [];
  let inClass = false;
  let classIndent = 0;
  let currentClass = "";
  let braceDepth = 0;
  let inFunction = false;
  let functionStart = -1;

  // Track imports and types
  const imports: string[] = [];
  const types: string[] = [];
  const signatures: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Track brace depth
    braceDepth += (line.match(/{/g) || []).length;
    braceDepth -= (line.match(/}/g) || []).length;

    // Imports
    if (trimmed.startsWith("import ") || trimmed.startsWith("from ")) {
      imports.push(trimmed);
      continue;
    }

    // Types/Interfaces (TypeScript)
    if (/^(export\s+)?(interface|type)\s+\w+/.test(trimmed)) {
      // Get the full type definition (may span multiple lines)
      let typeDef = trimmed;
      let j = i + 1;
      let typeDepth = (trimmed.match(/{/g) || []).length - (trimmed.match(/}/g) || []).length;

      while (j < lines.length && typeDepth > 0) {
        const nextLine = lines[j].trim();
        typeDef += "\n  " + nextLine;
        typeDepth += (nextLine.match(/{/g) || []).length;
        typeDepth -= (nextLine.match(/}/g) || []).length;
        j++;
      }
      types.push(typeDef);
      continue;
    }

    // Class definition
    if (/^(export\s+)?(abstract\s+)?class\s+\w+/.test(trimmed)) {
      inClass = true;
      classIndent = line.search(/\S/);
      currentClass = trimmed.match(/class\s+(\w+)/)?.[1] || "";
      signatures.push(`\n${trimmed}`);
      continue;
    }

    // Function/method signatures
    const funcPatterns = [
      // TypeScript/JavaScript function
      /^(export\s+)?(async\s+)?function\s+(\w+)\s*\([^)]*\)(\s*:\s*[^{]+)?/,
      // Arrow function assigned to const
      /^(export\s+)?const\s+(\w+)\s*=\s*(async\s+)?\([^)]*\)(\s*:\s*[^=]+)?\s*=>/,
      // Method in class
      /^(public|private|protected|static|async|\s)*(\w+)\s*\([^)]*\)(\s*:\s*[^{]+)?/,
      // Python function
      /^(async\s+)?def\s+(\w+)\s*\([^)]*\)(\s*->\s*[^:]+)?:/,
      // Go function
      /^func\s+(\([^)]*\)\s*)?\w+\s*\([^)]*\)(\s*[^{]+)?/,
    ];

    for (const pattern of funcPatterns) {
      if (pattern.test(trimmed)) {
        // Get the signature line
        let sig = trimmed;

        // If it ends with { or :, that's the full signature
        if (!sig.endsWith("{") && !sig.endsWith(":") && !sig.endsWith("=>")) {
          // Might be multi-line signature
          let j = i + 1;
          while (j < lines.length && !lines[j].includes("{") && !lines[j].trim().endsWith(":")) {
            sig += " " + lines[j].trim();
            j++;
          }
        }

        // Clean up and add ellipsis
        sig = sig.replace(/\{.*$/, "").trim();
        if (inClass && currentClass) {
          signatures.push(`  ${sig} { /* ... */ }`);
        } else {
          signatures.push(`${sig} { /* ... */ }`);
        }
        break;
      }
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
    parts.push(imports.slice(0, 10).join("\n")); // Limit imports
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

    originalTokens += countTokens(file.content);

    if (opts.signatureOnly && language !== "unknown") {
      // Extract signatures only
      const signatures = extractSignatures(file.content, language);
      const header = `// === ${fileName} ===`;
      const fileOutput = `${header}\n${signatures}`;
      parts.push(fileOutput);
      optimizedTokens += countTokens(fileOutput);
    } else {
      // Include full file (but might truncate if too large)
      const header = `// === ${fileName} ===`;
      let content = file.content;

      if (countTokens(content) > opts.maxTokensPerFile) {
        // Truncate with note
        const lines = content.split("\n");
        let truncated = "";
        let tokens = 0;
        for (const line of lines) {
          const lineTokens = countTokens(line);
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
      optimizedTokens += countTokens(fileOutput);
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

/**
 * Analyze a prompt and suggest optimal context
 */
export function analyzePreFlight(
  prompt: string,
  workspaceFiles: Array<{ path: string; content: string; tokens: number }>,
  modelCostPerMillion: number = 3 // $3 per 1M tokens for Claude Sonnet
): PreflightAnalysis {
  // Simple keyword matching for relevance
  const promptWords = new Set(
    prompt.toLowerCase()
      .split(/\W+/)
      .filter(w => w.length > 2)
  );

  // Score each file
  const scoredFiles = workspaceFiles.map(file => {
    const fileName = path.basename(file.path).toLowerCase();
    const content = file.content.toLowerCase();

    let score = 0;

    // File name matches prompt words
    for (const word of promptWords) {
      if (fileName.includes(word)) score += 10;
      if (content.includes(word)) score += 1;
    }

    // Boost for certain patterns
    if (promptWords.has("fix") || promptWords.has("bug") || promptWords.has("error")) {
      if (content.includes("throw") || content.includes("catch") || content.includes("error")) {
        score += 5;
      }
    }

    if (promptWords.has("test")) {
      if (fileName.includes("test") || fileName.includes("spec")) score += 20;
    }

    if (promptWords.has("style") || promptWords.has("css")) {
      if (fileName.endsWith(".css") || fileName.endsWith(".scss")) score += 20;
    }

    return { ...file, score };
  });

  // Sort by score
  scoredFiles.sort((a, b) => b.score - a.score);

  // Current context: all files
  const allFiles = workspaceFiles.map(f => f.path);
  const allTokens = workspaceFiles.reduce((sum, f) => sum + f.tokens, 0);
  const allCost = (allTokens / 1_000_000) * modelCostPerMillion;

  // Recommended: only high-scoring files (score > 0), max 10 files
  const relevantFiles = scoredFiles
    .filter(f => f.score > 0)
    .slice(0, 10);

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

  const largeFiles = workspaceFiles.filter(f => f.tokens > 2000);
  if (largeFiles.length > 0) {
    recommendations.push(
      `Consider using signatures-only for ${largeFiles.length} large files`
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

export interface TrackedDecision {
  description: string;
  turnNumber: number;
  timestamp: Date;
  category: "architectural" | "configuration" | "requirement" | "constraint";
}

interface CompactionSession {
  decisions: TrackedDecision[];
  contextSizeHistory: number[];
  lastKnownSize: number;
}

let compactionSession: CompactionSession = {
  decisions: [],
  contextSizeHistory: [],
  lastKnownSize: 0,
};

/**
 * Track an important decision made during the session
 */
export function trackDecision(
  description: string,
  category: TrackedDecision["category"] = "architectural"
): void {
  compactionSession.decisions.push({
    description,
    turnNumber: currentTurnNumber,
    timestamp: new Date(),
    category,
  });
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
  // Return all decisions from older turns
  // (more likely to be lost in compaction)
  return compactionSession.decisions
    .filter(d => d.turnNumber < currentTurnNumber - 2)
    .sort((a, b) => b.turnNumber - a.turnNumber);
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

  for (const decision of atRisk.slice(0, 5)) {
    lines.push(`• ${decision.description} (turn ${decision.turnNumber})`);
  }

  if (atRisk.length > 5) {
    lines.push(`• ... and ${atRisk.length - 5} more`);
  }

  return lines.join("\n");
}

/**
 * Reset compaction tracking
 */
export function resetCompactionTracking(): void {
  compactionSession = {
    decisions: [],
    contextSizeHistory: [],
    lastKnownSize: 0,
  };
}

/**
 * Auto-detect decisions from text (for assistant responses)
 */
export function extractDecisionsFromText(text: string): TrackedDecision[] {
  const decisions: TrackedDecision[] = [];
  const patterns = [
    // Configuration decisions
    { regex: /set\s+(\w+)\s+to\s+([^.,]+)/gi, category: "configuration" as const },
    { regex: /(\w+)\s*[:=]\s*(\d+\s*(?:ms|s|min|minutes?|hours?)?)/gi, category: "configuration" as const },
    { regex: /use\s+(\w+)\s+(?:for|as|instead of)/gi, category: "architectural" as const },

    // Architectural decisions
    { regex: /(?:must|should|need to|have to)\s+([^.,!?]{10,80})/gi, category: "requirement" as const },
    { regex: /(?:before|after)\s+(\w+)/gi, category: "constraint" as const },
    { regex: /implement(?:ed|ing)?\s+(\w+\s+(?:pattern|approach|strategy))/gi, category: "architectural" as const },
  ];

  for (const { regex, category } of patterns) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const description = match[1]?.trim() || match[0].trim();
      if (description.length > 5 && description.length < 100) {
        decisions.push({
          description,
          turnNumber: currentTurnNumber,
          timestamp: new Date(),
          category,
        });
      }
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
    decisions: compactionSession.decisions,
    turnNumber: currentTurnNumber,
  };
}
