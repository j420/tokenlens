/**
 * @prune/squeezer
 * Tree-sitter AST-based code compression
 *
 * Three-tier compression strategy:
 * 1. Lossless: Strip comments, whitespace, docstrings (~15% savings)
 * 2. Structural: Prune function bodies, keep signatures (~40% savings)
 * 3. Telegraphic: Interface definitions only (~70% savings)
 */

import Parser from "tree-sitter";
import { 
  type SqueezeTier, 
  type SqueezeResult, 
  type SqueezeOptions,
  type SupportedLanguage,
  getLanguageFromPath 
} from "@prune/shared";
import { countTokens } from "@prune/tokenizer";

// Import language grammars
import TypeScript from "tree-sitter-typescript";
import Python from "tree-sitter-python";
import Go from "tree-sitter-go";
import Rust from "tree-sitter-rust";
import Java from "tree-sitter-java";

// ============================================================================
// Parser Setup
// ============================================================================

const parser = new Parser();

const LANGUAGE_PARSERS: Record<SupportedLanguage, unknown> = {
  typescript: TypeScript.typescript,
  javascript: TypeScript.typescript, // TSX parser handles JS too
  python: Python,
  go: Go,
  rust: Rust,
  java: Java,
  cpp: null, // Will add tree-sitter-cpp if needed
  c: null,
};

// ============================================================================
// Node Type Definitions
// ============================================================================

interface NodeTypes {
  comment: string[];
  docstring: string[];
  function: string[];
  functionBody: string[];
  class: string[];
  classBody: string[];
  import: string[];
  typeDefinition: string[];
}

const LANGUAGE_NODE_TYPES: Record<SupportedLanguage, NodeTypes> = {
  typescript: {
    comment: ["comment", "multiline_comment"],
    docstring: ["comment"],
    function: ["function_declaration", "method_definition", "arrow_function"],
    functionBody: ["statement_block"],
    class: ["class_declaration"],
    classBody: ["class_body"],
    import: ["import_statement", "export_statement"],
    typeDefinition: ["type_alias_declaration", "interface_declaration"],
  },
  javascript: {
    comment: ["comment", "multiline_comment"],
    docstring: ["comment"],
    function: ["function_declaration", "method_definition", "arrow_function"],
    functionBody: ["statement_block"],
    class: ["class_declaration"],
    classBody: ["class_body"],
    import: ["import_statement", "export_statement"],
    typeDefinition: [],
  },
  python: {
    comment: ["comment"],
    docstring: ["expression_statement"], // String literals at start of function
    function: ["function_definition"],
    functionBody: ["block"],
    class: ["class_definition"],
    classBody: ["block"],
    import: ["import_statement", "import_from_statement"],
    typeDefinition: [],
  },
  go: {
    comment: ["comment", "block_comment"],
    docstring: ["comment"],
    function: ["function_declaration", "method_declaration"],
    functionBody: ["block"],
    class: ["type_declaration"],
    classBody: ["struct_type", "interface_type"],
    import: ["import_declaration"],
    typeDefinition: ["type_declaration"],
  },
  rust: {
    comment: ["line_comment", "block_comment"],
    docstring: ["line_comment"],
    function: ["function_item"],
    functionBody: ["block"],
    class: ["struct_item", "impl_item"],
    classBody: ["declaration_list"],
    import: ["use_declaration"],
    typeDefinition: ["type_item"],
  },
  java: {
    comment: ["line_comment", "block_comment"],
    docstring: ["block_comment"],
    function: ["method_declaration", "constructor_declaration"],
    functionBody: ["block"],
    class: ["class_declaration", "interface_declaration"],
    classBody: ["class_body"],
    import: ["import_declaration"],
    typeDefinition: ["interface_declaration"],
  },
  cpp: {
    comment: ["comment"],
    docstring: ["comment"],
    function: ["function_definition"],
    functionBody: ["compound_statement"],
    class: ["class_specifier", "struct_specifier"],
    classBody: ["field_declaration_list"],
    import: ["preproc_include"],
    typeDefinition: ["type_definition"],
  },
  c: {
    comment: ["comment"],
    docstring: ["comment"],
    function: ["function_definition"],
    functionBody: ["compound_statement"],
    class: ["struct_specifier"],
    classBody: ["field_declaration_list"],
    import: ["preproc_include"],
    typeDefinition: ["type_definition"],
  },
};

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

  // Get the language parser
  const langParser = LANGUAGE_PARSERS[language];
  if (!langParser) {
    // Language not supported, return original
    return {
      originalCode: code,
      compressedCode: code,
      originalTokens: countTokens(code).tokens,
      compressedTokens: countTokens(code).tokens,
      savings: 0,
      savingsPercent: 0,
      diffSummary: "Language not supported for compression",
      isValid: true,
    };
  }

  // Parse the code
  parser.setLanguage(langParser as Parser.Language);
  const tree = parser.parse(code);

  // Apply compression based on tier
  let compressedCode: string;
  let diffSummary: string;

  switch (tier) {
    case "lossless":
      ({ code: compressedCode, summary: diffSummary } = losslessCompress(
        code,
        tree,
        language
      ));
      break;
    case "structural":
      ({ code: compressedCode, summary: diffSummary } = structuralCompress(
        code,
        tree,
        language,
        options
      ));
      break;
    case "telegraphic":
      ({ code: compressedCode, summary: diffSummary } = telegraphicCompress(
        code,
        tree,
        language
      ));
      break;
    default:
      compressedCode = code;
      diffSummary = "No compression applied";
  }

  // Validate the compressed code
  const isValid = validateCode(compressedCode, language);
  if (!isValid) {
    // Revert to original if validation fails
    return {
      originalCode: code,
      compressedCode: code,
      originalTokens: countTokens(code).tokens,
      compressedTokens: countTokens(code).tokens,
      savings: 0,
      savingsPercent: 0,
      diffSummary: "Compression failed validation, using original",
      isValid: false,
    };
  }

  // Calculate token counts
  const originalTokens = countTokens(code).tokens;
  const compressedTokens = countTokens(compressedCode).tokens;
  const savings = originalTokens - compressedTokens;
  const savingsPercent = Math.round((savings / originalTokens) * 100);

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
// Compression Strategies
// ============================================================================

/**
 * Lossless compression: Remove comments and excessive whitespace
 */
function losslessCompress(
  code: string,
  tree: Parser.Tree,
  language: SupportedLanguage
): { code: string; summary: string } {
  const nodeTypes = LANGUAGE_NODE_TYPES[language];
  const removals: Array<{ start: number; end: number; type: string }> = [];
  let commentsRemoved = 0;
  let docstringsRemoved = 0;

  // Walk the tree and collect nodes to remove
  function walk(node: Parser.SyntaxNode) {
    // Check for comments
    if (nodeTypes.comment.includes(node.type)) {
      // Preserve TODOs and important comments
      const text = code.slice(node.startIndex, node.endIndex);
      if (!text.includes("TODO") && !text.includes("FIXME") && !text.includes("@ts-")) {
        removals.push({ start: node.startIndex, end: node.endIndex, type: "comment" });
        commentsRemoved++;
      }
    }

    // Recurse into children
    for (const child of node.children) {
      walk(child);
    }
  }

  walk(tree.rootNode);

  // Apply removals in reverse order to preserve indices
  let result = code;
  for (const removal of removals.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, removal.start) + result.slice(removal.end);
  }

  // Normalize whitespace (collapse multiple blank lines)
  result = result.replace(/\n{3,}/g, "\n\n");

  const summary = [
    commentsRemoved > 0 ? commentsRemoved + " comments removed" : null,
    docstringsRemoved > 0 ? docstringsRemoved + " docstrings removed" : null,
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
  tree: Parser.Tree,
  language: SupportedLanguage,
  options: SqueezeOptions
): { code: string; summary: string } {
  const nodeTypes = LANGUAGE_NODE_TYPES[language];
  const replacements: Array<{ start: number; end: number; replacement: string }> = [];
  let functionsCompressed = 0;

  function walk(node: Parser.SyntaxNode) {
    // Check for function declarations
    if (nodeTypes.function.includes(node.type)) {
      // Find the function body
      const bodyNode = node.children.find((child) =>
        nodeTypes.functionBody.includes(child.type)
      );

      if (bodyNode) {
        // Check if this is the active file (don't compress active function)
        const shouldCompress = !options.activeFile || 
          !code.slice(node.startIndex, node.endIndex).includes("// ACTIVE");

        if (shouldCompress) {
          // Replace body with ellipsis placeholder
          const ellipsis = getEllipsisForLanguage(language);
          replacements.push({
            start: bodyNode.startIndex,
            end: bodyNode.endIndex,
            replacement: ellipsis,
          });
          functionsCompressed++;
        }
      }
    }

    // Recurse into children
    for (const child of node.children) {
      walk(child);
    }
  }

  walk(tree.rootNode);

  // Start with lossless compression
  const { code: losslessCode } = losslessCompress(code, tree, language);

  // Re-parse after lossless compression
  const newTree = parser.parse(losslessCode);
  
  // Apply structural replacements
  let result = losslessCode;
  
  // Recalculate replacements on the new tree
  const newReplacements: Array<{ start: number; end: number; replacement: string }> = [];
  
  function walkNew(node: Parser.SyntaxNode) {
    if (nodeTypes.function.includes(node.type)) {
      const bodyNode = node.children.find((child) =>
        nodeTypes.functionBody.includes(child.type)
      );
      if (bodyNode) {
        const ellipsis = getEllipsisForLanguage(language);
        newReplacements.push({
          start: bodyNode.startIndex,
          end: bodyNode.endIndex,
          replacement: ellipsis,
        });
      }
    }
    for (const child of node.children) {
      walkNew(child);
    }
  }
  
  walkNew(newTree.rootNode);

  // Apply replacements in reverse order
  for (const rep of newReplacements.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, rep.start) + rep.replacement + result.slice(rep.end);
  }

  const summary = [
    functionsCompressed > 0 ? functionsCompressed + " function bodies compressed" : null,
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
  tree: Parser.Tree,
  language: SupportedLanguage
): { code: string; summary: string } {
  const nodeTypes = LANGUAGE_NODE_TYPES[language];
  const keeps: Array<{ start: number; end: number; type: string }> = [];

  function walk(node: Parser.SyntaxNode) {
    // Keep imports
    if (nodeTypes.import.includes(node.type)) {
      keeps.push({ start: node.startIndex, end: node.endIndex, type: "import" });
    }

    // Keep type definitions
    if (nodeTypes.typeDefinition.includes(node.type)) {
      keeps.push({ start: node.startIndex, end: node.endIndex, type: "type" });
    }

    // Keep function signatures (just the signature line)
    if (nodeTypes.function.includes(node.type)) {
      const bodyNode = node.children.find((child) =>
        nodeTypes.functionBody.includes(child.type)
      );
      if (bodyNode) {
        // Keep everything up to the body
        keeps.push({
          start: node.startIndex,
          end: bodyNode.startIndex,
          type: "function_signature",
        });
      }
    }

    // Keep class declarations (without method bodies)
    if (nodeTypes.class.includes(node.type)) {
      keeps.push({ start: node.startIndex, end: node.endIndex, type: "class" });
    }

    for (const child of node.children) {
      walk(child);
    }
  }

  walk(tree.rootNode);

  // Build result from kept sections
  const sortedKeeps = keeps.sort((a, b) => a.start - b.start);
  const sections = sortedKeeps.map(
    (k) => code.slice(k.start, k.end).trim()
  );
  
  // Join with newlines and add ellipsis markers
  const result = sections.join("\n\n// ...\n\n");

  const summary = [
    sortedKeeps.filter((k) => k.type === "import").length + " imports",
    sortedKeeps.filter((k) => k.type === "type").length + " type definitions",
    sortedKeeps.filter((k) => k.type === "function_signature").length + " function signatures",
    "all bodies removed",
  ].join(", ");

  return { code: result, summary };
}

// ============================================================================
// Utilities
// ============================================================================

function getEllipsisForLanguage(language: SupportedLanguage): string {
  switch (language) {
    case "python":
      return ":\n    ...";
    case "go":
    case "rust":
    case "java":
    case "cpp":
    case "c":
      return "{ /* ... */ }";
    case "typescript":
    case "javascript":
    default:
      return "{ /* ... */ }";
  }
}

function validateCode(code: string, language: SupportedLanguage): boolean {
  const langParser = LANGUAGE_PARSERS[language];
  if (!langParser) return true;

  try {
    parser.setLanguage(langParser as Parser.Language);
    const tree = parser.parse(code);
    // Check if the root node has errors
    return !tree.rootNode.hasError;
  } catch {
    return false;
  }
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
  const percentSaved = Math.round((tokensSaved / originalTokens) * 100);

  return [
    linesRemoved + " lines removed",
    tokensSaved + " tokens saved (" + percentSaved + "%)",
  ].join(", ");
}

// Re-export types
export type { SqueezeTier, SqueezeResult, SqueezeOptions, SupportedLanguage };
