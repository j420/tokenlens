/**
 * Comprehensive End-to-End Test for WASM Squeezer
 * Tests all languages and edge cases
 */

const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// ============================================================================
// Test Data
// ============================================================================

const PYTHON_CODE = `"""Sample Python module."""

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

const JAVASCRIPT_CODE = `/**
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

const TYPESCRIPT_CODE = `/**
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

// ============================================================================
// Helper Functions
// ============================================================================

function pathToWasmUrl(filePath) {
  const normalizedPath = path.resolve(filePath);
  if (process.platform === 'win32') {
    return pathToFileURL(normalizedPath).href;
  }
  return normalizedPath;
}

function hasParseError(node) {
  if (node.type === 'ERROR' || node.isMissing) return true;
  for (let i = 0; i < node.childCount; i++) {
    if (hasParseError(node.child(i))) return true;
  }
  return false;
}

// ============================================================================
// Squeeze Functions
// ============================================================================

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
      replacements.push({ startIndex: node.startIndex, endIndex: node.endIndex, replacement: '' });
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
      if (sibling.text.includes('critical')) return;
    }
    sibling = sibling.previousSibling;
  }

  const body = node.childForFieldName('body');
  if (!body || body.type !== 'block') return;

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
      inArgsSection = true; inReturnsSection = false; result.push(line); continue;
    }
    if (trimmed.startsWith('Returns:') || trimmed.startsWith('Return:')) {
      inArgsSection = false; inReturnsSection = true; result.push(line); continue;
    }
    if (trimmed.startsWith('Raises:') || trimmed.startsWith('Example:')) {
      inArgsSection = false; inReturnsSection = false; continue;
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
  if (['function_declaration', 'method_definition', 'function'].includes(node.type)) {
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
    if (!text.startsWith('/**') && !isTodoComment(text)) {
      replacements.push({ startIndex: node.startIndex, endIndex: node.endIndex, replacement: '' });
    }
    return;
  }
  for (let i = 0; i < node.childCount; i++) {
    processJSNode(node.child(i), code, replacements);
  }
}

function processJSFunction(node, code, replacements) {
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
  replacements.sort((a, b) => b.startIndex - a.startIndex);
  const filtered = [];
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
  return result.replace(/\n{3,}/g, '\n\n');
}

// ============================================================================
// Main Test Function
// ============================================================================

async function runTests() {
  console.log('='.repeat(70));
  console.log('COMPREHENSIVE WASM SQUEEZER TEST');
  console.log('='.repeat(70));
  console.log();

  const wasmDir = path.join(__dirname, 'wasm');
  console.log('Platform:', process.platform);
  console.log('WASM directory:', wasmDir);
  console.log('WASM URL:', pathToWasmUrl(wasmDir));
  console.log();

  // Check WASM files exist
  console.log('-'.repeat(70));
  console.log('TEST 0: WASM Files Verification');
  console.log('-'.repeat(70));

  const requiredFiles = [
    'web-tree-sitter.wasm',
    'tree-sitter.wasm',
    'tree-sitter-python.wasm',
    'tree-sitter-javascript.wasm',
    'tree-sitter-typescript.wasm'
  ];

  let allFilesExist = true;
  for (const file of requiredFiles) {
    const filePath = path.join(wasmDir, file);
    const exists = fs.existsSync(filePath);
    console.log(`  ${exists ? '✓' : '✗'} ${file}: ${exists ? 'Found' : 'MISSING'}`);
    if (!exists && !file.startsWith('tree-sitter.')) allFilesExist = false;
  }
  console.log();

  if (!allFilesExist) {
    console.error('ERROR: Required WASM files are missing!');
    process.exit(1);
  }

  try {
    // Load web-tree-sitter
    const TreeSitter = require('web-tree-sitter');
    console.log('-'.repeat(70));
    console.log('TEST 1: web-tree-sitter Module Loading');
    console.log('-'.repeat(70));
    console.log('  Module keys:', Object.keys(TreeSitter).join(', '));
    console.log('  Parser:', typeof TreeSitter.Parser);
    console.log('  Language:', typeof TreeSitter.Language);

    const Parser = TreeSitter.Parser;
    const Language = TreeSitter.Language;

    if (!Parser || !Language) {
      throw new Error('Parser or Language not found on web-tree-sitter module');
    }
    console.log('  ✓ Module loaded successfully');
    console.log();

    // Initialize Parser
    console.log('-'.repeat(70));
    console.log('TEST 2: Parser Initialization');
    console.log('-'.repeat(70));

    const mainWasmPath = path.join(wasmDir, 'web-tree-sitter.wasm');
    console.log('  WASM file:', mainWasmPath);
    console.log('  WASM URL:', pathToWasmUrl(mainWasmPath));

    await Parser.init({
      locateFile: (file, scriptDirectory) => {
        console.log(`  locateFile called: file="${file}", dir="${scriptDirectory}"`);
        const result = pathToWasmUrl(path.join(wasmDir, file));
        console.log(`  Returning: ${result}`);
        return result;
      }
    });
    console.log('  ✓ Parser initialized successfully');
    console.log();

    // Test Python
    console.log('-'.repeat(70));
    console.log('TEST 3: Python Code Squeezing');
    console.log('-'.repeat(70));

    const pythonWasmPath = path.join(wasmDir, 'tree-sitter-python.wasm');
    console.log('  Loading:', pythonWasmPath);
    const pythonLang = await Language.load(pathToWasmUrl(pythonWasmPath));
    console.log('  ✓ Python language loaded');

    const pythonParser = new Parser();
    pythonParser.setLanguage(pythonLang);
    console.log('  ✓ Parser configured for Python');

    const pythonTree = pythonParser.parse(PYTHON_CODE);
    console.log('  ✓ Python code parsed');

    const pythonSqueezed = squeezePython(PYTHON_CODE, pythonTree);
    console.log('  ✓ Python code squeezed');

    const pythonValid = !hasParseError(pythonParser.parse(pythonSqueezed).rootNode);
    const pythonSavings = ((1 - pythonSqueezed.length / PYTHON_CODE.length) * 100).toFixed(1);

    console.log();
    console.log('  Original:', PYTHON_CODE.length, 'chars');
    console.log('  Squeezed:', pythonSqueezed.length, 'chars');
    console.log('  Savings:', pythonSavings + '%');
    console.log('  Valid syntax:', pythonValid);
    console.log();

    pythonParser.delete();

    // Test JavaScript
    console.log('-'.repeat(70));
    console.log('TEST 4: JavaScript Code Squeezing');
    console.log('-'.repeat(70));

    const jsWasmPath = path.join(wasmDir, 'tree-sitter-javascript.wasm');
    const jsLang = await Language.load(pathToWasmUrl(jsWasmPath));
    console.log('  ✓ JavaScript language loaded');

    const jsParser = new Parser();
    jsParser.setLanguage(jsLang);

    const jsTree = jsParser.parse(JAVASCRIPT_CODE);
    const jsSqueezed = squeezeJavaScript(JAVASCRIPT_CODE, jsTree);
    const jsValid = !hasParseError(jsParser.parse(jsSqueezed).rootNode);
    const jsSavings = ((1 - jsSqueezed.length / JAVASCRIPT_CODE.length) * 100).toFixed(1);

    console.log('  Original:', JAVASCRIPT_CODE.length, 'chars');
    console.log('  Squeezed:', jsSqueezed.length, 'chars');
    console.log('  Savings:', jsSavings + '%');
    console.log('  Valid syntax:', jsValid);
    console.log();

    jsParser.delete();

    // Test TypeScript
    console.log('-'.repeat(70));
    console.log('TEST 5: TypeScript Code Squeezing');
    console.log('-'.repeat(70));

    const tsWasmPath = path.join(wasmDir, 'tree-sitter-typescript.wasm');
    const tsLang = await Language.load(pathToWasmUrl(tsWasmPath));
    console.log('  ✓ TypeScript language loaded');

    const tsParser = new Parser();
    tsParser.setLanguage(tsLang);

    const tsTree = tsParser.parse(TYPESCRIPT_CODE);
    const tsSqueezed = squeezeJavaScript(TYPESCRIPT_CODE, tsTree);
    const tsValid = !hasParseError(tsParser.parse(tsSqueezed).rootNode);
    const tsSavings = ((1 - tsSqueezed.length / TYPESCRIPT_CODE.length) * 100).toFixed(1);

    console.log('  Original:', TYPESCRIPT_CODE.length, 'chars');
    console.log('  Squeezed:', tsSqueezed.length, 'chars');
    console.log('  Savings:', tsSavings + '%');
    console.log('  Valid syntax:', tsValid);
    console.log();

    tsParser.delete();

    // Summary
    console.log('='.repeat(70));
    console.log('TEST SUMMARY');
    console.log('='.repeat(70));
    console.log();
    console.log('  Python:     ', pythonValid ? '✓ PASS' : '✗ FAIL', `(${pythonSavings}% savings)`);
    console.log('  JavaScript: ', jsValid ? '✓ PASS' : '✗ FAIL', `(${jsSavings}% savings)`);
    console.log('  TypeScript: ', tsValid ? '✓ PASS' : '✗ FAIL', `(${tsSavings}% savings)`);
    console.log();

    if (pythonValid && jsValid && tsValid) {
      console.log('ALL TESTS PASSED! ✓');
      console.log();
      console.log('--- SAMPLE OUTPUT (JavaScript) ---');
      console.log(jsSqueezed);
      console.log('--- END SAMPLE OUTPUT ---');
      process.exit(0);
    } else {
      console.log('SOME TESTS FAILED! ✗');
      process.exit(1);
    }

  } catch (error) {
    console.error();
    console.error('='.repeat(70));
    console.error('TEST FAILED WITH ERROR');
    console.error('='.repeat(70));
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

runTests();
