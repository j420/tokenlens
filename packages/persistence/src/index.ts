/**
 * @prune/persistence
 *
 * Storage backends for Prune's cost-intelligence data. LocalSqliteSink is
 * the default (zero native binaries, WASM SQLite). PostgresSink — for team
 * deployments — will adapt the existing @prune/db Drizzle client; until
 * then enterprise installs can still capture events locally and replay
 * them via the same interface.
 */

export * from "./sink.js";
export * from "./local-sqlite.js";
export * from "./feature-event.js";
