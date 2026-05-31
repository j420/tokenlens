#!/usr/bin/env node
/**
 * Replay Recorder hook — appends a tamper-evident audit record to the
 * local ReplayVault every time it fires. Designed for Stop and
 * PostToolUse events. Idempotent: re-firing on the same turn writes a
 * new sequence entry whose payload includes a deterministic content
 * hash, so duplicates are detectable downstream without breaking the
 * chain.
 *
 * Satisfies the cite-able trio for procurement (see vault.ts header):
 *   - EU AI Act Article 12 (logging, effective Aug 2 2026)
 *   - ISO/IEC 42001 A.6.1.6
 *   - NIST AI RMF Measure 2.5
 *
 * Configuration:
 *   PRUNE_VAULT_DISABLED   Set "1" to make the hook a no-op.
 *   PRUNE_VAULT_SQLITE     Override the vault db path (~/.prune/vault.sqlite).
 *   PRUNE_VAULT_KEY        Override the signer key path (~/.prune/keys/replay.pem).
 */

import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { LocalSqliteSink } from "@prune/persistence";
import { ReplayVault } from "@prune/replay-vault";

import {
  emitNoop,
  readHookPayload,
  safeRun,
} from "./_runtime.mjs";

const DEFAULT_DB = join(homedir(), ".prune", "vault.sqlite");

function resolveDbPath() {
  const p = process.env.PRUNE_VAULT_SQLITE || DEFAULT_DB;
  mkdirSync(dirname(p), { recursive: true });
  return p;
}

safeRun(async () => {
  if (process.env.PRUNE_VAULT_DISABLED === "1") return emitNoop();
  const payload = await readHookPayload();
  if (!payload.hook_event_name) return emitNoop();

  const sink = new LocalSqliteSink({ path: resolveDbPath() });
  try {
    await sink.init();
  } catch {
    // Another process holds the init lock — don't break the agent.
    return emitNoop();
  }

  const vault = new ReplayVault(sink, { keyPath: process.env.PRUNE_VAULT_KEY });
  const sessionId =
    payload.session_id ||
    payload.transcript_path ||
    "unattached-" + new Date().toISOString().slice(0, 10);

  await vault.append({
    sessionId,
    kind: "system",
    payload: {
      hook_event_name: payload.hook_event_name,
      tool_name: payload.tool_name ?? null,
      transcript_path: payload.transcript_path ?? null,
      // Include the raw payload, modulo any path that could carry secrets
      // (transcripts themselves stay outside the vault — only the
      // metadata about which transcript this event belongs to lands here).
    },
    metadata: {
      signer_fingerprint: vault.fingerprint(),
      hook_event: payload.hook_event_name,
    },
  });
  await sink.close();
  return emitNoop();
});
