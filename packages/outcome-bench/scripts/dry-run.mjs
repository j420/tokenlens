#!/usr/bin/env node
/**
 * dry-run.mjs — exercise the ENTIRE Benchmark v2 pipeline with zero model
 * spend: deterministic fixture transcripts → matrix → statistics → report →
 * signed attestation. Output goes to packages/outcome-bench/out/ (gitignored)
 * and every artifact is bannered as FIXTURE DATA.
 *
 * Build first: npm run build (this script imports from dist/).
 * Usage: node scripts/dry-run.mjs
 */

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const {
  writeFixtureSuite,
  FixtureRunner,
  runMatrix,
  analyzeOutcomes,
  renderReport,
  buildAttestation,
  PRE_REGISTRATION,
  FIXTURE_PRICED_MODEL,
  loadManifestDir,
} = await import(join(pkgRoot, "dist", "index.js"));

const out = join(pkgRoot, "out");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 1. Fixture suite + matrix (interleaved arms, resumable trial log).
const suite = writeFixtureSuite(join(out, "fixtures"));
const result = await runMatrix(
  suite.tasks,
  {
    trialsPerTask: 2,
    arms: ["naive", "governed"],
    logPath: join(out, "trials.jsonl"),
  },
  new FixtureRunner(suite.cells)
);
console.log(`matrix: ran ${result.ran}, skipped ${result.skipped}`);

// 2. Pre-registered analysis.
const analysis = analyzeOutcomes(result.records, PRE_REGISTRATION);
console.log(
  `metric=${analysis.metricUsed} medianSavings=${(analysis.medianSavingsPct * 100).toFixed(1)}% ` +
    `success naive=${analysis.naiveSuccessRate.toFixed(2)} governed=${analysis.governedSuccessRate.toFixed(2)}`
);

// 3. Report (FIXTURE-bannered) + signed attestation (ephemeral dev key).
const report = renderReport(analysis, {
  title: "Outcome Benchmark v2 — DRY RUN (fixture replay)",
  generatedAt: new Date().toISOString(),
  modelPins: [FIXTURE_PRICED_MODEL],
  executionMode: "fixture replay (dry-run, zero model spend)",
});
writeFileSync(join(out, "dry-run-report.md"), report);

const overhead = new Map(analysis.tasks.map((t) => [t.taskId, 450]));
const attestation = buildAttestation(analysis, overhead, {
  issuedAt: new Date().toISOString(),
});
writeFileSync(
  join(out, "dry-run-attestation.json"),
  JSON.stringify(attestation, null, 2)
);

// 4. Validate the committed pre-registered task manifests while we're here.
const self = loadManifestDir(join(pkgRoot, "tasks", "self"));
const external = loadManifestDir(join(pkgRoot, "tasks", "external"));
console.log(
  `manifests: self ready=${self.tasks.filter((t) => t.status === "ready").length} ` +
    `external drafts=${external.tasks.filter((t) => t.status === "draft").length} ` +
    `errors=${self.errors.length + external.errors.length}`
);
for (const e of [...self.errors, ...external.errors]) {
  console.error(`MANIFEST ERROR ${e.file}: ${e.reason}`);
}

console.log(`\nwrote ${join(out, "dry-run-report.md")}`);
console.log(`wrote ${join(out, "dry-run-attestation.json")}`);
if (self.errors.length + external.errors.length > 0) process.exit(1);
