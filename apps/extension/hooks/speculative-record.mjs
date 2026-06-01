#!/usr/bin/env node
/**
 * F3 — Speculative Action Pruner recorder (PostToolUse).
 *
 * Builds the session-scoped speculative cache the PreToolUse advisory reads.
 * After a read-only tool runs, store its result keyed by (tool, canonical
 * input) with the content-SHA freshness token. Runs regardless of the F3 flag
 * — building the cache is harmless and needed for both shadow calibration and
 * the advisory surface; only SURFACING is flag-gated (in speculative-prune.mjs).
 *
 * Only the sound content-SHA scope (Read) is recorded here; dir-scoped scopes
 * (Grep/Glob) need the stronger file-list token and are handled by the SDK
 * adapter where the scanned file set is known.
 */

import {
  SpeculativeCache,
  scopeForToolUse,
  contentToken,
} from "@prune/intelligence";
import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { readHookPayload, emitNoop, safeRun } from "./_runtime.mjs";

const CACHE_DIR = join(homedir(), ".prune", "cache");

function cachePath(transcriptPath) {
  const h = createHash("sha256").update(transcriptPath).digest("hex").slice(0, 16);
  return join(CACHE_DIR, `spec-${h}.json`);
}

function atomicWrite(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, data, "utf8");
  renameSync(tmp, path);
}

safeRun(async () => {
  const payload = await readHookPayload();
  const toolName = payload.tool_name;
  const toolInput = payload.tool_input ?? {};
  if (!toolName || !payload.transcript_path) return emitNoop();

  // Only the content-SHA-sound Read scope is recorded by the hook.
  if (scopeForToolUse(toolName, toolInput) !== "Read") return emitNoop();
  const file = toolInput.file_path ?? toolInput.path;
  if (!file || !existsSync(file)) return emitNoop();

  const cp = cachePath(payload.transcript_path);
  const cache = new SpeculativeCache({ enabledScopes: ["Read"] });
  if (existsSync(cp)) {
    try {
      cache.loadState(JSON.parse(readFileSync(cp, "utf8")));
    } catch {
      // corrupt cache file — start fresh
    }
  }

  // Store the freshly-read content keyed by file, with its content-SHA token.
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    return emitNoop();
  }
  cache.store(toolName, toolInput, content, contentToken(content), 0);
  atomicWrite(cp, JSON.stringify(cache.toJSON()));
  return emitNoop();
});
