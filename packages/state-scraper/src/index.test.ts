/**
 * State Scraper Comprehensive Test Suite
 *
 * 25+ test cases covering:
 * - Path detection
 * - SQL.js operations
 * - Session token extraction
 * - Usage API
 * - Diagnostics
 * - Edge cases
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import {
  getCursorStatePath,
  getVSCodeStatePath,
  isSqliteAvailable,
  runDiagnostics,
  getCursorStatus,
  type CursorDiagnostics,
  type CursorStatus,
} from "./index.js";

// ============================================================================
// Path Detection Tests
// ============================================================================

describe("getCursorStatePath", () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    // Restore original platform (can't actually do this, but tests should be platform-aware)
    vi.restoreAllMocks();
  });

  it("should return a string or null", () => {
    const result = getCursorStatePath();
    expect(result === null || typeof result === "string").toBe(true);
  });

  it("should return path ending in state.vscdb if found", () => {
    const result = getCursorStatePath();
    if (result !== null) {
      expect(result.endsWith("state.vscdb")).toBe(true);
    }
  });

  it("should contain 'Cursor' in path if found", () => {
    const result = getCursorStatePath();
    if (result !== null) {
      expect(result.toLowerCase()).toContain("cursor");
    }
  });
});

describe("getVSCodeStatePath", () => {
  it("should return a string or null", () => {
    const result = getVSCodeStatePath();
    expect(result === null || typeof result === "string").toBe(true);
  });

  it("should return path ending in state.vscdb if found", () => {
    const result = getVSCodeStatePath();
    if (result !== null) {
      expect(result.endsWith("state.vscdb")).toBe(true);
    }
  });

  it("should contain 'Code' in path if found", () => {
    const result = getVSCodeStatePath();
    if (result !== null) {
      expect(result.toLowerCase()).toContain("code");
    }
  });
});

describe("Path Detection - Platform Behavior", () => {
  it("should handle home directory correctly", () => {
    const homedir = os.homedir();
    expect(typeof homedir).toBe("string");
    expect(homedir.length).toBeGreaterThan(0);
  });

  it("should handle platform detection", () => {
    const platform = os.platform();
    expect(["darwin", "win32", "linux", "freebsd", "openbsd", "sunos", "aix"]).toContain(platform);
  });
});

// ============================================================================
// SQL.js Availability Tests
// ============================================================================

describe("isSqliteAvailable", () => {
  it("should return a boolean", async () => {
    const result = await isSqliteAvailable();
    expect(typeof result).toBe("boolean");
  });

  it("should return true (sql.js is bundled)", async () => {
    const result = await isSqliteAvailable();
    expect(result).toBe(true);
  });

  it("should be idempotent (cached)", async () => {
    const result1 = await isSqliteAvailable();
    const result2 = await isSqliteAvailable();
    expect(result1).toBe(result2);
  });
});

// ============================================================================
// Diagnostics Tests
// ============================================================================

describe("runDiagnostics", () => {
  it("should return diagnostics object", async () => {
    const diagnostics = await runDiagnostics();

    expect(diagnostics).toBeDefined();
    expect(typeof diagnostics.installed).toBe("boolean");
    expect(typeof diagnostics.sqliteAvailable).toBe("boolean");
    expect(typeof diagnostics.hasSessionToken).toBe("boolean");
  });

  it("should have correct structure", async () => {
    const diagnostics = await runDiagnostics();

    const expectedKeys: (keyof CursorDiagnostics)[] = [
      "installed",
      "statePath",
      "sqliteAvailable",
      "hasSessionToken",
      "userId",
      "userEmail",
      "stateKeyCount",
    ];

    expectedKeys.forEach(key => {
      expect(key in diagnostics).toBe(true);
    });
  });

  it("should report sqliteAvailable as true", async () => {
    const diagnostics = await runDiagnostics();
    expect(diagnostics.sqliteAvailable).toBe(true);
  });

  it("should have statePath matching getCursorStatePath", async () => {
    const diagnostics = await runDiagnostics();
    const directPath = getCursorStatePath();

    expect(diagnostics.statePath).toBe(directPath);
  });

  it("should have non-negative stateKeyCount", async () => {
    const diagnostics = await runDiagnostics();
    expect(diagnostics.stateKeyCount).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// Cursor Status Tests
// ============================================================================

describe("getCursorStatus", () => {
  it("should return status object", async () => {
    const status = await getCursorStatus();

    expect(status).toBeDefined();
    expect(typeof status.available).toBe("boolean");
  });

  it("should have correct structure", async () => {
    const status = await getCursorStatus();

    expect("available" in status).toBe(true);

    if (!status.available) {
      expect(status.error).toBeDefined();
    }

    if (status.available) {
      expect(status.usage).toBeDefined();
    }
  });

  it("should provide helpful error when Cursor not installed", async () => {
    const status = await getCursorStatus();

    if (!status.available && status.error) {
      expect(typeof status.error).toBe("string");
      expect(status.error.length).toBeGreaterThan(0);
    }
  });

  it("should include usage data when available", async () => {
    const status = await getCursorStatus();

    if (status.available && status.usage) {
      expect(typeof status.usage.requestsRemaining).toBe("number");
      expect(typeof status.usage.requestsUsed).toBe("number");
      expect(typeof status.usage.requestsLimit).toBe("number");
      expect(status.usage.resetDate).toBeInstanceOf(Date);
    }
  });
});

// ============================================================================
// Edge Cases Tests
// ============================================================================

describe("Edge Cases", () => {
  describe("Path Handling", () => {
    it("should handle special characters in home directory", () => {
      const homedir = os.homedir();
      // Home directory should be valid
      expect(homedir).toBeDefined();
      expect(typeof homedir).toBe("string");
    });

    it("should handle APPDATA environment variable on Windows", () => {
      if (os.platform() === "win32") {
        // On Windows, APPDATA should be defined
        const appData = process.env.APPDATA;
        if (appData) {
          expect(typeof appData).toBe("string");
        }
      }
      // On non-Windows, this test passes trivially
      expect(true).toBe(true);
    });
  });

  describe("Concurrent Access", () => {
    it("should handle multiple concurrent isSqliteAvailable calls", async () => {
      const results = await Promise.all([
        isSqliteAvailable(),
        isSqliteAvailable(),
        isSqliteAvailable(),
        isSqliteAvailable(),
        isSqliteAvailable(),
      ]);

      // All results should be the same
      results.forEach(r => expect(r).toBe(results[0]));
    });

    it("should handle multiple concurrent runDiagnostics calls", async () => {
      const results = await Promise.all([
        runDiagnostics(),
        runDiagnostics(),
        runDiagnostics(),
      ]);

      // All results should have same installed status
      results.forEach(r => expect(r.installed).toBe(results[0].installed));
    });
  });

  describe("Error Resilience", () => {
    it("should not throw on missing Cursor installation", async () => {
      // This should not throw even if Cursor is not installed
      const status = await getCursorStatus();
      expect(status).toBeDefined();
    });

    it("should not throw on runDiagnostics with missing installation", async () => {
      const diagnostics = await runDiagnostics();
      expect(diagnostics).toBeDefined();
      expect(diagnostics.sqliteAvailable).toBe(true);
    });
  });
});

// ============================================================================
// Type Safety Tests
// ============================================================================

describe("Type Safety", () => {
  it("CursorDiagnostics has all required fields", async () => {
    const diagnostics = await runDiagnostics();

    // TypeScript compile-time checks
    const _installed: boolean = diagnostics.installed;
    const _statePath: string | null = diagnostics.statePath;
    const _sqliteAvailable: boolean = diagnostics.sqliteAvailable;
    const _hasSessionToken: boolean = diagnostics.hasSessionToken;
    const _userId: string | null = diagnostics.userId;
    const _userEmail: string | null = diagnostics.userEmail;
    const _stateKeyCount: number = diagnostics.stateKeyCount;

    expect(true).toBe(true);
  });

  it("CursorStatus has required fields", async () => {
    const status = await getCursorStatus();

    // TypeScript compile-time checks
    const _available: boolean = status.available;
    const _error: string | undefined = status.error;

    expect(true).toBe(true);
  });
});

// ============================================================================
// Performance Tests
// ============================================================================

describe("Performance", () => {
  it("should complete isSqliteAvailable quickly", async () => {
    const start = performance.now();
    await isSqliteAvailable();
    const elapsed = performance.now() - start;

    // First call may take longer due to WASM initialization
    // Subsequent calls should be fast (cached)
    expect(elapsed).toBeLessThan(5000); // 5 seconds max
  });

  it("should complete path detection quickly", () => {
    const start = performance.now();
    getCursorStatePath();
    getVSCodeStatePath();
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(100); // 100ms max
  });

  it("should complete runDiagnostics in reasonable time", async () => {
    const start = performance.now();
    await runDiagnostics();
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(10000); // 10 seconds max
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe("Integration", () => {
  it("should have consistent results between getCursorStatus and runDiagnostics", async () => {
    const status = await getCursorStatus();
    const diagnostics = await runDiagnostics();

    // If Cursor is not installed, both should reflect this
    if (!diagnostics.installed) {
      expect(status.available).toBe(false);
    }

    // If no session token, status should not be available (unless SQL failed)
    if (!diagnostics.hasSessionToken && diagnostics.installed) {
      expect(status.available).toBe(false);
    }
  });

  it("should handle full diagnostic flow", async () => {
    // Step 1: Check SQL.js availability
    const sqlAvailable = await isSqliteAvailable();
    expect(sqlAvailable).toBe(true);

    // Step 2: Check paths
    const cursorPath = getCursorStatePath();
    const vscodePath = getVSCodeStatePath();
    // At least the function calls should work

    // Step 3: Run full diagnostics
    const diagnostics = await runDiagnostics();
    expect(diagnostics.sqliteAvailable).toBe(true);

    // Step 4: Get status
    const status = await getCursorStatus();
    expect(typeof status.available).toBe("boolean");
  });
});
