/**
 * Prune v2 Intelligence Engine
 *
 * A comprehensive token intelligence system that:
 * - Extracts symbols at function/class/type level
 * - Builds a Relevance DAG with weighted edges
 * - Classifies user intent (debug/generate/refactor/explain/edit)
 * - Walks the DAG with budget-aware traversal
 * - Generates signatures-only mode for medium-relevance code
 * - Tracks context utility and learns from responses
 * - Detects known knowledge to avoid redundant context
 * - Generates context manifests for bidirectional negotiation
 */

import * as path from "path";
import * as fs from "fs";

// ============================================================================
// Types & Interfaces
// ============================================================================

/** Symbol types that can be extracted from code */
export type SymbolKind =
  | "function"
  | "method"
  | "class"
  | "interface"
  | "type"
  | "enum"
  | "constant"
  | "variable"
  | "import"
  | "export";

/** A code symbol extracted from source */
export interface CodeSymbol {
  id: string;                    // Unique ID: file:line:name
  name: string;                  // Symbol name
  kind: SymbolKind;              // Type of symbol
  filePath: string;              // Source file
  startLine: number;             // Start line (1-indexed)
  endLine: number;               // End line (1-indexed)
  signature: string;             // Function/class signature (compact)
  fullText: string;              // Complete source text
  docstring?: string;            // Documentation if present
  dependencies: string[];        // IDs of symbols this depends on
  dependents: string[];          // IDs of symbols that depend on this
  complexity: number;            // Cyclomatic complexity estimate
  tokens: number;                // Approximate token count
  isExported: boolean;           // Whether exported/public
  isAsync: boolean;              // Whether async
  parameters?: ParameterInfo[];  // Function parameters
  returnType?: string;           // Return type annotation
  decorators?: string[];         // Decorators/annotations
}

export interface ParameterInfo {
  name: string;
  type?: string;
  defaultValue?: string;
  isOptional: boolean;
}

/** Edge in the relevance DAG */
export interface DependencyEdge {
  from: string;      // Source symbol ID
  to: string;        // Target symbol ID
  weight: number;    // Edge weight (0-1)
  type: EdgeType;    // Type of dependency
}

export type EdgeType =
  | "calls"          // Function calls another
  | "extends"        // Class extends another
  | "implements"     // Class implements interface
  | "imports"        // Imports from module
  | "uses_type"      // Uses a type definition
  | "instantiates"   // Creates instance of class
  | "references"     // General reference
  | "test_for";      // Test file for implementation

/** User intent classification */
export type IntentType =
  | "debug"          // Finding/fixing bugs
  | "generate"       // Creating new code
  | "refactor"       // Improving existing code
  | "explain"        // Understanding code
  | "edit"           // Modifying specific code
  | "test"           // Writing/fixing tests
  | "review"         // Code review
  | "unknown";

export interface IntentClassification {
  primary: IntentType;
  confidence: number;           // 0-1
  secondary?: IntentType;
  keywords: string[];           // Matched keywords
  targetFiles?: string[];       // Files mentioned
  targetSymbols?: string[];     // Symbols mentioned
}

/** Relevance score for a symbol */
export interface RelevanceScore {
  symbolId: string;
  score: number;                // 0-100
  reasons: string[];
  category: "critical" | "high" | "medium" | "low" | "none";
  includeMode: "full" | "signature" | "reference" | "exclude";
}

/** Context budget configuration */
export interface ContextBudget {
  maxTokens: number;
  reservedForResponse: number;
  reservedForSystem: number;
  availableForContext: number;
}

/** Result of context selection */
export interface ContextSelection {
  selectedSymbols: SelectedSymbol[];
  totalTokens: number;
  budgetUsed: number;
  budgetRemaining: number;
  excludedCount: number;
  compressionRatio: number;
}

export interface SelectedSymbol {
  symbol: CodeSymbol;
  relevance: RelevanceScore;
  content: string;              // Actual content to include
  tokens: number;
}

/** Context utility tracking */
export interface UtilityRecord {
  symbolId: string;
  sessionId: string;
  wasReferenced: boolean;       // Did LLM reference this?
  wasModified: boolean;         // Did LLM modify this?
  wasHelpful: boolean;          // User feedback
  timestamp: number;
}

/** Known knowledge patterns */
export interface KnownPattern {
  pattern: string;              // Regex or identifier
  category: string;             // e.g., "react-hooks", "express-middleware"
  confidence: number;           // How confident LLM knows this
  tokenSavings: number;         // Estimated tokens saved
}

/** Context manifest for bidirectional negotiation */
export interface ContextManifest {
  version: string;
  timestamp: number;
  files: ManifestFile[];
  symbols: ManifestSymbol[];
  totalTokens: number;
  requestFormat: string;        // How LLM can request more context
}

export interface ManifestFile {
  path: string;
  language: string;
  tokens: number;
  symbolCount: number;
  summary: string;
}

export interface ManifestSymbol {
  id: string;
  name: string;
  kind: SymbolKind;
  file: string;
  line: number;
  signature: string;
  tokens: number;
}

// ============================================================================
// Phase 1: Symbol Extractor
// ============================================================================

export class SymbolExtractor {
  private languagePatterns: Map<string, LanguagePatterns>;

  constructor() {
    this.languagePatterns = new Map();
    this.initializePatterns();
  }

  private initializePatterns(): void {
    // TypeScript/JavaScript patterns
    this.languagePatterns.set("typescript", {
      functionPatterns: [
        /(?:^|[;\{\}])\s*(export\s+)?(async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?::\s*([^\{]+))?\s*\{/gm,
        /(?:^|[;\{\}])\s*(export\s+)?(const|let|var)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(async\s+)?\(([^)]*)\)\s*(?::\s*([^\=\>]+))?\s*=>/gm,
        /(?:^|[;\{\}])\s*(export\s+)?(const|let|var)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(async\s+)?function\s*\(/gm,
        // Class methods (public/private/protected/async methods)
        /^\s*(public|private|protected)?\s*(static)?\s*(async)?\s*(\w+)\s*\(([^)]*)\)\s*(?::\s*([^\{]+))?\s*\{/gm,
      ],
      classPatterns: [
        /(?:^|[;\{\}])\s*(export\s+)?(abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^\{]+))?\s*\{/gm,
      ],
      interfacePatterns: [
        /(?:^|[;\{\}])\s*(export\s+)?interface\s+(\w+)(?:\s+extends\s+([^\{]+))?\s*\{/gm,
      ],
      typePatterns: [
        /(?:^|[;\{\}])\s*(export\s+)?type\s+(\w+)(?:\s*<[^>]*>)?\s*=/gm,
      ],
      enumPatterns: [
        /(?:^|[;\{\}])\s*(export\s+)?(const\s+)?enum\s+(\w+)\s*\{/gm,
      ],
      importPatterns: [
        /(?:^|;)\s*import\s+(?:(\w+)(?:\s*,\s*)?)?(?:\{([^}]+)\})?\s+from\s+['"]([^'"]+)['"]/gm,
        /(?:^|;)\s*import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/gm,
        /(?:^|;)\s*import\s+['"]([^'"]+)['"]/gm,
      ],
      constantPatterns: [
        /(?:^|[;\{\}])\s*(export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*(?::\s*([^=]+))?\s*=/gm,
      ],
    });

    // Python patterns
    this.languagePatterns.set("python", {
      functionPatterns: [
        /^(\s*)(async\s+)?def\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*([^\:]+))?\s*:/gm,
      ],
      classPatterns: [
        /^(\s*)class\s+(\w+)(?:\s*\(([^)]*)\))?\s*:/gm,
      ],
      importPatterns: [
        /^from\s+(\S+)\s+import\s+(.+)$/gm,
        /^import\s+(\S+)(?:\s+as\s+(\w+))?$/gm,
      ],
      constantPatterns: [
        /^([A-Z][A-Z0-9_]*)\s*(?::\s*([^=]+))?\s*=/gm,
      ],
      decoratorPatterns: [
        /^(\s*)@(\w+(?:\.\w+)*)(?:\(([^)]*)\))?$/gm,
      ],
    });

    // Go patterns
    this.languagePatterns.set("go", {
      functionPatterns: [
        // Matches functions with/without receivers, with various return types (pointer, qualified, tuple)
        /^func\s+(?:\(\s*\w+\s+\*?(\w+)\s*\)\s+)?(\w+)\s*\(([^)]*)\)\s*(?:\(([^)]*)\)|(\*?[\w.]+))?\s*\{/gm,
      ],
      interfacePatterns: [
        /^type\s+(\w+)\s+interface\s*\{/gm,
      ],
      typePatterns: [
        /^type\s+(\w+)\s+(?:struct\s*\{|[^\{]+)/gm,
      ],
      importPatterns: [
        /^import\s+(?:\(\s*([^)]+)\s*\)|"([^"]+)")/gm,
      ],
      constantPatterns: [
        /^const\s+(\w+)\s*(?:\w+)?\s*=/gm,
        /^var\s+(\w+)\s+/gm,
      ],
    });

    // Rust patterns
    this.languagePatterns.set("rust", {
      functionPatterns: [
        /^(\s*)(pub\s+)?(async\s+)?fn\s+(\w+)(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?:->\s*([^\{]+))?\s*(?:where[^\{]+)?\{/gm,
      ],
      classPatterns: [
        /^(\s*)(pub\s+)?struct\s+(\w+)(?:<[^>]*>)?\s*(?:\{|;|\()/gm,
        /^(\s*)(pub\s+)?enum\s+(\w+)(?:<[^>]*>)?\s*\{/gm,
      ],
      interfacePatterns: [
        /^(\s*)(pub\s+)?trait\s+(\w+)(?:<[^>]*>)?\s*(?::\s*[^\{]+)?\{/gm,
      ],
      importPatterns: [
        /^use\s+([^;]+);/gm,
      ],
      constantPatterns: [
        /^(\s*)(pub\s+)?const\s+([A-Z][A-Z0-9_]*)\s*:\s*([^=]+)\s*=/gm,
        /^(\s*)(pub\s+)?static\s+([A-Z][A-Z0-9_]*)\s*:\s*([^=]+)\s*=/gm,
      ],
    });

    // Java patterns
    this.languagePatterns.set("java", {
      functionPatterns: [
        /^(\s*)(public|private|protected)?\s*(static)?\s*(synchronized)?\s*(?:<[^>]*>\s*)?(\w+(?:<[^>]*>)?)\s+(\w+)\s*\(([^)]*)\)\s*(?:throws\s+[^\{]+)?\{/gm,
      ],
      classPatterns: [
        /^(\s*)(public|private|protected)?\s*(abstract)?\s*(final)?\s*class\s+(\w+)(?:<[^>]*>)?(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^\{]+))?\s*\{/gm,
      ],
      interfacePatterns: [
        /^(\s*)(public|private|protected)?\s*interface\s+(\w+)(?:<[^>]*>)?(?:\s+extends\s+([^\{]+))?\s*\{/gm,
      ],
      enumPatterns: [
        /^(\s*)(public|private|protected)?\s*enum\s+(\w+)\s*\{/gm,
      ],
      importPatterns: [
        /^import\s+(static\s+)?([^;]+);/gm,
      ],
      constantPatterns: [
        /^(\s*)(public|private|protected)?\s*(static)?\s*(final)?\s*(\w+)\s+([A-Z][A-Z0-9_]*)\s*=/gm,
      ],
    });

    // C# patterns
    this.languagePatterns.set("csharp", {
      functionPatterns: [
        /^(\s*)(public|private|protected|internal)?\s*(static)?\s*(async)?\s*(virtual|override|abstract)?\s*(?:<[^>]*>\s*)?(\w+(?:<[^>]*>)?)\s+(\w+)\s*\(([^)]*)\)\s*(?:where[^\{]+)?\{/gm,
      ],
      classPatterns: [
        /^(\s*)(public|private|protected|internal)?\s*(abstract|sealed|static|partial)?\s*class\s+(\w+)(?:<[^>]*>)?(?:\s*:\s*([^\{]+))?\s*\{/gm,
      ],
      interfacePatterns: [
        /^(\s*)(public|private|protected|internal)?\s*interface\s+(\w+)(?:<[^>]*>)?(?:\s*:\s*([^\{]+))?\s*\{/gm,
      ],
      enumPatterns: [
        /^(\s*)(public|private|protected|internal)?\s*enum\s+(\w+)\s*\{/gm,
      ],
      importPatterns: [
        /^using\s+(?:static\s+)?([^;]+);/gm,
      ],
    });

    // Ruby patterns
    this.languagePatterns.set("ruby", {
      functionPatterns: [
        /^(\s*)def\s+(self\.)?(\w+[?!]?)\s*(?:\(([^)]*)\))?/gm,
      ],
      classPatterns: [
        /^(\s*)class\s+(\w+)(?:\s*<\s*(\w+))?/gm,
      ],
      modulePatterns: [
        /^(\s*)module\s+(\w+)/gm,
      ],
      importPatterns: [
        /^require\s+['"]([^'"]+)['"]/gm,
        /^require_relative\s+['"]([^'"]+)['"]/gm,
      ],
      constantPatterns: [
        /^(\s*)([A-Z][A-Z0-9_]*)\s*=/gm,
      ],
    });

    // PHP patterns
    this.languagePatterns.set("php", {
      functionPatterns: [
        /^(\s*)(public|private|protected)?\s*(static)?\s*function\s+(\w+)\s*\(([^)]*)\)\s*(?::\s*\??\s*(\w+))?\s*\{/gm,
      ],
      classPatterns: [
        /^(\s*)(abstract|final)?\s*class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^\{]+))?\s*\{/gm,
      ],
      interfacePatterns: [
        /^(\s*)interface\s+(\w+)(?:\s+extends\s+([^\{]+))?\s*\{/gm,
      ],
      importPatterns: [
        /^use\s+([^;]+);/gm,
        /^require(?:_once)?\s+['"]([^'"]+)['"]/gm,
        /^include(?:_once)?\s+['"]([^'"]+)['"]/gm,
      ],
      constantPatterns: [
        /^(\s*)const\s+(\w+)\s*=/gm,
        /^define\s*\(\s*['"](\w+)['"]/gm,
      ],
    });
  }

  /**
   * Extract all symbols from a source file
   */
  extractSymbols(code: string, filePath: string, language: string): CodeSymbol[] {
    const symbols: CodeSymbol[] = [];
    const normalizedLang = this.normalizeLanguage(language);
    const patterns = this.languagePatterns.get(normalizedLang);

    if (!patterns) {
      // Fallback to generic extraction
      return this.extractGenericSymbols(code, filePath);
    }

    const lines = code.split("\n");

    // Extract functions
    if (patterns.functionPatterns) {
      for (const pattern of patterns.functionPatterns) {
        symbols.push(...this.extractWithPattern(code, filePath, pattern, "function", lines));
      }
    }

    // Extract classes
    if (patterns.classPatterns) {
      for (const pattern of patterns.classPatterns) {
        symbols.push(...this.extractWithPattern(code, filePath, pattern, "class", lines));
      }
    }

    // Extract interfaces
    if (patterns.interfacePatterns) {
      for (const pattern of patterns.interfacePatterns) {
        symbols.push(...this.extractWithPattern(code, filePath, pattern, "interface", lines));
      }
    }

    // Extract types
    if (patterns.typePatterns) {
      for (const pattern of patterns.typePatterns) {
        symbols.push(...this.extractWithPattern(code, filePath, pattern, "type", lines));
      }
    }

    // Extract enums
    if (patterns.enumPatterns) {
      for (const pattern of patterns.enumPatterns) {
        symbols.push(...this.extractWithPattern(code, filePath, pattern, "enum", lines));
      }
    }

    // Extract imports
    if (patterns.importPatterns) {
      for (const pattern of patterns.importPatterns) {
        symbols.push(...this.extractImports(code, filePath, pattern, lines));
      }
    }

    // Extract constants
    if (patterns.constantPatterns) {
      for (const pattern of patterns.constantPatterns) {
        symbols.push(...this.extractWithPattern(code, filePath, pattern, "constant", lines));
      }
    }

    // Deduplicate by ID
    const seen = new Set<string>();
    return symbols.filter(s => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
  }

  private extractWithPattern(
    code: string,
    filePath: string,
    pattern: RegExp,
    kind: SymbolKind,
    lines: string[]
  ): CodeSymbol[] {
    const symbols: CodeSymbol[] = [];
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    let lastIndex = 0;

    while ((match = regex.exec(code)) !== null) {
      // Prevent infinite loops by ensuring we advance
      if (regex.lastIndex <= lastIndex) {
        regex.lastIndex = lastIndex + 1;
        continue;
      }
      lastIndex = regex.lastIndex;

      const startIndex = match.index;
      const startLine = this.getLineNumber(code, startIndex);

      // Find the name (usually in one of the capture groups)
      const name = this.extractName(match, kind);
      if (!name) continue;

      // Find the end of the symbol (matching braces or indentation)
      const endLine = this.findSymbolEnd(code, startIndex, lines, kind);
      const fullText = lines.slice(startLine - 1, endLine).join("\n");

      // Generate signature
      const signature = this.generateSignature(match[0], kind);

      // Check if exported
      const isExported = /export\s+|public\s+|pub\s+/.test(match[0]);

      // Check if async
      const isAsync = /async\s+/.test(match[0]);

      // Extract parameters for functions
      const parameters = kind === "function" || kind === "method"
        ? this.extractParameters(match[0])
        : undefined;

      // Extract return type
      const returnType = this.extractReturnType(match[0]);

      // Extract decorators
      const decorators = this.extractDecorators(code, startIndex);

      const symbol: CodeSymbol = {
        id: `${filePath}:${startLine}:${name}`,
        name,
        kind,
        filePath,
        startLine,
        endLine,
        signature,
        fullText,
        docstring: this.extractDocstring(code, startIndex),
        dependencies: [],
        dependents: [],
        complexity: this.estimateComplexity(fullText),
        tokens: this.estimateTokens(fullText),
        isExported,
        isAsync,
        parameters,
        returnType,
        decorators,
      };

      symbols.push(symbol);
    }

    return symbols;
  }

  private extractImports(
    code: string,
    filePath: string,
    pattern: RegExp,
    lines: string[]
  ): CodeSymbol[] {
    const symbols: CodeSymbol[] = [];
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    let lastIndex = 0;

    while ((match = regex.exec(code)) !== null) {
      // Prevent infinite loops by ensuring we advance
      if (regex.lastIndex <= lastIndex) {
        regex.lastIndex = lastIndex + 1;
        continue;
      }
      lastIndex = regex.lastIndex;

      const startIndex = match.index;
      const startLine = this.getLineNumber(code, startIndex);
      const source = match[match.length - 1] || match[1] || "unknown";

      const symbol: CodeSymbol = {
        id: `${filePath}:${startLine}:import:${source}`,
        name: `import:${source}`,
        kind: "import",
        filePath,
        startLine,
        endLine: startLine,
        signature: match[0].trim(),
        fullText: match[0],
        dependencies: [],
        dependents: [],
        complexity: 0,
        tokens: this.estimateTokens(match[0]),
        isExported: false,
        isAsync: false,
      };

      symbols.push(symbol);
    }

    return symbols;
  }

  private extractGenericSymbols(code: string, filePath: string): CodeSymbol[] {
    // Generic extraction for unsupported languages
    const symbols: CodeSymbol[] = [];
    const lines = code.split("\n");

    // Look for function-like patterns
    const funcPattern = /^(\s*)((?:public|private|protected|static|async|export|def|fn|func|function)\s+)*(\w+)\s*[(<]/gm;
    let match;

    while ((match = funcPattern.exec(code)) !== null) {
      const startIndex = match.index;
      const startLine = this.getLineNumber(code, startIndex);
      const name = match[3];

      if (name && !this.isKeyword(name)) {
        symbols.push({
          id: `${filePath}:${startLine}:${name}`,
          name,
          kind: "function",
          filePath,
          startLine,
          endLine: startLine + 10, // Estimate
          signature: match[0].trim(),
          fullText: lines.slice(startLine - 1, startLine + 10).join("\n"),
          dependencies: [],
          dependents: [],
          complexity: 1,
          tokens: 50, // Estimate
          isExported: /export|public/.test(match[0]),
          isAsync: /async/.test(match[0]),
        });
      }
    }

    return symbols;
  }

  private extractName(match: RegExpExecArray, kind: SymbolKind): string | null {
    // Different capture group positions based on kind
    for (let i = match.length - 1; i >= 1; i--) {
      const group = match[i];
      if (group && /^[a-zA-Z_]\w*$/.test(group) && !this.isKeyword(group)) {
        return group;
      }
    }
    return null;
  }

  private isKeyword(word: string): boolean {
    const keywords = new Set([
      "function", "class", "interface", "type", "enum", "const", "let", "var",
      "public", "private", "protected", "static", "async", "await", "export",
      "import", "from", "return", "if", "else", "for", "while", "do", "switch",
      "case", "break", "continue", "try", "catch", "finally", "throw", "new",
      "this", "super", "extends", "implements", "abstract", "final", "def",
      "fn", "pub", "mut", "struct", "trait", "impl", "mod", "use", "crate",
      "void", "int", "string", "bool", "boolean", "number", "any", "object",
      // Go types and common return types
      "error", "nil", "true", "false", "byte", "rune", "uint", "int8", "int16",
      "int32", "int64", "uint8", "uint16", "uint32", "uint64", "float32", "float64",
      "complex64", "complex128", "uintptr", "chan", "map", "func", "package",
      // Rust types
      "self", "Self", "i8", "i16", "i32", "i64", "i128", "u8", "u16", "u32",
      "u64", "u128", "f32", "f64", "isize", "usize", "str", "char",
    ]);
    return keywords.has(word.toLowerCase()) || keywords.has(word);
  }

  private getLineNumber(code: string, index: number): number {
    return code.substring(0, index).split("\n").length;
  }

  private findSymbolEnd(
    code: string,
    startIndex: number,
    lines: string[],
    kind: SymbolKind
  ): number {
    const startLine = this.getLineNumber(code, startIndex);

    // For simple symbols, just return start line
    if (kind === "import" || kind === "constant" || kind === "type") {
      // Find semicolon or end of line
      const endIndex = code.indexOf(";", startIndex);
      if (endIndex !== -1 && endIndex - startIndex < 500) {
        return this.getLineNumber(code, endIndex);
      }
      return startLine;
    }

    // For braced constructs, count braces
    let braceCount = 0;
    let foundFirstBrace = false;
    let currentLine = startLine;

    for (let i = startIndex; i < code.length && currentLine < startLine + 500; i++) {
      const char = code[i];
      if (char === "\n") currentLine++;

      if (char === "{" || char === "(" && !foundFirstBrace) {
        braceCount++;
        foundFirstBrace = true;
      } else if (char === "}" || (char === ")" && kind !== "function")) {
        braceCount--;
        if (braceCount === 0 && foundFirstBrace) {
          return currentLine;
        }
      }
    }

    // Python-style indentation-based
    if (!foundFirstBrace) {
      const startIndent = lines[startLine - 1]?.match(/^(\s*)/)?.[1].length || 0;
      for (let i = startLine; i < lines.length && i < startLine + 200; i++) {
        const line = lines[i];
        if (line.trim() === "") continue;
        const indent = line.match(/^(\s*)/)?.[1].length || 0;
        if (indent <= startIndent && i > startLine) {
          return i;
        }
      }
    }

    return Math.min(startLine + 50, lines.length);
  }

  private generateSignature(matchText: string, kind: SymbolKind): string {
    // Clean up the signature
    let sig = matchText.trim();

    // Remove body
    sig = sig.replace(/\{[\s\S]*$/, "").trim();
    sig = sig.replace(/:[\s\S]*$/, "").trim();

    // Normalize whitespace
    sig = sig.replace(/\s+/g, " ");

    return sig;
  }

  private extractParameters(text: string): ParameterInfo[] {
    const params: ParameterInfo[] = [];
    const paramMatch = text.match(/\(([^)]*)\)/);
    if (!paramMatch) return params;

    const paramStr = paramMatch[1];
    if (!paramStr.trim()) return params;

    // Split by comma, handling nested generics
    const paramParts = this.splitParams(paramStr);

    for (const part of paramParts) {
      const trimmed = part.trim();
      if (!trimmed) continue;

      // Parse parameter: name: type = default or name = default
      const match = trimmed.match(/^(\w+)\s*(?::\s*([^=]+))?\s*(?:=\s*(.+))?$/);
      if (match) {
        params.push({
          name: match[1],
          type: match[2]?.trim(),
          defaultValue: match[3]?.trim(),
          isOptional: !!match[3] || trimmed.includes("?"),
        });
      } else {
        // Fallback: just extract name
        const nameMatch = trimmed.match(/^(\w+)/);
        if (nameMatch) {
          params.push({
            name: nameMatch[1],
            isOptional: false,
          });
        }
      }
    }

    return params;
  }

  private splitParams(paramStr: string): string[] {
    const parts: string[] = [];
    let current = "";
    let depth = 0;

    for (const char of paramStr) {
      if (char === "<" || char === "(" || char === "[" || char === "{") {
        depth++;
        current += char;
      } else if (char === ">" || char === ")" || char === "]" || char === "}") {
        depth--;
        current += char;
      } else if (char === "," && depth === 0) {
        parts.push(current);
        current = "";
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      parts.push(current);
    }

    return parts;
  }

  private extractReturnType(text: string): string | undefined {
    // TypeScript/Go style: ): Type {
    const tsMatch = text.match(/\)\s*:\s*([^{=]+)/);
    if (tsMatch) return tsMatch[1].trim();

    // Rust style: -> Type {
    const rustMatch = text.match(/->\s*([^{]+)/);
    if (rustMatch) return rustMatch[1].trim();

    // Python style: -> Type:
    const pyMatch = text.match(/->\s*([^:]+):/);
    if (pyMatch) return pyMatch[1].trim();

    return undefined;
  }

  private extractDecorators(code: string, startIndex: number): string[] {
    const decorators: string[] = [];
    let searchStart = startIndex - 1;

    // Look backwards for decorators
    while (searchStart > 0) {
      // Find previous line's newline
      let prevNewline = code.lastIndexOf("\n", searchStart);
      if (prevNewline === -1) {
        // We're at the first line
        break;
      }

      let lineStart = prevNewline + 1;
      const line = code.substring(lineStart, searchStart + 1).trim();

      if (line.startsWith("@")) {
        decorators.unshift(line);
      } else if (line !== "" && !line.startsWith("//") && !line.startsWith("#")) {
        // Non-empty, non-comment line means no more decorators
        break;
      }

      // Move to the character before the newline
      searchStart = prevNewline - 1;
    }

    return decorators;
  }

  private extractDocstring(code: string, startIndex: number): string | undefined {
    // Look for docstring before or at start of symbol
    const beforeCode = code.substring(Math.max(0, startIndex - 500), startIndex);

    // Python docstring
    const pyMatch = beforeCode.match(/"""([\s\S]*?)"""\s*$/);
    if (pyMatch) return pyMatch[1].trim();

    // JSDoc
    const jsMatch = beforeCode.match(/\/\*\*([\s\S]*?)\*\/\s*$/);
    if (jsMatch) return jsMatch[1].replace(/^\s*\*\s?/gm, "").trim();

    // Also check after the first line for Python
    const afterStart = code.substring(startIndex, startIndex + 200);
    const pyAfterMatch = afterStart.match(/:\s*\n\s*"""([\s\S]*?)"""/);
    if (pyAfterMatch) return pyAfterMatch[1].trim();

    return undefined;
  }

  private estimateComplexity(code: string): number {
    // Simple cyclomatic complexity estimate
    let complexity = 1;

    const patterns = [
      /\bif\b/g,
      /\belse\s+if\b/g,
      /\belif\b/g,
      /\bfor\b/g,
      /\bwhile\b/g,
      /\bcase\b/g,
      /\bcatch\b/g,
      /\b\?\s*[^:]+\s*:/g,  // Ternary
      /\&\&/g,
      /\|\|/g,
    ];

    for (const pattern of patterns) {
      const matches = code.match(pattern);
      if (matches) complexity += matches.length;
    }

    return complexity;
  }

  private estimateTokens(text: string): number {
    // Approximate token count (roughly 4 chars per token)
    return Math.ceil(text.length / 4);
  }

  private normalizeLanguage(language: string): string {
    const langMap: Record<string, string> = {
      ts: "typescript",
      tsx: "typescript",
      js: "javascript",
      jsx: "javascript",
      py: "python",
      rs: "rust",
      rb: "ruby",
      cs: "csharp",
      "c#": "csharp",
    };
    return langMap[language.toLowerCase()] || language.toLowerCase();
  }
}

interface LanguagePatterns {
  functionPatterns?: RegExp[];
  classPatterns?: RegExp[];
  interfacePatterns?: RegExp[];
  typePatterns?: RegExp[];
  enumPatterns?: RegExp[];
  importPatterns?: RegExp[];
  constantPatterns?: RegExp[];
  modulePatterns?: RegExp[];
  decoratorPatterns?: RegExp[];
}

// ============================================================================
// Phase 1: Relevance DAG
// ============================================================================

export class RelevanceDAG {
  private symbols: Map<string, CodeSymbol> = new Map();
  private edges: DependencyEdge[] = [];
  private fileSymbols: Map<string, string[]> = new Map();

  /**
   * Build the DAG from extracted symbols
   */
  build(symbols: CodeSymbol[]): void {
    this.symbols.clear();
    this.edges = [];
    this.fileSymbols.clear();

    // Index symbols
    for (const symbol of symbols) {
      this.symbols.set(symbol.id, symbol);

      const fileSyms = this.fileSymbols.get(symbol.filePath) || [];
      fileSyms.push(symbol.id);
      this.fileSymbols.set(symbol.filePath, fileSyms);
    }

    // Build edges
    this.buildDependencyEdges();
  }

  private buildDependencyEdges(): void {
    for (const symbol of this.symbols.values()) {
      // Find what this symbol references
      const refs = this.findReferences(symbol);

      for (const ref of refs) {
        const targetSymbol = this.findSymbolByName(ref.name, symbol.filePath);
        if (targetSymbol && targetSymbol.id !== symbol.id) {
          this.addEdge(symbol.id, targetSymbol.id, ref.type, ref.weight);

          // Update dependency lists
          symbol.dependencies.push(targetSymbol.id);
          targetSymbol.dependents.push(symbol.id);
        }
      }
    }
  }

  private findReferences(symbol: CodeSymbol): Array<{name: string; type: EdgeType; weight: number}> {
    const refs: Array<{name: string; type: EdgeType; weight: number}> = [];
    const code = symbol.fullText;

    // Function calls
    const callPattern = /\b([a-zA-Z_]\w*)\s*\(/g;
    let match;
    while ((match = callPattern.exec(code)) !== null) {
      if (!this.isKeywordOrBuiltin(match[1])) {
        refs.push({ name: match[1], type: "calls", weight: 0.8 });
      }
    }

    // Class extensions
    const extendsMatch = code.match(/extends\s+(\w+)/);
    if (extendsMatch) {
      refs.push({ name: extendsMatch[1], type: "extends", weight: 1.0 });
    }

    // Interface implementations
    const implMatch = code.match(/implements\s+([\w,\s]+)/);
    if (implMatch) {
      const interfaces = implMatch[1].split(",").map(s => s.trim());
      for (const iface of interfaces) {
        refs.push({ name: iface, type: "implements", weight: 0.9 });
      }
    }

    // Type references
    const typePattern = /:\s*(\w+)(?:<|>|\[|\]|\s|,|;|\))/g;
    while ((match = typePattern.exec(code)) !== null) {
      if (!this.isPrimitiveType(match[1])) {
        refs.push({ name: match[1], type: "uses_type", weight: 0.6 });
      }
    }

    // New instantiations
    const newPattern = /new\s+(\w+)\s*\(/g;
    while ((match = newPattern.exec(code)) !== null) {
      refs.push({ name: match[1], type: "instantiates", weight: 0.85 });
    }

    // Test file detection
    if (symbol.filePath.includes(".test.") || symbol.filePath.includes(".spec.") ||
        symbol.filePath.includes("_test.") || symbol.filePath.includes("/test/")) {
      // Find the file being tested
      const baseName = path.basename(symbol.filePath)
        .replace(/\.(test|spec)\.(ts|js|tsx|jsx|py|go|rs)$/, ".$2")
        .replace(/_test\.(py|go)$/, ".$1");

      // Look for describe/it blocks mentioning symbols
      const describeMatch = code.match(/describe\s*\(\s*['"](\w+)['"]/);
      if (describeMatch) {
        refs.push({ name: describeMatch[1], type: "test_for", weight: 0.95 });
      }
    }

    return refs;
  }

  private findSymbolByName(name: string, currentFile: string): CodeSymbol | undefined {
    // First check same file
    const sameFileSymbols = this.fileSymbols.get(currentFile) || [];
    for (const id of sameFileSymbols) {
      const sym = this.symbols.get(id);
      if (sym && sym.name === name) return sym;
    }

    // Then check all symbols
    for (const sym of this.symbols.values()) {
      if (sym.name === name) return sym;
    }

    return undefined;
  }

  private addEdge(from: string, to: string, type: EdgeType, weight: number): void {
    // Check for duplicate
    const exists = this.edges.some(e => e.from === from && e.to === to && e.type === type);
    if (!exists) {
      this.edges.push({ from, to, weight, type });
    }
  }

  private isKeywordOrBuiltin(name: string): boolean {
    const builtins = new Set([
      "console", "log", "error", "warn", "print", "println", "printf",
      "parseInt", "parseFloat", "Number", "String", "Boolean", "Array",
      "Object", "Map", "Set", "Promise", "Date", "Math", "JSON",
      "require", "import", "export", "module", "exports",
      "if", "else", "for", "while", "switch", "case", "return",
      "len", "range", "enumerate", "zip", "map", "filter", "reduce",
      "str", "int", "float", "bool", "list", "dict", "tuple", "set",
      "fmt", "Println", "Printf", "Sprintf",
    ]);
    return builtins.has(name);
  }

  private isPrimitiveType(type: string): boolean {
    const primitives = new Set([
      "string", "number", "boolean", "void", "any", "unknown", "never",
      "null", "undefined", "object", "symbol", "bigint",
      "int", "float", "double", "char", "byte", "short", "long",
      "bool", "str", "i32", "i64", "u32", "u64", "f32", "f64",
      "String", "Int", "Float", "Double", "Boolean",
    ]);
    return primitives.has(type);
  }

  /**
   * Get all symbols
   */
  getSymbols(): CodeSymbol[] {
    return Array.from(this.symbols.values());
  }

  /**
   * Get symbol by ID
   */
  getSymbol(id: string): CodeSymbol | undefined {
    return this.symbols.get(id);
  }

  /**
   * Get all edges
   */
  getEdges(): DependencyEdge[] {
    return this.edges;
  }

  /**
   * Get direct dependencies of a symbol
   */
  getDependencies(symbolId: string): CodeSymbol[] {
    return this.edges
      .filter(e => e.from === symbolId)
      .map(e => this.symbols.get(e.to))
      .filter((s): s is CodeSymbol => s !== undefined);
  }

  /**
   * Get symbols that depend on this one
   */
  getDependents(symbolId: string): CodeSymbol[] {
    return this.edges
      .filter(e => e.to === symbolId)
      .map(e => this.symbols.get(e.from))
      .filter((s): s is CodeSymbol => s !== undefined);
  }

  /**
   * Get transitive closure of dependencies up to a depth
   */
  getTransitiveDependencies(symbolId: string, maxDepth: number = 3): Set<string> {
    const visited = new Set<string>();
    const queue: Array<{id: string; depth: number}> = [{ id: symbolId, depth: 0 }];

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (visited.has(id) || depth > maxDepth) continue;
      visited.add(id);

      const deps = this.edges.filter(e => e.from === id);
      for (const dep of deps) {
        if (!visited.has(dep.to)) {
          queue.push({ id: dep.to, depth: depth + 1 });
        }
      }
    }

    visited.delete(symbolId); // Don't include the starting symbol
    return visited;
  }
}

// ============================================================================
// Phase 1: Intent Classifier
// ============================================================================

export class IntentClassifier {
  private intentPatterns: Map<IntentType, RegExp[]>;
  private intentKeywords: Map<IntentType, string[]>;

  constructor() {
    this.intentPatterns = new Map();
    this.intentKeywords = new Map();
    this.initializePatterns();
  }

  private initializePatterns(): void {
    // Debug patterns
    this.intentPatterns.set("debug", [
      /\b(fix|bug|error|issue|problem|wrong|broken|fails?|failing|crash|exception)\b/i,
      /\b(debug|troubleshoot|investigate|diagnose|trace)\b/i,
      /\b(not working|doesn't work|doesn't run|won't|can't)\b/i,
      /\bwhy\s+(is|does|doesn't|isn't|won't)\b/i,
    ]);
    this.intentKeywords.set("debug", [
      "fix", "bug", "error", "issue", "problem", "broken", "crash", "debug",
      "failing", "exception", "undefined", "null", "NaN", "trace", "stack",
    ]);

    // Generate patterns
    this.intentPatterns.set("generate", [
      /\b(create|generate|add|implement|build|make|write|new)\b/i,
      /\b(scaffold|boilerplate|template|starter)\b/i,
      /\bhow\s+(do\s+I|can\s+I|to)\s+(create|add|make|build|write)\b/i,
    ]);
    this.intentKeywords.set("generate", [
      "create", "generate", "add", "implement", "build", "make", "write",
      "new", "scaffold", "template", "function", "class", "component",
    ]);

    // Refactor patterns
    this.intentPatterns.set("refactor", [
      /\b(refactor|restructure|reorganize|clean\s*up|improve|optimize)\b/i,
      /\b(extract|inline|rename|move|split|merge|consolidate)\b/i,
      /\b(simplify|reduce|dry|duplication)\b/i,
    ]);
    this.intentKeywords.set("refactor", [
      "refactor", "restructure", "reorganize", "cleanup", "improve",
      "optimize", "extract", "inline", "rename", "simplify", "reduce",
    ]);

    // Explain patterns
    this.intentPatterns.set("explain", [
      /\b(explain|describe|what\s+(is|does|are)|how\s+(does|do)\s+\w+\s+work)\b/i,
      /\b(understand|clarify|tell\s+me\s+about|walk\s+me\s+through)\b/i,
      /\bwhat('s|\s+is)\s+(this|the|that)\b/i,
    ]);
    this.intentKeywords.set("explain", [
      "explain", "describe", "what", "how", "why", "understand", "clarify",
      "meaning", "purpose", "documentation", "comment",
    ]);

    // Edit patterns
    this.intentPatterns.set("edit", [
      /\b(change|modify|update|edit|alter|adjust|tweak)\b/i,
      /\b(replace|swap|switch|set|remove|delete)\b/i,
      /\bline\s*\d+\b/i,
    ]);
    this.intentKeywords.set("edit", [
      "change", "modify", "update", "edit", "alter", "adjust", "replace",
      "remove", "delete", "insert", "line", "value", "parameter",
    ]);

    // Test patterns (higher weight for specific test phrases)
    this.intentPatterns.set("test", [
      /\b(write\s+tests?|add\s+tests?|create\s+tests?)\b/i,  // Specific test creation phrases
      /\b(test|spec|unit\s*test|integration\s*test|e2e)\b/i,
      /\b(coverage|assert|expect|mock|stub|spy)\b/i,
      /\b(test\s+for|tests?\s+for)\b/i,
      /\btest(s|ing)?\s+(the|this|my|our)\b/i,
    ]);
    this.intentKeywords.set("test", [
      "test", "tests", "spec", "unit", "integration", "e2e", "coverage", "assert",
      "expect", "mock", "stub", "jest", "mocha", "pytest", "vitest", "testing",
    ]);

    // Review patterns
    this.intentPatterns.set("review", [
      /\b(review|check|audit|analyze|evaluate|assess)\b/i,
      /\b(code\s*review|pr\s*review|security|performance)\b/i,
      /\b(suggestions?|improvements?|feedback)\b/i,
    ]);
    this.intentKeywords.set("review", [
      "review", "check", "audit", "analyze", "evaluate", "security",
      "performance", "suggestions", "improvements", "feedback",
    ]);
  }

  /**
   * Classify the intent of a prompt
   */
  classify(prompt: string): IntentClassification {
    const scores: Map<IntentType, number> = new Map();
    const matchedKeywords: string[] = [];
    const promptLower = prompt.toLowerCase();

    // Check for specific high-confidence patterns first
    const specificPatterns: Array<{pattern: RegExp; intent: IntentType; boost: number}> = [
      { pattern: /\b(write|add|create)\s+tests?\b/i, intent: "test", boost: 0.5 },
      { pattern: /\btest(s|ing)?\s+(for|the|this)\b/i, intent: "test", boost: 0.4 },
      { pattern: /\b(fix|repair)\s+(the\s+)?(failing|broken)\s+tests?\b/i, intent: "test", boost: 0.6 },
      { pattern: /\bfailing\s+tests?\b/i, intent: "test", boost: 0.4 },
      { pattern: /\.spec\.(ts|js|tsx|jsx)\b/i, intent: "test", boost: 0.3 },
      { pattern: /\.test\.(ts|js|tsx|jsx)\b/i, intent: "test", boost: 0.3 },
      { pattern: /\bfix\s+(the\s+)?(bug|error|issue)\b/i, intent: "debug", boost: 0.5 },
      { pattern: /\b(refactor|clean\s*up)\s+(the|this)\b/i, intent: "refactor", boost: 0.5 },
      { pattern: /\b(explain|what\s+does)\s+(this|the)\b/i, intent: "explain", boost: 0.5 },
    ];

    for (const { pattern, intent, boost } of specificPatterns) {
      if (pattern.test(prompt)) {
        const current = scores.get(intent) || 0;
        scores.set(intent, current + boost);
      }
    }

    // Score each intent type
    for (const [intent, patterns] of this.intentPatterns) {
      let score = scores.get(intent) || 0;

      // Check patterns
      for (const pattern of patterns) {
        if (pattern.test(prompt)) {
          score += 0.3;
        }
      }

      // Check keywords
      const keywords = this.intentKeywords.get(intent) || [];
      for (const keyword of keywords) {
        if (promptLower.includes(keyword.toLowerCase())) {
          score += 0.1;
          matchedKeywords.push(keyword);
        }
      }

      scores.set(intent, score);
    }

    // Find primary and secondary intents
    const sorted = Array.from(scores.entries()).sort((a, b) => b[1] - a[1]);

    const primary = sorted[0]?.[1] > 0 ? sorted[0][0] : "unknown";
    const primaryScore = sorted[0]?.[1] || 0;
    const secondary = sorted[1]?.[1] > 0.2 ? sorted[1][0] : undefined;

    // Extract mentioned files
    const filePattern = /\b[\w\-./]+\.(ts|js|tsx|jsx|py|go|rs|java|rb|php|c|cpp|h|hpp|cs|swift|kt)\b/gi;
    const targetFiles = prompt.match(filePattern) || [];

    // Extract mentioned symbols (CamelCase or snake_case identifiers)
    const symbolPattern = /\b([A-Z][a-zA-Z0-9]+|[a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g;
    const symbols = prompt.match(symbolPattern) || [];
    const targetSymbols = symbols.filter(s =>
      s.length > 2 && !this.isCommonWord(s)
    );

    return {
      primary: primary as IntentType,
      confidence: Math.min(1, primaryScore),
      secondary: secondary as IntentType | undefined,
      keywords: [...new Set(matchedKeywords)],
      targetFiles: [...new Set(targetFiles)],
      targetSymbols: [...new Set(targetSymbols)],
    };
  }

  private isCommonWord(word: string): boolean {
    const common = new Set([
      "the", "this", "that", "with", "from", "into", "when", "what",
      "code", "file", "line", "function", "class", "method", "variable",
    ]);
    return common.has(word.toLowerCase());
  }
}

// ============================================================================
// Phase 1: DAG Walker (Budget-Aware Traversal)
// ============================================================================

export class DAGWalker {
  private dag: RelevanceDAG;
  private intentClassifier: IntentClassifier;

  constructor(dag: RelevanceDAG, intentClassifier: IntentClassifier) {
    this.dag = dag;
    this.intentClassifier = intentClassifier;
  }

  /**
   * Walk the DAG and select relevant symbols within budget
   */
  walk(
    prompt: string,
    budget: ContextBudget,
    activeFile?: string,
    cursorLine?: number
  ): ContextSelection {
    const intent = this.intentClassifier.classify(prompt);
    const relevanceScores = this.scoreAllSymbols(intent, activeFile, cursorLine);

    // Sort by relevance
    const sorted = relevanceScores.sort((a, b) => b.score - a.score);

    // Select symbols within budget
    const selected: SelectedSymbol[] = [];
    let usedTokens = 0;

    for (const relevance of sorted) {
      if (relevance.includeMode === "exclude") continue;

      const symbol = this.dag.getSymbol(relevance.symbolId);
      if (!symbol) continue;

      // Determine content based on include mode
      let content: string;
      let tokens: number;

      if (relevance.includeMode === "full") {
        content = symbol.fullText;
        tokens = symbol.tokens;
      } else if (relevance.includeMode === "signature") {
        content = this.generateSignatureOnly(symbol);
        tokens = this.estimateTokens(content);
      } else {
        content = `// ${symbol.kind}: ${symbol.name} (${symbol.filePath}:${symbol.startLine})`;
        tokens = this.estimateTokens(content);
      }

      // Check budget
      if (usedTokens + tokens > budget.availableForContext) {
        // Try to fit with signature mode if currently full
        if (relevance.includeMode === "full") {
          content = this.generateSignatureOnly(symbol);
          tokens = this.estimateTokens(content);
          if (usedTokens + tokens > budget.availableForContext) {
            continue;
          }
        } else {
          continue;
        }
      }

      selected.push({
        symbol,
        relevance,
        content,
        tokens,
      });
      usedTokens += tokens;
    }

    const totalSymbols = this.dag.getSymbols().length;
    const originalTokens = this.dag.getSymbols().reduce((sum, s) => sum + s.tokens, 0);

    return {
      selectedSymbols: selected,
      totalTokens: usedTokens,
      budgetUsed: usedTokens,
      budgetRemaining: budget.availableForContext - usedTokens,
      excludedCount: totalSymbols - selected.length,
      compressionRatio: originalTokens > 0 ? usedTokens / originalTokens : 1,
    };
  }

  private scoreAllSymbols(
    intent: IntentClassification,
    activeFile?: string,
    cursorLine?: number
  ): RelevanceScore[] {
    const scores: RelevanceScore[] = [];

    for (const symbol of this.dag.getSymbols()) {
      const score = this.scoreSymbol(symbol, intent, activeFile, cursorLine);
      scores.push(score);
    }

    return scores;
  }

  private scoreSymbol(
    symbol: CodeSymbol,
    intent: IntentClassification,
    activeFile?: string,
    cursorLine?: number
  ): RelevanceScore {
    let score = 0;
    const reasons: string[] = [];

    // Active file bonus (highest priority)
    if (activeFile && symbol.filePath === activeFile) {
      score += 40;
      reasons.push("active file");

      // Cursor proximity bonus
      if (cursorLine !== undefined) {
        const distance = Math.min(
          Math.abs(symbol.startLine - cursorLine),
          Math.abs(symbol.endLine - cursorLine)
        );
        if (distance === 0) {
          score += 30;
          reasons.push("cursor location");
        } else if (distance < 10) {
          score += 20;
          reasons.push("near cursor");
        } else if (distance < 50) {
          score += 10;
          reasons.push("same region");
        }
      }
    }

    // Mentioned in prompt
    if (intent.targetSymbols?.includes(symbol.name)) {
      score += 35;
      reasons.push("mentioned in prompt");
    }

    // File mentioned in prompt
    const fileName = path.basename(symbol.filePath);
    if (intent.targetFiles?.some(f =>
      f === fileName ||
      f === symbol.filePath ||
      symbol.filePath.includes(f)
    )) {
      score += 25;
      reasons.push("file mentioned");
    }

    // Intent-based scoring
    score += this.getIntentBonus(symbol, intent, reasons);

    // Export bonus
    if (symbol.isExported) {
      score += 5;
      reasons.push("exported");
    }

    // Dependency importance
    const dependentCount = symbol.dependents.length;
    if (dependentCount > 5) {
      score += 10;
      reasons.push("many dependents");
    } else if (dependentCount > 0) {
      score += 5;
      reasons.push("has dependents");
    }

    // Connected to active file
    if (activeFile) {
      const activeSymbols = this.dag.getSymbols().filter(s => s.filePath === activeFile);
      for (const activeSym of activeSymbols) {
        if (activeSym.dependencies.includes(symbol.id)) {
          score += 15;
          reasons.push("dependency of active");
          break;
        }
        if (symbol.dependencies.includes(activeSym.id)) {
          score += 12;
          reasons.push("depends on active");
          break;
        }
      }
    }

    // Determine category and include mode
    let category: RelevanceScore["category"];
    let includeMode: RelevanceScore["includeMode"];

    if (score >= 60) {
      category = "critical";
      includeMode = "full";
    } else if (score >= 40) {
      category = "high";
      includeMode = "full";
    } else if (score >= 25) {
      category = "medium";
      includeMode = "signature";
    } else if (score >= 10) {
      category = "low";
      includeMode = "reference";
    } else {
      category = "none";
      includeMode = "exclude";
    }

    return {
      symbolId: symbol.id,
      score: Math.min(100, score),
      reasons,
      category,
      includeMode,
    };
  }

  private getIntentBonus(
    symbol: CodeSymbol,
    intent: IntentClassification,
    reasons: string[]
  ): number {
    let bonus = 0;

    switch (intent.primary) {
      case "debug":
        // Prioritize error handling, logging, the specific function
        if (symbol.fullText.includes("catch") || symbol.fullText.includes("error")) {
          bonus += 10;
          reasons.push("error handling");
        }
        if (symbol.fullText.includes("console.") || symbol.fullText.includes("log")) {
          bonus += 5;
          reasons.push("logging");
        }
        break;

      case "test":
        // Prioritize test files and the code being tested
        if (symbol.filePath.includes("test") || symbol.filePath.includes("spec")) {
          bonus += 15;
          reasons.push("test file");
        }
        if (symbol.kind === "function" && symbol.name.startsWith("test")) {
          bonus += 10;
          reasons.push("test function");
        }
        break;

      case "refactor":
        // Prioritize complex code
        if (symbol.complexity > 10) {
          bonus += 10;
          reasons.push("high complexity");
        }
        if (symbol.dependents.length > 3) {
          bonus += 8;
          reasons.push("widely used");
        }
        break;

      case "generate":
        // Prioritize interfaces, types, examples
        if (symbol.kind === "interface" || symbol.kind === "type") {
          bonus += 12;
          reasons.push("type definition");
        }
        if (symbol.isExported) {
          bonus += 8;
          reasons.push("public API");
        }
        break;

      case "explain":
        // Prioritize documented code, entry points
        if (symbol.docstring) {
          bonus += 10;
          reasons.push("has documentation");
        }
        if (symbol.isExported && symbol.kind === "function") {
          bonus += 8;
          reasons.push("exported function");
        }
        break;

      case "edit":
        // Focus on specific location
        bonus += 0; // Location-based scoring handles this
        break;
    }

    return bonus;
  }

  private generateSignatureOnly(symbol: CodeSymbol): string {
    const parts: string[] = [];

    // Add file location comment
    parts.push(`// ${symbol.filePath}:${symbol.startLine}`);

    // Add decorators
    if (symbol.decorators?.length) {
      parts.push(...symbol.decorators);
    }

    // Add signature
    parts.push(symbol.signature);

    // Add brief docstring if available
    if (symbol.docstring) {
      const firstLine = symbol.docstring.split("\n")[0].trim();
      if (firstLine.length < 100) {
        parts.push(`  // ${firstLine}`);
      }
    }

    return parts.join("\n");
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}

// ============================================================================
// Phase 2: Context Utility Tracker
// ============================================================================

export class ContextUtilityTracker {
  private utilityHistory: UtilityRecord[] = [];
  private symbolScores: Map<string, number> = new Map(); // Running utility scores

  /**
   * Record that a symbol was included in context
   */
  recordContextInclusion(symbolId: string, sessionId: string): void {
    // Initial record - will be updated when we analyze response
    this.utilityHistory.push({
      symbolId,
      sessionId,
      wasReferenced: false,
      wasModified: false,
      wasHelpful: false,
      timestamp: Date.now(),
    });
  }

  /**
   * Update utility based on LLM response analysis
   */
  updateFromResponse(
    sessionId: string,
    referencedSymbols: string[],
    modifiedSymbols: string[]
  ): void {
    // Update records for this session
    for (const record of this.utilityHistory) {
      if (record.sessionId !== sessionId) continue;

      record.wasReferenced = referencedSymbols.includes(record.symbolId);
      record.wasModified = modifiedSymbols.includes(record.symbolId);
      record.wasHelpful = record.wasReferenced || record.wasModified;

      // Update running score
      this.updateSymbolScore(record);
    }
  }

  private updateSymbolScore(record: UtilityRecord): void {
    const currentScore = this.symbolScores.get(record.symbolId) || 50;

    let delta = 0;
    if (record.wasModified) {
      delta = 10; // High utility - was actually modified
    } else if (record.wasReferenced) {
      delta = 5;  // Medium utility - was referenced
    } else {
      delta = -2; // Low utility - included but not used
    }

    // Exponential moving average
    const newScore = Math.max(0, Math.min(100, currentScore * 0.9 + (50 + delta) * 0.1));
    this.symbolScores.set(record.symbolId, newScore);
  }

  /**
   * Get utility score for a symbol (higher = more useful historically)
   */
  getUtilityScore(symbolId: string): number {
    return this.symbolScores.get(symbolId) || 50; // Default neutral score
  }

  /**
   * Get utility adjustment for relevance scoring
   */
  getUtilityAdjustment(symbolId: string): number {
    const score = this.getUtilityScore(symbolId);
    // Convert to -10 to +10 adjustment
    return (score - 50) / 5;
  }

  /**
   * Clean old records (keep last 1000)
   */
  cleanup(): void {
    if (this.utilityHistory.length > 1000) {
      this.utilityHistory = this.utilityHistory.slice(-1000);
    }
  }
}

// ============================================================================
// Phase 2: Known Knowledge Detector
// ============================================================================

export class KnownKnowledgeDetector {
  private knownPatterns: KnownPattern[] = [];

  constructor() {
    this.initializePatterns();
  }

  private initializePatterns(): void {
    // React patterns
    this.knownPatterns.push(
      { pattern: "useState", category: "react-hooks", confidence: 0.95, tokenSavings: 50 },
      { pattern: "useEffect", category: "react-hooks", confidence: 0.95, tokenSavings: 80 },
      { pattern: "useCallback", category: "react-hooks", confidence: 0.90, tokenSavings: 60 },
      { pattern: "useMemo", category: "react-hooks", confidence: 0.90, tokenSavings: 50 },
      { pattern: "useContext", category: "react-hooks", confidence: 0.90, tokenSavings: 40 },
      { pattern: "useRef", category: "react-hooks", confidence: 0.90, tokenSavings: 40 },
      { pattern: "useReducer", category: "react-hooks", confidence: 0.85, tokenSavings: 70 },
    );

    // Express patterns
    this.knownPatterns.push(
      { pattern: "app.get", category: "express-routes", confidence: 0.95, tokenSavings: 30 },
      { pattern: "app.post", category: "express-routes", confidence: 0.95, tokenSavings: 30 },
      { pattern: "app.use", category: "express-middleware", confidence: 0.90, tokenSavings: 40 },
      { pattern: "Router()", category: "express-router", confidence: 0.90, tokenSavings: 50 },
    );

    // Node.js patterns
    this.knownPatterns.push(
      { pattern: "fs.readFile", category: "node-fs", confidence: 0.95, tokenSavings: 30 },
      { pattern: "fs.writeFile", category: "node-fs", confidence: 0.95, tokenSavings: 30 },
      { pattern: "path.join", category: "node-path", confidence: 0.95, tokenSavings: 20 },
      { pattern: "require(", category: "node-require", confidence: 0.95, tokenSavings: 20 },
    );

    // Python patterns
    this.knownPatterns.push(
      { pattern: "@app.route", category: "flask-routes", confidence: 0.95, tokenSavings: 30 },
      { pattern: "@pytest.fixture", category: "pytest", confidence: 0.90, tokenSavings: 40 },
      { pattern: "def __init__", category: "python-class", confidence: 0.95, tokenSavings: 20 },
      { pattern: "if __name__", category: "python-main", confidence: 0.95, tokenSavings: 30 },
    );

    // Testing patterns
    this.knownPatterns.push(
      { pattern: "describe(", category: "jest-describe", confidence: 0.95, tokenSavings: 20 },
      { pattern: "it(", category: "jest-it", confidence: 0.95, tokenSavings: 20 },
      { pattern: "expect(", category: "jest-expect", confidence: 0.95, tokenSavings: 20 },
      { pattern: "beforeEach", category: "jest-lifecycle", confidence: 0.90, tokenSavings: 30 },
      { pattern: "afterEach", category: "jest-lifecycle", confidence: 0.90, tokenSavings: 30 },
    );

    // TypeScript patterns
    this.knownPatterns.push(
      { pattern: "interface ", category: "typescript-interface", confidence: 0.90, tokenSavings: 10 },
      { pattern: "type ", category: "typescript-type", confidence: 0.90, tokenSavings: 10 },
      { pattern: "async/await", category: "async-await", confidence: 0.95, tokenSavings: 20 },
    );
  }

  /**
   * Detect known patterns in code and estimate savings
   */
  detectKnownPatterns(code: string): Array<{pattern: KnownPattern; count: number}> {
    const detected: Array<{pattern: KnownPattern; count: number}> = [];

    for (const pattern of this.knownPatterns) {
      const regex = new RegExp(pattern.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      const matches = code.match(regex);
      if (matches && matches.length > 0) {
        detected.push({ pattern, count: matches.length });
      }
    }

    return detected;
  }

  /**
   * Calculate potential token savings from known knowledge
   */
  calculatePotentialSavings(code: string): {
    totalSavings: number;
    patterns: Array<{category: string; savings: number}>;
  } {
    const detected = this.detectKnownPatterns(code);
    let totalSavings = 0;
    const patternSavings: Array<{category: string; savings: number}> = [];

    for (const { pattern, count } of detected) {
      // Only count savings if confidence is high
      if (pattern.confidence >= 0.85) {
        const savings = pattern.tokenSavings * count * pattern.confidence;
        totalSavings += savings;

        const existing = patternSavings.find(p => p.category === pattern.category);
        if (existing) {
          existing.savings += savings;
        } else {
          patternSavings.push({ category: pattern.category, savings });
        }
      }
    }

    return { totalSavings, patterns: patternSavings };
  }

  /**
   * Determine if a symbol likely uses well-known patterns
   * that don't need full inclusion
   */
  isWellKnownImplementation(symbol: CodeSymbol): {
    isKnown: boolean;
    confidence: number;
    reason?: string;
  } {
    const code = symbol.fullText;
    const detected = this.detectKnownPatterns(code);

    if (detected.length === 0) {
      return { isKnown: false, confidence: 0 };
    }

    // Calculate weighted confidence
    const totalConfidence = detected.reduce(
      (sum, d) => sum + d.pattern.confidence * d.count,
      0
    );
    const avgConfidence = totalConfidence / detected.reduce((sum, d) => sum + d.count, 0);

    // If most of the code is well-known patterns
    const knownCategories = [...new Set(detected.map(d => d.pattern.category))];

    return {
      isKnown: avgConfidence > 0.85 && knownCategories.length <= 2,
      confidence: avgConfidence,
      reason: `Uses ${knownCategories.join(", ")}`,
    };
  }
}

// ============================================================================
// Phase 2: Adaptive Budget Calculator
// ============================================================================

export class AdaptiveBudgetCalculator {
  private defaultBudgets: Map<IntentType, number>;

  constructor() {
    this.defaultBudgets = new Map([
      ["debug", 30000],     // Debugging needs focused context
      ["generate", 20000],  // Generation needs examples, types
      ["refactor", 40000],  // Refactoring needs to see full structure
      ["explain", 15000],   // Explanation can work with less
      ["edit", 25000],      // Editing needs surrounding context
      ["test", 35000],      // Testing needs implementation + test code
      ["review", 50000],    // Review needs comprehensive view
      ["unknown", 30000],   // Default
    ]);
  }

  /**
   * Calculate context budget based on intent and constraints
   */
  calculateBudget(
    intent: IntentClassification,
    modelMaxTokens: number = 128000,
    reservedForResponse: number = 4000,
    reservedForSystem: number = 2000
  ): ContextBudget {
    // Get base budget for intent
    const intentBudget = this.defaultBudgets.get(intent.primary) || 30000;

    // Adjust based on confidence
    const confidenceMultiplier = 0.8 + (intent.confidence * 0.4); // 0.8-1.2
    const adjustedBudget = Math.round(intentBudget * confidenceMultiplier);

    // Calculate available tokens
    const maxAvailable = modelMaxTokens - reservedForResponse - reservedForSystem;
    const availableForContext = Math.min(adjustedBudget, maxAvailable);

    return {
      maxTokens: modelMaxTokens,
      reservedForResponse,
      reservedForSystem,
      availableForContext,
    };
  }

  /**
   * Adjust budget based on file complexity
   */
  adjustForComplexity(
    budget: ContextBudget,
    averageComplexity: number,
    fileCount: number
  ): ContextBudget {
    let multiplier = 1.0;

    // High complexity needs more context
    if (averageComplexity > 15) {
      multiplier = 1.3;
    } else if (averageComplexity > 10) {
      multiplier = 1.15;
    }

    // Many files need more context
    if (fileCount > 10) {
      multiplier *= 1.2;
    } else if (fileCount > 5) {
      multiplier *= 1.1;
    }

    return {
      ...budget,
      availableForContext: Math.round(budget.availableForContext * multiplier),
    };
  }
}

// ============================================================================
// Phase 3: Response Analyzer
// ============================================================================

export class ResponseAnalyzer {
  /**
   * Analyze LLM response to determine which context was used
   */
  analyzeResponse(
    response: string,
    includedSymbols: CodeSymbol[]
  ): {
    referencedSymbols: string[];
    modifiedSymbols: string[];
    unusedSymbols: string[];
  } {
    const referencedSymbols: string[] = [];
    const modifiedSymbols: string[] = [];
    const unusedSymbols: string[] = [];

    for (const symbol of includedSymbols) {
      const isReferenced = this.checkIfReferenced(response, symbol);
      const isModified = this.checkIfModified(response, symbol);

      if (isModified) {
        modifiedSymbols.push(symbol.id);
        referencedSymbols.push(symbol.id);
      } else if (isReferenced) {
        referencedSymbols.push(symbol.id);
      } else {
        unusedSymbols.push(symbol.id);
      }
    }

    return { referencedSymbols, modifiedSymbols, unusedSymbols };
  }

  private checkIfReferenced(response: string, symbol: CodeSymbol): boolean {
    // Check if symbol name appears in response
    const namePattern = new RegExp(`\\b${this.escapeRegex(symbol.name)}\\b`, 'i');
    if (namePattern.test(response)) return true;

    // Check if file is mentioned
    const fileName = path.basename(symbol.filePath);
    if (response.includes(fileName)) return true;

    // Check for line number references
    if (response.includes(`line ${symbol.startLine}`) ||
        response.includes(`lines ${symbol.startLine}`)) {
      return true;
    }

    return false;
  }

  private checkIfModified(response: string, symbol: CodeSymbol): boolean {
    // Check for code blocks that mention the symbol
    const codeBlockPattern = /```[\s\S]*?```/g;
    const codeBlocks = response.match(codeBlockPattern) || [];

    for (const block of codeBlocks) {
      // Check if the code block contains the symbol name in a definition context
      const defPattern = new RegExp(
        `(function|class|interface|type|const|let|var|def|fn)\\s+${this.escapeRegex(symbol.name)}\\b`
      );
      if (defPattern.test(block)) return true;

      // Check if it's modifying the file
      const fileName = path.basename(symbol.filePath);
      if (block.includes(fileName) && block.includes(symbol.name)) {
        return true;
      }
    }

    // Check for explicit modification language
    const modifyPatterns = [
      `change.*${symbol.name}`,
      `modify.*${symbol.name}`,
      `update.*${symbol.name}`,
      `fix.*${symbol.name}`,
      `refactor.*${symbol.name}`,
    ];

    for (const pattern of modifyPatterns) {
      if (new RegExp(pattern, 'i').test(response)) return true;
    }

    return false;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

// ============================================================================
// Phase 4: Context Manifest Generator
// ============================================================================

export class ContextManifestGenerator {
  /**
   * Generate a compact manifest of available context
   * This allows the LLM to request specific symbols if needed
   */
  generate(
    symbols: CodeSymbol[],
    budget: ContextBudget
  ): ContextManifest {
    // Group symbols by file
    const fileGroups = new Map<string, CodeSymbol[]>();
    for (const symbol of symbols) {
      const group = fileGroups.get(symbol.filePath) || [];
      group.push(symbol);
      fileGroups.set(symbol.filePath, group);
    }

    // Generate file summaries
    const files: ManifestFile[] = [];
    for (const [filePath, fileSymbols] of fileGroups) {
      const tokens = fileSymbols.reduce((sum, s) => sum + s.tokens, 0);
      const kinds = [...new Set(fileSymbols.map(s => s.kind))];

      files.push({
        path: filePath,
        language: this.detectLanguage(filePath),
        tokens,
        symbolCount: fileSymbols.length,
        summary: `${fileSymbols.length} symbols (${kinds.join(", ")})`,
      });
    }

    // Generate symbol summaries
    const manifestSymbols: ManifestSymbol[] = symbols.map(s => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      file: path.basename(s.filePath),
      line: s.startLine,
      signature: s.signature.slice(0, 100), // Truncate long signatures
      tokens: s.tokens,
    }));

    const totalTokens = symbols.reduce((sum, s) => sum + s.tokens, 0);

    return {
      version: "1.0",
      timestamp: Date.now(),
      files: files.sort((a, b) => b.tokens - a.tokens),
      symbols: manifestSymbols.sort((a, b) => b.tokens - a.tokens),
      totalTokens,
      requestFormat: "To see full code for a symbol, say: 'Show me [symbol name] from [file]'",
    };
  }

  /**
   * Format manifest as compact text for inclusion in prompt
   */
  formatAsText(manifest: ContextManifest, maxLines: number = 50): string {
    const lines: string[] = [];

    lines.push("=== Available Context ===");
    lines.push(`${manifest.files.length} files, ${manifest.symbols.length} symbols, ${manifest.totalTokens} tokens total`);
    lines.push("");

    // List files
    lines.push("Files:");
    for (const file of manifest.files.slice(0, 10)) {
      lines.push(`  ${file.path} (${file.symbolCount} symbols, ${file.tokens} tokens)`);
    }
    if (manifest.files.length > 10) {
      lines.push(`  ... and ${manifest.files.length - 10} more files`);
    }
    lines.push("");

    // List key symbols
    lines.push("Key Symbols:");
    const keySymbols = manifest.symbols
      .filter(s => s.kind === "function" || s.kind === "class" || s.kind === "interface")
      .slice(0, 30);

    for (const sym of keySymbols) {
      const shortSig = sym.signature.length > 60
        ? sym.signature.slice(0, 57) + "..."
        : sym.signature;
      lines.push(`  ${sym.kind}: ${sym.name} (${sym.file}:${sym.line})`);
    }
    if (manifest.symbols.length > 30) {
      lines.push(`  ... and ${manifest.symbols.length - 30} more symbols`);
    }
    lines.push("");
    lines.push(manifest.requestFormat);

    return lines.slice(0, maxLines).join("\n");
  }

  private detectLanguage(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const langMap: Record<string, string> = {
      ".ts": "typescript",
      ".tsx": "typescript",
      ".js": "javascript",
      ".jsx": "javascript",
      ".py": "python",
      ".go": "go",
      ".rs": "rust",
      ".java": "java",
      ".rb": "ruby",
      ".php": "php",
      ".cs": "csharp",
      ".cpp": "cpp",
      ".c": "c",
      ".h": "c",
      ".hpp": "cpp",
      ".swift": "swift",
      ".kt": "kotlin",
    };
    return langMap[ext] || "unknown";
  }
}

// ============================================================================
// Main Intelligence Engine
// ============================================================================

export class PruneIntelligenceEngine {
  private symbolExtractor: SymbolExtractor;
  private dag: RelevanceDAG;
  private intentClassifier: IntentClassifier;
  private dagWalker: DAGWalker;
  private utilityTracker: ContextUtilityTracker;
  private knowledgeDetector: KnownKnowledgeDetector;
  private budgetCalculator: AdaptiveBudgetCalculator;
  private responseAnalyzer: ResponseAnalyzer;
  private manifestGenerator: ContextManifestGenerator;

  constructor() {
    this.symbolExtractor = new SymbolExtractor();
    this.dag = new RelevanceDAG();
    this.intentClassifier = new IntentClassifier();
    this.dagWalker = new DAGWalker(this.dag, this.intentClassifier);
    this.utilityTracker = new ContextUtilityTracker();
    this.knowledgeDetector = new KnownKnowledgeDetector();
    this.budgetCalculator = new AdaptiveBudgetCalculator();
    this.responseAnalyzer = new ResponseAnalyzer();
    this.manifestGenerator = new ContextManifestGenerator();
  }

  /**
   * Analyze files and build the intelligence graph
   */
  async analyzeFiles(files: Array<{path: string; content: string; language: string}>): Promise<void> {
    const allSymbols: CodeSymbol[] = [];

    for (const file of files) {
      const symbols = this.symbolExtractor.extractSymbols(
        file.content,
        file.path,
        file.language
      );
      allSymbols.push(...symbols);
    }

    this.dag.build(allSymbols);
  }

  /**
   * Select optimal context for a prompt
   */
  selectContext(
    prompt: string,
    options: {
      activeFile?: string;
      cursorLine?: number;
      modelMaxTokens?: number;
    } = {}
  ): ContextSelection {
    const intent = this.intentClassifier.classify(prompt);

    const budget = this.budgetCalculator.calculateBudget(
      intent,
      options.modelMaxTokens || 128000
    );

    return this.dagWalker.walk(
      prompt,
      budget,
      options.activeFile,
      options.cursorLine
    );
  }

  /**
   * Generate a context manifest
   */
  generateManifest(): ContextManifest {
    const symbols = this.dag.getSymbols();
    const budget = this.budgetCalculator.calculateBudget(
      { primary: "unknown", confidence: 0.5, keywords: [] }
    );
    return this.manifestGenerator.generate(symbols, budget);
  }

  /**
   * Record and learn from LLM response
   */
  learnFromResponse(
    sessionId: string,
    response: string,
    includedSymbols: CodeSymbol[]
  ): void {
    const analysis = this.responseAnalyzer.analyzeResponse(response, includedSymbols);
    this.utilityTracker.updateFromResponse(
      sessionId,
      analysis.referencedSymbols,
      analysis.modifiedSymbols
    );
  }

  /**
   * Get statistics about the analyzed codebase
   */
  getStats(): {
    symbolCount: number;
    edgeCount: number;
    fileCount: number;
    totalTokens: number;
  } {
    const symbols = this.dag.getSymbols();
    const files = new Set(symbols.map(s => s.filePath));

    return {
      symbolCount: symbols.length,
      edgeCount: this.dag.getEdges().length,
      fileCount: files.size,
      totalTokens: symbols.reduce((sum, s) => sum + s.tokens, 0),
    };
  }

  // Expose components for testing
  getIntentClassifier(): IntentClassifier {
    return this.intentClassifier;
  }

  getKnowledgeDetector(): KnownKnowledgeDetector {
    return this.knowledgeDetector;
  }

  getDAG(): RelevanceDAG {
    return this.dag;
  }
}

// Export singleton instance
export const pruneEngine = new PruneIntelligenceEngine();
