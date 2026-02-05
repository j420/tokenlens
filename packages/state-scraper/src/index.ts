/**
 * @prune/state-scraper
 * Read Cursor's local state for zero-key usage tracking
 *
 * Cursor stores session data in a local SQLite database.
 * We can read usage information without requiring API keys.
 *
 * Uses sql.js (pure JavaScript/WebAssembly) - no native compilation required.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const initSqlJs = require("sql.js");

import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { type CursorUsage } from "@prune/shared";

// Type definitions for sql.js
interface SqlJsDatabase {
  run(sql: string, params?: unknown[]): void;
  exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
  prepare(sql: string): SqlJsStatement;
  close(): void;
}

interface SqlJsStatement {
  bind(params?: unknown[]): boolean;
  step(): boolean;
  getAsObject(params?: unknown): Record<string, unknown>;
  free(): boolean;
  run(params?: unknown[]): void;
  reset(): void;
}

interface SqlJsStatic {
  Database: new (data?: ArrayLike<number> | Buffer | null) => SqlJsDatabase;
}

// Cache the SQL.js initialization
let sqlJsInstance: SqlJsStatic | null = null;

async function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsInstance) {
    sqlJsInstance = await initSqlJs() as SqlJsStatic;
  }
  return sqlJsInstance!;
}

// ============================================================================
// Path Detection
// ============================================================================

/**
 * Get the path to Cursor's state database
 */
export function getCursorStatePath(): string | null {
  const platform = os.platform();
  let basePath: string;

  switch (platform) {
    case "darwin": // macOS
      basePath = path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "Cursor",
        "User",
        "globalStorage"
      );
      break;
    case "win32": // Windows
      basePath = path.join(
        process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
        "Cursor",
        "User",
        "globalStorage"
      );
      break;
    case "linux":
      basePath = path.join(os.homedir(), ".config", "Cursor", "User", "globalStorage");
      break;
    default:
      return null;
  }

  const dbPath = path.join(basePath, "state.vscdb");

  if (fs.existsSync(dbPath)) {
    return dbPath;
  }

  return null;
}

/**
 * Get the path to VS Code's state database (fallback)
 */
export function getVSCodeStatePath(): string | null {
  const platform = os.platform();
  let basePath: string;

  switch (platform) {
    case "darwin":
      basePath = path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "Code",
        "User",
        "globalStorage"
      );
      break;
    case "win32":
      basePath = path.join(
        process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
        "Code",
        "User",
        "globalStorage"
      );
      break;
    case "linux":
      basePath = path.join(os.homedir(), ".config", "Code", "User", "globalStorage");
      break;
    default:
      return null;
  }

  const dbPath = path.join(basePath, "state.vscdb");

  if (fs.existsSync(dbPath)) {
    return dbPath;
  }

  return null;
}

// ============================================================================
// Database Operations
// ============================================================================

/**
 * Open a SQLite database using sql.js
 */
async function openDatabase(dbPath: string): Promise<SqlJsDatabase | null> {
  try {
    const SQL = await getSqlJs();
    const buffer = fs.readFileSync(dbPath);
    return new SQL.Database(buffer);
  } catch (error) {
    console.error("Failed to open database:", error);
    return null;
  }
}

/**
 * Read a value from the state database
 */
export async function readStateValue(dbPath: string, key: string): Promise<string | null> {
  const db = await openDatabase(dbPath);
  if (!db) return null;

  try {
    const stmt = db.prepare("SELECT value FROM ItemTable WHERE key = ?");
    stmt.bind([key]);

    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      db.close();
      return (row.value as string) ?? null;
    }

    stmt.free();
    db.close();
    return null;
  } catch (error) {
    console.error("Failed to read state value:", error);
    db.close();
    return null;
  }
}

/**
 * Read all state keys (for debugging/exploration)
 */
export async function readAllStateKeys(dbPath: string): Promise<string[]> {
  const db = await openDatabase(dbPath);
  if (!db) return [];

  try {
    const results = db.exec("SELECT key FROM ItemTable");
    db.close();

    if (results.length === 0) return [];

    return results[0].values.map((row: unknown[]) => row[0] as string);
  } catch (error) {
    console.error("Failed to read state keys:", error);
    db.close();
    return [];
  }
}

// ============================================================================
// Cursor-Specific Functions
// ============================================================================

/**
 * Known Cursor state keys
 */
const CURSOR_STATE_KEYS = {
  SESSION_TOKEN: "workos.cursorSessionToken",
  USER_ID: "cursor.userId",
  WORKSPACE_ID: "cursor.workspaceId",
  AUTH_STATE: "cursor.authState",
};

/**
 * Get Cursor session token for API access
 */
export async function getCursorSessionToken(): Promise<string | null> {
  const dbPath = getCursorStatePath();
  if (!dbPath) return null;

  return readStateValue(dbPath, CURSOR_STATE_KEYS.SESSION_TOKEN);
}

/**
 * Get Cursor user ID
 */
export async function getCursorUserId(): Promise<string | null> {
  const dbPath = getCursorStatePath();
  if (!dbPath) return null;

  return readStateValue(dbPath, CURSOR_STATE_KEYS.USER_ID);
}

// ============================================================================
// Usage API (requires session token)
// ============================================================================

interface CursorUsageResponse {
  usage: {
    requests_remaining: number;
    requests_used: number;
    requests_limit: number;
    reset_at: string;
  };
  plan: {
    type: string;
  };
}

/**
 * Fetch usage data from Cursor's API using the session token
 */
export async function fetchCursorUsage(): Promise<CursorUsage | null> {
  const sessionToken = await getCursorSessionToken();
  if (!sessionToken) {
    console.error("No Cursor session token found");
    return null;
  }

  try {
    const response = await fetch("https://api.cursor.com/usage", {
      headers: {
        Authorization: "Bearer " + sessionToken,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.error("Failed to fetch Cursor usage:", response.statusText);
      return null;
    }

    const data = (await response.json()) as CursorUsageResponse;

    return {
      requestsRemaining: data.usage.requests_remaining,
      requestsUsed: data.usage.requests_used,
      requestsLimit: data.usage.requests_limit,
      resetDate: new Date(data.usage.reset_at),
      plan: data.plan.type as "free" | "pro" | "business",
    };
  } catch (error) {
    console.error("Failed to fetch Cursor usage:", error);
    return null;
  }
}

// ============================================================================
// State Watcher
// ============================================================================

type StateChangeCallback = (key: string, value: string | null) => void;

/**
 * Watch for changes to the state database
 */
export function watchCursorState(
  callback: StateChangeCallback,
  pollIntervalMs: number = 5000
): () => void {
  const dbPath = getCursorStatePath();
  if (!dbPath) {
    console.error("Cursor state database not found");
    return () => {};
  }

  let lastValues: Record<string, string | null> = {};
  const keysToWatch = Object.values(CURSOR_STATE_KEYS);
  let isRunning = true;

  // Initial read and setup polling
  const poll = async () => {
    if (!isRunning) return;

    for (const key of keysToWatch) {
      const currentValue = await readStateValue(dbPath, key);
      if (currentValue !== lastValues[key]) {
        if (lastValues[key] !== undefined) {
          // Only callback after initial read
          callback(key, currentValue);
        }
        lastValues[key] = currentValue;
      }
    }

    if (isRunning) {
      setTimeout(poll, pollIntervalMs);
    }
  };

  // Start polling
  poll();

  // Return cleanup function
  return () => {
    isRunning = false;
  };
}

// ============================================================================
// Diagnostics
// ============================================================================

export interface CursorDiagnostics {
  installed: boolean;
  statePath: string | null;
  hasSessionToken: boolean;
  userId: string | null;
  stateKeyCount: number;
}

/**
 * Run diagnostics on Cursor installation
 */
export async function runDiagnostics(): Promise<CursorDiagnostics> {
  const statePath = getCursorStatePath();
  const installed = statePath !== null;

  let hasSessionToken = false;
  let userId: string | null = null;
  let stateKeyCount = 0;

  if (statePath) {
    hasSessionToken = (await getCursorSessionToken()) !== null;
    userId = await getCursorUserId();
    stateKeyCount = (await readAllStateKeys(statePath)).length;
  }

  return {
    installed,
    statePath,
    hasSessionToken,
    userId,
    stateKeyCount,
  };
}

// Re-export types
export { CursorUsage };
