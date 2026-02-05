/**
 * Test script for WASM-based Telegraphic Squeezer (CommonJS)
 */

const path = require('path');

const PYTHON_CODE = `
"""Sample Python module."""

import os
from typing import Optional, List

API_KEY = "secret_key_123"
MAX_RETRIES = 3

class UserService:
    """Service for managing users.

    Args:
        db_connection: Database connection string

    Returns:
        UserService instance
    """

    def __init__(self, db_connection: str):
        """Initialize the service."""
        self.db = db_connection
        self.cache = {}
        self._setup_logging()

    def get_user(self, user_id: int) -> Optional[dict]:
        """Fetch a user by ID.

        Args:
            user_id: The unique identifier

        Returns:
            User dictionary or None
        """
        if user_id in self.cache:
            return self.cache[user_id]
        query = f"SELECT * FROM users WHERE id = {user_id}"
        result = self.db.execute(query)
        return result

    @critical
    def delete_user(self, user_id: int) -> bool:
        """Delete a user - critical function."""
        self.db.execute(f"DELETE FROM users WHERE id = {user_id}")
        return True


def process_data(items: List[str]) -> List[str]:
    """Process items.

    Args:
        items: List of strings

    Returns:
        Processed list
    """
    result = []
    for item in items:
        result.append(item.strip())
    return result
`;

const JAVASCRIPT_CODE = `
/**
 * Sample JavaScript module.
 */

const API_URL = 'https://api.example.com';
const MAX_CONNECTIONS = 10;

/**
 * UserManager class.
 * @param {Object} config - Configuration
 */
class UserManager {
  constructor(config) {
    this.apiKey = config.apiKey;
    this.timeout = config.timeout || 5000;
    this.cache = new Map();
  }

  /**
   * Fetch a user by ID.
   * @param {number} userId - The user's ID
   * @returns {Promise<Object>} The user
   */
  async getUser(userId) {
    if (this.cache.has(userId)) {
      return this.cache.get(userId);
    }
    const response = await fetch(\`\${API_URL}/users/\${userId}\`);
    const user = await response.json();
    this.cache.set(userId, user);
    return user;
  }
}

const processItems = (items) => {
  return items.map(item => item.trim());
};

function calculateTotal(items) {
  let total = 0;
  for (const item of items) {
    total += item.price;
  }
  return total;
}

export { UserManager, processItems, calculateTotal };
`;

const TYPESCRIPT_CODE = `
/**
 * Sample TypeScript module.
 */

interface User {
  id: number;
  name: string;
  email: string;
}

interface Config {
  apiUrl: string;
  apiKey: string;
}

const DEFAULT_TIMEOUT = 5000;

class UserService {
  private config: Config;
  private cache: Map<number, User>;

  constructor(config: Config) {
    this.config = config;
    this.cache = new Map();
  }

  async getUser(userId: number): Promise<User | undefined> {
    if (this.cache.has(userId)) {
      return this.cache.get(userId);
    }
    const response = await fetch(\`\${this.config.apiUrl}/users/\${userId}\`);
    const user = await response.json();
    this.cache.set(userId, user);
    return user;
  }
}

const validateEmail = (email: string): boolean => {
  return email.includes('@');
};

export { UserService, User, Config, validateEmail };
`;

async function runTests() {
  console.log('='.repeat(70));
  console.log('WASM Squeezer Comprehensive Test Suite');
  console.log('='.repeat(70));
  console.log();

  const wasmDir = path.join(__dirname, 'wasm');
  console.log('WASM directory:', wasmDir);
  console.log();

  try {
    // Load web-tree-sitter
    const TreeSitter = require('web-tree-sitter');
    const Parser = TreeSitter.Parser;
    const Language = TreeSitter.Language;

    console.log('Initializing Parser...');
    await Parser.init({
      locateFile: (file) => path.join(wasmDir, file)
    });
    console.log('✓ Parser initialized');
    console.log();

    // =========================================================================
    // TEST 1: Python
    // =========================================================================
    console.log('-'.repeat(70));
    console.log('TEST 1: Python Code');
    console.log('-'.repeat(70));

    const pythonLang = await Language.load(path.join(wasmDir, 'tree-sitter-python.wasm'));
    const pythonParser = new Parser();
    pythonParser.setLanguage(pythonLang);

    const pythonTree = pythonParser.parse(PYTHON_CODE);
    console.log('✓ Parsed Python code');

    // Squeeze Python
    const pythonSqueezed = squeezePython(PYTHON_CODE, pythonTree);
    console.log();
    console.log('ORIGINAL Python length:', PYTHON_CODE.length, 'chars');
    console.log('SQUEEZED Python length:', pythonSqueezed.length, 'chars');
    console.log('Savings:', ((1 - pythonSqueezed.length / PYTHON_CODE.length) * 100).toFixed(1) + '%');
    console.log();
    console.log('--- SQUEEZED PYTHON OUTPUT ---');
    console.log(pythonSqueezed);
    console.log('--- END PYTHON OUTPUT ---');
    console.log();

    // Validate the squeezed output parses correctly
    const pythonValidTree = pythonParser.parse(pythonSqueezed);
    const pythonHasError = hasParseError(pythonValidTree.rootNode);
    console.log('✓ Squeezed Python is valid syntax:', !pythonHasError);
    console.log();

    pythonParser.delete();

    // =========================================================================
    // TEST 2: JavaScript
    // =========================================================================
    console.log('-'.repeat(70));
    console.log('TEST 2: JavaScript Code');
    console.log('-'.repeat(70));

    const jsLang = await Language.load(path.join(wasmDir, 'tree-sitter-javascript.wasm'));
    const jsParser = new Parser();
    jsParser.setLanguage(jsLang);

    const jsTree = jsParser.parse(JAVASCRIPT_CODE);
    console.log('✓ Parsed JavaScript code');

    // Squeeze JavaScript
    const jsSqueezed = squeezeJavaScript(JAVASCRIPT_CODE, jsTree);
    console.log();
    console.log('ORIGINAL JS length:', JAVASCRIPT_CODE.length, 'chars');
    console.log('SQUEEZED JS length:', jsSqueezed.length, 'chars');
    console.log('Savings:', ((1 - jsSqueezed.length / JAVASCRIPT_CODE.length) * 100).toFixed(1) + '%');
    console.log();
    console.log('--- SQUEEZED JAVASCRIPT OUTPUT ---');
    console.log(jsSqueezed);
    console.log('--- END JAVASCRIPT OUTPUT ---');
    console.log();

    // Validate
    const jsValidTree = jsParser.parse(jsSqueezed);
    const jsHasError = hasParseError(jsValidTree.rootNode);
    console.log('✓ Squeezed JavaScript is valid syntax:', !jsHasError);
    console.log();

    jsParser.delete();

    // =========================================================================
    // TEST 3: TypeScript
    // =========================================================================
    console.log('-'.repeat(70));
    console.log('TEST 3: TypeScript Code');
    console.log('-'.repeat(70));

    const tsLang = await Language.load(path.join(wasmDir, 'tree-sitter-typescript.wasm'));
    const tsParser = new Parser();
    tsParser.setLanguage(tsLang);

    const tsTree = tsParser.parse(TYPESCRIPT_CODE);
    console.log('✓ Parsed TypeScript code');

    // Squeeze TypeScript
    const tsSqueezed = squeezeJavaScript(TYPESCRIPT_CODE, tsTree);
    console.log();
    console.log('ORIGINAL TS length:', TYPESCRIPT_CODE.length, 'chars');
    console.log('SQUEEZED TS length:', tsSqueezed.length, 'chars');
    console.log('Savings:', ((1 - tsSqueezed.length / TYPESCRIPT_CODE.length) * 100).toFixed(1) + '%');
    console.log();
    console.log('--- SQUEEZED TYPESCRIPT OUTPUT ---');
    console.log(tsSqueezed);
    console.log('--- END TYPESCRIPT OUTPUT ---');
    console.log();

    // Validate
    const tsValidTree = tsParser.parse(tsSqueezed);
    const tsHasError = hasParseError(tsValidTree.rootNode);
    console.log('✓ Squeezed TypeScript is valid syntax:', !tsHasError);
    console.log();

    tsParser.delete();

    // =========================================================================
    // Summary
    // =========================================================================
    console.log('='.repeat(70));
    console.log('TEST SUMMARY');
    console.log('='.repeat(70));
    console.log('Python:     ✓ Parsed, ✓ Squeezed, Valid:', !pythonHasError);
    console.log('JavaScript: ✓ Parsed, ✓ Squeezed, Valid:', !jsHasError);
    console.log('TypeScript: ✓ Parsed, ✓ Squeezed, Valid:', !tsHasError);
    console.log();
    console.log('All tests completed!');

  } catch (error) {
    console.error('✗ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// ============================================================================
// Squeeze Functions (simplified versions for testing)
// ============================================================================

function hasParseError(node) {
  if (node.type === 'ERROR' || node.isMissing) return true;
  for (let i = 0; i < node.childCount; i++) {
    if (hasParseError(node.child(i))) return true;
  }
  return false;
}

function squeezePython(code, tree) {
  const replacements = [];
  processPythonNode(tree.rootNode, code, replacements);
  return applyReplacements(code, replacements);
}

function processPythonNode(node, code, replacements) {
  if (node.type === 'function_definition') {
    processPythonFunction(node, code, replacements);
    return;
  }
  if (node.type === 'class_definition') {
    processPythonClass(node, code, replacements);
    return;
  }
  if (node.type === 'comment') {
    const text = node.text;
    if (!isTodoComment(text)) {
      replacements.push({
        startIndex: node.startIndex,
        endIndex: node.endIndex,
        replacement: ''
      });
    }
    return;
  }

  for (let i = 0; i < node.childCount; i++) {
    processPythonNode(node.child(i), code, replacements);
  }
}

function processPythonFunction(node, code, replacements) {
  // Check for @critical decorator
  let sibling = node.previousSibling;
  while (sibling) {
    if (sibling.type === 'decorator') {
      const decoratorName = sibling.text.replace('@', '').split('(')[0];
      if (decoratorName === 'critical') {
        return; // Preserve entire function
      }
    }
    sibling = sibling.previousSibling;
  }

  // Find the body
  const body = node.childForFieldName('body');
  if (!body || body.type !== 'block') return;

  // Extract and compress docstring
  let newBody = '...';
  const firstChild = body.child(0);
  if (firstChild && firstChild.type === 'expression_statement') {
    const expr = firstChild.child(0);
    if (expr && expr.type === 'string') {
      const docstring = compressDocstring(expr.text);
      if (docstring) {
        newBody = docstring + '\n        ...';
      }
    }
  }

  // Get indentation
  const funcLine = code.slice(0, node.startIndex).split('\n').pop() || '';
  const baseIndent = (funcLine.match(/^(\s*)/) || ['', ''])[1];
  const bodyIndent = baseIndent + '    ';

  replacements.push({
    startIndex: body.startIndex,
    endIndex: body.endIndex,
    replacement: '\n' + bodyIndent + newBody
  });
}

function processPythonClass(node, code, replacements) {
  const body = node.childForFieldName('body');
  if (!body || body.type !== 'block') return;

  for (let i = 0; i < body.childCount; i++) {
    const child = body.child(i);
    if (child.type === 'function_definition') {
      processPythonFunction(child, code, replacements);
    }
  }
}

function compressDocstring(docstring) {
  let content = docstring;
  if (content.startsWith('"""') || content.startsWith("'''")) {
    content = content.slice(3, -3);
  }

  const lines = content.split('\n');
  const result = [];
  let inArgsSection = false;
  let inReturnsSection = false;
  let foundSummary = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('Args:') || trimmed.startsWith('Arguments:')) {
      inArgsSection = true;
      inReturnsSection = false;
      result.push(line);
      continue;
    }
    if (trimmed.startsWith('Returns:') || trimmed.startsWith('Return:')) {
      inArgsSection = false;
      inReturnsSection = true;
      result.push(line);
      continue;
    }
    if (trimmed.startsWith('Raises:') || trimmed.startsWith('Example:')) {
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

  if (result.length === 0) return '';
  return '"""' + result.join('\n').trim() + '"""';
}

function squeezeJavaScript(code, tree) {
  const replacements = [];
  processJSNode(tree.rootNode, code, replacements);
  return applyReplacements(code, replacements);
}

function processJSNode(node, code, replacements) {
  if (node.type === 'function_declaration' || node.type === 'method_definition' || node.type === 'function') {
    processJSFunction(node, code, replacements);
    return;
  }
  if (node.type === 'arrow_function') {
    processJSArrowFunction(node, code, replacements);
    return;
  }
  if (node.type === 'class_declaration') {
    processJSClass(node, code, replacements);
    return;
  }
  if (node.type === 'comment') {
    const text = node.text;
    // Keep JSDoc and TODO comments
    if (!text.startsWith('/**') && !isTodoComment(text)) {
      replacements.push({
        startIndex: node.startIndex,
        endIndex: node.endIndex,
        replacement: ''
      });
    }
    return;
  }

  for (let i = 0; i < node.childCount; i++) {
    processJSNode(node.child(i), code, replacements);
  }
}

function processJSFunction(node, code, replacements) {
  // Find the body
  let body = null;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && child.type === 'statement_block') {
      body = child;
      break;
    }
  }
  if (!body) return;

  replacements.push({
    startIndex: body.startIndex,
    endIndex: body.endIndex,
    replacement: '{ /* ... */ }'
  });
}

function processJSArrowFunction(node, code, replacements) {
  const body = node.childForFieldName('body');
  if (!body) return;

  if (body.type === 'statement_block') {
    replacements.push({
      startIndex: body.startIndex,
      endIndex: body.endIndex,
      replacement: '{ /* ... */ }'
    });
  }
}

function processJSClass(node, code, replacements) {
  let body = null;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && child.type === 'class_body') {
      body = child;
      break;
    }
  }
  if (!body) return;

  for (let i = 0; i < body.childCount; i++) {
    const child = body.child(i);
    if (child.type === 'method_definition') {
      processJSFunction(child, code, replacements);
    }
  }
}

function isTodoComment(text) {
  const upper = text.toUpperCase();
  return upper.includes('TODO') || upper.includes('FIXME') || upper.includes('NOTE:');
}

function applyReplacements(code, replacements) {
  // Sort by start index descending
  replacements.sort((a, b) => b.startIndex - a.startIndex);

  // Remove overlapping
  const filtered = [];
  let lastStart = code.length;
  for (const r of replacements) {
    if (r.endIndex <= lastStart) {
      filtered.push(r);
      lastStart = r.startIndex;
    }
  }

  // Apply
  let result = code;
  for (const r of filtered) {
    result = result.slice(0, r.startIndex) + r.replacement + result.slice(r.endIndex);
  }

  // Clean up multiple blank lines
  result = result.replace(/\n{3,}/g, '\n\n');

  return result;
}

runTests();
