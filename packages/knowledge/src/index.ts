/**
 * @prune/knowledge — f21 Repository Knowledge Compiler + f22 Proof-Carrying
 * Asset Store ("Verified Repo Memory": memory under warranty).
 *
 * f21 compiles a repository into a deterministic, content-SHA-keyed asset
 * (symbols, dependency edges, ownership, churn signals) with incremental
 * recompilation. f22 stores knowledge entries whose provenance is mandatory
 * and re-validated on every read: entries invalidated by code change demote
 * themselves; writes are sentinel-screened and content-addressed; optional
 * Ed25519 signatures bind authorship. No model calls and no regex anywhere
 * in decision logic.
 */

export * from "./types.js";
export * from "./codeowners.js";
export * from "./compiler.js";
export * from "./store.js";
