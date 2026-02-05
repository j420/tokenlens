/**
 * @prune/state-scraper
 * Read Cursor's local state for zero-key usage tracking
 *
 * Uses sqlite3 CLI via child_process - no WASM, no native bindings.
 * This approach avoids extension activation issues entirely.
 *
 * Flow:
 * 1. Copy state.vscdb to temp file (avoids locking issues)
 * 2. Run sqlite3 CLI to extract session token
 * 3. Call Cursor API with token to get usage stats
 * 4. Clean up temp file
 */

import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { type CursorUsage } from "@prune/shared";

const execAsync = promisify(exec);

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
// SQLite CLI Operations
// ============================================================================

/**
 * Check if sqlite3 CLI is available
 */
export async function isSqliteAvailable(): Promise<boolean> {
  try {
    await execAsync("sqlite3 --version");
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy database to temp file to avoid locking issues
 */
function copyToTemp(dbPath: string): string {
  const tempDir = os.tmpdir();
  const tempFile = path.join(tempDir, `cursor_state_${Date.now()}.db`);
  fs.copyFileSync(dbPath, tempFile);
  return tempFile;
}

/**
 * Clean up temp file
 */
function cleanupTemp(tempFile: string): void {
  try {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Read a value from the state database using sqlite3 CLI
 */
export async function readStateValue(dbPath: string, key: string): Promise<string | null> {
  let tempFile: string | null = null;

  try {
    // Copy to temp to avoid locking the IDE's database
    tempFile = copyToTemp(dbPath);

    // Escape the key for SQL
    const escapedKey = key.replace(/'/g, "''");

    // Run sqlite3 query
    const { stdout } = await execAsync(
      `sqlite3 "${tempFile}" "SELECT value FROM ItemTable WHERE key = '${escapedKey}';"`,
      { timeout: 5000 }
    );

    const value = stdout.trim();
    return value || null;
  } catch (error) {
    console.error("Failed to read state value:", error);
    return null;
  } finally {
    if (tempFile) {
      cleanupTemp(tempFile);
    }
  }
}

/**
 * Read all state keys (for debugging/exploration)
 */
export async function readAllStateKeys(dbPath: string): Promise<string[]> {
  let tempFile: string | null = null;

  try {
    tempFile = copyToTemp(dbPath);

    const { stdout } = await execAsync(
      `sqlite3 "${tempFile}" "SELECT key FROM ItemTable;"`,
      { timeout: 5000 }
    );

    return stdout.trim().split("\n").filter(Boolean);
  } catch (error) {
    console.error("Failed to read state keys:", error);
    return [];
  } finally {
    if (tempFile) {
      cleanupTemp(tempFile);
    }
  }
}

// ============================================================================
// Cursor-Specific Functions
// ============================================================================

/**
 * Known Cursor state keys
 */
const CURSOR_STATE_KEYS = {
  // Primary session token key
  SESSION_TOKEN: "cursorAuth/accessToken",
  // Alternative keys that Cursor might use
  SESSION_TOKEN_ALT: "workos.cursorSessionToken",
  REFRESH_TOKEN: "cursorAuth/refreshToken",
  // User info
  USER_ID: "cursor.userId",
  USER_EMAIL: "cursorAuth/cachedEmail",
  // Workspace
  WORKSPACE_ID: "cursor.workspaceId",
  AUTH_STATE: "cursor.authState",
};

/**
 * Get Cursor session token for API access
 * Tries multiple known key locations
 */
export async function getCursorSessionToken(): Promise<string | null> {
  const dbPath = getCursorStatePath();
  if (!dbPath) return null;

  // Try primary key first
  let token = await readStateValue(dbPath, CURSOR_STATE_KEYS.SESSION_TOKEN);
  if (token) return token;

  // Try alternative key
  token = await readStateValue(dbPath, CURSOR_STATE_KEYS.SESSION_TOKEN_ALT);
  if (token) return token;

  return null;
}

/**
 * Get Cursor user ID
 */
export async function getCursorUserId(): Promise<string | null> {
  const dbPath = getCursorStatePath();
  if (!dbPath) return null;

  return readStateValue(dbPath, CURSOR_STATE_KEYS.USER_ID);
}

/**
 * Get Cursor user email
 */
export async function getCursorUserEmail(): Promise<string | null> {
  const dbPath = getCursorStatePath();
  if (!dbPath) return null;

  return readStateValue(dbPath, CURSOR_STATE_KEYS.USER_EMAIL);
}

// ============================================================================
// Usage API
// ============================================================================

interface CursorUsageApiResponse {
  "gpt-4": {
    numRequests: number;
    maxRequestUsage: number | null;
    numRequestsTotal: number;
    numTokens: number;
  };
  "gpt-3.5-turbo": {
    numRequests: number;
    maxRequestUsage: number | null;
    numRequestsTotal: number;
    numTokens: number;
  };
  "gpt-4o-mini"?: {
    numRequests: number;
    maxRequestUsage: number | null;
    numRequestsTotal: number;
    numTokens: number;
  };
  startOfMonth: string;
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
    // Cursor uses a specific usage endpoint
    const response = await fetch("https://www.cursor.com/api/usage", {
      method: "GET",
      headers: {
        Cookie: `WorkosCursorSessionToken=${sessionToken}`,
        "User-Agent": "Mozilla/5.0 (compatible; Prune/1.0)",
      },
    });

    if (!response.ok) {
      console.error("Failed to fetch Cursor usage:", response.status, response.statusText);
      return null;
    }

    const data = (await response.json()) as CursorUsageApiResponse;

    // Calculate totals from the response
    const gpt4Usage = data["gpt-4"];
    const maxRequests = gpt4Usage.maxRequestUsage ?? 500; // Default to 500 for pro
    const requestsUsed = gpt4Usage.numRequests;
    const requestsRemaining = Math.max(0, maxRequests - requestsUsed);

    // Parse reset date from startOfMonth
    const resetDate = new Date(data.startOfMonth);
    resetDate.setMonth(resetDate.getMonth() + 1); // Reset at start of next month

    return {
      requestsRemaining,
      requestsUsed,
      requestsLimit: maxRequests,
      resetDate,
      plan: maxRequests > 150 ? "pro" : "free",
    };
  } catch (error) {
    console.error("Failed to fetch Cursor usage:", error);
    return null;
  }
}

/**
 * Get detailed usage breakdown by model
 */
export async function fetchCursorUsageDetailed(): Promise<CursorUsageApiResponse | null> {
  const sessionToken = await getCursorSessionToken();
  if (!sessionToken) {
    return null;
  }

  try {
    const response = await fetch("https://www.cursor.com/api/usage", {
      method: "GET",
      headers: {
        Cookie: `WorkosCursorSessionToken=${sessionToken}`,
        "User-Agent": "Mozilla/5.0 (compatible; Prune/1.0)",
      },
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as CursorUsageApiResponse;
  } catch {
    return null;
  }
}

// ============================================================================
// Diagnostics
// ============================================================================

export interface CursorDiagnostics {
  installed: boolean;
  statePath: string | null;
  sqliteAvailable: boolean;
  hasSessionToken: boolean;
  userId: string | null;
  userEmail: string | null;
  stateKeyCount: number;
}

/**
 * Run diagnostics on Cursor installation
 */
export async function runDiagnostics(): Promise<CursorDiagnostics> {
  const statePath = getCursorStatePath();
  const installed = statePath !== null;
  const sqliteAvailable = await isSqliteAvailable();

  let hasSessionToken = false;
  let userId: string | null = null;
  let userEmail: string | null = null;
  let stateKeyCount = 0;

  if (statePath && sqliteAvailable) {
    hasSessionToken = (await getCursorSessionToken()) !== null;
    userId = await getCursorUserId();
    userEmail = await getCursorUserEmail();
    stateKeyCount = (await readAllStateKeys(statePath)).length;
  }

  return {
    installed,
    statePath,
    sqliteAvailable,
    hasSessionToken,
    userId,
    userEmail,
    stateKeyCount,
  };
}

// ============================================================================
// Convenience function for extension
// ============================================================================

export interface CursorStatus {
  available: boolean;
  error?: string;
  usage?: CursorUsage;
  email?: string;
}

/**
 * Get complete Cursor status in one call
 * This is the main function for the VS Code extension to use
 */
export async function getCursorStatus(): Promise<CursorStatus> {
  // Check if sqlite3 is available
  const sqliteOk = await isSqliteAvailable();
  if (!sqliteOk) {
    return {
      available: false,
      error: "sqlite3 CLI not found. Install SQLite to enable Cursor usage tracking.",
    };
  }

  // Check if Cursor is installed
  const dbPath = getCursorStatePath();
  if (!dbPath) {
    return {
      available: false,
      error: "Cursor not installed or state database not found.",
    };
  }

  // Check if we have a session token
  const token = await getCursorSessionToken();
  if (!token) {
    return {
      available: false,
      error: "Not logged into Cursor. Please sign in to Cursor first.",
    };
  }

  // Fetch usage
  const usage = await fetchCursorUsage();
  if (!usage) {
    return {
      available: false,
      error: "Failed to fetch usage from Cursor API. Token may be expired.",
    };
  }

  // Get email for display
  const email = await getCursorUserEmail();

  return {
    available: true,
    usage,
    email: email ?? undefined,
  };
}

// Re-export types
export { CursorUsage };
