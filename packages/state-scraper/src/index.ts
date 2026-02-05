/**
 * @prune/state-scraper
 * Read Cursor's local state for zero-key usage tracking
 * 
 * Cursor stores session data in a local SQLite database.
 * We can read usage information without requiring API keys.
 */

import Database from "better-sqlite3";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { type CursorUsage } from "@prune/shared";

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

interface StateRow {
  key: string;
  value: string;
}

/**
 * Read a value from the state database
 */
export function readStateValue(dbPath: string, key: string): string | null {
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    
    const stmt = db.prepare("SELECT value FROM ItemTable WHERE key = ?");
    const row = stmt.get(key) as StateRow | undefined;
    
    db.close();
    
    return row?.value ?? null;
  } catch (error) {
    console.error("Failed to read state value:", error);
    return null;
  }
}

/**
 * Read all state keys (for debugging/exploration)
 */
export function readAllStateKeys(dbPath: string): string[] {
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    
    const stmt = db.prepare("SELECT key FROM ItemTable");
    const rows = stmt.all() as Array<{ key: string }>;
    
    db.close();
    
    return rows.map((r) => r.key);
  } catch (error) {
    console.error("Failed to read state keys:", error);
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
export function getCursorSessionToken(): string | null {
  const dbPath = getCursorStatePath();
  if (!dbPath) return null;

  return readStateValue(dbPath, CURSOR_STATE_KEYS.SESSION_TOKEN);
}

/**
 * Get Cursor user ID
 */
export function getCursorUserId(): string | null {
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
  const sessionToken = getCursorSessionToken();
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

  // Initial read
  for (const key of keysToWatch) {
    lastValues[key] = readStateValue(dbPath, key);
  }

  // Poll for changes
  const interval = setInterval(() => {
    for (const key of keysToWatch) {
      const currentValue = readStateValue(dbPath, key);
      if (currentValue !== lastValues[key]) {
        callback(key, currentValue);
        lastValues[key] = currentValue;
      }
    }
  }, pollIntervalMs);

  // Return cleanup function
  return () => {
    clearInterval(interval);
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
export function runDiagnostics(): CursorDiagnostics {
  const statePath = getCursorStatePath();
  const installed = statePath !== null;

  let hasSessionToken = false;
  let userId: string | null = null;
  let stateKeyCount = 0;

  if (statePath) {
    hasSessionToken = getCursorSessionToken() !== null;
    userId = getCursorUserId();
    stateKeyCount = readAllStateKeys(statePath).length;
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
