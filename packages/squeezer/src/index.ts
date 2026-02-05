/**
 * @prune/squeezer
 * Semantic Code Compression Engine
 *
 * Three-tier compression strategy:
 * 1. Lossless: Strip comments (except TODO/FIXME), preserve decorators & type hints
 * 2. Structural (Skeleton): Replace function bodies with placeholders, keep signatures
 * 3. Telegraphic: Interface definitions only
 *
 * Additional features:
 * - Smart Constant Folding: Collapse large objects/arrays/dicts
 * - Safety Verification: Re-parse and validate compressed code
 *
 * Uses TypeScript Compiler API (pure JavaScript, no native bindings)
 */

import * as ts from "typescript";
import {
  type SqueezeTier,
  type SqueezeResult,
  type SqueezeOptions,
  type SupportedLanguage,
  getLanguageFromPath,
} from "@prune/shared";
import { countTokens } from "@prune/tokenizer";

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  // Minimum lines for a constant/object to be considered "large" and foldable
  LARGE_OBJECT_THRESHOLD_LINES: 10,
  // Minimum array/object elements to be considered "large"
  LARGE_OBJECT_THRESHOLD_ELEMENTS: 20,
  // Comments containing these strings are preserved
  PRESERVED_COMMENT_MARKERS: ["TODO", "FIXME", "HACK", "XXX", "NOTE", "@ts-", "eslint-", "prettier-"],
};

// ============================================================================
// Core Squeeze Functions
// ============================================================================

/**
 * Main squeeze function with safety verification
 */
export function squeeze(
  code: string,
  language: SupportedLanguage,
  options: SqueezeOptions = { tier: "structural" }
): SqueezeResult {
  const { tier } = options;

  // Only TypeScript/JavaScript supported with full AST parsing
  const isJSLike = language === "typescript" || language === "javascript";

  if (!isJSLike) {
    // For other languages, use regex-based compression
    return squeezeWithRegex(code, language, tier, options);
  }

  // Parse original code and count errors
  const originalSourceFile = ts.createSourceFile(
    "file.ts",
    code,
    ts.ScriptTarget.Latest,
    true,
    language === "javascript" ? ts.ScriptKind.JS : ts.ScriptKind.TS
  );
  const originalErrors = countSyntaxErrors(originalSourceFile);

  // Apply compression based on tier
  let compressedCode: string;
  let diffSummary: string;

  switch (tier) {
    case "lossless":
      ({ code: compressedCode, summary: diffSummary } = losslessCompress(
        code,
        originalSourceFile,
        options
      ));
      break;
    case "structural":
      ({ code: compressedCode, summary: diffSummary } = structuralCompress(
        code,
        originalSourceFile,
        options
      ));
      break;
    case "telegraphic":
      ({ code: compressedCode, summary: diffSummary } = telegraphicCompress(
        code,
        originalSourceFile,
        options
      ));
      break;
    default:
      compressedCode = code;
      diffSummary = "No compression applied";
  }

  // Safety Verification: Re-parse compressed code and check for new errors
  const verification = verifySyntax(compressedCode, language, originalErrors);
  if (!verification.isValid) {
    // Abort compression if we introduced syntax errors
    return {
      originalCode: code,
      compressedCode: code,
      originalTokens: countTokens(code).tokens,
      compressedTokens: countTokens(code).tokens,
      savings: 0,
      savingsPercent: 0,
      diffSummary: "Compression aborted: " + verification.error,
      isValid: false,
    };
  }

  // Calculate token counts
  const originalTokens = countTokens(code).tokens;
  const compressedTokens = countTokens(compressedCode).tokens;
  const savings = originalTokens - compressedTokens;
  const savingsPercent =
    originalTokens > 0 ? Math.round((savings / originalTokens) * 100) : 0;

  return {
    originalCode: code,
    compressedCode,
    originalTokens,
    compressedTokens,
    savings,
    savingsPercent,
    diffSummary,
    isValid: true,
  };
}

/**
 * Squeeze a file by path (auto-detects language)
 */
export function squeezeFile(
  code: string,
  filePath: string,
  options: SqueezeOptions = { tier: "structural" }
): SqueezeResult {
  const language = getLanguageFromPath(filePath);
  if (!language) {
    return {
      originalCode: code,
      compressedCode: code,
      originalTokens: countTokens(code).tokens,
      compressedTokens: countTokens(code).tokens,
      savings: 0,
      savingsPercent: 0,
      diffSummary: "Unsupported file type",
      isValid: true,
    };
  }
  return squeeze(code, language, options);
}

// ============================================================================
// Safety Verification
// ============================================================================

/**
 * Count syntax errors in a source file
 */
function countSyntaxErrors(sourceFile: ts.SourceFile): number {
  let errorCount = 0;

  function visit(node: ts.Node) {
    // Check if the node itself is an error token
    if (node.kind === ts.SyntaxKind.Unknown) {
      errorCount++;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return errorCount;
}

/**
 * Verify that compressed code doesn't have more syntax errors than original
 */
function verifySyntax(
  compressedCode: string,
  language: SupportedLanguage,
  originalErrorCount: number
): { isValid: boolean; error?: string } {
  try {
    const compressedSourceFile = ts.createSourceFile(
      "file.ts",
      compressedCode,
      ts.ScriptTarget.Latest,
      true,
      language === "javascript" ? ts.ScriptKind.JS : ts.ScriptKind.TS
    );

    const newErrorCount = countSyntaxErrors(compressedSourceFile);

    if (newErrorCount > originalErrorCount) {
      return {
        isValid: false,
        error: `Introduced ${newErrorCount - originalErrorCount} new syntax errors`,
      };
    }

    return { isValid: true };
  } catch (error) {
    return {
      isValid: false,
      error: `Parse error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================================================
// TypeScript/JavaScript Compression (AST-based)
// ============================================================================

/**
 * Lossless compression: Remove comments (except TODO/FIXME) and whitespace
 * Preserves: decorators, type hints, important comments
 */
function losslessCompress(
  code: string,
  sourceFile: ts.SourceFile,
  options: SqueezeOptions
): { code: string; summary: string } {
  const removals: Array<{ start: number; end: number; type: string }> = [];
  let commentsRemoved = 0;
  let constantsFolded = 0;

  // Get all comments and filter out preserved ones
  const comments = getComments(code, sourceFile);

  for (const comment of comments) {
    const text = code.slice(comment.pos, comment.end);
    const shouldPreserve = CONFIG.PRESERVED_COMMENT_MARKERS.some((marker) =>
      text.includes(marker)
    );

    if (!shouldPreserve) {
      removals.push({ start: comment.pos, end: comment.end, type: "comment" });
      commentsRemoved++;
    }
  }

  // Smart Constant Folding: Find large objects/arrays and collapse them
  const foldableConstants = findLargeConstants(code, sourceFile);
  for (const constant of foldableConstants) {
    removals.push({
      start: constant.start,
      end: constant.end,
      type: "constant",
    });
    constantsFolded++;
  }

  // Apply removals in reverse order to preserve indices
  let result = code;
  const sortedRemovals = removals.sort((a, b) => b.start - a.start);

  for (const removal of sortedRemovals) {
    if (removal.type === "constant") {
      // Replace with folded placeholder
      const originalText = code.slice(removal.start, removal.end);
      const lineCount = originalText.split("\n").length;
      const placeholder = `/* ... (${lineCount} lines hidden) */`;
      result = result.slice(0, removal.start) + placeholder + result.slice(removal.end);
    } else {
      // Remove entirely
      result = result.slice(0, removal.start) + result.slice(removal.end);
    }
  }

  // Normalize whitespace (collapse multiple blank lines)
  result = result.replace(/\n{3,}/g, "\n\n");
  // Remove trailing whitespace from lines
  result = result.replace(/[ \t]+$/gm, "");

  const summary = [
    commentsRemoved > 0 ? `${commentsRemoved} comments removed` : null,
    constantsFolded > 0 ? `${constantsFolded} large constants folded` : null,
    "whitespace normalized",
  ]
    .filter(Boolean)
    .join(", ");

  return { code: result, summary };
}

/**
 * Structural (Skeleton) compression: Keep signatures, replace bodies with placeholders
 */
function structuralCompress(
  code: string,
  sourceFile: ts.SourceFile,
  options: SqueezeOptions
): { code: string; summary: string } {
  // First apply lossless compression
  const { code: losslessCode, summary: losslessSummary } = losslessCompress(
    code,
    sourceFile,
    options
  );

  // Re-parse the lossless code
  const newSourceFile = ts.createSourceFile(
    "file.ts",
    losslessCode,
    ts.ScriptTarget.Latest,
    true
  );

  const replacements: Array<{
    start: number;
    end: number;
    replacement: string;
  }> = [];
  let functionsCompressed = 0;

  function visit(node: ts.Node) {
    // Function declarations
    if (ts.isFunctionDeclaration(node) && node.body) {
      replacements.push({
        start: node.body.getStart(newSourceFile),
        end: node.body.getEnd(),
        replacement: "{ /* ... */ }",
      });
      functionsCompressed++;
      return;
    }

    // Method declarations
    if (ts.isMethodDeclaration(node) && node.body) {
      replacements.push({
        start: node.body.getStart(newSourceFile),
        end: node.body.getEnd(),
        replacement: "{ /* ... */ }",
      });
      functionsCompressed++;
      return;
    }

    // Arrow functions with block body
    if (ts.isArrowFunction(node) && node.body && ts.isBlock(node.body)) {
      const parent = node.parent;
      if (
        ts.isVariableDeclaration(parent) ||
        ts.isPropertyDeclaration(parent) ||
        ts.isPropertyAssignment(parent)
      ) {
        replacements.push({
          start: node.body.getStart(newSourceFile),
          end: node.body.getEnd(),
          replacement: "{ /* ... */ }",
        });
        functionsCompressed++;
        return;
      }
    }

    // Function expressions
    if (ts.isFunctionExpression(node) && node.body) {
      replacements.push({
        start: node.body.getStart(newSourceFile),
        end: node.body.getEnd(),
        replacement: "{ /* ... */ }",
      });
      functionsCompressed++;
      return;
    }

    // Getters and setters
    if (ts.isGetAccessorDeclaration(node) && node.body) {
      replacements.push({
        start: node.body.getStart(newSourceFile),
        end: node.body.getEnd(),
        replacement: "{ /* ... */ }",
      });
      functionsCompressed++;
      return;
    }

    if (ts.isSetAccessorDeclaration(node) && node.body) {
      replacements.push({
        start: node.body.getStart(newSourceFile),
        end: node.body.getEnd(),
        replacement: "{ /* ... */ }",
      });
      functionsCompressed++;
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(newSourceFile);

  // Apply replacements in reverse order
  let result = losslessCode;
  for (const rep of replacements.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, rep.start) + rep.replacement + result.slice(rep.end);
  }

  const summary = [
    functionsCompressed > 0
      ? `${functionsCompressed} function bodies compressed`
      : null,
    losslessSummary,
  ]
    .filter(Boolean)
    .join(", ");

  return { code: result, summary };
}

/**
 * Telegraphic compression: Only keep imports, types, interfaces, and signatures
 */
function telegraphicCompress(
  code: string,
  sourceFile: ts.SourceFile,
  options: SqueezeOptions
): { code: string; summary: string } {
  const sections: string[] = [];
  let importCount = 0;
  let typeCount = 0;
  let functionCount = 0;
  let classCount = 0;

  function visit(node: ts.Node) {
    // Keep imports
    if (ts.isImportDeclaration(node)) {
      sections.push(node.getText(sourceFile));
      importCount++;
      return;
    }

    // Keep exports
    if (ts.isExportDeclaration(node)) {
      sections.push(node.getText(sourceFile));
      return;
    }

    // Keep type aliases
    if (ts.isTypeAliasDeclaration(node)) {
      sections.push(node.getText(sourceFile));
      typeCount++;
      return;
    }

    // Keep interfaces
    if (ts.isInterfaceDeclaration(node)) {
      sections.push(node.getText(sourceFile));
      typeCount++;
      return;
    }

    // Keep enum declarations
    if (ts.isEnumDeclaration(node)) {
      sections.push(node.getText(sourceFile));
      typeCount++;
      return;
    }

    // Extract class signatures
    if (ts.isClassDeclaration(node)) {
      sections.push(extractClassSignature(node, sourceFile));
      classCount++;
      return;
    }

    // Extract function signatures
    if (ts.isFunctionDeclaration(node) && node.name) {
      sections.push(extractFunctionSignature(node, sourceFile));
      functionCount++;
      return;
    }

    // Extract const/let/var with arrow functions (as signatures)
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (decl.initializer && ts.isArrowFunction(decl.initializer)) {
          sections.push(extractArrowFunctionSignature(decl, sourceFile));
          functionCount++;
        }
      }
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  const result = sections.join("\n\n");

  const summary = [
    `${importCount} imports`,
    `${typeCount} type definitions`,
    `${functionCount} function signatures`,
    `${classCount} class signatures`,
    "all bodies removed",
  ].join(", ");

  return { code: result, summary };
}

// ============================================================================
// Smart Constant Folding
// ============================================================================

interface FoldableConstant {
  start: number;
  end: number;
  lineCount: number;
  elementCount: number;
}

/**
 * Find large objects, arrays, and dictionaries that can be folded
 */
function findLargeConstants(
  code: string,
  sourceFile: ts.SourceFile
): FoldableConstant[] {
  const foldables: FoldableConstant[] = [];

  function visit(node: ts.Node) {
    // Check for large array literals
    if (ts.isArrayLiteralExpression(node)) {
      const text = node.getText(sourceFile);
      const lineCount = text.split("\n").length;
      const elementCount = node.elements.length;

      if (
        lineCount >= CONFIG.LARGE_OBJECT_THRESHOLD_LINES ||
        elementCount >= CONFIG.LARGE_OBJECT_THRESHOLD_ELEMENTS
      ) {
        foldables.push({
          start: node.getStart(sourceFile),
          end: node.getEnd(),
          lineCount,
          elementCount,
        });
        return; // Don't recurse into this node
      }
    }

    // Check for large object literals
    if (ts.isObjectLiteralExpression(node)) {
      const text = node.getText(sourceFile);
      const lineCount = text.split("\n").length;
      const elementCount = node.properties.length;

      if (
        lineCount >= CONFIG.LARGE_OBJECT_THRESHOLD_LINES ||
        elementCount >= CONFIG.LARGE_OBJECT_THRESHOLD_ELEMENTS
      ) {
        foldables.push({
          start: node.getStart(sourceFile),
          end: node.getEnd(),
          lineCount,
          elementCount,
        });
        return; // Don't recurse into this node
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return foldables;
}

// ============================================================================
// Python Compression (Regex-based with enhanced patterns)
// ============================================================================

function squeezeWithRegex(
  code: string,
  language: SupportedLanguage,
  tier: SqueezeTier,
  options: SqueezeOptions
): SqueezeResult {
  let compressedCode = code;
  let diffSummary = "";
  let isValid = true;

  // Store original for safety check
  const originalCode = code;

  switch (tier) {
    case "lossless": {
      const result = losslessCompressRegex(code, language);
      compressedCode = result.code;
      diffSummary = result.summary;
      break;
    }
    case "structural": {
      const result = structuralCompressRegex(code, language);
      compressedCode = result.code;
      diffSummary = result.summary;
      break;
    }
    case "telegraphic": {
      const result = telegraphicCompressRegex(code, language);
      compressedCode = result.code;
      diffSummary = result.summary;
      break;
    }
  }

  // Safety verification for Python: check indentation consistency
  if (language === "python") {
    const verification = verifyPythonSyntax(compressedCode);
    if (!verification.isValid) {
      compressedCode = originalCode;
      diffSummary = "Compression aborted: " + verification.error;
      isValid = false;
    }
  }

  const originalTokens = countTokens(originalCode).tokens;
  const compressedTokens = countTokens(compressedCode).tokens;
  const savings = originalTokens - compressedTokens;
  const savingsPercent =
    originalTokens > 0 ? Math.round((savings / originalTokens) * 100) : 0;

  return {
    originalCode,
    compressedCode,
    originalTokens,
    compressedTokens,
    savings,
    savingsPercent,
    diffSummary,
    isValid,
  };
}

/**
 * Lossless compression for Python and other languages
 */
function losslessCompressRegex(
  code: string,
  language: SupportedLanguage
): { code: string; summary: string } {
  let result = code;
  let commentsRemoved = 0;
  let docstringsRemoved = 0;
  let constantsFolded = 0;

  if (language === "python") {
    // Remove # comments (preserving TODO/FIXME/etc)
    result = result.replace(/^([ \t]*)#(.*)$/gm, (match, indent, content) => {
      const hasPreservedMarker = CONFIG.PRESERVED_COMMENT_MARKERS.some((marker) =>
        content.includes(marker)
      );
      if (hasPreservedMarker) {
        return match;
      }
      commentsRemoved++;
      return "";
    });

    // Remove docstrings (preserving TODO/FIXME in docstrings)
    result = result.replace(
      /("""[\s\S]*?"""|'''[\s\S]*?''')/g,
      (match) => {
        const hasPreservedMarker = CONFIG.PRESERVED_COMMENT_MARKERS.some((marker) =>
          match.includes(marker)
        );
        if (hasPreservedMarker) {
          return match;
        }
        docstringsRemoved++;
        return '""';
      }
    );

    // Fold large dictionaries/lists (>50 lines or >20 elements)
    result = foldLargePythonStructures(result);
    constantsFolded = (result.match(/# \.\.\. \(\d+ lines hidden\)/g) || []).length;
  } else {
    // Generic C-style comments
    result = result.replace(/\/\/(.*)$/gm, (match, content) => {
      const hasPreservedMarker = CONFIG.PRESERVED_COMMENT_MARKERS.some((marker) =>
        content.includes(marker)
      );
      if (hasPreservedMarker) return match;
      commentsRemoved++;
      return "";
    });

    result = result.replace(/\/\*[\s\S]*?\*\//g, (match) => {
      const hasPreservedMarker = CONFIG.PRESERVED_COMMENT_MARKERS.some((marker) =>
        match.includes(marker)
      );
      if (hasPreservedMarker) return match;
      commentsRemoved++;
      return "";
    });
  }

  // Normalize whitespace
  result = result.replace(/\n{3,}/g, "\n\n");
  result = result.replace(/[ \t]+$/gm, "");

  const summary = [
    commentsRemoved > 0 ? `${commentsRemoved} comments removed` : null,
    docstringsRemoved > 0 ? `${docstringsRemoved} docstrings removed` : null,
    constantsFolded > 0 ? `${constantsFolded} large structures folded` : null,
    "whitespace normalized",
  ]
    .filter(Boolean)
    .join(", ");

  return { code: result, summary };
}

/**
 * Structural (Skeleton) compression for Python
 */
function structuralCompressRegex(
  code: string,
  language: SupportedLanguage
): { code: string; summary: string } {
  // Start with lossless compression
  const { code: losslessCode, summary: losslessSummary } = losslessCompressRegex(
    code,
    language
  );

  let result = losslessCode;
  let functionsCompressed = 0;

  if (language === "python") {
    // Replace function bodies with ... while preserving decorators and signature
    // This regex handles:
    // - Decorators (@decorator)
    // - Async functions
    // - Type hints
    // - Default arguments
    result = result.replace(
      /^((?:[ \t]*@[\w.]+(?:\([^)]*\))?\s*\n)*)?([ \t]*)(async\s+)?def\s+(\w+)\s*\(([^)]*)\)([^:]*):[ \t]*\n((?:\2[ \t]+.+\n?)+)/gm,
      (match, decorators, indent, async_, name, params, returnType, body) => {
        functionsCompressed++;
        const decoratorPart = decorators || "";
        const asyncPart = async_ || "";
        return `${decoratorPart}${indent}${asyncPart}def ${name}(${params})${returnType}:\n${indent}    ...`;
      }
    );

    // Replace class method bodies (same pattern but with self/cls)
    result = result.replace(
      /^([ \t]+)(async\s+)?def\s+(\w+)\s*\(\s*(self|cls)([^)]*)\)([^:]*):[ \t]*\n((?:\1[ \t]+.+\n?)+)/gm,
      (match, indent, async_, name, selfOrCls, params, returnType, body) => {
        functionsCompressed++;
        const asyncPart = async_ || "";
        return `${indent}${asyncPart}def ${name}(${selfOrCls}${params})${returnType}:\n${indent}    ...`;
      }
    );
  } else if (language === "go") {
    result = result.replace(
      /(func\s+(?:\([^)]*\)\s*)?\w+\s*\([^)]*\)[^{]*)\{[\s\S]*?\n\}/g,
      (match, signature) => {
        functionsCompressed++;
        return signature + "{ /* ... */ }";
      }
    );
  } else if (language === "java") {
    result = result.replace(
      /((?:public|private|protected|static|final|\s)+[\w<>\[\]]+\s+\w+\s*\([^)]*\)[^{]*)\{[\s\S]*?\n[ \t]*\}/g,
      (match, signature) => {
        functionsCompressed++;
        return signature + "{ /* ... */ }";
      }
    );
  }

  const summary = [
    functionsCompressed > 0
      ? `${functionsCompressed} function bodies compressed`
      : null,
    losslessSummary,
  ]
    .filter(Boolean)
    .join(", ");

  return { code: result, summary };
}

/**
 * Telegraphic compression for Python
 */
function telegraphicCompressRegex(
  code: string,
  language: SupportedLanguage
): { code: string; summary: string } {
  const lines = code.split("\n");
  const signatures: string[] = [];
  let importCount = 0;
  let classCount = 0;
  let functionCount = 0;

  if (language === "python") {
    let currentDecorators: string[] = [];
    let inClass = false;
    let classIndent = "";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Collect decorators
      if (trimmed.startsWith("@")) {
        currentDecorators.push(line);
        continue;
      }

      // Imports
      if (trimmed.startsWith("import ") || trimmed.startsWith("from ")) {
        signatures.push(line);
        importCount++;
        currentDecorators = [];
        continue;
      }

      // Class definitions
      if (trimmed.startsWith("class ")) {
        if (currentDecorators.length > 0) {
          signatures.push(...currentDecorators);
        }
        // Extract class signature without body
        const classMatch = line.match(/^(\s*)class\s+(\w+)([^:]*)/);
        if (classMatch) {
          const [, indent, className, inheritance] = classMatch;
          signatures.push(`${indent}class ${className}${inheritance}:`);
          inClass = true;
          classIndent = indent;
          classCount++;
        }
        currentDecorators = [];
        continue;
      }

      // Function/method definitions
      if (trimmed.match(/^(async\s+)?def\s+/)) {
        if (currentDecorators.length > 0) {
          signatures.push(...currentDecorators);
        }
        // Extract function signature
        const funcMatch = line.match(/^(\s*)(async\s+)?def\s+(\w+)\s*\(([^)]*)\)([^:]*)/);
        if (funcMatch) {
          const [, indent, async_, name, params, returnType] = funcMatch;
          const asyncPart = async_ || "";
          signatures.push(`${indent}${asyncPart}def ${name}(${params})${returnType}`);
          functionCount++;
        }
        currentDecorators = [];
        continue;
      }

      // Type annotations at module level (Python 3.6+)
      if (trimmed.match(/^\w+\s*:\s*\w+/) && !inClass) {
        signatures.push(line);
        continue;
      }

      // Reset class context if we're back to top level
      if (inClass && line.length > 0 && !line.startsWith(classIndent + " ") && !line.startsWith(classIndent + "\t")) {
        inClass = false;
      }

      currentDecorators = [];
    }
  } else if (language === "go") {
    for (const line of lines) {
      if (
        line.match(/^import\s/) ||
        line.match(/^type\s/) ||
        line.match(/^func\s/)
      ) {
        signatures.push(line.replace(/\{.*$/, "").trim());
      }
    }
  } else {
    return { code, summary: "Language not fully supported for telegraphic compression" };
  }

  const result = signatures.join("\n");

  const summary = [
    `${importCount} imports`,
    `${classCount} classes`,
    `${functionCount} functions`,
    "signatures only",
  ].join(", ");

  return { code: result, summary };
}

/**
 * Fold large Python data structures (lists, dicts, sets > 50 lines)
 */
function foldLargePythonStructures(code: string): string {
  // Match large list/dict/set literals
  const patterns = [
    // Dict literals
    /^(\s*\w+\s*=\s*)\{([^}]*\n){10,}\s*\}/gm,
    // List literals
    /^(\s*\w+\s*=\s*)\[([^\]]*\n){10,}\s*\]/gm,
    // Set literals
    /^(\s*\w+\s*=\s*)\{([^}]*\n){10,}\s*\}/gm,
  ];

  let result = code;

  for (const pattern of patterns) {
    result = result.replace(pattern, (match, prefix) => {
      const lineCount = match.split("\n").length;
      return `${prefix}# ... (${lineCount} lines hidden)`;
    });
  }

  return result;
}

/**
 * Verify Python syntax by checking indentation consistency
 */
function verifyPythonSyntax(code: string): { isValid: boolean; error?: string } {
  const lines = code.split("\n");
  let expectedIndent = 0;
  let lastNonEmptyIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;

    const indent = line.match(/^[ \t]*/)?.[0].length || 0;

    // Check for mixed tabs and spaces
    if (line.match(/^\t+ /) || line.match(/^ +\t/)) {
      return {
        isValid: false,
        error: `Mixed tabs and spaces on line ${i + 1}`,
      };
    }

    // Check for inconsistent indentation jumps (more than one level)
    if (indent > lastNonEmptyIndent + 8) {
      return {
        isValid: false,
        error: `Unexpected indentation jump on line ${i + 1}`,
      };
    }

    lastNonEmptyIndent = indent;
  }

  return { isValid: true };
}

// ============================================================================
// Helper Functions
// ============================================================================

function getComments(
  code: string,
  sourceFile: ts.SourceFile
): Array<{ pos: number; end: number }> {
  const comments: Array<{ pos: number; end: number }> = [];

  function collectComments(node: ts.Node) {
    const ranges = ts.getLeadingCommentRanges(code, node.pos);
    if (ranges) {
      for (const range of ranges) {
        comments.push({ pos: range.pos, end: range.end });
      }
    }
    const trailingRanges = ts.getTrailingCommentRanges(code, node.end);
    if (trailingRanges) {
      for (const range of trailingRanges) {
        comments.push({ pos: range.pos, end: range.end });
      }
    }
    ts.forEachChild(node, collectComments);
  }

  collectComments(sourceFile);

  // Deduplicate
  const seen = new Set<string>();
  return comments.filter((c) => {
    const key = `${c.pos}-${c.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractClassSignature(
  node: ts.ClassDeclaration,
  sourceFile: ts.SourceFile
): string {
  const className = node.name?.getText(sourceFile) || "Anonymous";
  const members: string[] = [];

  // Get decorators
  const decorators = ts.getDecorators(node);
  const decoratorText = decorators
    ? decorators.map((d) => d.getText(sourceFile)).join("\n") + "\n"
    : "";

  for (const member of node.members) {
    if (ts.isPropertyDeclaration(member)) {
      const name = member.name.getText(sourceFile);
      const type = member.type ? ": " + member.type.getText(sourceFile) : "";
      const modifiers = ts.getModifiers(member);
      const modText = modifiers
        ? modifiers.map((m) => m.getText(sourceFile)).join(" ") + " "
        : "";
      members.push(`  ${modText}${name}${type};`);
    } else if (ts.isMethodDeclaration(member)) {
      const name = member.name.getText(sourceFile);
      const params = member.parameters
        .map((p) => p.getText(sourceFile))
        .join(", ");
      const returnType = member.type
        ? ": " + member.type.getText(sourceFile)
        : "";
      const modifiers = ts.getModifiers(member);
      const modText = modifiers
        ? modifiers.map((m) => m.getText(sourceFile)).join(" ") + " "
        : "";
      members.push(`  ${modText}${name}(${params})${returnType};`);
    } else if (ts.isConstructorDeclaration(member)) {
      const params = member.parameters
        .map((p) => p.getText(sourceFile))
        .join(", ");
      members.push(`  constructor(${params});`);
    } else if (ts.isGetAccessorDeclaration(member)) {
      const name = member.name.getText(sourceFile);
      const returnType = member.type
        ? ": " + member.type.getText(sourceFile)
        : "";
      members.push(`  get ${name}()${returnType};`);
    } else if (ts.isSetAccessorDeclaration(member)) {
      const name = member.name.getText(sourceFile);
      const params = member.parameters
        .map((p) => p.getText(sourceFile))
        .join(", ");
      members.push(`  set ${name}(${params});`);
    }
  }

  const extendsClause = node.heritageClauses?.find(
    (h) => h.token === ts.SyntaxKind.ExtendsKeyword
  );
  const implementsClause = node.heritageClauses?.find(
    (h) => h.token === ts.SyntaxKind.ImplementsKeyword
  );

  let classDecl = `class ${className}`;
  if (extendsClause) {
    classDecl += ` extends ${extendsClause.types
      .map((t) => t.getText(sourceFile))
      .join(", ")}`;
  }
  if (implementsClause) {
    classDecl += ` implements ${implementsClause.types
      .map((t) => t.getText(sourceFile))
      .join(", ")}`;
  }

  return `${decoratorText}${classDecl} {\n${members.join("\n")}\n}`;
}

function extractFunctionSignature(
  node: ts.FunctionDeclaration,
  sourceFile: ts.SourceFile
): string {
  const name = node.name?.getText(sourceFile) || "anonymous";
  const params = node.parameters
    .map((p) => p.getText(sourceFile))
    .join(", ");
  const returnType = node.type ? ": " + node.type.getText(sourceFile) : "";

  // Get modifiers (export, async, etc.)
  const modifiers = ts.getModifiers(node);
  const modText = modifiers
    ? modifiers.map((m) => m.getText(sourceFile)).join(" ") + " "
    : "";

  // Get decorators (only available on certain node types)
  let decoratorText = "";
  if (ts.canHaveDecorators(node)) {
    const decorators = ts.getDecorators(node);
    decoratorText = decorators
      ? decorators.map((d) => d.getText(sourceFile)).join("\n") + "\n"
      : "";
  }

  return `${decoratorText}${modText}function ${name}(${params})${returnType};`;
}

function extractArrowFunctionSignature(
  decl: ts.VariableDeclaration,
  sourceFile: ts.SourceFile
): string {
  const name = decl.name.getText(sourceFile);
  const arrowFunc = decl.initializer as ts.ArrowFunction;

  const params = arrowFunc.parameters
    .map((p) => p.getText(sourceFile))
    .join(", ");
  const returnType = arrowFunc.type
    ? ": " + arrowFunc.type.getText(sourceFile)
    : "";

  // Check if it's a const or let
  const parent = decl.parent;
  const keyword =
    parent.flags & ts.NodeFlags.Const
      ? "const"
      : parent.flags & ts.NodeFlags.Let
      ? "let"
      : "var";

  return `${keyword} ${name} = (${params})${returnType} => { /* ... */ };`;
}

/**
 * Generate a diff summary between original and compressed
 */
export function generateDiffSummary(
  original: string,
  compressed: string
): string {
  const originalLines = original.split("\n").length;
  const compressedLines = compressed.split("\n").length;
  const linesRemoved = originalLines - compressedLines;

  const originalTokens = countTokens(original).tokens;
  const compressedTokens = countTokens(compressed).tokens;
  const tokensSaved = originalTokens - compressedTokens;
  const percentSaved =
    originalTokens > 0 ? Math.round((tokensSaved / originalTokens) * 100) : 0;

  return [
    `${linesRemoved} lines removed`,
    `${tokensSaved} tokens saved (${percentSaved}%)`,
  ].join(", ");
}

// Re-export types
export type { SqueezeTier, SqueezeResult, SqueezeOptions, SupportedLanguage };
