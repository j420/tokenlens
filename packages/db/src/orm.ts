/**
 * ORM re-exports for downstream Prune packages.
 *
 * `@prune/db` is the single package in the monorepo that depends on
 * `drizzle-orm` and the `postgres` (postgres-js) driver. Other packages that
 * need to compose the Drizzle query builder against the shared schema — e.g.
 * `@prune/persistence`'s PostgresSink — import these symbols from here instead
 * of taking their own direct `drizzle-orm` / `postgres` dependency. That keeps
 * the driver version pinned in exactly one place (no version skew, no lockfile
 * duplication) and means a consumer only needs the internal `@prune/db`
 * workspace dependency.
 */

export {
  and,
  asc,
  desc,
  eq,
  gte,
  lte,
  sql,
} from "drizzle-orm";
export { drizzle } from "drizzle-orm/postgres-js";
export { default as postgres } from "postgres";
