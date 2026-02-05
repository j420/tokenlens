/**
 * @prune/squeezer
 * TypeScript Compiler API-based code compression
 *
 * Three-tier compression strategy:
 * 1. Lossless: Strip comments, whitespace, docstrings (~15% savings)
 * 2. Structural: Prune function bodies, keep signatures (~40% savings)
 * 3. Telegraphic: Interface definitions only (~70% savings)
 *
 * Uses TypeScript's built-in parser (pure JavaScript, no native bindings)
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
// Core Squeeze Functions
// ============================================================================

/**
 * Main squeeze function
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
    return squeezeWithRegex(code, language, tier);
  }

  // Parse with TypeScript compiler
  const sourceFile = ts.createSourceFile(
    "file.ts",
    code,
    ts.ScriptTarget.Latest,
    true, // setParentNodes
    language === "javascript" ? ts.ScriptKind.JS : ts.ScriptKind.TS
  );

  // Apply compression based on tier
  let compressedCode: string;
  let diffSummary: string;

  switch (tier) {
    case "lossless":
      ({ code: compressedCode, summary: diffSummary } = losslessCompress(
        code,
        sourceFile
      ));
      break;
    case "structural":
      ({ code: compressedCode, summary: diffSummary } = structuralCompress(
        code,
        sourceFile,
        options
      ));
      break;
    case "telegraphic":
      ({ code: compressedCode, summary: diffSummary } = telegraphicCompress(
        code,
        sourceFile
      ));
      break;
    default:
      compressedCode = code;
      diffSummary = "No compression applied";
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
// TypeScript/JavaScript Compression (AST-based)
// ============================================================================

/**
 * Lossless compression: Remove comments and excessive whitespace
 */
function losslessCompress(
  code: string,
  sourceFile: ts.SourceFile
): { code: string; summary: string } {
  const removals: Array<{ start: number; end: number }> = [];
  let commentsRemoved = 0;

  // Get all comments
  const comments = getComments(code, sourceFile);

  for (const comment of comments) {
    const text = code.slice(comment.pos, comment.end);
    // Preserve TODOs and important comments
    if (
      !text.includes("TODO") &&
      !text.includes("FIXME") &&
      !text.includes("@ts-") &&
      !text.includes("eslint-")
    ) {
      removals.push({ start: comment.pos, end: comment.end });
      commentsRemoved++;
    }
  }

  // Apply removals in reverse order to preserve indices
  let result = code;
  for (const removal of removals.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, removal.start) + result.slice(removal.end);
  }

  // Normalize whitespace (collapse multiple blank lines)
  result = result.replace(/\n{3,}/g, "\n\n");

  const summary = [
    commentsRemoved > 0 ? commentsRemoved + " comments removed" : null,
    "whitespace normalized",
  ]
    .filter(Boolean)
    .join(", ");

  return { code: result, summary };
}

/**
 * Structural compression: Keep signatures, prune function bodies
 */
function structuralCompress(
  code: string,
  sourceFile: ts.SourceFile,
  options: SqueezeOptions
): { code: string; summary: string } {
  const replacements: Array<{
    start: number;
    end: number;
    replacement: string;
  }> = [];
  let functionsCompressed = 0;

  function visit(node: ts.Node) {
    // Function declarations
    if (ts.isFunctionDeclaration(node) && node.body) {
      const bodyStart = node.body.getStart(sourceFile);
      const bodyEnd = node.body.getEnd();
      replacements.push({
        start: bodyStart,
        end: bodyEnd,
        replacement: "{ /* ... */ }",
      });
      functionsCompressed++;
      return; // Don't recurse into function body
    }

    // Method declarations
    if (ts.isMethodDeclaration(node) && node.body) {
      const bodyStart = node.body.getStart(sourceFile);
      const bodyEnd = node.body.getEnd();
      replacements.push({
        start: bodyStart,
        end: bodyEnd,
        replacement: "{ /* ... */ }",
      });
      functionsCompressed++;
      return;
    }

    // Arrow functions (only top-level or class properties)
    if (ts.isArrowFunction(node) && node.body) {
      const parent = node.parent;
      // Only compress arrow functions assigned to variables/properties
      if (
        ts.isVariableDeclaration(parent) ||
        ts.isPropertyDeclaration(parent)
      ) {
        if (ts.isBlock(node.body)) {
          const bodyStart = node.body.getStart(sourceFile);
          const bodyEnd = node.body.getEnd();
          replacements.push({
            start: bodyStart,
            end: bodyEnd,
            replacement: "{ /* ... */ }",
          });
          functionsCompressed++;
          return;
        }
      }
    }

    // Function expressions
    if (ts.isFunctionExpression(node) && node.body) {
      const bodyStart = node.body.getStart(sourceFile);
      const bodyEnd = node.body.getEnd();
      replacements.push({
        start: bodyStart,
        end: bodyEnd,
        replacement: "{ /* ... */ }",
      });
      functionsCompressed++;
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  // Start with lossless compression
  const { code: losslessCode } = losslessCompress(code, sourceFile);

  // Re-parse after lossless compression
  const newSourceFile = ts.createSourceFile(
    "file.ts",
    losslessCode,
    ts.ScriptTarget.Latest,
    true
  );

  // Recalculate positions on the new source
  const newReplacements: Array<{
    start: number;
    end: number;
    replacement: string;
  }> = [];

  function visitNew(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.body) {
      newReplacements.push({
        start: node.body.getStart(newSourceFile),
        end: node.body.getEnd(),
        replacement: "{ /* ... */ }",
      });
      return;
    }
    if (ts.isMethodDeclaration(node) && node.body) {
      newReplacements.push({
        start: node.body.getStart(newSourceFile),
        end: node.body.getEnd(),
        replacement: "{ /* ... */ }",
      });
      return;
    }
    if (ts.isArrowFunction(node) && node.body && ts.isBlock(node.body)) {
      const parent = node.parent;
      if (
        ts.isVariableDeclaration(parent) ||
        ts.isPropertyDeclaration(parent)
      ) {
        newReplacements.push({
          start: node.body.getStart(newSourceFile),
          end: node.body.getEnd(),
          replacement: "{ /* ... */ }",
        });
        return;
      }
    }
    if (ts.isFunctionExpression(node) && node.body) {
      newReplacements.push({
        start: node.body.getStart(newSourceFile),
        end: node.body.getEnd(),
        replacement: "{ /* ... */ }",
      });
      return;
    }
    ts.forEachChild(node, visitNew);
  }

  visitNew(newSourceFile);

  // Apply replacements in reverse order
  let result = losslessCode;
  for (const rep of newReplacements.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, rep.start) + rep.replacement + result.slice(rep.end);
  }

  const summary = [
    functionsCompressed > 0
      ? functionsCompressed + " function bodies compressed"
      : null,
    "comments removed",
  ]
    .filter(Boolean)
    .join(", ");

  return { code: result, summary };
}

/**
 * Telegraphic compression: Interface definitions only
 */
function telegraphicCompress(
  code: string,
  sourceFile: ts.SourceFile
): { code: string; summary: string } {
  const keeps: Array<{ start: number; end: number; type: string }> = [];

  function visit(node: ts.Node) {
    // Keep imports
    if (ts.isImportDeclaration(node)) {
      keeps.push({
        start: node.getStart(sourceFile),
        end: node.getEnd(),
        type: "import",
      });
    }

    // Keep exports (type exports)
    if (ts.isExportDeclaration(node)) {
      keeps.push({
        start: node.getStart(sourceFile),
        end: node.getEnd(),
        type: "export",
      });
    }

    // Keep type aliases
    if (ts.isTypeAliasDeclaration(node)) {
      keeps.push({
        start: node.getStart(sourceFile),
        end: node.getEnd(),
        type: "type",
      });
    }

    // Keep interfaces
    if (ts.isInterfaceDeclaration(node)) {
      keeps.push({
        start: node.getStart(sourceFile),
        end: node.getEnd(),
        type: "interface",
      });
    }

    // Keep class declarations (signatures only)
    if (ts.isClassDeclaration(node)) {
      // Extract class with method signatures only
      const className = node.name?.getText(sourceFile) || "Anonymous";
      const members: string[] = [];

      for (const member of node.members) {
        if (ts.isPropertyDeclaration(member)) {
          // Keep property declarations
          const propText = member.getText(sourceFile);
          members.push("  " + propText.split("=")[0].trim() + ";");
        } else if (ts.isMethodDeclaration(member)) {
          // Keep method signature only
          const name = member.name.getText(sourceFile);
          const params = member.parameters
            .map((p) => p.getText(sourceFile))
            .join(", ");
          const returnType = member.type
            ? ": " + member.type.getText(sourceFile)
            : "";
          members.push(`  ${name}(${params})${returnType};`);
        }
      }

      const classText = `class ${className} {\n${members.join("\n")}\n}`;
      // Store as a synthetic entry
      keeps.push({
        start: node.getStart(sourceFile),
        end: node.getEnd(),
        type: "class_signature",
      });
    }

    // Keep function signatures (declarations without body)
    if (ts.isFunctionDeclaration(node) && node.name) {
      const name = node.name.getText(sourceFile);
      const params = node.parameters
        .map((p) => p.getText(sourceFile))
        .join(", ");
      const returnType = node.type ? ": " + node.type.getText(sourceFile) : "";
      const signature = `function ${name}(${params})${returnType};`;

      keeps.push({
        start: node.getStart(sourceFile),
        end: node.getEnd(),
        type: "function_signature",
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  // Build result from kept sections
  const sortedKeeps = keeps.sort((a, b) => a.start - b.start);

  // For telegraphic, we rebuild with signatures only
  const sections: string[] = [];
  let lastEnd = 0;

  for (const keep of sortedKeeps) {
    if (keep.type === "import" || keep.type === "export") {
      sections.push(code.slice(keep.start, keep.end));
    } else if (keep.type === "type" || keep.type === "interface") {
      sections.push(code.slice(keep.start, keep.end));
    } else if (keep.type === "function_signature") {
      // Get function signature only
      const node = findNodeAt(sourceFile, keep.start);
      if (node && ts.isFunctionDeclaration(node) && node.name) {
        const name = node.name.getText(sourceFile);
        const params = node.parameters
          .map((p) => p.getText(sourceFile))
          .join(", ");
        const returnType = node.type
          ? ": " + node.type.getText(sourceFile)
          : "";
        const modifiers = node.modifiers
          ? node.modifiers.map((m) => m.getText(sourceFile)).join(" ") + " "
          : "";
        sections.push(`${modifiers}function ${name}(${params})${returnType};`);
      }
    } else if (keep.type === "class_signature") {
      // Get class with method signatures
      const node = findNodeAt(sourceFile, keep.start);
      if (node && ts.isClassDeclaration(node)) {
        sections.push(extractClassSignature(node, sourceFile));
      }
    }
  }

  const result = sections.join("\n\n");

  const summary = [
    sortedKeeps.filter((k) => k.type === "import").length + " imports",
    sortedKeeps.filter((k) => k.type === "type" || k.type === "interface")
      .length + " type definitions",
    sortedKeeps.filter((k) => k.type === "function_signature").length +
      " function signatures",
    "all bodies removed",
  ].join(", ");

  return { code: result, summary };
}

// ============================================================================
// Regex-based compression for non-JS languages
// ============================================================================

function squeezeWithRegex(
  code: string,
  language: SupportedLanguage,
  tier: SqueezeTier
): SqueezeResult {
  let compressedCode = code;
  let diffSummary = "";

  switch (tier) {
    case "lossless": {
      // Remove comments based on language
      const { result, count } = removeCommentsRegex(code, language);
      compressedCode = result;
      compressedCode = compressedCode.replace(/\n{3,}/g, "\n\n");
      diffSummary = count + " comments removed, whitespace normalized";
      break;
    }
    case "structural": {
      // Remove comments + collapse function bodies
      const { result: noComments, count } = removeCommentsRegex(code, language);
      compressedCode = collapseFunctionBodiesRegex(noComments, language);
      diffSummary = count + " comments removed, function bodies collapsed";
      break;
    }
    case "telegraphic": {
      // Extract only signatures
      compressedCode = extractSignaturesRegex(code, language);
      diffSummary = "Only signatures and type definitions kept";
      break;
    }
  }

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

function removeCommentsRegex(
  code: string,
  language: SupportedLanguage
): { result: string; count: number } {
  let result = code;
  let count = 0;

  switch (language) {
    case "python":
      // Remove # comments (but not in strings)
      result = result.replace(/(?<!["'])#(?!.*["']).*$/gm, () => {
        count++;
        return "";
      });
      // Remove docstrings
      result = result.replace(/"""[\s\S]*?"""|'''[\s\S]*?'''/g, () => {
        count++;
        return '""';
      });
      break;

    case "go":
    case "java":
    case "rust":
    case "cpp":
    case "c":
      // Remove // comments
      result = result.replace(/\/\/.*$/gm, () => {
        count++;
        return "";
      });
      // Remove /* */ comments
      result = result.replace(/\/\*[\s\S]*?\*\//g, () => {
        count++;
        return "";
      });
      break;

    default:
      // Generic: remove // and /* */
      result = result.replace(/\/\/.*$/gm, () => {
        count++;
        return "";
      });
      result = result.replace(/\/\*[\s\S]*?\*\//g, () => {
        count++;
        return "";
      });
  }

  return { result, count };
}

function collapseFunctionBodiesRegex(
  code: string,
  language: SupportedLanguage
): string {
  switch (language) {
    case "python":
      // Replace function bodies with ...
      return code.replace(
        /(def\s+\w+\s*\([^)]*\)[^:]*:)\s*\n((?:[ \t]+.+\n?)+)/g,
        "$1\n    ..."
      );

    case "go":
      // Replace function bodies with { /* ... */ }
      return code.replace(
        /(func\s+(?:\([^)]*\)\s*)?\w+\s*\([^)]*\)[^{]*)\{[^}]*\}/gs,
        "$1{ /* ... */ }"
      );

    case "java":
      // Simplified: replace method bodies
      return code.replace(
        /((?:public|private|protected|static|\s)+[\w<>\[\]]+\s+\w+\s*\([^)]*\)[^{]*)\{[^}]*\}/gs,
        "$1{ /* ... */ }"
      );

    default:
      return code;
  }
}

function extractSignaturesRegex(
  code: string,
  language: SupportedLanguage
): string {
  const lines = code.split("\n");
  const signatures: string[] = [];

  switch (language) {
    case "python": {
      // Extract imports, class defs, and function defs
      for (const line of lines) {
        if (
          line.match(/^import\s/) ||
          line.match(/^from\s.*import/) ||
          line.match(/^class\s/) ||
          line.match(/^def\s/)
        ) {
          signatures.push(line.replace(/:$/, ""));
        }
      }
      break;
    }

    case "go": {
      // Extract imports, type defs, and func signatures
      for (const line of lines) {
        if (
          line.match(/^import\s/) ||
          line.match(/^type\s/) ||
          line.match(/^func\s/)
        ) {
          signatures.push(line.replace(/\{.*$/, ""));
        }
      }
      break;
    }

    default:
      return code;
  }

  return signatures.join("\n");
}

// ============================================================================
// Helper Functions
// ============================================================================

function getComments(
  code: string,
  sourceFile: ts.SourceFile
): Array<{ pos: number; end: number }> {
  const comments: Array<{ pos: number; end: number }> = [];

  // Get leading comments
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

function findNodeAt(sourceFile: ts.SourceFile, pos: number): ts.Node | null {
  let found: ts.Node | null = null;

  function visit(node: ts.Node) {
    if (node.getStart(sourceFile) === pos) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

function extractClassSignature(
  node: ts.ClassDeclaration,
  sourceFile: ts.SourceFile
): string {
  const className = node.name?.getText(sourceFile) || "Anonymous";
  const members: string[] = [];

  for (const member of node.members) {
    if (ts.isPropertyDeclaration(member)) {
      const name = member.name.getText(sourceFile);
      const type = member.type ? ": " + member.type.getText(sourceFile) : "";
      const modifiers = member.modifiers
        ? member.modifiers.map((m) => m.getText(sourceFile)).join(" ") + " "
        : "";
      members.push(`  ${modifiers}${name}${type};`);
    } else if (ts.isMethodDeclaration(member)) {
      const name = member.name.getText(sourceFile);
      const params = member.parameters
        .map((p) => p.getText(sourceFile))
        .join(", ");
      const returnType = member.type
        ? ": " + member.type.getText(sourceFile)
        : "";
      const modifiers = member.modifiers
        ? member.modifiers.map((m) => m.getText(sourceFile)).join(" ") + " "
        : "";
      members.push(`  ${modifiers}${name}(${params})${returnType};`);
    } else if (ts.isConstructorDeclaration(member)) {
      const params = member.parameters
        .map((p) => p.getText(sourceFile))
        .join(", ");
      members.push(`  constructor(${params});`);
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

  return `${classDecl} {\n${members.join("\n")}\n}`;
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
    linesRemoved + " lines removed",
    tokensSaved + " tokens saved (" + percentSaved + "%)",
  ].join(", ");
}

// Re-export types
export type { SqueezeTier, SqueezeResult, SqueezeOptions, SupportedLanguage };
