#!/usr/bin/env node
/**
 * Negative paths: do the packages fail safely when things go wrong?
 * (Corrupted state, missing inputs, malformed payloads, etc.)
 */

import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalSqliteSink } from "@prune/persistence";
import { BudgetGate, BudgetGateError } from "@prune/budget-gate";
import { SloManager, SloManagerError } from "@prune/slo";
import { ReplayVault } from "@prune/replay-vault";
import { scanPromptForSecrets } from "@prune/sentinel";
import { indexRepo } from "@prune/repo-map";
import { classifyRequest, route } from "@prune/router";
import { rollup, decodeDimensions } from "@prune/attribution";
import { analyzeSubagents } from "@prune/intelligence";

const dir = mkdtempSync(join(tmpdir(), "tokenlens-resil-"));
let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push({ name, detail });
    console.log(`  ✗ ${name}${detail ? "  (" + detail + ")" : ""}`);
  }
}
function section(label) { console.log("\n=== " + label + " ==="); }

try {
  // BudgetGate: missing envelope, invalid input
  section("BudgetGate — invalid inputs");
  const sink = new LocalSqliteSink({ path: join(dir, "b.sqlite") });
  await sink.init();
  const gate = new BudgetGate(sink);
  let threw = false;
  try { await gate.check({ envelopeName: "missing", model: "x", estimatedTokensIn: 1 }); }
  catch (e) { threw = e instanceof BudgetGateError; }
  check("check on missing envelope throws BudgetGateError", threw);

  threw = false;
  try { await gate.createEnvelope({ name: "neg", limitUsd: -5, periodKind: "month" }); }
  catch (e) { threw = e instanceof BudgetGateError; }
  check("negative limit throws", threw);

  threw = false;
  try { await gate.createEnvelope({ name: "z", limitUsd: 1, periodKind: "month", softCapPct: 0.9, hardCapPct: 0.5 }); }
  catch (e) { threw = e instanceof BudgetGateError; }
  check("soft > hard throws", threw);

  threw = false;
  try { await gate.createEnvelope({ name: "z", limitUsd: 1, periodKind: "custom" }); }
  catch (e) { threw = e instanceof BudgetGateError; }
  check("custom period without bounds throws", threw);

  // SLO: missing scope
  section("SLO — invalid inputs");
  const mgr = new SloManager(sink);
  threw = false;
  try {
    await mgr.define({
      name: "x", scopeEnvelopeName: "no-such-env",
      targetUsdPerTask: 1, errorBudgetUsd: 1, windowDays: 1,
    });
  } catch (e) { threw = e instanceof SloManagerError; }
  check("SLO on missing envelope throws", threw);

  threw = false;
  try { await mgr.check("no-such-slo"); }
  catch (e) { threw = e instanceof SloManagerError; }
  check("check on missing SLO throws", threw);

  // ReplayVault: tampered payload caught
  section("ReplayVault — tamper detection");
  const vault = new ReplayVault(sink, { keyPath: join(dir, "vault.pem") });
  const r1 = await vault.append({ sessionId: "tamper-1", kind: "request", payload: { q: "real" } });
  // Inject a row whose record_hash doesn't match its payload_canonical.
  await sink.appendReplayLog({
    record_id: "fake-1",
    session_id: "tamper-1",
    sequence: 1,
    timestamp: "2026-05-15T00:00:00.000Z",
    kind: "request",
    payload_canonical: '{"forged":true}',
    record_hash: "0".repeat(64), // bogus hash
    prev_record_hash: r1.record_hash,
    signature: "AA==",
    signer_fingerprint: vault.fingerprint(),
    metadata: {},
  });
  const v = await vault.verify("tamper-1");
  check("vault detects forged payload", !v.ok);
  check("vault reports break sequence", v.brokeAtSequence === 1);

  // Sentinel — handles malformed strings cleanly
  section("Sentinel — degenerate inputs");
  check("empty string → allow", scanPromptForSecrets("").verdict === "allow");
  check("only whitespace → allow", scanPromptForSecrets("   \n\t\n").verdict === "allow");
  // Strings with bytes that could break dumb regex impls
  const tricky = "\x00‮​some\nhello";
  check("nul + bidi + zero-width → allow", scanPromptForSecrets(tricky).verdict === "allow");

  // Router — classifier on empty / garbage
  section("Router — degenerate inputs");
  const c1 = classifyRequest({ prompt: "", estimatedTokensIn: 0 });
  check("empty prompt → standard default", c1.difficulty === "trivial" || c1.difficulty === "standard");
  const c2 = classifyRequest({ prompt: "x".repeat(50_000), estimatedTokensIn: 100_000 });
  const d2 = route(c2);
  check("huge prompt → STRONG via hard rule", d2.tier === "STRONG");

  // Attribution — decode handles random metadata cleanly
  section("Attribution — degenerate metadata");
  const decoded = decodeDimensions({});
  check("empty metadata → empty dims", Object.keys(decoded).length === 0);
  const decodedNoise = decodeDimensions({ random: "x", other: 42 });
  check("non-attribution keys ignored", Object.keys(decodedNoise).length === 0);
  const empty = rollup([], { groupBy: ["developer"] });
  check("rollup on empty charges → empty", empty.length === 0);

  // RepoMap — empty dir
  section("RepoMap — empty dir");
  const emptyDir = mkdtempSync(join(tmpdir(), "empty-"));
  try {
    const m = await indexRepo(emptyDir);
    check("empty dir → zero symbols", m.symbols.length === 0);
    check("empty dir → zero files", m.filesScanned === 0);
  } finally {
    rmSync(emptyDir, { recursive: true, force: true });
  }

  // RepoMap — file that fails to parse
  section("RepoMap — unparseable source");
  const badDir = mkdtempSync(join(tmpdir(), "bad-"));
  writeFileSync(join(badDir, "broken.ts"), "function {{{ not valid \n const x = ");
  writeFileSync(join(badDir, "good.ts"), "export function ok() {}");
  try {
    const m = await indexRepo(badDir);
    // The TS parser is very lenient; even broken.ts emits zero symbols
    // rather than crashing. The good file's symbol survives.
    check("unparseable file doesn't crash indexer", m.symbols.length >= 1);
    check("good.ts symbol present", m.symbols.some((s) => s.name === "ok"));
  } finally {
    rmSync(badDir, { recursive: true, force: true });
  }

  // Subagent walker — malformed turns
  section("Subagent walker — malformed turns");
  const turns = [
    { turnNumber: 1, toolUses: [], toolResults: [] },
    { turnNumber: 2, toolUses: [{ name: "Task" }], toolResults: [] }, // no id
  ];
  const a = analyzeSubagents(turns);
  check("walker handles tool_use without id", a.totalCount === 1);

  await sink.close();

  // Persistence — reopen after close
  section("Persistence — reopen after close");
  const reopened = new LocalSqliteSink({ path: join(dir, "b.sqlite") });
  await reopened.init();
  const env = await reopened.getBudgetEnvelope("perf"); // never created — should be null
  check("reopen + missing envelope → null", env === null);
  await reopened.close();
} catch (e) {
  failed++;
  failures.push({ name: "(uncaught)", detail: String(e?.stack ?? e) });
  console.log("FATAL: " + (e?.stack ?? e));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("\n" + "=".repeat(60));
console.log(`Resilience result: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log("  ✗ " + f.name + (f.detail ? "\n    " + f.detail : ""));
}
console.log("=".repeat(60));
process.exit(failed > 0 ? 1 : 0);
