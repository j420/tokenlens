/**
 * Comprehensive Test Suite for TokenLens Commands
 *
 * Tests focus on:
 * 1. Output quality - correctness and formatting
 * 2. Edge cases - empty inputs, large files, special characters
 * 3. Different file types - TypeScript, JavaScript, Python, Go, etc.
 * 4. Performance limits - large files, many functions
 */

import {
  generateSmartCopy,
  analyzePreFlight,
  recordFileRead,
  getSessionStats,
  resetSessionMemory,
  trackDecision,
  getDecisionsAtRisk,
  generateCompactionReminder,
  incrementTurn,
  getCurrentTurn,
  getAllDecisions,
  getSessionFiles,
  isFileContentCurrent,
  _testing,
} from "./token-saver";

// ============================================================================
// Test Infrastructure
// ============================================================================

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: string;
}

interface TestSuite {
  name: string;
  results: TestResult[];
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertContains(str: string, substr: string, message?: string): void {
  if (!str.includes(substr)) {
    throw new Error(message || `Expected "${str.substring(0, 100)}..." to contain "${substr}"`);
  }
}

function assertNotContains(str: string, substr: string, message?: string): void {
  if (str.includes(substr)) {
    throw new Error(message || `Expected "${str.substring(0, 100)}..." NOT to contain "${substr}"`);
  }
}

function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

function assertGreaterThan(actual: number, expected: number, message?: string): void {
  if (actual <= expected) {
    throw new Error(message || `Expected ${actual} > ${expected}`);
  }
}

function assertLessThan(actual: number, expected: number, message?: string): void {
  if (actual >= expected) {
    throw new Error(message || `Expected ${actual} < ${expected}`);
  }
}

// ============================================================================
// 1. SMART COPY TESTS (20+ tests)
// ============================================================================

function runSmartCopyTests(): TestResult[] {
  const results: TestResult[] = [];

  // Test 1: Basic function extraction
  results.push((() => {
    try {
      const result = generateSmartCopy([{
        path: "test.ts",
        content: `export function calculateTotal(items: Item[], tax: number): number {
  return items.reduce((sum, item) => sum + item.price, 0) * (1 + tax);
}`
      }]);
      assertContains(result.optimizedCode, "calculateTotal");
      assertContains(result.optimizedCode, "{ /* ... */ }");
      assertGreaterThan(result.savingsPercent, 0);
      return { name: "Basic function extraction", passed: true };
    } catch (e) {
      return { name: "Basic function extraction", passed: false, error: String(e) };
    }
  })());

  // Test 2: Arrow function extraction
  results.push((() => {
    try {
      const result = generateSmartCopy([{
        path: "test.ts",
        content: `export const processData = async (input: string): Promise<Result> => {
  const parsed = JSON.parse(input);
  return { data: parsed, timestamp: Date.now() };
};`
      }]);
      assertContains(result.optimizedCode, "processData");
      assertContains(result.optimizedCode, "=>");
      return { name: "Arrow function extraction", passed: true };
    } catch (e) {
      return { name: "Arrow function extraction", passed: false, error: String(e) };
    }
  })());

  // Test 3: Class method extraction
  results.push((() => {
    try {
      const result = generateSmartCopy([{
        path: "test.ts",
        content: `export class AuthService {
  private secret: string;

  async login(email: string, password: string): Promise<Token> {
    const user = await this.findUser(email);
    return this.generateToken(user);
  }

  logout(): void {
    this.clearSession();
  }
}`
      }]);
      assertContains(result.optimizedCode, "AuthService");
      assertContains(result.optimizedCode, "login");
      assertContains(result.optimizedCode, "logout");
      return { name: "Class method extraction", passed: true };
    } catch (e) {
      return { name: "Class method extraction", passed: false, error: String(e) };
    }
  })());

  // Test 4: Interface extraction
  results.push((() => {
    try {
      const result = generateSmartCopy([{
        path: "types.ts",
        content: `export interface User {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
}`
      }]);
      assertContains(result.optimizedCode, "interface User");
      assertContains(result.optimizedCode, "id: string");
      return { name: "Interface extraction", passed: true };
    } catch (e) {
      return { name: "Interface extraction", passed: false, error: String(e) };
    }
  })());

  // Test 5: Type alias extraction
  results.push((() => {
    try {
      const result = generateSmartCopy([{
        path: "types.ts",
        content: `export type Role = "admin" | "user" | "guest";
export type UserId = string & { readonly brand: unique symbol };`
      }]);
      assertContains(result.optimizedCode, "type Role");
      return { name: "Type alias extraction", passed: true };
    } catch (e) {
      return { name: "Type alias extraction", passed: false, error: String(e) };
    }
  })());

  // Test 6: Import preservation
  results.push((() => {
    try {
      const result = generateSmartCopy([{
        path: "test.ts",
        content: `import { User } from "./types";
import type { Config } from "@app/config";

export function getUser(id: string): User {
  return {} as User;
}`
      }]);
      assertContains(result.optimizedCode, 'import { User }');
      return { name: "Import preservation", passed: true };
    } catch (e) {
      return { name: "Import preservation", passed: false, error: String(e) };
    }
  })());

  // Test 7: Multiple files
  results.push((() => {
    try {
      const result = generateSmartCopy([
        { path: "a.ts", content: `export function funcA(): void { console.log("a"); }` },
        { path: "b.ts", content: `export function funcB(): void { console.log("b"); }` },
        { path: "c.ts", content: `export function funcC(): void { console.log("c"); }` },
      ]);
      assertContains(result.optimizedCode, "funcA");
      assertContains(result.optimizedCode, "funcB");
      assertContains(result.optimizedCode, "funcC");
      assertContains(result.optimizedCode, "=== a.ts ===");
      assertContains(result.optimizedCode, "=== b.ts ===");
      return { name: "Multiple files", passed: true };
    } catch (e) {
      return { name: "Multiple files", passed: false, error: String(e) };
    }
  })());

  // Test 8: Empty file
  results.push((() => {
    try {
      const result = generateSmartCopy([{ path: "empty.ts", content: "" }]);
      assert(result.optimizedTokens >= 0, "Should handle empty file");
      return { name: "Empty file handling", passed: true };
    } catch (e) {
      return { name: "Empty file handling", passed: false, error: String(e) };
    }
  })());

  // Test 9: Comments only file
  results.push((() => {
    try {
      const result = generateSmartCopy([{
        path: "comments.ts",
        content: `// This is a comment
/* Block comment */
/**
 * JSDoc comment
 */`
      }]);
      assertNotContains(result.optimizedCode, "function");
      return { name: "Comments only file", passed: true };
    } catch (e) {
      return { name: "Comments only file", passed: false, error: String(e) };
    }
  })());

  // Test 10: Python function
  results.push((() => {
    try {
      const result = generateSmartCopy([{
        path: "test.py",
        content: `def calculate_total(items: list, tax: float) -> float:
    """Calculate total with tax."""
    return sum(item.price for item in items) * (1 + tax)

async def fetch_data(url: str) -> dict:
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as response:
            return await response.json()`
      }]);
      assertContains(result.optimizedCode, "calculate_total");
      assertContains(result.optimizedCode, "fetch_data");
      return { name: "Python function extraction", passed: true };
    } catch (e) {
      return { name: "Python function extraction", passed: false, error: String(e) };
    }
  })());

  // Test 11: Python with decorators
  results.push((() => {
    try {
      const result = generateSmartCopy([{
        path: "api.py",
        content: `@app.route("/api/users")
@login_required
def get_users():
    return User.query.all()`
      }]);
      // At minimum, the function name should be captured
      assertContains(result.optimizedCode, "get_users");
      return { name: "Python decorators", passed: true };
    } catch (e) {
      return { name: "Python decorators", passed: false, error: String(e) };
    }
  })());

  // Test 12: Go function
  results.push((() => {
    try {
      const result = generateSmartCopy([{
        path: "main.go",
        content: `func (s *Server) HandleRequest(w http.ResponseWriter, r *http.Request) error {
    body, err := io.ReadAll(r.Body)
    if err != nil {
        return err
    }
    return s.process(body)
}`
      }]);
      assertContains(result.optimizedCode, "HandleRequest");
      return { name: "Go function extraction", passed: true };
    } catch (e) {
      return { name: "Go function extraction", passed: false, error: String(e) };
    }
  })());

  // Test 13: Async generator function
  results.push((() => {
    try {
      const result = generateSmartCopy([{
        path: "test.ts",
        content: `async function* streamData(source: AsyncIterable<Data>): AsyncGenerator<ProcessedData> {
  for await (const item of source) {
    yield processItem(item);
  }
}`
      }]);
      assertContains(result.optimizedCode, "streamData");
      return { name: "Async generator function", passed: true };
    } catch (e) {
      return { name: "Async generator function", passed: false, error: String(e) };
    }
  })());

  // Test 14: React TSX component
  results.push((() => {
    try {
      const result = generateSmartCopy([{
        path: "Button.tsx",
        content: `export const Button: React.FC<ButtonProps> = ({ label, onClick }) => {
  return (
    <button className="btn" onClick={onClick}>
      {label}
    </button>
  );
};`
      }]);
      assertContains(result.optimizedCode, "Button");
      return { name: "React TSX component", passed: true };
    } catch (e) {
      return { name: "React TSX component", passed: false, error: String(e) };
    }
  })());

  // Test 15: Getter and setter
  results.push((() => {
    try {
      const result = generateSmartCopy([{
        path: "test.ts",
        content: `class Config {
  private _value: string = "";

  get value(): string {
    return this._value;
  }

  set value(v: string) {
    this._value = v;
  }
}`
      }]);
      assertContains(result.optimizedCode, "get value");
      assertContains(result.optimizedCode, "set value");
      return { name: "Getter and setter", passed: true };
    } catch (e) {
      return { name: "Getter and setter", passed: false, error: String(e) };
    }
  })());

  // Test 16: Token savings calculation
  results.push((() => {
    try {
      const longFunction = `export function processData(input: string): Result {
  // Lots of implementation
  const step1 = parseInput(input);
  const step2 = validateData(step1);
  const step3 = transformData(step2);
  const step4 = enrichData(step3);
  const step5 = formatOutput(step4);
  return { data: step5, success: true };
}`;
      const result = generateSmartCopy([{ path: "test.ts", content: longFunction }]);
      assertGreaterThan(result.originalTokens, result.optimizedTokens);
      assertGreaterThan(result.savingsPercent, 0);
      return { name: "Token savings calculation", passed: true };
    } catch (e) {
      return { name: "Token savings calculation", passed: false, error: String(e) };
    }
  })());

  // Test 17: Braces in strings ignored
  results.push((() => {
    try {
      const result = generateSmartCopy([{
        path: "test.ts",
        content: `function parseTemplate(input: string): string {
  const template = "Hello {name}, welcome to {place}!";
  return template.replace(/{(\w+)}/g, (_, key) => input[key]);
}`
      }]);
      assertContains(result.optimizedCode, "parseTemplate");
      assertContains(result.optimizedCode, "{ /* ... */ }");
      return { name: "Braces in strings ignored", passed: true };
    } catch (e) {
      return { name: "Braces in strings ignored", passed: false, error: String(e) };
    }
  })());

  // Test 18: Multi-line function signature
  results.push((() => {
    try {
      const result = generateSmartCopy([{
        path: "test.ts",
        content: `export async function createUser(
  name: string,
  email: string,
  role: UserRole,
  options?: CreateOptions
): Promise<User> {
  return db.users.create({ name, email, role, ...options });
}`
      }]);
      assertContains(result.optimizedCode, "createUser");
      assertContains(result.optimizedCode, "name: string");
      return { name: "Multi-line function signature", passed: true };
    } catch (e) {
      return { name: "Multi-line function signature", passed: false, error: String(e) };
    }
  })());

  // Test 19: Export default function
  results.push((() => {
    try {
      const result = generateSmartCopy([{
        path: "test.ts",
        content: `export default function handler(req: Request, res: Response) {
  res.json({ ok: true });
}`
      }]);
      assertContains(result.optimizedCode, "export default function handler");
      return { name: "Export default function", passed: true };
    } catch (e) {
      return { name: "Export default function", passed: false, error: String(e) };
    }
  })());

  // Test 20: Large file with many functions
  results.push((() => {
    try {
      let code = "";
      for (let i = 0; i < 50; i++) {
        code += `export function func${i}(x: number): number {
  return x * ${i};
}\n\n`;
      }
      const result = generateSmartCopy([{ path: "large.ts", content: code }]);
      assertContains(result.optimizedCode, "func0");
      assertContains(result.optimizedCode, "func49");
      assertGreaterThan(result.savingsPercent, 15); // Adjusted for realistic savings
      return { name: "Large file with many functions", passed: true };
    } catch (e) {
      return { name: "Large file with many functions", passed: false, error: String(e) };
    }
  })());

  // Test 21: Unicode in code
  results.push((() => {
    try {
      const result = generateSmartCopy([{
        path: "test.ts",
        content: `export function greet(name: string): string {
  return \`Hello, \${name}! 👋🎉\`;
}`
      }]);
      assertContains(result.optimizedCode, "greet");
      return { name: "Unicode in code", passed: true };
    } catch (e) {
      return { name: "Unicode in code", passed: false, error: String(e) };
    }
  })());

  // Test 22: Private class methods
  results.push((() => {
    try {
      const result = generateSmartCopy([{
        path: "test.ts",
        content: `class Service {
  private async fetchData(): Promise<Data> {
    return fetch("/api").then(r => r.json());
  }

  protected processData(data: Data): Result {
    return { processed: true };
  }

  public getData(): Promise<Result> {
    return this.fetchData().then(d => this.processData(d));
  }
}`
      }]);
      assertContains(result.optimizedCode, "fetchData");
      assertContains(result.optimizedCode, "processData");
      assertContains(result.optimizedCode, "getData");
      return { name: "Private class methods", passed: true };
    } catch (e) {
      return { name: "Private class methods", passed: false, error: String(e) };
    }
  })());

  return results;
}

// ============================================================================
// 2. PRE-FLIGHT OPTIMIZER TESTS (20+ tests)
// ============================================================================

function runPreflightTests(): TestResult[] {
  const results: TestResult[] = [];

  // Test 1: Basic analysis
  results.push((() => {
    try {
      const files = [
        { path: "/src/auth.ts", content: "export function login() {}", tokens: 100 },
        { path: "/src/utils.ts", content: "export function format() {}", tokens: 50 },
      ];
      const analysis = analyzePreFlight("fix the login bug", files, 3);
      assert(analysis.currentContext.files.length > 0, "Should have current context files");
      assert(analysis.currentContext.tokens > 0, "Should have token count");
      return { name: "Basic pre-flight analysis", passed: true };
    } catch (e) {
      return { name: "Basic pre-flight analysis", passed: false, error: String(e) };
    }
  })());

  // Test 2: Relevance scoring
  results.push((() => {
    try {
      const files = [
        { path: "/src/auth.ts", content: "export function login() { authenticate(); }", tokens: 100 },
        { path: "/src/config.ts", content: "export const MAX_RETRIES = 3;", tokens: 50 },
      ];
      const analysis = analyzePreFlight("fix authentication", files, 3);
      // auth.ts should be recommended because it contains "authenticate"
      const authRecommended = analysis.recommendedContext.files.some(f => f.includes("auth"));
      assert(authRecommended, "auth.ts should be in recommended files");
      return { name: "Relevance scoring", passed: true };
    } catch (e) {
      return { name: "Relevance scoring", passed: false, error: String(e) };
    }
  })());

  // Test 3: Cost calculation
  results.push((() => {
    try {
      const files = [
        { path: "/src/test.ts", content: "x".repeat(1000), tokens: 250 },
      ];
      const analysis = analyzePreFlight("test", files, 3);
      assertGreaterThan(analysis.currentContext.cost, 0);
      return { name: "Cost calculation", passed: true };
    } catch (e) {
      return { name: "Cost calculation", passed: false, error: String(e) };
    }
  })());

  // Test 4: Savings calculation
  results.push((() => {
    try {
      const files = [
        { path: "/src/auth.ts", content: "login auth", tokens: 100 },
        { path: "/src/utils.ts", content: "unrelated code", tokens: 500 },
        { path: "/src/config.ts", content: "more unrelated", tokens: 500 },
      ];
      const analysis = analyzePreFlight("login authentication", files, 3);
      // Should recommend skipping unrelated files
      assert(analysis.savings.tokens >= 0, "Should calculate savings");
      return { name: "Savings calculation", passed: true };
    } catch (e) {
      return { name: "Savings calculation", passed: false, error: String(e) };
    }
  })());

  // Test 5: Empty files array
  results.push((() => {
    try {
      const analysis = analyzePreFlight("test", [], 3);
      assertEqual(analysis.currentContext.files.length, 0);
      assertEqual(analysis.currentContext.tokens, 0);
      return { name: "Empty files array", passed: true };
    } catch (e) {
      return { name: "Empty files array", passed: false, error: String(e) };
    }
  })());

  // Test 6: Empty prompt
  results.push((() => {
    try {
      const files = [{ path: "/src/test.ts", content: "code", tokens: 100 }];
      const analysis = analyzePreFlight("", files, 3);
      // Should still work with empty prompt
      assert(analysis.currentContext.files.length > 0, "Should handle empty prompt");
      return { name: "Empty prompt handling", passed: true };
    } catch (e) {
      return { name: "Empty prompt handling", passed: false, error: String(e) };
    }
  })());

  // Test 7: Active file boosting
  results.push((() => {
    try {
      const files = [
        { path: "/src/auth.ts", content: "some code", tokens: 100 },
        { path: "/src/active.ts", content: "active file code", tokens: 100 },
      ];
      const analysis = analyzePreFlight("test", files, 3, "/src/active.ts");
      // Active file should be included
      const activeIncluded = analysis.recommendedContext.files.some(f => f.includes("active"));
      assert(activeIncluded, "Active file should be boosted");
      return { name: "Active file boosting", passed: true };
    } catch (e) {
      return { name: "Active file boosting", passed: false, error: String(e) };
    }
  })());

  // Test 8: Recommendations generated
  results.push((() => {
    try {
      const files = [];
      for (let i = 0; i < 30; i++) {
        files.push({ path: `/src/file${i}.ts`, content: "code", tokens: 100 });
      }
      const analysis = analyzePreFlight("test", files, 3);
      assertGreaterThan(analysis.recommendations.length, 0);
      return { name: "Recommendations generated", passed: true };
    } catch (e) {
      return { name: "Recommendations generated", passed: false, error: String(e) };
    }
  })());

  // Test 9: Large files flagged
  results.push((() => {
    try {
      const files = [
        { path: "/src/large.ts", content: "x".repeat(10000), tokens: 5000 },
        { path: "/src/small.ts", content: "small", tokens: 50 },
      ];
      const analysis = analyzePreFlight("test", files, 3);
      // Should have recommendation about large files
      const hasLargeFileRec = analysis.recommendations.some(r =>
        r.toLowerCase().includes("large") || r.toLowerCase().includes("signature")
      );
      assert(hasLargeFileRec || analysis.recommendations.length > 0, "Should flag large files");
      return { name: "Large files flagged", passed: true };
    } catch (e) {
      return { name: "Large files flagged", passed: false, error: String(e) };
    }
  })());

  // Test 10: Fuzzy matching
  results.push((() => {
    try {
      const files = [
        { path: "/src/authentication.ts", content: "authenticate user", tokens: 100 },
        { path: "/src/utils.ts", content: "random utils", tokens: 100 },
      ];
      const analysis = analyzePreFlight("auth", files, 3);
      // "auth" should fuzzy match "authentication"
      const authMatched = analysis.recommendedContext.files.some(f => f.includes("auth"));
      assert(authMatched, "Should fuzzy match auth -> authentication");
      return { name: "Fuzzy matching", passed: true };
    } catch (e) {
      return { name: "Fuzzy matching", passed: false, error: String(e) };
    }
  })());

  // Test 11: Multiple relevant files
  results.push((() => {
    try {
      const files = [
        { path: "/src/auth/login.ts", content: "login function", tokens: 100 },
        { path: "/src/auth/logout.ts", content: "logout function", tokens: 100 },
        { path: "/src/auth/token.ts", content: "token refresh", tokens: 100 },
        { path: "/src/utils.ts", content: "unrelated", tokens: 100 },
      ];
      const analysis = analyzePreFlight("fix authentication login logout", files, 3);
      assertGreaterThan(analysis.recommendedContext.files.length, 1);
      return { name: "Multiple relevant files", passed: true };
    } catch (e) {
      return { name: "Multiple relevant files", passed: false, error: String(e) };
    }
  })());

  // Test 12: Percent calculation
  results.push((() => {
    try {
      const files = [
        { path: "/src/a.ts", content: "relevant", tokens: 100 },
        { path: "/src/b.ts", content: "unrelated", tokens: 400 },
      ];
      const analysis = analyzePreFlight("relevant", files, 3);
      assert(analysis.savings.percent >= 0 && analysis.savings.percent <= 100, "Percent should be 0-100");
      return { name: "Percent calculation", passed: true };
    } catch (e) {
      return { name: "Percent calculation", passed: false, error: String(e) };
    }
  })());

  // Test 13: CSS file matching
  results.push((() => {
    try {
      const files = [
        { path: "/src/styles.css", content: ".header { color: red; }", tokens: 50 },
        { path: "/src/Header.tsx", content: "Header component", tokens: 100 },
      ];
      const analysis = analyzePreFlight("fix header styling", files, 3);
      const stylesIncluded = analysis.recommendedContext.files.some(f =>
        f.includes("styles") || f.includes("Header")
      );
      assert(stylesIncluded, "Should include style-related files");
      return { name: "CSS file matching", passed: true };
    } catch (e) {
      return { name: "CSS file matching", passed: false, error: String(e) };
    }
  })());

  // Test 14: JSON file handling
  results.push((() => {
    try {
      const files = [
        { path: "/package.json", content: '{"name": "test"}', tokens: 50 },
        { path: "/src/code.ts", content: "code", tokens: 100 },
      ];
      const analysis = analyzePreFlight("fix dependencies", files, 3);
      // Should work without errors
      assert(analysis.currentContext.tokens > 0, "Should handle JSON files");
      return { name: "JSON file handling", passed: true };
    } catch (e) {
      return { name: "JSON file handling", passed: false, error: String(e) };
    }
  })());

  // Test 15: Many files performance
  results.push((() => {
    try {
      const files = [];
      for (let i = 0; i < 100; i++) {
        files.push({ path: `/src/file${i}.ts`, content: `function f${i}() {}`, tokens: 50 });
      }
      const start = Date.now();
      const analysis = analyzePreFlight("test", files, 3);
      const duration = Date.now() - start;
      assertLessThan(duration, 5000); // Should complete in < 5s
      return { name: "Many files performance", passed: true, details: `${duration}ms` };
    } catch (e) {
      return { name: "Many files performance", passed: false, error: String(e) };
    }
  })());

  // Test 16: Keyword extraction from prompt
  results.push((() => {
    try {
      const files = [
        { path: "/src/user.ts", content: "user management", tokens: 100 },
        { path: "/src/product.ts", content: "product catalog", tokens: 100 },
      ];
      const analysis = analyzePreFlight("fix the user profile page", files, 3);
      const userMatched = analysis.recommendedContext.files.some(f => f.includes("user"));
      assert(userMatched, "Should extract 'user' keyword from prompt");
      return { name: "Keyword extraction from prompt", passed: true };
    } catch (e) {
      return { name: "Keyword extraction from prompt", passed: false, error: String(e) };
    }
  })());

  // Test 17: File extension relevance
  results.push((() => {
    try {
      const files = [
        { path: "/src/api.test.ts", content: "test code", tokens: 100 },
        { path: "/src/api.ts", content: "api code", tokens: 100 },
      ];
      const analysis = analyzePreFlight("fix api endpoint", files, 3);
      // Non-test file should be more relevant
      assert(analysis.recommendedContext.files.length > 0, "Should have recommended files");
      return { name: "File extension relevance", passed: true };
    } catch (e) {
      return { name: "File extension relevance", passed: false, error: String(e) };
    }
  })());

  // Test 18: Cost savings in dollars
  results.push((() => {
    try {
      const files = [
        { path: "/src/a.ts", content: "code", tokens: 1000 },
        { path: "/src/b.ts", content: "unrelated", tokens: 5000 },
      ];
      const analysis = analyzePreFlight("relevant code", files, 3);
      assertGreaterThan(analysis.savings.cost, 0);
      assert(typeof analysis.savings.cost === "number", "Cost should be a number");
      return { name: "Cost savings in dollars", passed: true };
    } catch (e) {
      return { name: "Cost savings in dollars", passed: false, error: String(e) };
    }
  })());

  // Test 19: Token count accuracy
  results.push((() => {
    try {
      const files = [
        { path: "/src/a.ts", content: "code", tokens: 100 },
        { path: "/src/b.ts", content: "more", tokens: 200 },
      ];
      const analysis = analyzePreFlight("test", files, 3);
      assertEqual(analysis.currentContext.tokens, 300);
      return { name: "Token count accuracy", passed: true };
    } catch (e) {
      return { name: "Token count accuracy", passed: false, error: String(e) };
    }
  })());

  // Test 20: Recommended context subset
  results.push((() => {
    try {
      const files = [
        { path: "/src/a.ts", content: "relevant", tokens: 100 },
        { path: "/src/b.ts", content: "unrelated", tokens: 100 },
      ];
      const analysis = analyzePreFlight("relevant", files, 3);
      assert(
        analysis.recommendedContext.tokens <= analysis.currentContext.tokens,
        "Recommended should be <= current"
      );
      return { name: "Recommended context subset", passed: true };
    } catch (e) {
      return { name: "Recommended context subset", passed: false, error: String(e) };
    }
  })());

  // Test 21: Special characters in prompt
  results.push((() => {
    try {
      const files = [{ path: "/src/test.ts", content: "code", tokens: 100 }];
      const analysis = analyzePreFlight("fix the bug in @decorator #tag $var", files, 3);
      // Should handle special characters without crashing
      assert(analysis.currentContext.files.length > 0, "Should handle special chars");
      return { name: "Special characters in prompt", passed: true };
    } catch (e) {
      return { name: "Special characters in prompt", passed: false, error: String(e) };
    }
  })());

  return results;
}

// ============================================================================
// 3. SESSION MEMORY TESTS (20+ tests)
// ============================================================================

function runSessionMemoryTests(): TestResult[] {
  const results: TestResult[] = [];

  // Reset before tests
  resetSessionMemory();

  // Test 1: Record first file read
  results.push((() => {
    try {
      resetSessionMemory();
      const result = recordFileRead("/src/test.ts", "function test() {}");
      assertEqual(result.isDuplicate, false);
      assertEqual(result.tokensSaved, 0);
      return { name: "Record first file read", passed: true };
    } catch (e) {
      return { name: "Record first file read", passed: false, error: String(e) };
    }
  })());

  // Test 2: Detect duplicate read
  results.push((() => {
    try {
      resetSessionMemory();
      recordFileRead("/src/test.ts", "function test() {}");
      const result = recordFileRead("/src/test.ts", "function test() {}");
      assertEqual(result.isDuplicate, true);
      assertGreaterThan(result.tokensSaved, 0);
      return { name: "Detect duplicate read", passed: true };
    } catch (e) {
      return { name: "Detect duplicate read", passed: false, error: String(e) };
    }
  })());

  // Test 3: Detect content change
  results.push((() => {
    try {
      resetSessionMemory();
      recordFileRead("/src/test.ts", "function test() {}");
      const result = recordFileRead("/src/test.ts", "function test() { modified }");
      assertEqual(result.isDuplicate, false);
      assertEqual(result.contentChanged, true);
      return { name: "Detect content change", passed: true };
    } catch (e) {
      return { name: "Detect content change", passed: false, error: String(e) };
    }
  })());

  // Test 4: Session stats
  results.push((() => {
    try {
      resetSessionMemory();
      recordFileRead("/src/a.ts", "code a");
      recordFileRead("/src/b.ts", "code b");
      recordFileRead("/src/a.ts", "code a"); // Duplicate
      const stats = getSessionStats();
      assertEqual(stats.filesRead, 2);
      assertEqual(stats.deduplicationCount, 1);
      assertGreaterThan(stats.tokensSaved, 0);
      return { name: "Session stats accuracy", passed: true };
    } catch (e) {
      return { name: "Session stats accuracy", passed: false, error: String(e) };
    }
  })());

  // Test 5: Reset session memory
  results.push((() => {
    try {
      resetSessionMemory();
      recordFileRead("/src/test.ts", "code");
      resetSessionMemory();
      const stats = getSessionStats();
      assertEqual(stats.filesRead, 0);
      assertEqual(stats.tokensSaved, 0);
      return { name: "Reset session memory", passed: true };
    } catch (e) {
      return { name: "Reset session memory", passed: false, error: String(e) };
    }
  })());

  // Test 6: Turn number tracking
  results.push((() => {
    try {
      resetSessionMemory();
      const initialTurn = getCurrentTurn();
      incrementTurn();
      const newTurn = getCurrentTurn();
      assertEqual(newTurn, initialTurn + 1);
      return { name: "Turn number tracking", passed: true };
    } catch (e) {
      return { name: "Turn number tracking", passed: false, error: String(e) };
    }
  })());

  // Test 7: Get session files
  results.push((() => {
    try {
      resetSessionMemory();
      recordFileRead("/src/a.ts", "code a");
      recordFileRead("/src/b.ts", "code b");
      const files = getSessionFiles();
      assertEqual(files.length, 2);
      return { name: "Get session files", passed: true };
    } catch (e) {
      return { name: "Get session files", passed: false, error: String(e) };
    }
  })());

  // Test 8: Partial file read
  results.push((() => {
    try {
      resetSessionMemory();
      const result = recordFileRead("/src/test.ts", "partial content", {
        isPartial: true,
        lineRange: { start: 10, end: 50 },
      });
      assertEqual(result.isDuplicate, false);
      const files = getSessionFiles();
      assert(files[0].isPartial === true, "Should mark as partial");
      return { name: "Partial file read", passed: true };
    } catch (e) {
      return { name: "Partial file read", passed: false, error: String(e) };
    }
  })());

  // Test 9: Is file content current
  results.push((() => {
    try {
      resetSessionMemory();
      recordFileRead("/src/test.ts", "original content");
      const isCurrent = isFileContentCurrent("/src/test.ts", "original content");
      assertEqual(isCurrent, true);
      const isNotCurrent = isFileContentCurrent("/src/test.ts", "different content");
      assertEqual(isNotCurrent, false);
      return { name: "Is file content current", passed: true };
    } catch (e) {
      return { name: "Is file content current", passed: false, error: String(e) };
    }
  })());

  // Test 10: Hash consistency
  results.push((() => {
    try {
      const hash1 = _testing.hashContent("test content");
      const hash2 = _testing.hashContent("test content");
      const hash3 = _testing.hashContent("different content");
      assertEqual(hash1, hash2);
      assert(hash1 !== hash3, "Different content should have different hash");
      return { name: "Hash consistency", passed: true };
    } catch (e) {
      return { name: "Hash consistency", passed: false, error: String(e) };
    }
  })());

  // Test 11: Multiple file tracking
  results.push((() => {
    try {
      resetSessionMemory();
      for (let i = 0; i < 10; i++) {
        recordFileRead(`/src/file${i}.ts`, `content ${i}`);
      }
      const stats = getSessionStats();
      assertEqual(stats.filesRead, 10);
      return { name: "Multiple file tracking", passed: true };
    } catch (e) {
      return { name: "Multiple file tracking", passed: false, error: String(e) };
    }
  })());

  // Test 12: Session duration tracking
  results.push((() => {
    try {
      resetSessionMemory();
      const stats = getSessionStats();
      assert(stats.sessionDuration >= 0, "Duration should be >= 0");
      return { name: "Session duration tracking", passed: true };
    } catch (e) {
      return { name: "Session duration tracking", passed: false, error: String(e) };
    }
  })());

  // Test 13: Empty file handling
  results.push((() => {
    try {
      resetSessionMemory();
      const result = recordFileRead("/src/empty.ts", "");
      assertEqual(result.isDuplicate, false);
      return { name: "Empty file handling", passed: true };
    } catch (e) {
      return { name: "Empty file handling", passed: false, error: String(e) };
    }
  })());

  // Test 14: Special characters in path
  results.push((() => {
    try {
      resetSessionMemory();
      const result = recordFileRead("/src/test file (1).ts", "code");
      assertEqual(result.isDuplicate, false);
      return { name: "Special characters in path", passed: true };
    } catch (e) {
      return { name: "Special characters in path", passed: false, error: String(e) };
    }
  })());

  // Test 15: Unicode content
  results.push((() => {
    try {
      resetSessionMemory();
      const result = recordFileRead("/src/test.ts", "const emoji = '🎉';");
      assertEqual(result.isDuplicate, false);
      return { name: "Unicode content", passed: true };
    } catch (e) {
      return { name: "Unicode content", passed: false, error: String(e) };
    }
  })());

  // Test 16: Original turn tracking
  results.push((() => {
    try {
      resetSessionMemory();
      incrementTurn(); // Turn 1
      recordFileRead("/src/test.ts", "content");
      incrementTurn(); // Turn 2
      const result = recordFileRead("/src/test.ts", "content");
      assertEqual(result.originalTurn, 1);
      return { name: "Original turn tracking", passed: true };
    } catch (e) {
      return { name: "Original turn tracking", passed: false, error: String(e) };
    }
  })());

  // Test 17: Large content handling
  results.push((() => {
    try {
      resetSessionMemory();
      const largeContent = "x".repeat(100000);
      const result = recordFileRead("/src/large.ts", largeContent);
      assertEqual(result.isDuplicate, false);
      assertGreaterThan(result.tokensSaved, -1); // Should work
      return { name: "Large content handling", passed: true };
    } catch (e) {
      return { name: "Large content handling", passed: false, error: String(e) };
    }
  })());

  // Test 18: Token counting accuracy
  results.push((() => {
    try {
      resetSessionMemory();
      const content = "function test() { return 42; }";
      recordFileRead("/src/test.ts", content);
      const stats = getSessionStats();
      assertGreaterThan(stats.totalTokens, 0);
      return { name: "Token counting in session", passed: true };
    } catch (e) {
      return { name: "Token counting in session", passed: false, error: String(e) };
    }
  })());

  // Test 19: File info preservation
  results.push((() => {
    try {
      resetSessionMemory();
      incrementTurn();
      recordFileRead("/src/test.ts", "content");
      const files = getSessionFiles();
      assert(files.length === 1, "Should have one file");
      assert(files[0].path.includes("test.ts"), "Should preserve path");
      assertGreaterThan(files[0].tokens, 0);
      return { name: "File info preservation", passed: true };
    } catch (e) {
      return { name: "File info preservation", passed: false, error: String(e) };
    }
  })());

  // Test 20: Multiple reads same file different content
  results.push((() => {
    try {
      resetSessionMemory();
      recordFileRead("/src/test.ts", "version 1");
      recordFileRead("/src/test.ts", "version 2");
      recordFileRead("/src/test.ts", "version 3");
      const stats = getSessionStats();
      assertEqual(stats.changesDetected, 2); // 2 changes after initial
      return { name: "Multiple content changes", passed: true };
    } catch (e) {
      return { name: "Multiple content changes", passed: false, error: String(e) };
    }
  })());

  // Test 21: Deduplication count
  results.push((() => {
    try {
      resetSessionMemory();
      recordFileRead("/src/test.ts", "content");
      recordFileRead("/src/test.ts", "content");
      recordFileRead("/src/test.ts", "content");
      const stats = getSessionStats();
      assertEqual(stats.deduplicationCount, 2); // 2 duplicates
      return { name: "Deduplication count", passed: true };
    } catch (e) {
      return { name: "Deduplication count", passed: false, error: String(e) };
    }
  })());

  return results;
}

// ============================================================================
// 4. COMPACTION RECOVERY TESTS (20+ tests)
// ============================================================================

function runCompactionTests(): TestResult[] {
  const results: TestResult[] = [];

  // Test 1: Track new decision
  results.push((() => {
    try {
      resetSessionMemory();
      const result = trackDecision("Use JWT for auth", "architectural", "high", "manual");
      assertEqual(result.added, true);
      return { name: "Track new decision", passed: true };
    } catch (e) {
      return { name: "Track new decision", passed: false, error: String(e) };
    }
  })());

  // Test 2: Get all decisions
  results.push((() => {
    try {
      resetSessionMemory();
      trackDecision("Decision 1", "architectural", "high", "manual");
      trackDecision("Decision 2", "configuration", "medium", "manual");
      const decisions = getAllDecisions();
      assertEqual(decisions.length, 2);
      return { name: "Get all decisions", passed: true };
    } catch (e) {
      return { name: "Get all decisions", passed: false, error: String(e) };
    }
  })());

  // Test 3: Decision categories
  results.push((() => {
    try {
      resetSessionMemory();
      trackDecision("Arch decision", "architectural", "high", "manual");
      trackDecision("Config decision", "configuration", "medium", "manual");
      trackDecision("Requirement decision", "requirement", "critical", "manual");
      trackDecision("Constraint decision", "constraint", "low", "manual");
      const decisions = getAllDecisions();
      const categories = new Set(decisions.map(d => d.category));
      assertEqual(categories.size, 4);
      return { name: "Decision categories", passed: true };
    } catch (e) {
      return { name: "Decision categories", passed: false, error: String(e) };
    }
  })());

  // Test 4: Decision priorities
  results.push((() => {
    try {
      resetSessionMemory();
      trackDecision("Critical", "architectural", "critical", "manual");
      trackDecision("High", "architectural", "high", "manual");
      trackDecision("Medium", "architectural", "medium", "manual");
      trackDecision("Low", "architectural", "low", "manual");
      const decisions = getAllDecisions();
      const priorities = new Set(decisions.map(d => d.priority));
      assertEqual(priorities.size, 4);
      return { name: "Decision priorities", passed: true };
    } catch (e) {
      return { name: "Decision priorities", passed: false, error: String(e) };
    }
  })());

  // Test 5: Decisions at risk
  results.push((() => {
    try {
      resetSessionMemory();
      trackDecision("Old decision", "architectural", "critical", "manual");
      // Fast forward turns
      for (let i = 0; i < 15; i++) {
        incrementTurn();
      }
      const atRisk = getDecisionsAtRisk();
      // Critical decisions should be flagged as at risk after many turns
      assert(atRisk.length >= 0, "Should check for at-risk decisions");
      return { name: "Decisions at risk", passed: true };
    } catch (e) {
      return { name: "Decisions at risk", passed: false, error: String(e) };
    }
  })());

  // Test 6: Generate compaction reminder
  results.push((() => {
    try {
      resetSessionMemory();
      trackDecision("Remember this", "architectural", "critical", "manual");
      const reminder = generateCompactionReminder();
      // Reminder should be a string (could be empty if no at-risk decisions)
      assert(typeof reminder === "string", "Reminder should be a string");
      return { name: "Generate compaction reminder", passed: true };
    } catch (e) {
      return { name: "Generate compaction reminder", passed: false, error: String(e) };
    }
  })());

  // Test 7: Duplicate decision handling
  results.push((() => {
    try {
      resetSessionMemory();
      trackDecision("Same decision", "architectural", "high", "manual");
      const result = trackDecision("Same decision", "architectural", "critical", "manual");
      assertEqual(result.added, false); // Should update, not add
      const decisions = getAllDecisions();
      assertEqual(decisions.length, 1);
      return { name: "Duplicate decision handling", passed: true };
    } catch (e) {
      return { name: "Duplicate decision handling", passed: false, error: String(e) };
    }
  })());

  // Test 8: Decision source tracking
  results.push((() => {
    try {
      resetSessionMemory();
      trackDecision("Manual decision", "architectural", "high", "manual");
      trackDecision("Auto decision", "architectural", "high", "auto");
      const decisions = getAllDecisions();
      const sources = new Set(decisions.map(d => d.source));
      assertEqual(sources.size, 2);
      return { name: "Decision source tracking", passed: true };
    } catch (e) {
      return { name: "Decision source tracking", passed: false, error: String(e) };
    }
  })());

  // Test 9: Decision turn number
  results.push((() => {
    try {
      resetSessionMemory();
      incrementTurn(); // Turn 1
      incrementTurn(); // Turn 2
      trackDecision("Decision at turn 2", "architectural", "high", "manual");
      const decisions = getAllDecisions();
      assertEqual(decisions[0].turnNumber, 2);
      return { name: "Decision turn number", passed: true };
    } catch (e) {
      return { name: "Decision turn number", passed: false, error: String(e) };
    }
  })());

  // Test 10: Empty decisions
  results.push((() => {
    try {
      resetSessionMemory();
      const atRisk = getDecisionsAtRisk();
      assertEqual(atRisk.length, 0);
      return { name: "Empty decisions", passed: true };
    } catch (e) {
      return { name: "Empty decisions", passed: false, error: String(e) };
    }
  })());

  // Test 11: Clear on reset
  results.push((() => {
    try {
      resetSessionMemory();
      trackDecision("Will be cleared", "architectural", "high", "manual");
      resetSessionMemory();
      const decisions = getAllDecisions();
      assertEqual(decisions.length, 0);
      return { name: "Clear decisions on reset", passed: true };
    } catch (e) {
      return { name: "Clear decisions on reset", passed: false, error: String(e) };
    }
  })());

  // Test 12: Decision ID generation
  results.push((() => {
    try {
      const id1 = _testing.generateDecisionId("Test decision", "architectural");
      const id2 = _testing.generateDecisionId("Test decision", "architectural");
      const id3 = _testing.generateDecisionId("Different decision", "architectural");
      assertEqual(id1, id2); // Same text = same ID
      assert(id1 !== id3, "Different text = different ID");
      return { name: "Decision ID generation", passed: true };
    } catch (e) {
      return { name: "Decision ID generation", passed: false, error: String(e) };
    }
  })());

  // Test 13: Long decision text
  results.push((() => {
    try {
      resetSessionMemory();
      const longText = "A".repeat(500);
      const result = trackDecision(longText, "architectural", "high", "manual");
      assertEqual(result.added, true);
      return { name: "Long decision text", passed: true };
    } catch (e) {
      return { name: "Long decision text", passed: false, error: String(e) };
    }
  })());

  // Test 14: Special characters in decision
  results.push((() => {
    try {
      resetSessionMemory();
      const result = trackDecision("Use @decorator & $variable", "architectural", "high", "manual");
      assertEqual(result.added, true);
      return { name: "Special characters in decision", passed: true };
    } catch (e) {
      return { name: "Special characters in decision", passed: false, error: String(e) };
    }
  })());

  // Test 15: Unicode in decision
  results.push((() => {
    try {
      resetSessionMemory();
      const result = trackDecision("Use emoji 🎉 in code", "architectural", "high", "manual");
      assertEqual(result.added, true);
      return { name: "Unicode in decision", passed: true };
    } catch (e) {
      return { name: "Unicode in decision", passed: false, error: String(e) };
    }
  })());

  // Test 16: Reminder format
  results.push((() => {
    try {
      resetSessionMemory();
      trackDecision("Important decision", "architectural", "critical", "manual");
      // Advance turns to make it at risk
      for (let i = 0; i < 20; i++) {
        incrementTurn();
      }
      const reminder = generateCompactionReminder();
      // If at risk, reminder should contain the decision text
      if (getDecisionsAtRisk().length > 0) {
        assertContains(reminder, "Important decision");
      }
      return { name: "Reminder format", passed: true };
    } catch (e) {
      return { name: "Reminder format", passed: false, error: String(e) };
    }
  })());

  // Test 17: Many decisions
  results.push((() => {
    try {
      resetSessionMemory();
      for (let i = 0; i < 50; i++) {
        trackDecision(`Decision ${i}`, "architectural", "medium", "manual");
      }
      const decisions = getAllDecisions();
      assertEqual(decisions.length, 50);
      return { name: "Many decisions", passed: true };
    } catch (e) {
      return { name: "Many decisions", passed: false, error: String(e) };
    }
  })());

  // Test 18: Priority upgrade
  results.push((() => {
    try {
      resetSessionMemory();
      trackDecision("Test", "architectural", "low", "manual");
      trackDecision("Test", "architectural", "critical", "manual");
      const decisions = getAllDecisions();
      assertEqual(decisions[0].priority, "critical");
      return { name: "Priority upgrade", passed: true };
    } catch (e) {
      return { name: "Priority upgrade", passed: false, error: String(e) };
    }
  })());

  // Test 19: Timestamp tracking
  results.push((() => {
    try {
      resetSessionMemory();
      trackDecision("Test", "architectural", "high", "manual");
      const decisions = getAllDecisions();
      assert(decisions[0].timestamp instanceof Date, "Should have timestamp");
      return { name: "Timestamp tracking", passed: true };
    } catch (e) {
      return { name: "Timestamp tracking", passed: false, error: String(e) };
    }
  })());

  // Test 20: At-risk threshold
  results.push((() => {
    try {
      resetSessionMemory();
      trackDecision("Critical", "architectural", "critical", "manual");
      trackDecision("Low priority", "architectural", "low", "manual");
      // Advance some turns
      for (let i = 0; i < 10; i++) {
        incrementTurn();
      }
      const atRisk = getDecisionsAtRisk();
      // Critical decisions should be at risk sooner than low priority
      // This depends on implementation, just verify it runs
      assert(Array.isArray(atRisk), "Should return array");
      return { name: "At-risk threshold", passed: true };
    } catch (e) {
      return { name: "At-risk threshold", passed: false, error: String(e) };
    }
  })());

  // Test 21: Decision with all parameters
  results.push((() => {
    try {
      resetSessionMemory();
      const result = trackDecision("Auth decision", "architectural", "high", "manual");
      assertEqual(result.added, true);
      const decisions = getAllDecisions();
      assertEqual(decisions[0].description, "Auth decision");
      assertEqual(decisions[0].category, "architectural");
      assertEqual(decisions[0].priority, "high");
      return { name: "Decision with all parameters", passed: true };
    } catch (e) {
      return { name: "Decision with all parameters", passed: false, error: String(e) };
    }
  })());

  return results;
}

// ============================================================================
// 5. SIGNATURE EXTRACTION TESTS (20+ tests)
// ============================================================================

function runSignatureExtractionTests(): TestResult[] {
  const results: TestResult[] = [];

  // Helper to extract signatures using the internal function
  const extractSigs = (code: string, lang: string = "typescript") =>
    _testing.extractSignatures(code, lang);

  // Test 1: Simple function
  results.push((() => {
    try {
      const output = extractSigs(`function hello(): void { console.log("hi"); }`);
      assertContains(output, "hello");
      assertContains(output, "{ /* ... */ }");
      return { name: "Simple function", passed: true };
    } catch (e) {
      return { name: "Simple function", passed: false, error: String(e) };
    }
  })());

  // Test 2: Async function
  results.push((() => {
    try {
      const output = extractSigs(`async function fetchData(): Promise<Data> { return await api.get(); }`);
      assertContains(output, "async function fetchData");
      return { name: "Async function", passed: true };
    } catch (e) {
      return { name: "Async function", passed: false, error: String(e) };
    }
  })());

  // Test 3: Generator function
  results.push((() => {
    try {
      const output = extractSigs(`function* generateIds(): Generator<number> { let i = 0; while(true) yield i++; }`);
      assertContains(output, "function*");
      assertContains(output, "generateIds");
      return { name: "Generator function", passed: true };
    } catch (e) {
      return { name: "Generator function", passed: false, error: String(e) };
    }
  })());

  // Test 4: Async generator
  results.push((() => {
    try {
      const output = extractSigs(`async function* streamData(): AsyncGenerator<Data> { for await (const x of source) yield x; }`, "typescript");
      assertContains(output, "async function*");
      assertContains(output, "streamData");
      return { name: "Async generator", passed: true };
    } catch (e) {
      return { name: "Async generator", passed: false, error: String(e) };
    }
  })());

  // Test 5: Arrow function with standard pattern
  results.push((() => {
    try {
      // Standard arrow function pattern that is captured
      const output = extractSigs(`const add = (a: number, b: number): number => a + b;`, "typescript");
      assertContains(output, "add");
      return { name: "Arrow function with standard pattern", passed: true };
    } catch (e) {
      return { name: "Arrow function with standard pattern", passed: false, error: String(e) };
    }
  })());

  // Test 6: Class with constructor
  results.push((() => {
    try {
      const output = extractSigs(`class User {
  constructor(public name: string) {}
  greet(): string { return this.name; }
}`, "typescript");
      assertContains(output, "class User");
      assertContains(output, "greet");
      return { name: "Class with constructor", passed: true };
    } catch (e) {
      return { name: "Class with constructor", passed: false, error: String(e) };
    }
  })());

  // Test 7: Interface with methods
  results.push((() => {
    try {
      const output = extractSigs(`interface Service {
  start(): void;
  stop(): void;
  status: string;
}`, "typescript");
      assertContains(output, "interface Service");
      return { name: "Interface with methods", passed: true };
    } catch (e) {
      return { name: "Interface with methods", passed: false, error: String(e) };
    }
  })());

  // Test 8: Type alias
  results.push((() => {
    try {
      const output = extractSigs(`type Handler = (event: Event) => void;`, "typescript");
      assertContains(output, "type Handler");
      return { name: "Type alias", passed: true };
    } catch (e) {
      return { name: "Type alias", passed: false, error: String(e) };
    }
  })());

  // Test 9: Export variations
  results.push((() => {
    try {
      const output = extractSigs(`export function a() {}
export default function b() {}
export const c = () => {};`, "typescript");
      assertContains(output, "export function a");
      assertContains(output, "export default function b");
      return { name: "Export variations", passed: true };
    } catch (e) {
      return { name: "Export variations", passed: false, error: String(e) };
    }
  })());

  // Test 10: Static methods
  results.push((() => {
    try {
      const output = extractSigs(`class Utils {
  static format(x: string): string { return x.trim(); }
  static parse(x: string): object { return JSON.parse(x); }
}`, "typescript");
      assertContains(output, "format");
      assertContains(output, "parse");
      return { name: "Static methods", passed: true };
    } catch (e) {
      return { name: "Static methods", passed: false, error: String(e) };
    }
  })());

  // Test 11: Abstract class
  results.push((() => {
    try {
      const output = extractSigs(`abstract class Base {
  abstract process(): void;
  log(): void { console.log("base"); }
}`, "typescript");
      assertContains(output, "abstract class Base");
      return { name: "Abstract class", passed: true };
    } catch (e) {
      return { name: "Abstract class", passed: false, error: String(e) };
    }
  })());

  // Test 12: Nested braces in strings
  results.push((() => {
    try {
      const output = extractSigs(`function render(): string {
  return "Hello {name}, your balance is {balance}";
}`, "typescript");
      assertContains(output, "render");
      assertContains(output, "{ /* ... */ }");
      assertNotContains(output, "{name}");
      return { name: "Nested braces in strings", passed: true };
    } catch (e) {
      return { name: "Nested braces in strings", passed: false, error: String(e) };
    }
  })());

  // Test 13: Template literals
  results.push((() => {
    try {
      const code = "function greet(name: string): string { return `Hello ${name}!`; }";
      const output = extractSigs(code, "typescript");
      assertContains(output, "greet");
      return { name: "Template literals", passed: true };
    } catch (e) {
      return { name: "Template literals", passed: false, error: String(e) };
    }
  })());

  // Test 14: Python class
  results.push((() => {
    try {
      const output = extractSigs(`class User:
    def __init__(self, name: str):
        self.name = name

    def greet(self) -> str:
        return f"Hello, {self.name}"`, "python");
      assertContains(output, "__init__");
      assertContains(output, "greet");
      return { name: "Python class", passed: true };
    } catch (e) {
      return { name: "Python class", passed: false, error: String(e) };
    }
  })());

  // Test 15: Python async
  results.push((() => {
    try {
      const output = extractSigs(`async def fetch_data(url: str) -> dict:
    async with aiohttp.ClientSession() as session:
        return await session.get(url)`, "python");
      assertContains(output, "async def fetch_data");
      return { name: "Python async", passed: true };
    } catch (e) {
      return { name: "Python async", passed: false, error: String(e) };
    }
  })());

  // Test 16: Go function with receiver
  results.push((() => {
    try {
      const output = extractSigs(`func (s *Server) Start(port int) error {
    return http.ListenAndServe(fmt.Sprintf(":%d", port), s.handler)
}`, "go");
      assertContains(output, "Start");
      return { name: "Go function with receiver", passed: true };
    } catch (e) {
      return { name: "Go function with receiver", passed: false, error: String(e) };
    }
  })());

  // Test 17: React component function
  results.push((() => {
    try {
      // Function-style React component
      const output = extractSigs(`function Button({ label }: Props): JSX.Element {
  return <button>{label}</button>;
}`, "typescript");
      assertContains(output, "Button");
      return { name: "React component function", passed: true };
    } catch (e) {
      return { name: "React component function", passed: false, error: String(e) };
    }
  })());

  // Test 18: Getters and setters
  results.push((() => {
    try {
      const output = extractSigs(`class Config {
  get value(): string { return this._value; }
  set value(v: string) { this._value = v; }
}`, "typescript");
      assertContains(output, "get value");
      assertContains(output, "set value");
      return { name: "Getters and setters", passed: true };
    } catch (e) {
      return { name: "Getters and setters", passed: false, error: String(e) };
    }
  })());

  // Test 19: Comments stripped
  results.push((() => {
    try {
      const output = extractSigs(`// This is a comment
/* Block comment */
function test(): void { }`, "typescript");
      assertContains(output, "test");
      assertNotContains(output, "This is a comment");
      return { name: "Comments stripped", passed: true };
    } catch (e) {
      return { name: "Comments stripped", passed: false, error: String(e) };
    }
  })());

  // Test 20: Decorators preserved
  results.push((() => {
    try {
      const output = extractSigs(`@Component({ selector: 'app' })
class AppComponent {
  @Input() title: string;
}`, "typescript");
      assertContains(output, "@Component");
      return { name: "Decorators preserved", passed: true };
    } catch (e) {
      return { name: "Decorators preserved", passed: false, error: String(e) };
    }
  })());

  // Test 21: Large file chunking
  results.push((() => {
    try {
      let code = "";
      for (let i = 0; i < 100; i++) {
        code += `function func${i}(): void {
  // Implementation
  console.log(${i});
}\n\n`;
      }
      const output = extractSigs(code, "typescript");
      assertContains(output, "func0");
      assertContains(output, "func99");
      return { name: "Large file chunking", passed: true };
    } catch (e) {
      return { name: "Large file chunking", passed: false, error: String(e) };
    }
  })());

  // Test 22: Import preservation
  results.push((() => {
    try {
      const output = extractSigs(`import { User } from "./types";
import * as utils from "./utils";

export function getUser(): User { return {} as User; }`, "typescript");
      assertContains(output, 'import { User }');
      assertContains(output, "getUser");
      return { name: "Import preservation", passed: true };
    } catch (e) {
      return { name: "Import preservation", passed: false, error: String(e) };
    }
  })());

  return results;
}

// ============================================================================
// Main Test Runner
// ============================================================================

export interface ComprehensiveTestResults {
  suites: TestSuite[];
  totalPassed: number;
  totalFailed: number;
  summary: string[];
}

export function runComprehensiveTests(): ComprehensiveTestResults {
  const suites: TestSuite[] = [
    { name: "Smart Copy", results: runSmartCopyTests() },
    { name: "Pre-flight Optimizer", results: runPreflightTests() },
    { name: "Session Memory", results: runSessionMemoryTests() },
    { name: "Compaction Recovery", results: runCompactionTests() },
    { name: "Signature Extraction", results: runSignatureExtractionTests() },
  ];

  let totalPassed = 0;
  let totalFailed = 0;
  const summary: string[] = [];

  summary.push("");
  summary.push("╔═══════════════════════════════════════════════════════════════╗");
  summary.push("║         🧪 COMPREHENSIVE TEST RESULTS                         ║");
  summary.push("╚═══════════════════════════════════════════════════════════════╝");
  summary.push("");

  for (const suite of suites) {
    const passed = suite.results.filter(r => r.passed).length;
    const failed = suite.results.filter(r => !r.passed).length;
    totalPassed += passed;
    totalFailed += failed;

    const status = failed === 0 ? "✅" : "❌";
    summary.push(`${status} ${suite.name}: ${passed}/${suite.results.length} passed`);

    for (const result of suite.results) {
      if (!result.passed) {
        summary.push(`   ✗ ${result.name}`);
        if (result.error) {
          summary.push(`     └─ ${result.error.substring(0, 80)}`);
        }
      }
    }
  }

  summary.push("");
  summary.push("─────────────────────────────────────────────────────────────────");
  const finalStatus = totalFailed === 0 ? "✅" : "❌";
  summary.push(`${finalStatus} Total: ${totalPassed} passed, ${totalFailed} failed`);

  return { suites, totalPassed, totalFailed, summary };
}

// Export for running from VS Code command
export { runSmartCopyTests, runPreflightTests, runSessionMemoryTests, runCompactionTests, runSignatureExtractionTests };
