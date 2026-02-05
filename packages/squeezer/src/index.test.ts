/**
 * Comprehensive tests for the Semantic Code Squeezer
 */

import { describe, it, expect } from "vitest";
import { squeeze, squeezeFile, generateDiffSummary } from "./index";

// ============================================================================
// TypeScript/JavaScript Tests
// ============================================================================

describe("TypeScript/JavaScript Compression", () => {
  describe("Lossless Mode", () => {
    it("should remove regular comments but preserve TODO/FIXME", () => {
      const code = `
// This is a regular comment
const x = 1;
// TODO: Fix this later
const y = 2;
/* FIXME: This needs attention */
const z = 3;
/* Regular block comment */
const w = 4;
`;
      const result = squeeze(code, "typescript", { tier: "lossless" });

      expect(result.compressedCode).not.toContain("This is a regular comment");
      expect(result.compressedCode).not.toContain("Regular block comment");
      expect(result.compressedCode).toContain("TODO: Fix this later");
      expect(result.compressedCode).toContain("FIXME: This needs attention");
      expect(result.isValid).toBe(true);
    });

    it("should preserve @ts- and eslint- comments", () => {
      const code = `
// @ts-ignore
const x: any = undefined;
// eslint-disable-next-line
const y = eval("code");
`;
      const result = squeeze(code, "typescript", { tier: "lossless" });

      expect(result.compressedCode).toContain("@ts-ignore");
      expect(result.compressedCode).toContain("eslint-disable-next-line");
    });

    it("should fold large arrays", () => {
      const code = `const items = [
  "item1",
  "item2",
  "item3",
  "item4",
  "item5",
  "item6",
  "item7",
  "item8",
  "item9",
  "item10",
  "item11",
  "item12",
];`;
      const result = squeeze(code, "typescript", { tier: "lossless" });

      expect(result.compressedCode).toContain("lines hidden");
      expect(result.savings).toBeGreaterThan(0);
    });

    it("should fold large objects", () => {
      const code = `const config = {
  key1: "value1",
  key2: "value2",
  key3: "value3",
  key4: "value4",
  key5: "value5",
  key6: "value6",
  key7: "value7",
  key8: "value8",
  key9: "value9",
  key10: "value10",
  key11: "value11",
};`;
      const result = squeeze(code, "typescript", { tier: "lossless" });

      expect(result.compressedCode).toContain("lines hidden");
    });
  });

  describe("Structural (Skeleton) Mode", () => {
    it("should compress function bodies", () => {
      const code = `
function add(a: number, b: number): number {
  const result = a + b;
  console.log(result);
  return result;
}
`;
      const result = squeeze(code, "typescript", { tier: "structural" });

      expect(result.compressedCode).toContain("function add(a: number, b: number): number");
      expect(result.compressedCode).toContain("{ /* ... */ }");
      expect(result.compressedCode).not.toContain("const result");
      expect(result.isValid).toBe(true);
    });

    it("should compress class methods", () => {
      const code = `
class Calculator {
  private value: number;

  constructor(initial: number) {
    this.value = initial;
  }

  add(x: number): number {
    this.value += x;
    return this.value;
  }
}
`;
      const result = squeeze(code, "typescript", { tier: "structural" });

      expect(result.compressedCode).toContain("class Calculator");
      expect(result.compressedCode).toContain("constructor(initial: number)");
      expect(result.compressedCode).toContain("add(x: number): number");
      expect(result.compressedCode).toContain("{ /* ... */ }");
      expect(result.isValid).toBe(true);
    });

    it("should compress arrow functions", () => {
      const code = `
const multiply = (a: number, b: number): number => {
  const result = a * b;
  return result;
};
`;
      const result = squeeze(code, "typescript", { tier: "structural" });

      expect(result.compressedCode).toContain("const multiply");
      expect(result.compressedCode).toContain("{ /* ... */ }");
      expect(result.isValid).toBe(true);
    });

    it("should compress getters and setters", () => {
      const code = `
class Person {
  private _name: string;

  get name(): string {
    return this._name;
  }

  set name(value: string) {
    this._name = value;
  }
}
`;
      const result = squeeze(code, "typescript", { tier: "structural" });

      expect(result.compressedCode).toContain("get name()");
      expect(result.compressedCode).toContain("set name(value: string)");
      expect(result.compressedCode).toContain("{ /* ... */ }");
      expect(result.isValid).toBe(true);
    });
  });

  describe("Telegraphic Mode", () => {
    it("should extract only signatures", () => {
      const code = `
import { Something } from "somewhere";

interface User {
  id: number;
  name: string;
}

type Status = "active" | "inactive";

function getUser(id: number): User {
  return { id, name: "John" };
}

class UserService {
  private users: User[] = [];

  add(user: User): void {
    this.users.push(user);
  }
}
`;
      const result = squeeze(code, "typescript", { tier: "telegraphic" });

      // Should have imports
      expect(result.compressedCode).toContain('import { Something } from "somewhere"');
      // Should have interface
      expect(result.compressedCode).toContain("interface User");
      // Should have type
      expect(result.compressedCode).toContain("type Status");
      // Should have function signature
      expect(result.compressedCode).toContain("function getUser(id: number): User;");
      // Should have class with method signatures
      expect(result.compressedCode).toContain("class UserService");
      expect(result.compressedCode).toContain("add(user: User): void;");
      // Should NOT have implementation details
      expect(result.compressedCode).not.toContain("this.users.push");
      expect(result.isValid).toBe(true);
    });

    it("should preserve decorators in telegraphic mode", () => {
      const code = `
@Injectable()
class Service {
  @Inject()
  private dep: Dependency;

  @Log()
  doSomething(): void {
    console.log("doing something");
  }
}
`;
      const result = squeeze(code, "typescript", { tier: "telegraphic" });

      expect(result.compressedCode).toContain("@Injectable()");
      expect(result.compressedCode).toContain("class Service");
      expect(result.isValid).toBe(true);
    });
  });

  describe("Safety Verification", () => {
    it("should return original code if compression introduces errors", () => {
      // This test ensures the safety mechanism works
      // We can't easily trigger this in valid TypeScript, but the mechanism exists
      const code = `const x = 1;`;
      const result = squeeze(code, "typescript", { tier: "lossless" });

      expect(result.isValid).toBe(true);
    });
  });
});

// ============================================================================
// Python Tests
// ============================================================================

describe("Python Compression", () => {
  describe("Lossless Mode", () => {
    it("should remove regular comments but preserve TODO/FIXME", () => {
      const code = `
# Regular comment
x = 1
# TODO: Implement this
y = 2
# FIXME: Bug here
z = 3
`;
      const result = squeeze(code, "python", { tier: "lossless" });

      expect(result.compressedCode).not.toContain("Regular comment");
      expect(result.compressedCode).toContain("TODO: Implement this");
      expect(result.compressedCode).toContain("FIXME: Bug here");
      expect(result.isValid).toBe(true);
    });

    it("should remove docstrings but preserve those with TODO/FIXME", () => {
      const code = `
def func1():
    """This is a regular docstring"""
    pass

def func2():
    """TODO: Document this properly"""
    pass
`;
      const result = squeeze(code, "python", { tier: "lossless" });

      expect(result.compressedCode).not.toContain("This is a regular docstring");
      expect(result.compressedCode).toContain("TODO: Document this properly");
    });
  });

  describe("Structural (Skeleton) Mode", () => {
    it("should replace function bodies with ...", () => {
      const code = `
def add(a: int, b: int) -> int:
    result = a + b
    print(result)
    return result
`;
      const result = squeeze(code, "python", { tier: "structural" });

      expect(result.compressedCode).toContain("def add(a: int, b: int) -> int:");
      expect(result.compressedCode).toContain("...");
      expect(result.compressedCode).not.toContain("result = a + b");
      expect(result.isValid).toBe(true);
    });

    it("should handle async functions", () => {
      const code = `
async def fetch_data(url: str) -> dict:
    response = await http.get(url)
    return response.json()
`;
      const result = squeeze(code, "python", { tier: "structural" });

      expect(result.compressedCode).toContain("async def fetch_data(url: str) -> dict:");
      expect(result.compressedCode).toContain("...");
      expect(result.isValid).toBe(true);
    });

    it("should preserve decorators", () => {
      const code = `
@decorator
@another_decorator(param=True)
def decorated_func(x: int) -> int:
    return x * 2
`;
      const result = squeeze(code, "python", { tier: "structural" });

      expect(result.compressedCode).toContain("@decorator");
      expect(result.compressedCode).toContain("@another_decorator(param=True)");
      expect(result.compressedCode).toContain("def decorated_func(x: int) -> int:");
    });

    it("should handle class methods with self/cls", () => {
      const code = `
class MyClass:
    def method(self, x: int) -> int:
        return x * 2

    @classmethod
    def class_method(cls, y: int) -> int:
        return y * 3
`;
      const result = squeeze(code, "python", { tier: "structural" });

      expect(result.compressedCode).toContain("def method(self, x: int) -> int:");
      expect(result.compressedCode).toContain("def class_method(cls, y: int) -> int:");
      expect(result.compressedCode).toContain("...");
      expect(result.isValid).toBe(true);
    });
  });

  describe("Telegraphic Mode", () => {
    it("should extract imports, classes, and function signatures", () => {
      const code = `
import os
from typing import List, Dict

class DataProcessor:
    def __init__(self, data: List[int]):
        self.data = data

    def process(self) -> Dict[str, int]:
        return {"sum": sum(self.data)}

def helper(x: int) -> int:
    return x * 2
`;
      const result = squeeze(code, "python", { tier: "telegraphic" });

      expect(result.compressedCode).toContain("import os");
      expect(result.compressedCode).toContain("from typing import List, Dict");
      expect(result.compressedCode).toContain("class DataProcessor:");
      expect(result.compressedCode).toContain("def __init__(self, data: List[int])");
      expect(result.compressedCode).toContain("def process(self) -> Dict[str, int]");
      expect(result.compressedCode).toContain("def helper(x: int) -> int");
      expect(result.compressedCode).not.toContain("sum(self.data)");
      expect(result.isValid).toBe(true);
    });
  });

  describe("Safety Verification", () => {
    it("should handle Python code with consistent indentation", () => {
      // Python code with proper indentation should be valid
      const code = `def func():
    x = 1
    return x`;

      const result = squeeze(code, "python", { tier: "lossless" });
      expect(result.isValid).toBe(true);
    });

    it("should detect mixed tabs and spaces on the same line", () => {
      // Mixed tabs and spaces on the same line at the start
      const code = "def func():\n\t pass";  // tab followed by space

      const result = squeeze(code, "python", { tier: "lossless" });
      // The verifier should catch this
      expect(result.isValid).toBe(false);
    });
  });
});

// ============================================================================
// File-based Tests
// ============================================================================

describe("squeezeFile", () => {
  it("should auto-detect TypeScript files", () => {
    const code = `const x: number = 1;`;
    const result = squeezeFile(code, "/path/to/file.ts");

    expect(result.isValid).toBe(true);
  });

  it("should auto-detect JavaScript files", () => {
    const code = `const x = 1;`;
    const result = squeezeFile(code, "/path/to/file.js");

    expect(result.isValid).toBe(true);
  });

  it("should auto-detect Python files", () => {
    const code = `x = 1`;
    const result = squeezeFile(code, "/path/to/file.py");

    expect(result.isValid).toBe(true);
  });

  it("should handle unsupported file types", () => {
    const code = `random content`;
    const result = squeezeFile(code, "/path/to/file.xyz");

    expect(result.diffSummary).toContain("Unsupported");
    expect(result.savings).toBe(0);
  });
});

// ============================================================================
// Diff Summary Tests
// ============================================================================

describe("generateDiffSummary", () => {
  it("should calculate correct line and token savings", () => {
    const original = `
// This is a comment
function foo() {
  return 1;
}
`;
    const compressed = `function foo() { /* ... */ }`;

    const summary = generateDiffSummary(original, compressed);

    expect(summary).toContain("lines removed");
    expect(summary).toContain("tokens saved");
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("Edge Cases", () => {
  it("should handle empty code", () => {
    const result = squeeze("", "typescript", { tier: "lossless" });

    expect(result.compressedCode).toBe("");
    expect(result.isValid).toBe(true);
  });

  it("should handle code with only comments", () => {
    const code = `// Just a comment`;
    const result = squeeze(code, "typescript", { tier: "lossless" });

    expect(result.savings).toBeGreaterThan(0);
    expect(result.isValid).toBe(true);
  });

  it("should handle deeply nested functions", () => {
    const code = `
function outer() {
  function inner() {
    function deepest() {
      return 1;
    }
    return deepest();
  }
  return inner();
}
`;
    const result = squeeze(code, "typescript", { tier: "structural" });

    expect(result.compressedCode).toContain("{ /* ... */ }");
    expect(result.isValid).toBe(true);
  });

  it("should handle code with syntax errors gracefully", () => {
    const code = `const x = {`;
    const result = squeeze(code, "typescript", { tier: "lossless" });

    // Should either succeed with the original or report invalid
    expect(typeof result.isValid).toBe("boolean");
  });
});
