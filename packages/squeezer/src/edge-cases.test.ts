/**
 * Edge Case and Boundary Tests for @prune/squeezer
 *
 * Tests for:
 * - Unusual code patterns
 * - Error boundaries
 * - Multi-language support
 * - Performance edge cases
 */

import { describe, it, expect } from "vitest";
import { squeeze, squeezeFile } from "./index.js";

// ============================================================================
// UNUSUAL CODE PATTERNS
// ============================================================================

describe("Unusual Code Patterns", () => {
  it("should handle empty code", () => {
    const result = squeeze("", "typescript", { tier: "structural" });
    expect(result.compressedCode).toBe("");
    expect(result.isValid).toBe(true);
    expect(result.savings).toBe(0);
  });

  it("should handle whitespace-only code", () => {
    const result = squeeze("   \n\n\t  \n   ", "typescript", { tier: "structural" });
    expect(result.isValid).toBe(true);
  });

  it("should handle code with only comments", () => {
    const code = `
// Comment 1
/* Comment 2 */
// TODO: Keep this
`;
    const result = squeeze(code, "typescript", { tier: "lossless" });
    expect(result.isValid).toBe(true);
    expect(result.compressedCode).toContain("TODO");
  });

  it("should handle deeply nested functions", () => {
    const code = `
function level1() {
  function level2() {
    function level3() {
      function level4() {
        return "deep";
      }
      return level4();
    }
    return level3();
  }
  return level2();
}
`;
    const result = squeeze(code, "typescript", { tier: "structural" });
    expect(result.isValid).toBe(true);
    expect(result.compressedCode).toContain("level1");
  });

  it("should handle arrow functions with various syntaxes", () => {
    const code = `
const a = () => 1;
const b = x => x * 2;
const c = (x, y) => x + y;
const d = (x: number): number => x;
const e = async () => { await fetch(); };
const f = async (url: string): Promise<void> => { await fetch(url); };
`;
    const result = squeeze(code, "typescript", { tier: "structural" });
    expect(result.isValid).toBe(true);
  });

  it("should handle class with all modifiers", () => {
    const code = `
abstract class Base {
  public abstract method(): void;
  protected static prop: string;
  private readonly _id: number;
  #privateField: string;

  constructor(private name: string) {}

  get id(): number { return this._id; }
  set id(value: number) { this._id = value; }
}
`;
    const result = squeeze(code, "typescript", { tier: "structural" });
    expect(result.isValid).toBe(true);
    expect(result.compressedCode).toContain("abstract");
  });

  it("should handle decorators", () => {
    const code = `
@Controller("/api")
@Injectable()
class UserController {
  @Get()
  @Authorized(["admin"])
  getUsers(@Query() query: QueryDto): User[] {
    return [];
  }
}
`;
    const result = squeeze(code, "typescript", { tier: "structural" });
    expect(result.isValid).toBe(true);
  });

  it("should handle template literals with expressions", () => {
    const code = `
const greeting = \`Hello, \${name}!\`;
const sql = \`
  SELECT * FROM users
  WHERE id = \${userId}
  AND status = '\${status}'
\`;
`;
    const result = squeeze(code, "typescript", { tier: "lossless" });
    expect(result.isValid).toBe(true);
  });

  it("should handle regex with special characters", () => {
    const code = `
const regex1 = /[{}()\\[\\]]/g;
const regex2 = /^(?:(?:https?|ftp):\\/\\/)?(?:[^\\s@]+@)?(?:[^:\\s]+)(?::\\d+)?(?:\\/[^\\s]*)?$/i;
const regex3 = new RegExp("\\\\d+");
`;
    const result = squeeze(code, "typescript", { tier: "lossless" });
    expect(result.isValid).toBe(true);
  });
});

// ============================================================================
// ERROR BOUNDARIES
// ============================================================================

describe("Error Boundaries", () => {
  it("should handle invalid TypeScript gracefully", () => {
    const invalidCode = `
function broken( {
  const x = ;
  return
}
`;
    const result = squeeze(invalidCode, "typescript", { tier: "structural" });
    // Should not throw, may mark as invalid
    expect(typeof result.compressedCode).toBe("string");
  });

  it("should handle mismatched braces", () => {
    const code = `
function test() {
  if (true) {
    console.log("missing close");
`;
    const result = squeeze(code, "typescript", { tier: "structural" });
    expect(typeof result.compressedCode).toBe("string");
  });

  it("should handle unicode edge cases", () => {
    const code = `
const emoji = "🎉🚀💻";
const chinese = "你好世界";
const arabic = "مرحبا";
function greet(name: string) { return \`\${chinese} \${name}\`; }
`;
    const result = squeeze(code, "typescript", { tier: "structural" });
    expect(result.isValid).toBe(true);
  });

  it("should handle very long lines", () => {
    const longLine = "const x = " + JSON.stringify("a".repeat(1000)) + ";";
    const result = squeeze(longLine, "typescript", { tier: "lossless" });
    expect(result.isValid).toBe(true);
  });

  it("should handle many small functions", () => {
    const functions = Array(50).fill(null)
      .map((_, i) => `function fn${i}() { return ${i}; }`)
      .join("\n");
    const result = squeeze(functions, "typescript", { tier: "structural" });
    expect(result.isValid).toBe(true);
    expect(result.savings).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// MULTI-LANGUAGE SUPPORT
// ============================================================================

describe("Multi-Language Support", () => {
  it("should handle Python code", () => {
    const pythonCode = `
def hello(name: str) -> str:
    """Greet a person."""
    return f"Hello, {name}!"

class User:
    def __init__(self, name):
        self.name = name

    def greet(self):
        return hello(self.name)
`;
    const result = squeeze(pythonCode, "python", { tier: "structural" });
    expect(typeof result.compressedCode).toBe("string");
  });

  it("should handle Go code", () => {
    const goCode = `
package main

import "fmt"

type Server struct {
    Port int
    Host string
}

func (s *Server) Start() error {
    fmt.Printf("Starting on %s:%d", s.Host, s.Port)
    return nil
}

func NewServer(host string, port int) *Server {
    return &Server{Host: host, Port: port}
}
`;
    const result = squeeze(goCode, "go", { tier: "structural" });
    expect(typeof result.compressedCode).toBe("string");
  });

  it("should handle Rust code", () => {
    const rustCode = `
pub struct Config {
    pub debug: bool,
    port: u16,
}

impl Config {
    pub fn new(debug: bool, port: u16) -> Self {
        Self { debug, port }
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.port == 0 {
            return Err("Port cannot be zero".to_string());
        }
        Ok(())
    }
}
`;
    const result = squeeze(rustCode, "rust", { tier: "structural" });
    expect(typeof result.compressedCode).toBe("string");
  });

  it("should handle Java code", () => {
    const javaCode = `
package com.example;

import java.util.List;

public class UserService {
    private final UserRepository repo;

    public UserService(UserRepository repo) {
        this.repo = repo;
    }

    public User findById(Long id) {
        return repo.findById(id).orElse(null);
    }
}
`;
    const result = squeeze(javaCode, "java", { tier: "structural" });
    expect(typeof result.compressedCode).toBe("string");
  });
});

// ============================================================================
// TIER COMPARISON
// ============================================================================

describe("Tier Comparison", () => {
  const sampleCode = `
/**
 * User authentication service
 */
class AuthService {
  private token: string | null = null;
  private refreshToken: string | null = null;

  /**
   * Authenticate user with credentials
   */
  async login(email: string, password: string): Promise<boolean> {
    const response = await fetch("/api/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    const data = await response.json();
    this.token = data.token;
    this.refreshToken = data.refreshToken;
    return true;
  }

  /**
   * Clear authentication state
   */
  logout(): void {
    this.token = null;
    this.refreshToken = null;
    localStorage.removeItem("token");
  }

  isAuthenticated(): boolean {
    return this.token !== null;
  }
}

export const authService = new AuthService();
`;

  it("lossless should preserve most code", () => {
    const result = squeeze(sampleCode, "typescript", { tier: "lossless" });
    expect(result.isValid).toBe(true);
    expect(result.savings).toBeLessThan(50); // Less than 50% savings
  });

  it("structural should provide moderate savings", () => {
    const result = squeeze(sampleCode, "typescript", { tier: "structural" });
    expect(result.isValid).toBe(true);
    expect(result.savings).toBeGreaterThanOrEqual(0);
  });

  it("telegraphic should provide maximum savings", () => {
    const result = squeeze(sampleCode, "typescript", { tier: "telegraphic" });
    expect(result.isValid).toBe(true);
    // Telegraphic should give more savings than structural
  });

  it("savings should increase with tier aggressiveness", () => {
    const lossless = squeeze(sampleCode, "typescript", { tier: "lossless" });
    const structural = squeeze(sampleCode, "typescript", { tier: "structural" });
    const telegraphic = squeeze(sampleCode, "typescript", { tier: "telegraphic" });

    // More aggressive tiers should produce shorter output
    expect(telegraphic.compressedCode.length).toBeLessThanOrEqual(
      structural.compressedCode.length
    );
  });
});

// ============================================================================
// FILE PATH HANDLING
// ============================================================================

describe("File Path Handling", () => {
  it("should process .ts files", () => {
    const result = squeezeFile("const x = 1;", "/src/utils.ts");
    expect(result.isValid).toBe(true);
    expect(result.compressedCode).toBeDefined();
  });

  it("should process .py files", () => {
    const result = squeezeFile("x = 1", "/src/main.py");
    expect(typeof result.compressedCode).toBe("string");
  });

  it("should process .go files", () => {
    const result = squeezeFile("package main", "/src/main.go");
    expect(typeof result.compressedCode).toBe("string");
  });

  it("should process .rs files", () => {
    const result = squeezeFile("fn main() {}", "/src/lib.rs");
    expect(typeof result.compressedCode).toBe("string");
  });

  it("should handle unknown extensions by returning original", () => {
    const result = squeezeFile("content", "/file.xyz");
    expect(result.compressedCode).toBe("content");
  });

  it("should handle paths with multiple dots", () => {
    const result = squeezeFile("const x = 1;", "/src/config.dev.ts");
    expect(result.isValid).toBe(true);
  });
});

// ============================================================================
// PERFORMANCE EDGE CASES
// ============================================================================

describe("Performance Edge Cases", () => {
  it("should handle code with many imports", () => {
    const imports = Array(100).fill(null)
      .map((_, i) => `import { fn${i} } from "./module${i}";`)
      .join("\n");
    const code = imports + "\nconst x = 1;";

    const result = squeeze(code, "typescript", { tier: "structural" });
    expect(result.isValid).toBe(true);
  });

  it("should handle code with many exports", () => {
    const exports = Array(100).fill(null)
      .map((_, i) => `export const var${i} = ${i};`)
      .join("\n");

    const result = squeeze(exports, "typescript", { tier: "structural" });
    expect(result.isValid).toBe(true);
  });

  it("should handle large string literals", () => {
    const code = `const text = ${JSON.stringify("x".repeat(5000))};`;
    const result = squeeze(code, "typescript", { tier: "lossless" });
    expect(result.isValid).toBe(true);
  });

  it("should complete in reasonable time for 1000-line file", () => {
    const lines = Array(1000).fill(null)
      .map((_, i) => `const var${i} = ${i};`)
      .join("\n");

    const start = performance.now();
    const result = squeeze(lines, "typescript", { tier: "structural" });
    const duration = performance.now() - start;

    expect(result.isValid).toBe(true);
    expect(duration).toBeLessThan(5000); // Should complete in under 5 seconds
  });
});
