#!/usr/bin/env node
/**
 * F16 — Dedup-VoI Read Gate hook (PreToolUse on Read).
 *
 * Before a file read executes, check whether the identical content is provably
 * still in context (same content hash, same compaction epoch). If so, the read
 * delivers nothing new, so — once promoted — the gate blocks it and tells the
 * agent the file is already resident from an earlier turn. Zero information loss:
 * a deny only ever fires on a proven duplicate.
 *
 *   - disabled         → no-op.
 *   - shadow (default) → maintain the resident set + record telemetry; never block.
 *   - canary | general → block a proven duplicate read (the agent keeps the
 *                        copy it already has). PRUNE_READ_GATE_WARN_ONLY=1 demotes
 *                        a deny to a non-blocking advisory.
 *
 * Compaction epoch is derived from the transcript: when the turn count shrinks
 * (a compaction occurred), the epoch advances and residency is cleared, so the
 * gate never denies across a compaction boundary.
 *
 * Partial reads (offset/limit) are always ALLOWED — we can't prove the same
 * slice is resident. Deterministic (hash state machine), fail-safe, no model.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createHash, randomBytes } from "node:crypto";

import { loadCachedSessionView } from "@prune/telemetry";
import { countTokens } from "@prune/tokenizer";
import { sha256Hex } from "@prune/shared/node";
import { isFeatureEnabled, isFeatureInShadow, validateFlags } from "@prune/shared";
import { evaluateRead, recordRead, emptyResidentSet } from "@prune/read-gate";

import {
  emitAdditionalContext,
  emitBlock,
  emitNoop,
  readHookPayload,
  safeRun,
} from "./_runtime.mjs";
import {
  deriveSessionId,
  recordFeatureEventBestEffort,
  stableId,
} from "./_telemetry.mjs";

const FEATURE_ID = "f16";
const FLAG_PATH = join(homedir(), ".prune", "feature-flags.json");
const STATE_DIR = join(homedir(), ".prune", "cache");

function flagsFromDisk() {
  try {
    return validateFlags(JSON.parse(readFileSync(FLAG_PATH, "utf8")));
  } catch {
    return validateFlags(null);
  }
}

function stateFile(transcriptPath) {
  const key = createHash("sha256").update(transcriptPath).digest("hex").slice(0, 16);
  return join(STATE_DIR, `read-gate-${key}.json`);
}

function loadState(path) {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    if (raw && typeof raw === "object" && raw.set && typeof raw.set === "object") {
      return {
        epoch: Number.isInteger(raw.epoch) ? raw.epoch : 0,
        lastMsgCount: Number.isInteger(raw.lastMsgCount) ? raw.lastMsgCount : 0,
        set: raw.set,
      };
    }
  } catch {
    /* fall through to fresh state */
  }
  return { epoch: 0, lastMsgCount: 0, set: emptyResidentSet(0) };
}

function saveState(path, state) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
    writeFileSync(tmp, JSON.stringify(state), "utf8");
    renameSync(tmp, path);
  } catch {
    /* best-effort; a lost write just means a future allow */
  }
}

safeRun(async () => {
  const payload = await readHookPayload();
  if (payload.tool_name !== "Read") return emitNoop();
  const input = payload.tool_input;
  if (!input || typeof input.file_path !== "string") return emitNoop();

  // Partial reads can't be proven resident — always allow.
  if (input.offset !== undefined || input.limit !== undefined) return emitNoop();

  const flags = flagsFromDisk();
  const enabled = isFeatureEnabled(flags, FEATURE_ID);
  const shadow = isFeatureInShadow(flags, FEATURE_ID);
  if (!enabled && !shadow) return emitNoop();

  let content;
  try {
    content = readFileSync(input.file_path, "utf8");
  } catch {
    return emitNoop(); // unreadable/binary/missing → can't gate
  }

  const transcriptPath =
    typeof payload.transcript_path === "string" ? payload.transcript_path : "";
  const path = stateFile(transcriptPath || input.file_path);
  const state = loadState(path);

  // Epoch from compaction: a shrunk transcript means context was compacted.
  let msgCount = state.lastMsgCount;
  let currentTurn = 0;
  if (transcriptPath) {
    const view = await loadCachedSessionView(transcriptPath);
    const turns = Array.isArray(view?.turns) ? view.turns : [];
    msgCount = turns.length;
    currentTurn = turns.length > 0 ? turns[turns.length - 1].turnNumber : 0;
  }
  const epoch = msgCount < state.lastMsgCount ? state.epoch + 1 : state.epoch;

  const req = {
    path: input.file_path,
    contentHash: sha256Hex(content),
    turn: currentTurn,
    tokens: countTokens(content),
    epoch,
  };

  const verdict = evaluateRead(state.set, req);
  const nextSet = recordRead(state.set, req);
  saveState(path, { epoch, lastMsgCount: msgCount, set: nextSet });

  if (verdict.decision === "deny" && verdict.reclaimedTokens > 0) {
    await recordFeatureEventBestEffort({
      featureId: FEATURE_ID,
      qualityProof: {
        kind: "read-gate",
        path: req.path,
        reclaimedTokens: verdict.reclaimedTokens,
        firstReadTurn: verdict.firstReadTurn,
      },
      sessionId: deriveSessionId(payload),
      eventId: `f16-${stableId(req.path + req.contentHash).slice(0, 16)}`,
      model: payload.model ?? null,
      latencyMs: 0,
    });
  }

  if (!enabled || verdict.decision === "allow") return emitNoop();

  const message =
    `📑 Read gate: ${req.path} is already in context (unchanged since turn ` +
    `${verdict.firstReadTurn ?? "?"}). Skipping the re-read saves ~` +
    `${verdict.reclaimedTokens} tokens.`;
  const warnOnly = process.env.PRUNE_READ_GATE_WARN_ONLY === "1";

  if (warnOnly) {
    return emitAdditionalContext(message, payload.hook_event_name ?? "PreToolUse", {
      reclaimed_tokens: verdict.reclaimedTokens,
      path: req.path,
    });
  }

  return emitBlock(message, {
    reclaimed_tokens: verdict.reclaimedTokens,
    path: req.path,
    first_read_turn: verdict.firstReadTurn,
  });
});
