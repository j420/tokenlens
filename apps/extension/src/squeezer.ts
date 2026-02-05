/**
 * Telegraphic Semantic Code Squeezer (TypeScript/WASM Version)
 *
 * Compresses code for LLM context by preserving:
 * - Function/method signatures with type hints
 * - Class definitions
 * - Imports and exports
 * - Global constants (UPPER_CASE)
 * - Decorators
 * - Args/Returns sections in docstrings
 * - TODO/FIXME comments
 *
 * While compressing:
 * - Function bodies replaced with ellipsis
 * - Long docstrings reduced to summary only
 * - Regular comments removed
 */

import * as path from "path";
import type { Parser as ParserType, Language, SyntaxNode, Tree } from "web-tree-sitter";

// Dynamic import for web-tree-sitter (handles CommonJS/ESM compatibility)
let ParserClass: typeof ParserType | null = null;
let LanguageClass: any = null;

async function loadTreeSitter(): Promise<{ Parser: typeof ParserType; Language: any }> {
  if (ParserClass && LanguageClass) {
    return { Parser: ParserClass, Language: LanguageClass };
  }

  // In CommonJS (bundled by esbuild), it's require('web-tree-sitter').Parser
  const mod = await import("web-tree-sitter");

  // Try different ways to get the Parser and Language classes
  if ((mod as any).Parser && typeof (mod as any).Parser.init === 'function') {
    ParserClass = (mod as any).Parser;
    LanguageClass = (mod as any).Language;
  } else if ((mod as any).default?.Parser && typeof (mod as any).default.Parser.init === 'function') {
    ParserClass = (mod as any).default.Parser;
    LanguageClass = (mod as any).default.Language;
  } else {
    throw new Error('Could not find Parser class in web-tree-sitter module');
  }

  return { Parser: ParserClass!, Language: LanguageClass };
}

async function loadParser(): Promise<typeof ParserType> {
  const { Parser } = await loadTreeSitter();
  return Parser;
}

// ============================================================================
// Types
// ============================================================================

export interface SqueezeConfig {
  criticalDecorators?: Set<string>;
  criticalKeywords?: Set<string>;
}

export interface SqueezeResult {
  originalTokens: number;
  squeezedTokens: number;
  savings: number;
  savingsPercent: number;
  isValid: boolean;
  error: string | null;
  squeezedCode: string;
}

interface NodeRange {
  startIndex: number;
  endIndex: number;
  replacement: string;
}

// ============================================================================
// Token Counter (simple approximation)
// ============================================================================

function countTokensApprox(text: string): number {
  if (!text || text.trim().length === 0) return 1;
  // Simple approximation: ~4 chars per token on average for code
  return Math.max(1, Math.ceil(text.length / 4));
}

// ============================================================================
// Default Config
// ============================================================================

const DEFAULT_CRITICAL_DECORATORS = new Set([
  "critical",
  "important",
  "preserve",
  "no_squeeze",
  "api_endpoint",
  "security_critical",
]);

const DEFAULT_CRITICAL_KEYWORDS = new Set([
  "API_KEY",
  "SECRET",
  "PASSWORD",
  "TOKEN",
  "PRIVATE_KEY",
  "AUTH",
  "CREDENTIAL",
]);

// ============================================================================
// WASM Initialization
// ============================================================================

let parserInitialized = false;
let languageCache: Map<string, Language> = new Map();

/**
 * Initialize the Tree-sitter parser with WASM
 */
export async function initParser(wasmDir: string): Promise<void> {
  if (parserInitialized) return;

  const P = await loadParser();
  await P.init({
    locateFile: (file: string) => {
      // web-tree-sitter looks for web-tree-sitter.wasm
      return path.join(wasmDir, file);
    },
  });

  parserInitialized = true;
}

/**
 * Load a language grammar
 */
export async function loadLanguage(
  language: string,
  wasmDir: string
): Promise<Language> {
  const cached = languageCache.get(language);
  if (cached) return cached;

  const { Language } = await loadTreeSitter();
  const langFile = `tree-sitter-${language}.wasm`;
  const langPath = path.join(wasmDir, langFile);

  const lang = await Language.load(langPath);
  languageCache.set(language, lang);

  return lang;
}

// ============================================================================
// Main Squeezer Class
// ============================================================================

export class SemanticSqueezer {
  private config: Required<SqueezeConfig>;

  constructor(config?: SqueezeConfig) {
    this.config = {
      criticalDecorators: config?.criticalDecorators ?? DEFAULT_CRITICAL_DECORATORS,
      criticalKeywords: config?.criticalKeywords ?? DEFAULT_CRITICAL_KEYWORDS,
    };
  }

  /**
   * Squeeze code using Telegraphic Semantic Compression
   */
  async squeeze(
    code: string,
    language: string,
    wasmDir: string
  ): Promise<SqueezeResult> {
    // Handle empty input
    if (!code.trim()) {
      return {
        originalTokens: 0,
        squeezedTokens: 0,
        savings: 0,
        savingsPercent: 0,
        isValid: true,
        error: null,
        squeezedCode: "",
      };
    }

    const originalTokens = countTokensApprox(code);

    // Check language support
    const supportedLanguages = ["python", "javascript", "typescript", "tsx"];
    const normalizedLang = this.normalizeLanguage(language);

    if (!supportedLanguages.includes(normalizedLang)) {
      return {
        originalTokens,
        squeezedTokens: originalTokens,
        savings: 0,
        savingsPercent: 0,
        isValid: true,
        error: `Unsupported language: ${language}. Supported: ${supportedLanguages.join(", ")}`,
        squeezedCode: code,
      };
    }

    try {
      // Initialize parser if needed
      await initParser(wasmDir);

      // Load language grammar
      const grammarLang = normalizedLang === "tsx" ? "tsx" : normalizedLang;
      const lang = await loadLanguage(grammarLang, wasmDir);

      // Create parser and set language
      const P = await loadParser();
      const parser = new P();
      parser.setLanguage(lang);

      // Parse code
      const tree = parser.parse(code);
      if (!tree) {
        throw new Error("Failed to parse code");
      }

      // Squeeze based on language
      let squeezedCode: string;
      if (normalizedLang === "python") {
        squeezedCode = this.squeezePython(code, tree as Tree);
      } else {
        squeezedCode = this.squeezeJavaScript(code, tree as Tree);
      }

      // Validate output
      const isValid = this.validateOutput(squeezedCode, parser as any);

      // If invalid, fallback to original
      if (!isValid) {
        parser.delete();
        return {
          originalTokens,
          squeezedTokens: originalTokens,
          savings: 0,
          savingsPercent: 0,
          isValid: false,
          error: "Compression produced invalid syntax, using original",
          squeezedCode: code,
        };
      }

      const squeezedTokens = countTokensApprox(squeezedCode);
      const savings = originalTokens - squeezedTokens;
      const savingsPercent = originalTokens > 0 ? (savings / originalTokens) * 100 : 0;

      parser.delete();

      return {
        originalTokens,
        squeezedTokens,
        savings,
        savingsPercent,
        isValid: true,
        error: null,
        squeezedCode,
      };
    } catch (error) {
      return {
        originalTokens,
        squeezedTokens: originalTokens,
        savings: 0,
        savingsPercent: 0,
        isValid: true,
        error: error instanceof Error ? error.message : String(error),
        squeezedCode: code,
      };
    }
  }

  private normalizeLanguage(language: string): string {
    const langMap: Record<string, string> = {
      py: "python",
      python: "python",
      js: "javascript",
      javascript: "javascript",
      jsx: "javascript",
      ts: "typescript",
      typescript: "typescript",
      tsx: "tsx",
    };
    return langMap[language.toLowerCase()] || language.toLowerCase();
  }

  private validateOutput(code: string, parser: Parser): boolean {
    try {
      const tree = parser.parse(code);
      if (!tree) return false;

      // Check for syntax errors
      const hasError = this.hasParseError(tree.rootNode);
      return !hasError;
    } catch {
      return false;
    }
  }

  private hasParseError(node: SyntaxNode): boolean {
    if (node.type === "ERROR" || node.isMissing) {
      return true;
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child && this.hasParseError(child)) {
        return true;
      }
    }
    return false;
  }

  // ==========================================================================
  // Python Squeezer
  // ==========================================================================

  private squeezePython(code: string, tree: Tree): string {
    const replacements: NodeRange[] = [];
    const root = tree.rootNode;

    // Process all nodes
    this.processPythonNode(root, code, replacements, false);

    // Apply replacements in reverse order
    return this.applyReplacements(code, replacements);
  }

  private processPythonNode(
    node: SyntaxNode,
    code: string,
    replacements: NodeRange[],
    insideFunction: boolean
  ): void {
    switch (node.type) {
      case "function_definition":
        this.processPythonFunction(node, code, replacements);
        return;

      case "class_definition":
        this.processPythonClass(node, code, replacements);
        return;

      case "comment":
        // Remove regular comments, preserve TODO/FIXME
        if (!insideFunction) {
          const text = node.text;
          if (!this.isTodoComment(text)) {
            replacements.push({
              startIndex: node.startIndex,
              endIndex: node.endIndex,
              replacement: "",
            });
          }
        }
        break;

      default:
        // Recurse into children
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child) {
            this.processPythonNode(child, code, replacements, insideFunction);
          }
        }
    }
  }

  private processPythonFunction(
    node: SyntaxNode,
    code: string,
    replacements: NodeRange[]
  ): void {
    // Check for critical decorator
    const hasCriticalDecorator = this.hasCriticalDecorator(node, code);
    const hasCriticalKeyword = this.containsCriticalKeyword(node.text);

    if (hasCriticalDecorator || hasCriticalKeyword) {
      // Preserve entire function
      return;
    }

    // Find the body (block node)
    const body = node.childForFieldName("body");
    if (!body || body.type !== "block") return;

    // Get the body content
    const bodyText = body.text;

    // Extract and compress docstring if present
    let newBody = "...\n";
    const firstChild = body.child(0);
    if (firstChild && firstChild.type === "expression_statement") {
      const expr = firstChild.child(0);
      if (expr && expr.type === "string") {
        const docstring = this.compressDocstring(expr.text);
        if (docstring) {
          newBody = docstring + "\n    ...\n";
        }
      }
    }

    // Get proper indentation
    const funcLine = code.slice(0, node.startIndex).split("\n").pop() || "";
    const baseIndent = funcLine.match(/^(\s*)/)?.[1] || "";
    const bodyIndent = baseIndent + "    ";

    // Create replacement for body
    const colonIndex = code.lastIndexOf(":", body.startIndex);
    if (colonIndex === -1) return;

    replacements.push({
      startIndex: body.startIndex,
      endIndex: body.endIndex,
      replacement: "\n" + bodyIndent + newBody.trim(),
    });
  }

  private processPythonClass(
    node: SyntaxNode,
    code: string,
    replacements: NodeRange[]
  ): void {
    // Find the body
    const body = node.childForFieldName("body");
    if (!body || body.type !== "block") return;

    // Process class body - squeeze methods but keep signatures
    for (let i = 0; i < body.childCount; i++) {
      const child = body.child(i);
      if (!child) continue;

      if (child.type === "function_definition") {
        this.processPythonFunction(child, code, replacements);
      } else if (child.type === "comment") {
        const text = child.text;
        if (!this.isTodoComment(text)) {
          replacements.push({
            startIndex: child.startIndex,
            endIndex: child.endIndex,
            replacement: "",
          });
        }
      }
    }
  }

  // ==========================================================================
  // JavaScript/TypeScript Squeezer
  // ==========================================================================

  private squeezeJavaScript(code: string, tree: Tree): string {
    const replacements: NodeRange[] = [];
    const root = tree.rootNode;

    this.processJSNode(root, code, replacements, false);

    return this.applyReplacements(code, replacements);
  }

  private processJSNode(
    node: SyntaxNode,
    code: string,
    replacements: NodeRange[],
    insideFunction: boolean
  ): void {
    switch (node.type) {
      case "function_declaration":
      case "method_definition":
      case "function":
        this.processJSFunction(node, code, replacements);
        return;

      case "arrow_function":
        this.processJSArrowFunction(node, code, replacements);
        return;

      case "class_declaration":
        this.processJSClass(node, code, replacements);
        return;

      case "comment":
        if (!insideFunction) {
          const text = node.text;
          // Preserve JSDoc and TODO/FIXME comments
          if (!text.startsWith("/**") && !this.isTodoComment(text)) {
            replacements.push({
              startIndex: node.startIndex,
              endIndex: node.endIndex,
              replacement: "",
            });
          } else if (text.startsWith("/**")) {
            // Compress JSDoc
            const compressed = this.compressJSDoc(text);
            if (compressed !== text) {
              replacements.push({
                startIndex: node.startIndex,
                endIndex: node.endIndex,
                replacement: compressed,
              });
            }
          }
        }
        break;

      default:
        // Recurse into children
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child) {
            this.processJSNode(child, code, replacements, insideFunction);
          }
        }
    }
  }

  private processJSFunction(
    node: SyntaxNode,
    code: string,
    replacements: NodeRange[]
  ): void {
    // Check for critical keywords
    if (this.containsCriticalKeyword(node.text)) {
      return;
    }

    // Find the body (statement_block)
    let body: SyntaxNode | null = null;
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child && child.type === "statement_block") {
        body = child;
        break;
      }
    }

    if (!body) return;

    // Replace body with { /* ... */ }
    replacements.push({
      startIndex: body.startIndex,
      endIndex: body.endIndex,
      replacement: "{ /* ... */ }",
    });
  }

  private processJSArrowFunction(
    node: SyntaxNode,
    code: string,
    replacements: NodeRange[]
  ): void {
    // Check for critical keywords
    if (this.containsCriticalKeyword(node.text)) {
      return;
    }

    // Find the body
    const body = node.childForFieldName("body");
    if (!body) return;

    // Only compress block bodies, not expression bodies
    if (body.type === "statement_block") {
      replacements.push({
        startIndex: body.startIndex,
        endIndex: body.endIndex,
        replacement: "{ /* ... */ }",
      });
    }
  }

  private processJSClass(
    node: SyntaxNode,
    code: string,
    replacements: NodeRange[]
  ): void {
    // Find class body
    let body: SyntaxNode | null = null;
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child && child.type === "class_body") {
        body = child;
        break;
      }
    }

    if (!body) return;

    // Process methods within class body
    for (let i = 0; i < body.childCount; i++) {
      const child = body.child(i);
      if (!child) continue;

      if (child.type === "method_definition") {
        this.processJSFunction(child, code, replacements);
      } else if (child.type === "comment") {
        const text = child.text;
        if (!text.startsWith("/**") && !this.isTodoComment(text)) {
          replacements.push({
            startIndex: child.startIndex,
            endIndex: child.endIndex,
            replacement: "",
          });
        }
      }
    }
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private hasCriticalDecorator(
    node: SyntaxNode,
    code: string
  ): boolean {
    // Check previous sibling for decorator
    let sibling = node.previousSibling;
    while (sibling) {
      if (sibling.type === "decorator") {
        const decoratorName = sibling.text.replace("@", "").split("(")[0];
        if (this.config.criticalDecorators.has(decoratorName)) {
          return true;
        }
      } else if (sibling.type !== "comment") {
        break;
      }
      sibling = sibling.previousSibling;
    }
    return false;
  }

  private containsCriticalKeyword(text: string): boolean {
    for (const keyword of this.config.criticalKeywords) {
      if (text.includes(keyword)) {
        return true;
      }
    }
    return false;
  }

  private isTodoComment(text: string): boolean {
    const upper = text.toUpperCase();
    return (
      upper.includes("TODO") ||
      upper.includes("FIXME") ||
      upper.includes("HACK") ||
      upper.includes("XXX") ||
      upper.includes("BUG") ||
      upper.includes("NOTE:")
    );
  }

  private compressDocstring(docstring: string): string {
    // Remove quotes
    let content = docstring;
    if (content.startsWith('"""') || content.startsWith("'''")) {
      content = content.slice(3, -3);
    } else if (content.startsWith('"') || content.startsWith("'")) {
      content = content.slice(1, -1);
    }

    const lines = content.split("\n");
    const result: string[] = [];
    let inArgsSection = false;
    let inReturnsSection = false;
    let foundSummary = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // Detect sections
      if (trimmed.startsWith("Args:") || trimmed.startsWith("Arguments:")) {
        inArgsSection = true;
        inReturnsSection = false;
        result.push(line);
        continue;
      }
      if (
        trimmed.startsWith("Returns:") ||
        trimmed.startsWith("Return:") ||
        trimmed.startsWith("Yields:")
      ) {
        inArgsSection = false;
        inReturnsSection = true;
        result.push(line);
        continue;
      }
      if (
        trimmed.startsWith("Raises:") ||
        trimmed.startsWith("Example:") ||
        trimmed.startsWith("Note:") ||
        trimmed.startsWith("Warning:")
      ) {
        inArgsSection = false;
        inReturnsSection = false;
        // Skip these sections
        continue;
      }

      // Keep Args and Returns content
      if (inArgsSection || inReturnsSection) {
        if (trimmed.length > 0) {
          result.push(line);
        }
        continue;
      }

      // Keep first non-empty line as summary
      if (!foundSummary && trimmed.length > 0) {
        foundSummary = true;
        result.push(line);
      }
    }

    if (result.length === 0) return "";

    const compressed = result.join("\n").trim();
    return `"""${compressed}"""`;
  }

  private compressJSDoc(jsdoc: string): string {
    const lines = jsdoc.split("\n");
    const result: string[] = [];
    let foundSummary = false;

    for (const line of lines) {
      const trimmed = line.trim().replace(/^\*\s*/, "").trim();

      // Keep @param, @returns, @return tags
      if (
        trimmed.startsWith("@param") ||
        trimmed.startsWith("@returns") ||
        trimmed.startsWith("@return") ||
        trimmed.startsWith("@throws") ||
        trimmed.startsWith("@type")
      ) {
        result.push(line);
        continue;
      }

      // Skip other @ tags
      if (trimmed.startsWith("@")) {
        continue;
      }

      // Keep opening/closing
      if (line.includes("/**") || line.includes("*/")) {
        result.push(line);
        continue;
      }

      // Keep first content line as summary
      if (!foundSummary && trimmed.length > 0 && !trimmed.startsWith("*")) {
        foundSummary = true;
        result.push(line);
      }
    }

    return result.join("\n");
  }

  private applyReplacements(code: string, replacements: NodeRange[]): string {
    // Sort by start index descending
    replacements.sort((a, b) => b.startIndex - a.startIndex);

    // Remove overlapping replacements
    const filtered: NodeRange[] = [];
    let lastStart = code.length;

    for (const r of replacements) {
      if (r.endIndex <= lastStart) {
        filtered.push(r);
        lastStart = r.startIndex;
      }
    }

    // Apply replacements
    let result = code;
    for (const r of filtered) {
      result = result.slice(0, r.startIndex) + r.replacement + result.slice(r.endIndex);
    }

    // Clean up multiple blank lines
    result = result.replace(/\n{3,}/g, "\n\n");

    return result;
  }
}
