/**
 * MCP handlers for f21+f22 Verified Repo Memory (@prune/knowledge).
 *
 * The warranty travels through the protocol: every read re-validates
 * provenance NOW (a stale entry is never served as fresh), writes go
 * through the sentinel screens and the contradiction rule inside the
 * store, and rejections come back as structured errors, never thrown.
 * `memory_store` is the ONLY mutating tool and writes solely under the
 * target repo's `.prune/knowledge/` — no global state.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  KnowledgeStore,
  compile,
  loadCompiled,
  recompile,
  saveCompiled,
} from "@prune/knowledge";

function J(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function repoRootOf(args: unknown): string | { error: string } {
  if (args === null || typeof args !== "object") {
    return { error: "expected an object with { repoRoot: string }" };
  }
  const repoRoot = (args as Record<string, unknown>).repoRoot;
  if (typeof repoRoot !== "string" || repoRoot.length === 0) {
    return { error: "repoRoot must be a non-empty string" };
  }
  return repoRoot;
}

export function handleKnowledgeCompile(args: unknown): string {
  const repoRoot = repoRootOf(args);
  if (typeof repoRoot !== "string") return J(repoRoot);
  try {
    const prev = loadCompiled(repoRoot);
    const result = prev === null ? compile(repoRoot) : recompile(repoRoot, prev);
    if ("error" in result) return J({ error: result.error });
    saveCompiled(repoRoot, result.asset);
    return J({
      contentHash: result.asset.contentHash,
      files: result.asset.files.length,
      symbols: result.asset.files.reduce((n, f) => n + f.symbols.length, 0),
      edges: result.asset.edges.length,
      truncated: result.asset.truncated,
      incremental: prev !== null,
      codeownersSkipped: result.codeownersSkipped,
      unreadable: result.unreadable,
    });
  } catch (e) {
    return J({ error: e instanceof Error ? e.message : String(e) });
  }
}

export function handleMemorySearch(args: unknown): string {
  const repoRoot = repoRootOf(args);
  if (typeof repoRoot !== "string") return J(repoRoot);
  const a = args as Record<string, unknown>;
  if (typeof a.query !== "string" || a.query.length === 0) {
    return J({ error: "query must be a non-empty string" });
  }
  try {
    const { store, invalidEntries } = KnowledgeStore.open(repoRoot);
    const hits = store.search(a.query, {
      limit: typeof a.limit === "number" && Number.isInteger(a.limit) && a.limit > 0 ? a.limit : 10,
      includeStale: a.includeStale === true,
    });
    return J({ hits, invalidEntries });
  } catch (e) {
    return J({ error: e instanceof Error ? e.message : String(e) });
  }
}

export function handleMemoryGet(args: unknown): string {
  const repoRoot = repoRootOf(args);
  if (typeof repoRoot !== "string") return J(repoRoot);
  const a = args as Record<string, unknown>;
  if (typeof a.id !== "string" || a.id.length !== 64) {
    return J({ error: "id must be a 64-char content hash" });
  }
  try {
    const { store } = KnowledgeStore.open(repoRoot);
    const got = store.retrieve(a.id, { includeStale: a.includeStale === true });
    if (got === null) {
      return J({
        error:
          "entry not found, demoted, or stale (pass includeStale: true to inspect a stale entry)",
      });
    }
    return J(got);
  } catch (e) {
    return J({ error: e instanceof Error ? e.message : String(e) });
  }
}

export function handleMemoryStore(args: unknown): string {
  const repoRoot = repoRootOf(args);
  if (typeof repoRoot !== "string") return J(repoRoot);
  const a = args as Record<string, unknown>;
  if (typeof a.key !== "string" || a.key.length === 0) {
    return J({ error: "key must be a non-empty string (the logical subject)" });
  }
  if (typeof a.content !== "string" || a.content.length === 0) {
    return J({ error: "content must be a non-empty string" });
  }
  if (
    a.sourcePaths === undefined ||
    !Array.isArray(a.sourcePaths) ||
    a.sourcePaths.length === 0 ||
    !a.sourcePaths.every((p) => typeof p === "string" && p.length > 0)
  ) {
    return J({
      error:
        "sourcePaths must be a non-empty array of repo-relative paths — provenance is mandatory; memory without sources is unverifiable and refused",
    });
  }
  try {
    // Provenance SHAs are computed HERE from the current tree, not accepted
    // from the caller: a caller-supplied SHA could cite bytes that never
    // existed, breaking the warranty at the front door.
    const sourceShas: Record<string, string> = {};
    for (const p of a.sourcePaths as string[]) {
      try {
        sourceShas[p] = createHash("sha256")
          .update(readFileSync(join(repoRoot, p)))
          .digest("hex");
      } catch {
        return J({ error: `source path does not exist in the repo: ${p}` });
      }
    }
    const { store } = KnowledgeStore.open(repoRoot);
    const result = store.store({
      kind: "discovery",
      key: a.key,
      content: a.content,
      sourceShas,
      createdBy: "agent",
    });
    if ("rejected" in result) return J({ error: result.reason });
    return J({ stored: { id: result.id, key: result.key, status: result.status } });
  } catch (e) {
    return J({ error: e instanceof Error ? e.message : String(e) });
  }
}

export function handleMemoryValidate(args: unknown): string {
  const repoRoot = repoRootOf(args);
  if (typeof repoRoot !== "string") return J(repoRoot);
  try {
    const { store, invalidEntries } = KnowledgeStore.open(repoRoot);
    const verdicts = store.validateAll();
    return J({
      verdicts,
      fresh: verdicts.filter((v) => v.fresh).length,
      stale: verdicts.filter((v) => !v.fresh).length,
      invalidEntries,
    });
  } catch (e) {
    return J({ error: e instanceof Error ? e.message : String(e) });
  }
}
