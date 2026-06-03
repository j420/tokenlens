#!/usr/bin/env node
/**
 * F6 — Context-Health Advisor hook (UserPromptSubmit).
 *
 * Reads the live transcript via @prune/telemetry's SessionCache (O(Δ)
 * per invocation), runs ContextHealthDetector against the new turns,
 * and emits an `additionalContext` advisory ONLY when:
 *   - the feature flag is `enabled && (general | canary)`, AND
 *   - the current observation's regime is "warning" or "critical".
 *
 * Detector state is persisted between invocations under
 *   ~/.prune/cache/context-health-<sha256(transcriptPath)[:16]>.json
 * with atomic tmp+rename writes, so two parallel hook processes can't
 * tear the JSON.
 *
 * SHADOW MODE: detector still runs, sink rows are recorded (when the
 * sink is reachable), but no `additionalContext` is emitted. The hook
 * is a pure no-op at the user surface until f6 is promoted.
 *
 * NEVER blocks. NEVER throws. NEVER calls a model.
 */

import { loadCachedSessionView } from "@prune/telemetry";
import {
  buildAdvisory,
  ContextHealthDetector,
  resolveConfig,
} from "@prune/context-health";
import { isFeatureEnabled, validateFlags } from "@prune/shared";
import {
  createHash,
  randomBytes,
} from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  emitAdditionalContext,
  emitNoop,
  readHookPayload,
  safeRun,
} from "./_runtime.mjs";
import {
  deriveSessionId,
  recordFeatureEventBestEffort,
  stableId,
} from "./_telemetry.mjs";

const FLAG_PATH = join(homedir(), ".prune", "feature-flags.json");
const STATE_DIR = join(homedir(), ".prune", "cache");

function flagsFromDisk() {
  try {
    return validateFlags(JSON.parse(readFileSync(FLAG_PATH, "utf8")));
  } catch {
    return validateFlags(null);
  }
}

function statePathFor(transcriptPath) {
  const hash = createHash("sha256")
    .update(transcriptPath)
    .digest("hex")
    .slice(0, 16);
  return join(STATE_DIR, `context-health-${hash}.json`);
}

function loadDetectorState(statePath, config) {
  try {
    const raw = JSON.parse(readFileSync(statePath, "utf8"));
    return ContextHealthDetector.fromJSON(config, raw);
  } catch {
    return new ContextHealthDetector(config);
  }
}

function saveDetectorState(statePath, detector) {
  try {
    mkdirSync(dirname(statePath), { recursive: true });
    const json = JSON.stringify(detector.toJSON());
    const tmp = `${statePath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    writeFileSync(tmp, json, "utf8");
    renameSync(tmp, statePath);
  } catch (err) {
    process.stderr.write(`prune-hook: failed to persist context-health state: ${err?.message ?? err}\n`);
  }
}

safeRun(async () => {
  const payload = await readHookPayload();
  if (!payload.transcript_path) return emitNoop();

  const flags = flagsFromDisk();
  const config = resolveConfig(process.env);

  const view = await loadCachedSessionView(payload.transcript_path);
  if (view.turns.length < 2) return emitNoop();

  const statePath = statePathFor(payload.transcript_path);
  const detector = loadDetectorState(statePath, config);

  // Cache reset (file shrank / rotated) ⇒ start fresh.
  let lastObservedTurn = detector.current.cusum.lastTurnNumber;
  if (view.reset) {
    detector.markCompaction(view.turns[0]?.turnNumber ?? 1);
    lastObservedTurn = -1;
  }

  let lastObservation = null;
  for (const turn of view.turns) {
    if (turn.turnNumber <= lastObservedTurn) continue;
    const recent = view.turns.filter((t) => t.turnNumber <= turn.turnNumber);
    lastObservation = detector.observe(turn, recent);
  }

  saveDetectorState(statePath, detector);

  const advisory =
    lastObservation && !lastObservation.skipped
      ? buildAdvisory(lastObservation)
      : null;

  // Shadow-aware f6 telemetry: record the regime when an advisory is produced
  // (records regardless of the flag; only the surfaced advisory below is
  // gated). PII-safe: regime label only, never transcript content.
  if (advisory) {
    const latestTurn = view.turns[view.turns.length - 1]?.turnNumber ?? view.turns.length;
    await recordFeatureEventBestEffort({
      featureId: "f6",
      qualityProof: {
        schemaVersion: 1,
        featureId: "f6",
        regime: typeof lastObservation.regime === "string" ? lastObservation.regime : null,
      },
      sessionId: deriveSessionId(payload),
      eventId: `f6-${stableId(payload.transcript_path, String(latestTurn))}`,
    });
  }

  if (!isFeatureEnabled(flags, "f6")) return emitNoop();
  if (!advisory) return emitNoop();

  return emitAdditionalContext(
    advisory.text,
    payload.hook_event_name ?? "UserPromptSubmit"
  );
});
