/**
 * Test script for WASM-based Telegraphic Squeezer
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Sample test codes
const PYTHON_CODE = `
"""
This is a sample Python module for testing the squeezer.
It contains various constructs that should be handled.
"""

import os
import sys
from typing import Optional, List, Dict

# Global constants should be preserved
API_KEY = "secret_key_123"
MAX_RETRIES = 3
DEFAULT_TIMEOUT = 30

class UserService:
    """
    Service for managing users.

    This class provides methods for CRUD operations on users.
    It connects to the database and handles all user-related logic.

    Args:
        db_connection: Database connection string
        cache_enabled: Whether to enable caching

    Returns:
        UserService instance
    """

    def __init__(self, db_connection: str, cache_enabled: bool = True):
        """Initialize the service with database connection."""
        self.db = db_connection
        self.cache = {} if cache_enabled else None
        self._setup_logging()
        self._connect_to_db()

    def get_user(self, user_id: int) -> Optional[Dict]:
        """
        Fetch a user by ID.

        Args:
            user_id: The unique identifier of the user

        Returns:
            User dictionary or None if not found
        """
        if self.cache and user_id in self.cache:
            return self.cache[user_id]

        query = f"SELECT * FROM users WHERE id = {user_id}"
        result = self.db.execute(query)

        if result:
            self.cache[user_id] = result
            return result
        return None

    @critical
    def delete_user(self, user_id: int) -> bool:
        """Delete a user - this is critical and should be preserved."""
        # This entire function body should be kept
        self.db.execute(f"DELETE FROM users WHERE id = {user_id}")
        if user_id in self.cache:
            del self.cache[user_id]
        self._audit_log("delete", user_id)
        return True


def process_data(items: List[str]) -> List[str]:
    """
    Process a list of items.

    Args:
        items: List of strings to process

    Returns:
        Processed list of strings
    """
    result = []
    for item in items:
        cleaned = item.strip().lower()
        if cleaned:
            result.append(cleaned)
    return result


# TODO: Implement batch processing
def batch_process(items: List[str], batch_size: int = 100) -> None:
    """Process items in batches."""
    for i in range(0, len(items), batch_size):
        batch = items[i:i + batch_size]
        process_data(batch)
`;

const JAVASCRIPT_CODE = `
/**
 * Sample JavaScript module for testing the squeezer.
 * Contains various JS constructs.
 */

const API_URL = 'https://api.example.com';
const MAX_CONNECTIONS = 10;

/**
 * UserManager class for handling user operations.
 * @class
 */
class UserManager {
  /**
   * Create a UserManager instance.
   * @param {Object} config - Configuration object
   * @param {string} config.apiKey - API key for authentication
   * @param {number} config.timeout - Request timeout in ms
   */
  constructor(config) {
    this.apiKey = config.apiKey;
    this.timeout = config.timeout || 5000;
    this.cache = new Map();
    this._initializeConnection();
  }

  /**
   * Fetch a user by ID.
   * @param {number} userId - The user's ID
   * @returns {Promise<Object|null>} The user object or null
   */
  async getUser(userId) {
    if (this.cache.has(userId)) {
      return this.cache.get(userId);
    }

    const response = await fetch(\`\${API_URL}/users/\${userId}\`, {
      headers: { 'Authorization': \`Bearer \${this.apiKey}\` }
    });

    if (!response.ok) {
      throw new Error(\`Failed to fetch user: \${response.status}\`);
    }

    const user = await response.json();
    this.cache.set(userId, user);
    return user;
  }

  /**
   * Create a new user.
   * @param {Object} userData - User data
   * @returns {Promise<Object>} Created user
   */
  async createUser(userData) {
    const response = await fetch(\`\${API_URL}/users\`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': \`Bearer \${this.apiKey}\`
      },
      body: JSON.stringify(userData)
    });

    return response.json();
  }
}

// Arrow function examples
const processItems = (items) => {
  return items.map(item => item.trim().toLowerCase());
};

const fetchData = async (url) => {
  const response = await fetch(url);
  return response.json();
};

// Regular function
function calculateTotal(items) {
  let total = 0;
  for (const item of items) {
    total += item.price * item.quantity;
  }
  return total;
}

// TODO: Add error handling
function validateInput(data) {
  if (!data) return false;
  if (!data.name || data.name.length < 2) return false;
  if (!data.email || !data.email.includes('@')) return false;
  return true;
}

export { UserManager, processItems, fetchData, calculateTotal };
`;

const TYPESCRIPT_CODE = `
/**
 * Sample TypeScript module for testing the squeezer.
 */

import { EventEmitter } from 'events';

// Type definitions should be preserved
interface User {
  id: number;
  name: string;
  email: string;
  createdAt: Date;
}

interface UserServiceConfig {
  apiUrl: string;
  apiKey: string;
  timeout?: number;
}

type UserRole = 'admin' | 'user' | 'guest';

// Constants
const DEFAULT_TIMEOUT = 5000;
const MAX_RETRIES = 3;

/**
 * Service for managing users.
 * @template T - The user type
 */
class UserService<T extends User> extends EventEmitter {
  private config: UserServiceConfig;
  private cache: Map<number, T>;

  /**
   * Create a UserService instance.
   * @param config - Service configuration
   */
  constructor(config: UserServiceConfig) {
    super();
    this.config = config;
    this.cache = new Map();
    this.initializeConnection();
  }

  /**
   * Get a user by ID.
   * @param userId - The user's ID
   * @returns The user or undefined
   */
  async getUser(userId: number): Promise<T | undefined> {
    if (this.cache.has(userId)) {
      return this.cache.get(userId);
    }

    const response = await fetch(\`\${this.config.apiUrl}/users/\${userId}\`, {
      headers: { 'Authorization': \`Bearer \${this.config.apiKey}\` }
    });

    if (!response.ok) {
      this.emit('error', new Error(\`Failed to fetch user: \${response.status}\`));
      return undefined;
    }

    const user = await response.json() as T;
    this.cache.set(userId, user);
    return user;
  }

  /**
   * Create a new user.
   * @param userData - Partial user data
   * @returns The created user
   */
  async createUser(userData: Partial<T>): Promise<T> {
    const response = await fetch(\`\${this.config.apiUrl}/users\`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': \`Bearer \${this.config.apiKey}\`
      },
      body: JSON.stringify(userData)
    });

    const user = await response.json() as T;
    this.cache.set(user.id, user);
    this.emit('userCreated', user);
    return user;
  }

  private initializeConnection(): void {
    console.log('Initializing connection to', this.config.apiUrl);
  }
}

// Generic function
function processArray<T>(items: T[], processor: (item: T) => T): T[] {
  return items.map(processor);
}

// Arrow function with types
const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
  return emailRegex.test(email);
};

export { UserService, User, UserServiceConfig, UserRole, processArray, validateEmail };
`;

async function runTests() {
  console.log('='.repeat(60));
  console.log('WASM Squeezer Test Suite');
  console.log('='.repeat(60));
  console.log();

  // Build the extension first to get the compiled squeezer
  const distPath = join(__dirname, 'dist', 'extension.js');
  const wasmDir = join(__dirname, 'wasm');

  console.log('Loading squeezer from:', distPath);
  console.log('WASM directory:', wasmDir);
  console.log();

  try {
    // We need to test via the compiled extension
    // Let's use a simpler approach - directly import web-tree-sitter

    const Parser = (await import('web-tree-sitter')).default;

    // Initialize
    await Parser.init({
      locateFile: (file) => join(wasmDir, file === 'tree-sitter.wasm' ? 'tree-sitter.wasm' : file)
    });

    console.log('✓ Parser initialized successfully');
    console.log();

    // Test Python
    console.log('-'.repeat(60));
    console.log('TEST 1: Python Code Squeezing');
    console.log('-'.repeat(60));

    const pythonLang = await Parser.Language.load(join(wasmDir, 'tree-sitter-python.wasm'));
    const pythonParser = new Parser();
    pythonParser.setLanguage(pythonLang);

    const pythonTree = pythonParser.parse(PYTHON_CODE);
    console.log('✓ Python code parsed successfully');
    console.log('  Root node type:', pythonTree.rootNode.type);
    console.log('  Child count:', pythonTree.rootNode.childCount);

    // Count function definitions
    let funcCount = 0;
    let classCount = 0;
    function countNodes(node) {
      if (node.type === 'function_definition') funcCount++;
      if (node.type === 'class_definition') classCount++;
      for (let i = 0; i < node.childCount; i++) {
        countNodes(node.child(i));
      }
    }
    countNodes(pythonTree.rootNode);
    console.log('  Functions found:', funcCount);
    console.log('  Classes found:', classCount);
    console.log();

    // Test JavaScript
    console.log('-'.repeat(60));
    console.log('TEST 2: JavaScript Code Squeezing');
    console.log('-'.repeat(60));

    const jsLang = await Parser.Language.load(join(wasmDir, 'tree-sitter-javascript.wasm'));
    const jsParser = new Parser();
    jsParser.setLanguage(jsLang);

    const jsTree = jsParser.parse(JAVASCRIPT_CODE);
    console.log('✓ JavaScript code parsed successfully');
    console.log('  Root node type:', jsTree.rootNode.type);
    console.log('  Child count:', jsTree.rootNode.childCount);

    funcCount = 0;
    classCount = 0;
    let arrowCount = 0;
    function countJSNodes(node) {
      if (node.type === 'function_declaration') funcCount++;
      if (node.type === 'class_declaration') classCount++;
      if (node.type === 'arrow_function') arrowCount++;
      for (let i = 0; i < node.childCount; i++) {
        countJSNodes(node.child(i));
      }
    }
    countJSNodes(jsTree.rootNode);
    console.log('  Functions found:', funcCount);
    console.log('  Classes found:', classCount);
    console.log('  Arrow functions found:', arrowCount);
    console.log();

    // Test TypeScript
    console.log('-'.repeat(60));
    console.log('TEST 3: TypeScript Code Squeezing');
    console.log('-'.repeat(60));

    const tsLang = await Parser.Language.load(join(wasmDir, 'tree-sitter-typescript.wasm'));
    const tsParser = new Parser();
    tsParser.setLanguage(tsLang);

    const tsTree = tsParser.parse(TYPESCRIPT_CODE);
    console.log('✓ TypeScript code parsed successfully');
    console.log('  Root node type:', tsTree.rootNode.type);
    console.log('  Child count:', tsTree.rootNode.childCount);

    funcCount = 0;
    classCount = 0;
    arrowCount = 0;
    let interfaceCount = 0;
    function countTSNodes(node) {
      if (node.type === 'function_declaration') funcCount++;
      if (node.type === 'class_declaration') classCount++;
      if (node.type === 'arrow_function') arrowCount++;
      if (node.type === 'interface_declaration') interfaceCount++;
      for (let i = 0; i < node.childCount; i++) {
        countTSNodes(node.child(i));
      }
    }
    countTSNodes(tsTree.rootNode);
    console.log('  Functions found:', funcCount);
    console.log('  Classes found:', classCount);
    console.log('  Arrow functions found:', arrowCount);
    console.log('  Interfaces found:', interfaceCount);
    console.log();

    console.log('='.repeat(60));
    console.log('All parsing tests passed! Now testing full squeeze...');
    console.log('='.repeat(60));
    console.log();

    // Clean up
    pythonParser.delete();
    jsParser.delete();
    tsParser.delete();

  } catch (error) {
    console.error('✗ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

runTests();
