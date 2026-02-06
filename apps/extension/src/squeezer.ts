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
import * as fs from "fs";
import { pathToFileURL } from "url";

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

// Simple interface for tree-sitter types
interface TreeSitterNode {
  type: string;
  text: string;
  startIndex: number;
  endIndex: number;
  childCount: number;
  isMissing?: boolean;
  child(index: number): TreeSitterNode | null;
  childForFieldName(name: string): TreeSitterNode | null;
  previousSibling: TreeSitterNode | null;
}

interface TreeSitterTree {
  rootNode: TreeSitterNode;
}

interface TreeSitterParser {
  parse(code: string): TreeSitterTree | null;
  setLanguage(lang: any): void;
  delete(): void;
}

// ============================================================================
// Token Counter (simple approximation)
// ============================================================================

function countTokensApprox(text: string): number {
  if (!text || text.trim().length === 0) return 1;
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
// WASM Initialization - Robust Version
// ============================================================================

let TreeSitterModule: any = null;
let parserInitialized = false;
let languageCache: Map<string, any> = new Map();
let cachedWasmDir: string | null = null;

// Debug logging - enabled for troubleshooting
let debugEnabled = true;

function debugLog(message: string, ...args: any[]) {
  if (debugEnabled) {
    console.log(`[Squeezer] ${message}`, ...args);
  }
}

/**
 * Enable or disable debug logging
 */
export function setDebugMode(enabled: boolean) {
  debugEnabled = enabled;
}

/**
 * Convert a file path to a proper URL for WASM loading
 * Works on both Windows and Unix
 */
function pathToWasmUrl(filePath: string): string {
  // Normalize the path first
  const normalizedPath = path.resolve(filePath);

  // On Windows, convert backslashes to forward slashes and add file:// prefix
  if (process.platform === "win32") {
    // Convert C:\path\to\file to file:///C:/path/to/file
    const fileUrl = pathToFileURL(normalizedPath).href;
    debugLog("Windows path conversion:", normalizedPath, "->", fileUrl);
    return fileUrl;
  }

  // On Unix, just use the absolute path (or file URL)
  debugLog("Unix path:", normalizedPath);
  return normalizedPath;
}

/**
 * Load the web-tree-sitter module
 */
async function loadTreeSitterModule(): Promise<any> {
  if (TreeSitterModule) return TreeSitterModule;

  debugLog("Loading web-tree-sitter module...");

  // Use require for CommonJS compatibility in bundled extension
  const mod = require("web-tree-sitter");

  debugLog("Module loaded:", Object.keys(mod));

  // The module structure can vary based on how it's bundled
  if (mod.Parser && typeof mod.Parser.init === "function") {
    TreeSitterModule = mod;
    debugLog("Found Parser at mod.Parser");
  } else if (mod.default?.Parser && typeof mod.default.Parser.init === "function") {
    TreeSitterModule = mod.default;
    debugLog("Found Parser at mod.default.Parser");
  } else if (typeof mod.init === "function") {
    TreeSitterModule = { Parser: mod, Language: mod.Language };
    debugLog("Found Parser as mod itself");
  } else {
    throw new Error(
      `Could not find Parser in web-tree-sitter module. Keys: ${Object.keys(mod).join(", ")}`
    );
  }

  return TreeSitterModule;
}

/**
 * Initialize the Tree-sitter parser with WASM
 */
export async function initParser(wasmDir: string): Promise<void> {
  if (parserInitialized && cachedWasmDir === wasmDir) {
    debugLog("Parser already initialized");
    return;
  }

  debugLog("Initializing parser with wasmDir:", wasmDir);

  // Verify the WASM directory exists
  if (!fs.existsSync(wasmDir)) {
    throw new Error(`WASM directory does not exist: ${wasmDir}`);
  }

  // Check for required WASM file
  const mainWasmPath = path.join(wasmDir, "web-tree-sitter.wasm");
  const altWasmPath = path.join(wasmDir, "tree-sitter.wasm");

  let wasmPath: string;
  if (fs.existsSync(mainWasmPath)) {
    wasmPath = mainWasmPath;
  } else if (fs.existsSync(altWasmPath)) {
    wasmPath = altWasmPath;
  } else {
    throw new Error(
      `WASM file not found. Looked for:\n  - ${mainWasmPath}\n  - ${altWasmPath}`
    );
  }

  debugLog("Found WASM file:", wasmPath);

  // Load the module
  const mod = await loadTreeSitterModule();
  const Parser = mod.Parser;

  // Convert to proper URL for loading
  const wasmUrl = pathToWasmUrl(wasmPath);
  debugLog("WASM URL:", wasmUrl);

  // Initialize with explicit locateFile that returns file URLs
  try {
    await Parser.init({
      locateFile: (file: string, scriptDirectory: string) => {
        debugLog("locateFile called with:", file, scriptDirectory);

        // Handle the main WASM file request
        if (file === "tree-sitter.wasm" || file === "web-tree-sitter.wasm") {
          const result = pathToWasmUrl(wasmPath);
          debugLog("Returning WASM path:", result);
          return result;
        }

        // For other files, try to locate in the wasm directory
        const otherPath = path.join(wasmDir, file);
        if (fs.existsSync(otherPath)) {
          return pathToWasmUrl(otherPath);
        }

        // Fallback
        debugLog("File not found, using default:", file);
        return file;
      },
    });

    parserInitialized = true;
    cachedWasmDir = wasmDir;
    debugLog("Parser initialized successfully");
  } catch (initError) {
    const error = initError instanceof Error ? initError : new Error(String(initError));
    throw new Error(`Failed to initialize Parser: ${error.message}`);
  }
}

/**
 * Load a language grammar
 */
export async function loadLanguage(language: string, wasmDir: string): Promise<any> {
  const cached = languageCache.get(language);
  if (cached) {
    debugLog("Using cached language:", language);
    return cached;
  }

  debugLog("Loading language:", language);

  const mod = await loadTreeSitterModule();
  const Language = mod.Language;

  if (!Language || typeof Language.load !== "function") {
    throw new Error("Language.load not available on web-tree-sitter module");
  }

  const langFile = `tree-sitter-${language}.wasm`;
  const langPath = path.join(wasmDir, langFile);

  if (!fs.existsSync(langPath)) {
    throw new Error(`Language WASM not found: ${langPath}`);
  }

  debugLog("Loading language from:", langPath);

  try {
    // Read WASM file as buffer to avoid path resolution issues on Windows
    // Language.load() accepts ArrayBuffer/Uint8Array which bypasses URL handling
    const wasmBuffer = fs.readFileSync(langPath);
    debugLog("Read WASM buffer, size:", wasmBuffer.length, "bytes");

    const lang = await Language.load(wasmBuffer);
    languageCache.set(language, lang);
    debugLog("Language loaded successfully:", language);
    return lang;
  } catch (loadError) {
    const error = loadError instanceof Error ? loadError : new Error(String(loadError));
    debugLog("Language load error:", error.message);
    throw new Error(`Failed to load language ${language}: ${error.message}`);
  }
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
  async squeeze(code: string, language: string, wasmDir: string): Promise<SqueezeResult> {
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

      // Get the Parser class
      const mod = await loadTreeSitterModule();
      const Parser = mod.Parser;

      // Create parser instance and set language
      const parser: TreeSitterParser = new Parser();
      parser.setLanguage(lang);

      // Parse code
      const tree = parser.parse(code);
      if (!tree) {
        throw new Error("Failed to parse code");
      }

      // Squeeze based on language
      let squeezedCode: string;
      if (normalizedLang === "python") {
        squeezedCode = this.squeezePython(code, tree);
      } else {
        squeezedCode = this.squeezeJavaScript(code, tree);
      }

      // Validate output
      const isValid = this.validateOutput(squeezedCode, parser);

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
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        originalTokens,
        squeezedTokens: originalTokens,
        savings: 0,
        savingsPercent: 0,
        isValid: true,
        error: errorMessage,
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

  private validateOutput(code: string, parser: TreeSitterParser): boolean {
    try {
      const tree = parser.parse(code);
      if (!tree) return false;
      const hasError = this.hasParseError(tree.rootNode);
      return !hasError;
    } catch {
      return false;
    }
  }

  private hasParseError(node: TreeSitterNode): boolean {
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

  private squeezePython(code: string, tree: TreeSitterTree): string {
    const replacements: NodeRange[] = [];
    const root = tree.rootNode;
    this.processPythonNode(root, code, replacements, false);
    return this.applyReplacements(code, replacements);
  }

  private processPythonNode(
    node: TreeSitterNode,
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
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child) {
            this.processPythonNode(child, code, replacements, insideFunction);
          }
        }
    }
  }

  private processPythonFunction(
    node: TreeSitterNode,
    code: string,
    replacements: NodeRange[]
  ): void {
    const hasCriticalDecorator = this.hasCriticalDecorator(node);
    const hasCriticalKeyword = this.containsCriticalKeyword(node.text);

    if (hasCriticalDecorator || hasCriticalKeyword) {
      return;
    }

    const body = node.childForFieldName("body");
    if (!body || body.type !== "block") return;

    let newBody = "...";
    const firstChild = body.child(0);
    if (firstChild && firstChild.type === "expression_statement") {
      const expr = firstChild.child(0);
      if (expr && expr.type === "string") {
        const docstring = this.compressDocstring(expr.text);
        if (docstring) {
          newBody = docstring + "\n        ...";
        }
      }
    }

    const funcLine = code.slice(0, node.startIndex).split("\n").pop() || "";
    const baseIndent = funcLine.match(/^(\s*)/)?.[1] || "";
    const bodyIndent = baseIndent + "    ";

    replacements.push({
      startIndex: body.startIndex,
      endIndex: body.endIndex,
      replacement: "\n" + bodyIndent + newBody,
    });
  }

  private processPythonClass(
    node: TreeSitterNode,
    code: string,
    replacements: NodeRange[]
  ): void {
    const body = node.childForFieldName("body");
    if (!body || body.type !== "block") return;

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

  private squeezeJavaScript(code: string, tree: TreeSitterTree): string {
    const replacements: NodeRange[] = [];
    const root = tree.rootNode;
    this.processJSNode(root, code, replacements, false);
    return this.applyReplacements(code, replacements);
  }

  private processJSNode(
    node: TreeSitterNode,
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
          if (!text.startsWith("/**") && !this.isTodoComment(text)) {
            replacements.push({
              startIndex: node.startIndex,
              endIndex: node.endIndex,
              replacement: "",
            });
          } else if (text.startsWith("/**")) {
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
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child) {
            this.processJSNode(child, code, replacements, insideFunction);
          }
        }
    }
  }

  private processJSFunction(
    node: TreeSitterNode,
    code: string,
    replacements: NodeRange[]
  ): void {
    if (this.containsCriticalKeyword(node.text)) {
      return;
    }

    let body: TreeSitterNode | null = null;
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child && child.type === "statement_block") {
        body = child;
        break;
      }
    }

    if (!body) return;

    replacements.push({
      startIndex: body.startIndex,
      endIndex: body.endIndex,
      replacement: "{ /* ... */ }",
    });
  }

  private processJSArrowFunction(
    node: TreeSitterNode,
    code: string,
    replacements: NodeRange[]
  ): void {
    if (this.containsCriticalKeyword(node.text)) {
      return;
    }

    const body = node.childForFieldName("body");
    if (!body) return;

    if (body.type === "statement_block") {
      replacements.push({
        startIndex: body.startIndex,
        endIndex: body.endIndex,
        replacement: "{ /* ... */ }",
      });
    }
  }

  private processJSClass(
    node: TreeSitterNode,
    code: string,
    replacements: NodeRange[]
  ): void {
    let body: TreeSitterNode | null = null;
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child && child.type === "class_body") {
        body = child;
        break;
      }
    }

    if (!body) return;

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

  private hasCriticalDecorator(node: TreeSitterNode): boolean {
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

      if (trimmed.startsWith("Args:") || trimmed.startsWith("Arguments:")) {
        inArgsSection = true;
        inReturnsSection = false;
        result.push(line);
        continue;
      }
      if (trimmed.startsWith("Returns:") || trimmed.startsWith("Return:") || trimmed.startsWith("Yields:")) {
        inArgsSection = false;
        inReturnsSection = true;
        result.push(line);
        continue;
      }
      if (trimmed.startsWith("Raises:") || trimmed.startsWith("Example:") || trimmed.startsWith("Note:") || trimmed.startsWith("Warning:")) {
        inArgsSection = false;
        inReturnsSection = false;
        continue;
      }

      if (inArgsSection || inReturnsSection) {
        if (trimmed.length > 0) result.push(line);
        continue;
      }

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

      if (trimmed.startsWith("@")) {
        continue;
      }

      if (line.includes("/**") || line.includes("*/")) {
        result.push(line);
        continue;
      }

      if (!foundSummary && trimmed.length > 0 && !trimmed.startsWith("*")) {
        foundSummary = true;
        result.push(line);
      }
    }

    return result.join("\n");
  }

  private applyReplacements(code: string, replacements: NodeRange[]): string {
    replacements.sort((a, b) => b.startIndex - a.startIndex);

    const filtered: NodeRange[] = [];
    let lastStart = code.length;

    for (const r of replacements) {
      if (r.endIndex <= lastStart) {
        filtered.push(r);
        lastStart = r.startIndex;
      }
    }

    let result = code;
    for (const r of filtered) {
      result = result.slice(0, r.startIndex) + r.replacement + result.slice(r.endIndex);
    }

    result = result.replace(/\n{3,}/g, "\n\n");

    return result;
  }
}
