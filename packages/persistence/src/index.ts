/**
 * @prune/persistence
 *
 * Storage backends for Prune's cost-intelligence data. LocalSqliteSink is
 * the default (zero native binaries, WASM SQLite). PostgresSink — for team /
 * enterprise deployments — adapts the @prune/db Drizzle client, writing to the
 * `persistence_*` mirror tables so a SQLite -> Postgres export of any row type
 * maps onto the same columns via the same PersistenceSink interface.
 *
 * Round-trip fidelity is proven at two levels: the pure row<->column mappers
 * are unit-tested (fromXxx(toXxx(row)) === row for every type), and the SQL
 * query layer is executed against an in-memory PGlite Postgres
 * (postgres.integration.test.ts) which writes then reads back each row type and
 * verifies upsert conflict targets and the replay-log unique index. PGlite is
 * not a byte-identical stand-in for a production server, so a gated live-server
 * smoke test (postgres.live.integration.test.ts) covers the rest — real
 * postgres-js driver result shaping, server numeric/jsonb coercion, pooled
 * concurrency, and the unique-index race. It runs only when PRUNE_PG_TEST_URL
 * points at a throwaway Postgres, and skips otherwise so CI without a DB stays
 * green.
 */

export * from "./sink.js";
export * from "./local-sqlite.js";
export * from "./feature-event.js";
export * from "./forward.js";
export * from "./postgres.js";
export * from "./postgres-mapping.js";
