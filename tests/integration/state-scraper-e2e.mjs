#!/usr/bin/env node
/**
 * State-scraper end-to-end with synthetic Cursor environment.
 *
 * Tests the two paths the user pushed back on:
 *   1. "No Cursor installed" — actually create a real-shape SQLite DB
 *      at $HOME/.config/Cursor/User/globalStorage/state.vscdb with
 *      the expected ItemTable schema, populated with realistic
 *      session-token + user-info rows.
 *   2. "No Anthropic / cursor.com keys" — spin up a local HTTP server
 *      that speaks the same shape as www.cursor.com/api/usage and
 *      route the global fetch() to it via undici MockAgent.
 *
 * Verifies the full read-then-fetch flow works end to end:
 *   getCursorSessionToken() → reads from synthetic SQLite
 *   fetchCursorUsage() → calls (mocked) https://www.cursor.com/api/usage
 *   runDiagnostics() → composes both
 */

import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from "undici";

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) { passed++; console.log("  ✓ " + name); }
  else { failed++; failures.push({ name, detail }); console.log("  ✗ " + name + (detail ? "  (" + detail + ")" : "")); }
}
function section(label) { console.log("\n=== " + label + " ==="); }

// ============================================================================
// 1. Synthetic Cursor SQLite database
// ============================================================================

section("Synthetic Cursor SQLite — fixture setup");

const fakeHome = mkdtempSync(join(tmpdir(), "fake-cursor-home-"));
const dbDir = join(fakeHome, ".config", "Cursor", "User", "globalStorage");
mkdirSync(dbDir, { recursive: true });
const dbPath = join(dbDir, "state.vscdb");

// Build the SQLite database with sql.js (same package state-scraper uses).
const initSqlJs = (await import("sql.js")).default;
const SQL = await initSqlJs();
const db = new SQL.Database();
db.run(`
  CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT);
`);
db.run("INSERT INTO ItemTable VALUES (?, ?)", [
  "cursorAuth/accessToken",
  "fake-session-token-AbCdEf123456",
]);
db.run("INSERT INTO ItemTable VALUES (?, ?)", [
  "cursorAuth/cachedEmail",
  "test-dev@example.com",
]);
db.run("INSERT INTO ItemTable VALUES (?, ?)", [
  "cursor.userId",
  "user_01HZ987",
]);
db.run("INSERT INTO ItemTable VALUES (?, ?)", [
  "cursor.authState",
  "authenticated",
]);

const fs = await import("node:fs");
fs.writeFileSync(dbPath, Buffer.from(db.export()));
db.close();

const stat = fs.statSync(dbPath);
check("synthetic state.vscdb created", stat.size > 0,
  `${stat.size} bytes at ${dbPath}`);

// ============================================================================
// 2. Mock cursor.com/api/usage server (via undici MockAgent)
// ============================================================================

section("Mock cursor.com Usage API — fixture setup");

const mockAgent = new MockAgent();
mockAgent.disableNetConnect();
setGlobalDispatcher(mockAgent);

const mockBody = {
  "gpt-4": {
    numRequests: 137,
    maxRequestUsage: 500,
    numTokens: 4_521_338,
    maxTokenUsage: null,
  },
  "gpt-3.5-turbo": {
    numRequests: 482,
    maxRequestUsage: null,
    numTokens: 18_244_001,
    maxTokenUsage: null,
  },
  startOfMonth: "2026-05-01T00:00:00.000Z",
};

const pool = mockAgent.get("https://www.cursor.com");
pool.intercept({ method: "GET", path: "/api/usage" })
  .reply(200, mockBody, { headers: { "content-type": "application/json" } })
  .times(10);

check("mockAgent configured", typeof getGlobalDispatcher() === "object");

// ============================================================================
// 3. Drive state-scraper against the synthetic environment
// ============================================================================

section("Read path — getCursorStatePath / getCursorSessionToken");

const realHome = process.env.HOME;
process.env.HOME = fakeHome;

const ss = await import("@prune/state-scraper");
ss.resetSqlCache();

const resolvedPath = ss.getCursorStatePath();
check("getCursorStatePath finds the synthetic DB", resolvedPath === dbPath,
  `got=${resolvedPath} expected=${dbPath}`);

const token = await ss.getCursorSessionToken();
check("getCursorSessionToken reads the token", token === "fake-session-token-AbCdEf123456",
  `got=${token?.slice(0, 20)}...`);

const userId = await ss.getCursorUserId();
check("getCursorUserId reads the user id", userId === "user_01HZ987",
  `got=${userId}`);

const email = await ss.getCursorUserEmail();
check("getCursorUserEmail reads the email", email === "test-dev@example.com",
  `got=${email}`);

const allKeys = await ss.readAllStateKeys(dbPath);
check("readAllStateKeys returns 4 keys", allKeys.length === 4,
  `keys=${allKeys.join(", ")}`);

// ============================================================================
// 4. fetchCursorUsage hits the mock server
// ============================================================================

section("Fetch path — fetchCursorUsage / fetchCursorUsageDetailed");

const usage = await ss.fetchCursorUsage();
check("fetchCursorUsage hit the mock server",
  usage !== null,
  `got=${JSON.stringify(usage)?.slice(0, 100)}`);
check("fetchCursorUsage parsed requestsUsed",
  usage?.requestsUsed === 137,
  `requestsUsed=${usage?.requestsUsed}`);
check("fetchCursorUsage parsed requestsLimit",
  usage?.requestsLimit === 500,
  `requestsLimit=${usage?.requestsLimit}`);
check("fetchCursorUsage parsed requestsRemaining",
  usage?.requestsRemaining === 363,
  `requestsRemaining=${usage?.requestsRemaining}`);
check("fetchCursorUsage detected plan=pro (>150 max)",
  usage?.plan === "pro",
  `plan=${usage?.plan}`);
check("fetchCursorUsage resetDate is a Date",
  usage?.resetDate instanceof Date);

const detailed = await ss.fetchCursorUsageDetailed();
check("fetchCursorUsageDetailed returns raw shape",
  detailed?.["gpt-4"]?.numRequests === 137);
check("fetchCursorUsageDetailed includes gpt-3.5-turbo",
  detailed?.["gpt-3.5-turbo"]?.numRequests === 482);

// ============================================================================
// 5. runDiagnostics composes everything
// ============================================================================

section("Composed — runDiagnostics");

const diag = await ss.runDiagnostics();
check("runDiagnostics.installed = true", diag.installed === true);
check("runDiagnostics.sqliteAvailable = true", diag.sqliteAvailable === true);
check("runDiagnostics.hasSessionToken = true", diag.hasSessionToken === true);
check("runDiagnostics.userId matches", diag.userId === "user_01HZ987");
check("runDiagnostics.userEmail matches", diag.userEmail === "test-dev@example.com");
check("runDiagnostics.stateKeyCount = 4", diag.stateKeyCount === 4);

// ============================================================================
// 6. Negative paths
// ============================================================================

section("Negative — missing DB, bad path, no token");

process.env.HOME = "/tmp/nonexistent-home-for-cursor-" + Date.now();
const nullPath = ss.getCursorStatePath();
check("getCursorStatePath returns null when no DB", nullPath === null);

process.env.HOME = fakeHome;
const badDb = join(dbDir, "empty.vscdb");
const SQL2 = await initSqlJs();
const db2 = new SQL2.Database();
db2.run("CREATE TABLE ItemTable (key TEXT, value TEXT)");
fs.writeFileSync(badDb, Buffer.from(db2.export()));
db2.close();

const nullToken = await ss.readStateValue(badDb, "cursorAuth/accessToken");
check("readStateValue returns null when key missing", nullToken === null);

// ============================================================================
// Cleanup
// ============================================================================

process.env.HOME = realHome;
rmSync(fakeHome, { recursive: true, force: true });

console.log("\n" + "=".repeat(60));
console.log("State-scraper E2E: " + passed + " passed, " + failed + " failed");
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log("  ✗ " + f.name + (f.detail ? "\n    " + f.detail : ""));
}
console.log("=".repeat(60));
process.exit(failed > 0 ? 1 : 0);
