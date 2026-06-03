/**
 * @prune/persistence
 *
 * Storage backends for Prune's cost-intelligence data. LocalSqliteSink is
 * the default (zero native binaries, WASM SQLite). PostgresSink — for team /
 * enterprise deployments — adapts the @prune/db Drizzle client, writing to the
 * `persistence_*` lossless-mirror tables so a SQLite -> Postgres export of any
 * row type is byte-for-byte faithful via the same PersistenceSink interface.
 */

export * from "./sink.js";
export * from "./local-sqlite.js";
export * from "./feature-event.js";
export * from "./postgres.js";
export * from "./postgres-mapping.js";
