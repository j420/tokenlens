#!/usr/bin/env node
/**
 * Dogfood benchmark: run TokenLens's own compression over TokenLens's own
 * source files, account for the savings with WasteBench (counterfactual,
 * overhead-subtracted), and emit an Ed25519-signed attestation.
 *
 * Honesty notes (these are the rules of the house):
 *  - Every token count below is MEASURED by the local tokenizer on real file
 *    contents. Nothing is estimated or fabricated.
 *  - This measures artifact-level compression savings (what Smart Copy /
 *    squeeze_files save when these files are sent to a model). It is NOT a
 *    production session-level savings claim.
 *  - overheadTokens is 0 because local AST compression consumes zero model
 *    tokens. Session-level features (advisors that inject context) have real
 *    overhead; attesting those requires recorded session telemetry.
 *  - Files whose compressed output fails the squeezer's safety verification
 *    (isValid === false) are skipped per tier and counted in the report.
 *
 * Usage: node scripts/benchmark-dogfood.mjs [--out docs/benchmark-attestation.json]
 */

import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import {
  buildManifest,
  generateKeypair,
  signManifest,
  verifyAttestation,
} from "@prune/wastebench";

const require = createRequire(import.meta.url);
const { squeezeFile } = require("@prune/squeezer");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Representative, deterministic corpus: real TypeScript sources from this repo.
const CORPUS_DIRS = [
  "apps/extension/src",
  "packages/intelligence/src",
  "packages/shared/src",
  "packages/context-health/src",
  "packages/cache-habits/src",
];

const TIERS = ["lossless", "structural", "telegraphic"];

function collectFiles(dir) {
  const abs = join(ROOT, dir);
  return readdirSync(abs)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts"))
    .map((f) => join(abs, f))
    .filter((p) => statSync(p).isFile());
}

const files = CORPUS_DIRS.flatMap(collectFiles);

const records = [];
const skipped = { lossless: 0, structural: 0, telegraphic: 0 };
let corpusBaselineTokens = 0;
const perTier = Object.fromEntries(TIERS.map((t) => [t, { baseline: 0, optimized: 0, files: 0 }]));

for (const file of files) {
  const code = readFileSync(file, "utf8");
  let countedBaseline = false;
  for (const tier of TIERS) {
    const res = squeezeFile(code, file, { tier });
    if (!res.isValid) {
      skipped[tier]++;
      continue;
    }
    if (!countedBaseline) {
      corpusBaselineTokens += res.originalTokens;
      countedBaseline = true;
    }
    perTier[tier].baseline += res.originalTokens;
    perTier[tier].optimized += res.compressedTokens;
    perTier[tier].files++;
    records.push({
      feature: `squeezer.${tier}`,
      baselineTokens: res.originalTokens,
      optimizedTokens: res.compressedTokens,
      overheadTokens: 0, // local AST compression spends zero model tokens
    });
  }
}

const manifest = buildManifest(
  records,
  { maxOverheadRatio: 0.1 },
  { issuedAt: new Date().toISOString() }
);

const keys = generateKeypair();
const attestation = signManifest(manifest, keys.privateKeyPem);
const verdict = verifyAttestation(attestation);

const outArg = process.argv.indexOf("--out");
const outPath = join(
  ROOT,
  outArg !== -1 ? process.argv[outArg + 1] : "docs/benchmark-attestation.json"
);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(attestation, null, 2) + "\n");

const pct = (n, d) => (d === 0 ? "n/a" : ((100 * n) / d).toFixed(1) + "%");

console.log("=== TokenLens dogfood benchmark (artifact-level compression) ===");
console.log(`Corpus: ${files.length} TypeScript files from ${CORPUS_DIRS.length} workspaces`);
console.log(`Corpus baseline: ${corpusBaselineTokens.toLocaleString()} tokens (measured locally)`);
console.log("");
for (const tier of TIERS) {
  const t = perTier[tier];
  const saved = t.baseline - t.optimized;
  console.log(
    `  ${tier.padEnd(12)} ${String(t.files).padStart(3)} files  ` +
      `${t.baseline.toLocaleString().padStart(9)} -> ${t.optimized.toLocaleString().padStart(9)} tokens  ` +
      `saved ${pct(saved, t.baseline).padStart(6)}  (skipped ${skipped[tier]} invalid)`
  );
}
console.log("");
console.log(`WasteBench rollup: ${manifest.rollup.records} records, ` +
  `gross ${manifest.rollup.grossSaved.toLocaleString()} tokens, ` +
  `overhead ${manifest.rollup.overhead}, net ${manifest.rollup.netSaved.toLocaleString()}`);
console.log(`Overhead SLO (<=10%): ${manifest.slo.ok ? "PASS" : "FAIL"} — ${manifest.slo.reason}`);
console.log(`Attestation: ed25519, verified=${verdict.valid} (${verdict.reason})`);
console.log(`Written: ${relative(ROOT, outPath)}`);

if (!verdict.valid) process.exit(1);
