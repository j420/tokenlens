/**
 * Smart Context Analyzer
 *
 * Analyzes file dependencies to determine which files are relevant
 * to the current task. Works with any language.
 *
 * Key principle: Be CONSERVATIVE - better to include extra files
 * than miss something important.
 */

import * as path from "path";
import * as fs from "fs";

// ============================================================================
// Types
// ============================================================================

export interface FileRelevance {
  filePath: string;
  fileName: string;
  tokens: number;
  relevanceScore: number; // 0-100
  relevanceReasons: string[];
  isRelevant: boolean;
  category: "active" | "imported" | "imports-active" | "related" | "config" | "test" | "keyword" | "unrelated";
}

export interface ContextAnalysis {
  activeFile: string;
  prompt: string;
  relevantFiles: FileRelevance[];
  excludedFiles: FileRelevance[];
  totalTokens: number;
  relevantTokens: number;
  excludedTokens: number;
  savingsPercent: number;
}

interface ImportInfo {
  source: string;      // The import path as written
  resolved: string;    // Resolved absolute path (if possible)
  isRelative: boolean;
  isPackage: boolean;
}

// ============================================================================
// Language-Specific Import Parsers
// ============================================================================

/**
 * Parse imports from JavaScript/TypeScript files
 */
function parseJSImports(content: string, filePath: string): ImportInfo[] {
  const imports: ImportInfo[] = [];
  const dir = path.dirname(filePath);

  // ES6 imports: import X from 'path'
  const es6Regex = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+|\w+))*\s+from\s+)?['"]([^'"]+)['"]/g;
  let match;
  while ((match = es6Regex.exec(content)) !== null) {
    const source = match[1];
    imports.push(resolveImport(source, dir));
  }

  // CommonJS: require('path')
  const cjsRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = cjsRegex.exec(content)) !== null) {
    const source = match[1];
    imports.push(resolveImport(source, dir));
  }

  // Dynamic imports: import('path')
  const dynamicRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = dynamicRegex.exec(content)) !== null) {
    const source = match[1];
    imports.push(resolveImport(source, dir));
  }

  return imports;
}

/**
 * Parse imports from Python files
 */
function parsePythonImports(content: string, filePath: string): ImportInfo[] {
  const imports: ImportInfo[] = [];
  const dir = path.dirname(filePath);

  // from X import Y
  const fromRegex = /from\s+(\.+)?(\S+)?\s+import/g;
  let match;
  while ((match = fromRegex.exec(content)) !== null) {
    const dots = match[1] || "";
    const module = match[2] || "";

    if (dots) {
      // Relative import
      const levels = dots.length;
      let targetDir = dir;
      for (let i = 1; i < levels; i++) {
        targetDir = path.dirname(targetDir);
      }
      const source = module ? path.join(targetDir, ...module.split(".")) : targetDir;
      imports.push({
        source: dots + module,
        resolved: source + ".py",
        isRelative: true,
        isPackage: false,
      });
    } else if (module) {
      imports.push({
        source: module,
        resolved: "",
        isRelative: false,
        isPackage: !module.startsWith("."),
      });
    }
  }

  // import X
  const importRegex = /^import\s+(\S+)/gm;
  while ((match = importRegex.exec(content)) !== null) {
    const module = match[1].split(",")[0].trim();
    imports.push({
      source: module,
      resolved: "",
      isRelative: false,
      isPackage: true,
    });
  }

  return imports;
}

/**
 * Parse imports from Go files
 */
function parseGoImports(content: string, filePath: string): ImportInfo[] {
  const imports: ImportInfo[] = [];

  // Single import: import "path"
  const singleRegex = /import\s+"([^"]+)"/g;
  let match;
  while ((match = singleRegex.exec(content)) !== null) {
    imports.push({
      source: match[1],
      resolved: "",
      isRelative: match[1].startsWith("."),
      isPackage: !match[1].startsWith("."),
    });
  }

  // Import block: import ( "path1" "path2" )
  const blockRegex = /import\s*\(([\s\S]*?)\)/g;
  while ((match = blockRegex.exec(content)) !== null) {
    const block = match[1];
    const pathRegex = /["']([^"']+)["']/g;
    let pathMatch;
    while ((pathMatch = pathRegex.exec(block)) !== null) {
      imports.push({
        source: pathMatch[1],
        resolved: "",
        isRelative: pathMatch[1].startsWith("."),
        isPackage: !pathMatch[1].startsWith("."),
      });
    }
  }

  return imports;
}

/**
 * Parse imports from Rust files
 */
function parseRustImports(content: string, filePath: string): ImportInfo[] {
  const imports: ImportInfo[] = [];

  // use statements
  const useRegex = /use\s+(crate|self|super)?::?([^;{]+)/g;
  let match;
  while ((match = useRegex.exec(content)) !== null) {
    const prefix = match[1] || "";
    const path = match[2].trim();
    imports.push({
      source: prefix ? `${prefix}::${path}` : path,
      resolved: "",
      isRelative: prefix === "self" || prefix === "super" || prefix === "crate",
      isPackage: !prefix || prefix === "",
    });
  }

  // mod statements (file includes)
  const modRegex = /mod\s+(\w+)\s*;/g;
  while ((match = modRegex.exec(content)) !== null) {
    const modName = match[1];
    const dir = path.dirname(filePath);
    // Could be modname.rs or modname/mod.rs
    imports.push({
      source: modName,
      resolved: path.join(dir, modName + ".rs"),
      isRelative: true,
      isPackage: false,
    });
  }

  return imports;
}

/**
 * Parse imports from Java/Kotlin files
 */
function parseJavaImports(content: string, filePath: string): ImportInfo[] {
  const imports: ImportInfo[] = [];

  const importRegex = /import\s+(static\s+)?([^;]+);/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const importPath = match[2].trim();
    imports.push({
      source: importPath,
      resolved: "",
      isRelative: false,
      isPackage: true,
    });
  }

  return imports;
}

/**
 * Parse imports from C/C++ files
 */
function parseCppImports(content: string, filePath: string): ImportInfo[] {
  const imports: ImportInfo[] = [];
  const dir = path.dirname(filePath);

  // #include "local.h" (local)
  const localRegex = /#include\s*"([^"]+)"/g;
  let match;
  while ((match = localRegex.exec(content)) !== null) {
    const source = match[1];
    imports.push({
      source: source,
      resolved: path.join(dir, source),
      isRelative: true,
      isPackage: false,
    });
  }

  // #include <system.h> (system)
  const systemRegex = /#include\s*<([^>]+)>/g;
  while ((match = systemRegex.exec(content)) !== null) {
    imports.push({
      source: match[1],
      resolved: "",
      isRelative: false,
      isPackage: true,
    });
  }

  return imports;
}

/**
 * Parse imports from Ruby files
 */
function parseRubyImports(content: string, filePath: string): ImportInfo[] {
  const imports: ImportInfo[] = [];
  const dir = path.dirname(filePath);

  // require 'path' or require "path"
  const requireRegex = /require\s*['"](\.\/)?([^'"]+)['"]/g;
  let match;
  while ((match = requireRegex.exec(content)) !== null) {
    const isRelative = !!match[1];
    const source = match[2];
    imports.push({
      source: source,
      resolved: isRelative ? path.join(dir, source + ".rb") : "",
      isRelative: isRelative,
      isPackage: !isRelative,
    });
  }

  // require_relative 'path'
  const relativeRegex = /require_relative\s*['"]([^'"]+)['"]/g;
  while ((match = relativeRegex.exec(content)) !== null) {
    const source = match[1];
    imports.push({
      source: source,
      resolved: path.join(dir, source + ".rb"),
      isRelative: true,
      isPackage: false,
    });
  }

  return imports;
}

/**
 * Parse imports from PHP files
 */
function parsePHPImports(content: string, filePath: string): ImportInfo[] {
  const imports: ImportInfo[] = [];
  const dir = path.dirname(filePath);

  // require/include statements
  const includeRegex = /(require|include|require_once|include_once)\s*[\(]?\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = includeRegex.exec(content)) !== null) {
    const source = match[2];
    imports.push({
      source: source,
      resolved: path.isAbsolute(source) ? source : path.join(dir, source),
      isRelative: !path.isAbsolute(source),
      isPackage: false,
    });
  }

  // use statements (namespaces)
  const useRegex = /use\s+([^;{]+)/g;
  while ((match = useRegex.exec(content)) !== null) {
    imports.push({
      source: match[1].trim(),
      resolved: "",
      isRelative: false,
      isPackage: true,
    });
  }

  return imports;
}

// ============================================================================
// Helper Functions
// ============================================================================

function resolveImport(source: string, fromDir: string): ImportInfo {
  const isRelative = source.startsWith(".") || source.startsWith("/");
  const isPackage = !isRelative;

  let resolved = "";
  if (isRelative) {
    // Try common extensions
    const basePath = path.resolve(fromDir, source);
    const extensions = ["", ".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs", "/index.js", "/index.ts"];
    for (const ext of extensions) {
      const tryPath = basePath + ext;
      if (fs.existsSync(tryPath)) {
        resolved = tryPath;
        break;
      }
    }
    if (!resolved) {
      resolved = basePath; // Best guess
    }
  }

  return { source, resolved, isRelative, isPackage };
}

function getLanguageFromExtension(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const langMap: Record<string, string> = {
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".py": "python",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".kt": "kotlin",
    ".kts": "kotlin",
    ".c": "c",
    ".h": "c",
    ".cpp": "cpp",
    ".hpp": "cpp",
    ".cc": "cpp",
    ".cxx": "cpp",
    ".rb": "ruby",
    ".php": "php",
  };
  return langMap[ext] || "unknown";
}

function parseImports(content: string, filePath: string): ImportInfo[] {
  const lang = getLanguageFromExtension(filePath);

  switch (lang) {
    case "javascript":
    case "typescript":
      return parseJSImports(content, filePath);
    case "python":
      return parsePythonImports(content, filePath);
    case "go":
      return parseGoImports(content, filePath);
    case "rust":
      return parseRustImports(content, filePath);
    case "java":
    case "kotlin":
      return parseJavaImports(content, filePath);
    case "c":
    case "cpp":
      return parseCppImports(content, filePath);
    case "ruby":
      return parseRubyImports(content, filePath);
    case "php":
      return parsePHPImports(content, filePath);
    default:
      return [];
  }
}

function estimateTokens(content: string): number {
  // Rough estimate: ~4 characters per token
  return Math.ceil(content.length / 4);
}

function extractKeywords(prompt: string): string[] {
  // Extract meaningful words from the prompt
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "must", "shall", "can", "need", "dare",
    "to", "of", "in", "for", "on", "with", "at", "by", "from", "as",
    "into", "through", "during", "before", "after", "above", "below",
    "between", "under", "again", "further", "then", "once", "here",
    "there", "when", "where", "why", "how", "all", "each", "few",
    "more", "most", "other", "some", "such", "no", "nor", "not",
    "only", "own", "same", "so", "than", "too", "very", "just",
    "and", "but", "if", "or", "because", "until", "while", "this",
    "that", "these", "those", "i", "me", "my", "we", "our", "you",
    "your", "it", "its", "fix", "add", "update", "change", "make",
    "create", "delete", "remove", "please", "help", "want", "need",
  ]);

  const words = prompt.toLowerCase()
    .replace(/[^a-z0-9_\-\.]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));

  return [...new Set(words)];
}

function getRelatedFilePatterns(filePath: string): string[] {
  const baseName = path.basename(filePath);
  const ext = path.extname(filePath);
  const nameWithoutExt = baseName.replace(ext, "");
  const dir = path.dirname(filePath);

  const patterns: string[] = [];

  // Test files
  patterns.push(`${nameWithoutExt}.test${ext}`);
  patterns.push(`${nameWithoutExt}.spec${ext}`);
  patterns.push(`${nameWithoutExt}_test${ext}`);
  patterns.push(`test_${nameWithoutExt}${ext}`);

  // Type definition files
  patterns.push(`${nameWithoutExt}.types${ext}`);
  patterns.push(`${nameWithoutExt}.d.ts`);

  // Related modules
  patterns.push(`${nameWithoutExt}.utils${ext}`);
  patterns.push(`${nameWithoutExt}.helpers${ext}`);
  patterns.push(`${nameWithoutExt}.constants${ext}`);

  // Index files in same-named directory
  patterns.push(`${nameWithoutExt}/index${ext}`);

  return patterns;
}

// ============================================================================
// Always Include / Always Exclude Lists
// ============================================================================

const ALWAYS_INCLUDE_PATTERNS = [
  /^package\.json$/,
  /^tsconfig\.json$/,
  /^jsconfig\.json$/,
  /^\.env\.example$/,
  /^requirements\.txt$/,
  /^Cargo\.toml$/,
  /^go\.mod$/,
  /^Gemfile$/,
  /^composer\.json$/,
];

const ALWAYS_EXCLUDE_PATTERNS = [
  /^package-lock\.json$/,
  /^yarn\.lock$/,
  /^pnpm-lock\.yaml$/,
  /^Cargo\.lock$/,
  /^Gemfile\.lock$/,
  /^composer\.lock$/,
  /^node_modules\//,
  /^\.git\//,
  /^dist\//,
  /^build\//,
  /^out\//,
  /^\.next\//,
  /^__pycache__\//,
  /^\.pyc$/,
  /^\.class$/,
  /^\.o$/,
  /^\.so$/,
  /^\.dll$/,
  /^\.exe$/,
  /\.min\.js$/,
  /\.min\.css$/,
  /\.map$/,
  /\.chunk\./,
];

function shouldAlwaysInclude(fileName: string): boolean {
  return ALWAYS_INCLUDE_PATTERNS.some(pattern => pattern.test(fileName));
}

function shouldAlwaysExclude(filePath: string): boolean {
  const fileName = path.basename(filePath);
  return ALWAYS_EXCLUDE_PATTERNS.some(pattern =>
    pattern.test(fileName) || pattern.test(filePath)
  );
}

// ============================================================================
// Main Analysis Function
// ============================================================================

export interface AnalyzeOptions {
  activeFilePath: string;
  activeFileContent: string;
  prompt: string;
  workspaceFiles: { path: string; content: string }[];
}

export function analyzeContext(options: AnalyzeOptions): ContextAnalysis {
  const { activeFilePath, activeFileContent, prompt, workspaceFiles } = options;
  const activeFileName = path.basename(activeFilePath);
  const activeDir = path.dirname(activeFilePath);

  // Extract keywords from prompt
  const keywords = extractKeywords(prompt);

  // Parse imports from active file
  const activeImports = parseImports(activeFileContent, activeFilePath);
  const importedPaths = new Set(
    activeImports
      .filter(i => i.isRelative && i.resolved)
      .map(i => i.resolved)
  );

  // Get patterns for related files
  const relatedPatterns = getRelatedFilePatterns(activeFilePath);

  // Build reverse dependency map (who imports the active file)
  const reverseImports = new Set<string>();
  for (const file of workspaceFiles) {
    if (file.path === activeFilePath) continue;
    const imports = parseImports(file.content, file.path);
    for (const imp of imports) {
      if (imp.resolved === activeFilePath ||
          imp.resolved.replace(/\.(js|ts|tsx|jsx)$/, "") === activeFilePath.replace(/\.(js|ts|tsx|jsx)$/, "")) {
        reverseImports.add(file.path);
        break;
      }
    }
  }

  // Analyze each file
  const relevantFiles: FileRelevance[] = [];
  const excludedFiles: FileRelevance[] = [];

  for (const file of workspaceFiles) {
    const fileName = path.basename(file.path);
    const fileDir = path.dirname(file.path);
    const tokens = estimateTokens(file.content);
    const reasons: string[] = [];
    let score = 0;

    // Check if always excluded
    if (shouldAlwaysExclude(file.path)) {
      excludedFiles.push({
        filePath: file.path,
        fileName,
        tokens,
        relevanceScore: 0,
        relevanceReasons: ["Generated/lock file"],
        isRelevant: false,
        category: "unrelated",
      });
      continue;
    }

    // Active file - always include
    if (file.path === activeFilePath) {
      relevantFiles.push({
        filePath: file.path,
        fileName,
        tokens,
        relevanceScore: 100,
        relevanceReasons: ["Active file being edited"],
        isRelevant: true,
        category: "active",
      });
      continue;
    }

    // Check if imported by active file
    if (importedPaths.has(file.path)) {
      score += 80;
      reasons.push("Imported by active file");
    }

    // Check if imports active file
    if (reverseImports.has(file.path)) {
      score += 60;
      reasons.push("Imports the active file");
    }

    // Check related file patterns (test, types, etc.)
    for (const pattern of relatedPatterns) {
      if (fileName === pattern || file.path.endsWith(pattern)) {
        score += 70;
        reasons.push(`Related file (${pattern.includes("test") || pattern.includes("spec") ? "test" : "types/utils"})`);
        break;
      }
    }

    // Same directory bonus
    if (fileDir === activeDir) {
      score += 20;
      reasons.push("Same directory");
    }

    // Config files - always include (small, often needed)
    if (shouldAlwaysInclude(fileName)) {
      score += 50;
      reasons.push("Config file");
    }

    // Keyword matching
    const fileContentLower = file.content.toLowerCase();
    const fileNameLower = fileName.toLowerCase();
    for (const keyword of keywords) {
      if (fileNameLower.includes(keyword)) {
        score += 40;
        reasons.push(`Filename matches keyword "${keyword}"`);
        break;
      }
      if (fileContentLower.includes(keyword)) {
        score += 15;
        reasons.push(`Content contains keyword "${keyword}"`);
        break;
      }
    }

    // Determine category
    let category: FileRelevance["category"] = "unrelated";
    if (reasons.some(r => r.includes("Imported by"))) category = "imported";
    else if (reasons.some(r => r.includes("Imports the"))) category = "imports-active";
    else if (reasons.some(r => r.includes("test"))) category = "test";
    else if (reasons.some(r => r.includes("Config"))) category = "config";
    else if (reasons.some(r => r.includes("Related"))) category = "related";
    else if (reasons.some(r => r.includes("keyword"))) category = "keyword";

    const isRelevant = score >= 30; // Threshold for relevance

    const fileRelevance: FileRelevance = {
      filePath: file.path,
      fileName,
      tokens,
      relevanceScore: Math.min(100, score),
      relevanceReasons: reasons.length > 0 ? reasons : ["No connection found"],
      isRelevant,
      category,
    };

    if (isRelevant) {
      relevantFiles.push(fileRelevance);
    } else {
      excludedFiles.push(fileRelevance);
    }
  }

  // Sort by relevance score
  relevantFiles.sort((a, b) => b.relevanceScore - a.relevanceScore);
  excludedFiles.sort((a, b) => b.tokens - a.tokens);

  // Calculate totals
  const relevantTokens = relevantFiles.reduce((sum, f) => sum + f.tokens, 0);
  const excludedTokens = excludedFiles.reduce((sum, f) => sum + f.tokens, 0);
  const totalTokens = relevantTokens + excludedTokens;
  const savingsPercent = totalTokens > 0 ? (excludedTokens / totalTokens) * 100 : 0;

  return {
    activeFile: activeFilePath,
    prompt,
    relevantFiles,
    excludedFiles,
    totalTokens,
    relevantTokens,
    excludedTokens,
    savingsPercent,
  };
}

// ============================================================================
// Export for Extension
// ============================================================================

export {
  parseImports,
  extractKeywords,
  estimateTokens,
  getLanguageFromExtension,
};
