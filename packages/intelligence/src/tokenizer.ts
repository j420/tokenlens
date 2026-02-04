/**
 * Simple tokenizer for estimating token counts
 * Uses a rough approximation: ~4 characters per token for English text
 * For code, we use ~3 characters per token (more punctuation/symbols)
 */

const CODE_EXTENSIONS = new Set([
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".cs",
  ".php",
  ".swift",
  ".kt",
  ".scala",
  ".vue",
  ".svelte",
  ".css",
  ".scss",
  ".less",
  ".html",
  ".xml",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".md",
  ".sql",
  ".sh",
  ".bash",
  ".zsh",
]);

export function isCodeFile(filename: string): boolean {
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  return CODE_EXTENSIONS.has(ext);
}

export function estimateTokenCount(text: string, isCode = false): number {
  if (!text) return 0;
  // Rough approximation: code has more tokens per character due to punctuation
  const charsPerToken = isCode ? 3 : 4;
  return Math.ceil(text.length / charsPerToken);
}

export function tokenize(text: string): string[] {
  // Simple word tokenization for TF-IDF
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ") // Replace punctuation with spaces
    .split(/\s+/)
    .filter((word) => word.length > 1); // Filter out single characters
}

/**
 * Extract meaningful terms from code (function names, variable names, etc.)
 */
export function extractCodeTerms(code: string): string[] {
  const terms: string[] = [];

  // Extract identifiers (camelCase, snake_case, PascalCase)
  const identifierRegex = /[a-zA-Z_][a-zA-Z0-9_]*/g;
  const matches = code.match(identifierRegex) || [];

  for (const match of matches) {
    // Skip very common keywords
    if (isCommonKeyword(match)) continue;

    // Split camelCase and PascalCase
    const parts = match
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/_/g, " ")
      .toLowerCase()
      .split(/\s+/);

    terms.push(...parts.filter((p) => p.length > 2));
  }

  return terms;
}

const COMMON_KEYWORDS = new Set([
  "const",
  "let",
  "var",
  "function",
  "class",
  "return",
  "if",
  "else",
  "for",
  "while",
  "do",
  "switch",
  "case",
  "break",
  "continue",
  "try",
  "catch",
  "throw",
  "new",
  "this",
  "super",
  "import",
  "export",
  "default",
  "from",
  "async",
  "await",
  "true",
  "false",
  "null",
  "undefined",
  "void",
  "typeof",
  "instanceof",
  "in",
  "of",
  "public",
  "private",
  "protected",
  "static",
  "readonly",
  "abstract",
  "interface",
  "type",
  "enum",
  "extends",
  "implements",
  "def",
  "self",
  "None",
  "True",
  "False",
  "and",
  "or",
  "not",
  "is",
  "fn",
  "pub",
  "mut",
  "impl",
  "trait",
  "struct",
  "use",
  "mod",
  "crate",
  "func",
  "package",
  "type",
  "struct",
  "interface",
  "map",
  "slice",
  "chan",
  "go",
  "defer",
  "select",
]);

function isCommonKeyword(word: string): boolean {
  return COMMON_KEYWORDS.has(word.toLowerCase());
}
