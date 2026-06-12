/**
 * Report rendering + signed attestation.
 *
 * The markdown report is written for a skeptical reader: it leads with the
 * paired result, prints the achieved power next to the NI verdict, lists
 * every disclosed limitation, and — when ANY record came from a fixture —
 * banners the whole document as dry-run output so fixture numbers can never
 * be mistaken for evidence.
 *
 * The attestation is a WasteBench manifest over per-task counterfactual
 * savings (baseline = naive arm, optimized = governed arm, overhead = the
 * governance layer's own injected tokens), Ed25519-signed.
 */

import {
  buildManifest,
  generateKeypair,
  signManifest,
  type KeyPairPem,
  type OverheadSlo,
  type SavingsRecord,
  type SignedAttestation,
} from "@prune/wastebench";
import type { OutcomeAnalysis, TaskPairSummary } from "./stats.js";

// ============================================================================
// Attestation
// ============================================================================

export const BENCH_FEATURE_ID = "outcome-bench:governed-arm";

/**
 * One savings record per task pair, in TOKENS (the attestation unit must be
 * a measured count, so the token metric is used even when USD is available).
 * Negative nets are reported, not hidden — `rollupSavings` clamps gross at 0
 * per record and subtracts the full overhead.
 */
export function savingsRecordsFrom(
  analysis: OutcomeAnalysis,
  meanOverheadByTask: Map<string, number>
): SavingsRecord[] {
  return analysis.tasks.map((t) => ({
    feature: BENCH_FEATURE_ID,
    baselineTokens: Math.round(tokensOf(t, analysis, "naive")),
    optimizedTokens: Math.round(tokensOf(t, analysis, "governed")),
    overheadTokens: Math.round(meanOverheadByTask.get(t.taskId) ?? 0),
  }));
}

function tokensOf(
  t: TaskPairSummary,
  analysis: OutcomeAnalysis,
  arm: "naive" | "governed"
): number {
  // When the analysis ran on USD, the pair summary holds dollars — the
  // attestation still needs tokens, so the caller passes token means via
  // the ledger; here we use the metric value only when it IS tokens.
  if (analysis.metricUsed === "tokens") {
    return arm === "naive" ? t.naiveMeanCost : t.governedMeanCost;
  }
  // USD metric: fall back to the per-arm ledger token totals scaled per task.
  const ledger = analysis.ledger[arm];
  const row = ledger.tasks.find((x) => x.taskId === t.taskId);
  const trials = arm === "naive" ? t.naiveTrials : t.governedTrials;
  return row ? row.totalTokens / trials : 0;
}

export interface AttestOptions {
  issuedAt: string;
  slo?: OverheadSlo;
  /** Omit to generate an ephemeral keypair (dev/dry-run). */
  keypair?: KeyPairPem;
}

export function buildAttestation(
  analysis: OutcomeAnalysis,
  meanOverheadByTask: Map<string, number>,
  opts: AttestOptions
): SignedAttestation {
  const records = savingsRecordsFrom(analysis, meanOverheadByTask);
  const manifest = buildManifest(
    records,
    opts.slo ?? { maxOverheadRatio: 0.1 },
    { issuedAt: opts.issuedAt }
  );
  const keypair = opts.keypair ?? generateKeypair();
  return signManifest(manifest, keypair.privateKeyPem);
}

// ============================================================================
// Markdown report
// ============================================================================

export interface ReportMeta {
  title: string;
  generatedAt: string;
  modelPins: string[];
  /** e.g. "fixture replay (dry-run)" or "live headless Claude Code". */
  executionMode: string;
}

function pct(x: number | null): string {
  return x === null ? "n/a" : `${(x * 100).toFixed(1)}%`;
}

function num(x: number): string {
  return Number.isInteger(x) ? String(x) : x.toFixed(4);
}

export function renderReport(
  analysis: OutcomeAnalysis,
  meta: ReportMeta
): string {
  const L: string[] = [];
  L.push(`# ${meta.title}`);
  L.push("");
  if (analysis.fixtureData) {
    L.push(
      "> **⚠️ DRY-RUN — FIXTURE DATA.** Every number below was replayed from",
      "> canned fixture transcripts to validate the pipeline. Nothing here is",
      "> evidence about TokenLens; real-matrix results replace this document.",
      ""
    );
  }
  L.push(`Generated: ${meta.generatedAt} · Execution: ${meta.executionMode}`);
  L.push(`Model pins: ${meta.modelPins.join(", ")}`);
  L.push("");

  // --- Headline -------------------------------------------------------------
  const unit = analysis.metricUsed === "usd" ? "USD" : "provider-reported tokens";
  L.push("## Headline");
  L.push("");
  L.push(
    `- **Primary (paired cost):** median per-task savings **${pct(analysis.medianSavingsPct)}** ` +
      `(${unit}); Wilcoxon signed-rank one-sided p = ${analysis.wilcoxon.pValue.toExponential(2)} ` +
      `(${analysis.wilcoxon.reject ? "significant" : "not significant"} at α = ${analysis.preRegistration.alpha}).`
  );
  L.push(
    `- **Secondary (success rate):** naive ${pct(analysis.naiveSuccessRate)} vs governed ${pct(analysis.governedSuccessRate)}. ` +
      `NI at ${pct(analysis.preRegistration.niMargin)} screening margin: ` +
      `${analysis.nonInferiority.reject ? "**non-inferiority concluded (screening tier)**" : "**NOT concluded**"} ` +
      `(p = ${analysis.nonInferiority.pValue.toFixed(4)}).`
  );
  L.push(
    `- **Cost metric:** ${analysis.metricUsed === "usd" ? "strict USD (every trial priced)" : "raw token totals — one or more trials ran on an unpriced model, so no dollars are claimed"}.`
  );
  L.push("");

  // --- Power honesty ---------------------------------------------------------
  L.push("## Statistical power (read before citing the NI verdict)");
  L.push("");
  if (analysis.power.requiredPerArm === null) {
    L.push(
      "- Pooled success rate is degenerate (0 or 1); the power formula is undefined here."
    );
  } else {
    L.push(
      `- The NI test at this margin would need **${analysis.power.requiredPerArm} trials/arm** for 80% power; ` +
        `this run has **${analysis.power.actualPerArm}/arm** — ` +
        (analysis.power.adequatelyPowered
          ? "adequately powered."
          : "**underpowered**, so the NI verdict is a screening signal, not proof of equivalence.")
    );
  }
  L.push(
    `- McNemar on paired per-task majority outcomes: b (naive✓/governed✗) = ${analysis.discordant.naivePassGovernedFail}, ` +
      `c (naive✗/governed✓) = ${analysis.discordant.naiveFailGovernedPass}, p = ${analysis.mcnemar.pValue.toFixed(4)}.`
  );
  L.push("");

  // --- Per-task table ----------------------------------------------------------
  L.push("## Per-task results");
  L.push("");
  L.push(
    `| Task | Naive mean (${analysis.metricUsed}) | Governed mean | Savings | Naive pass | Governed pass |`
  );
  L.push("|---|---|---|---|---|---|");
  for (const t of analysis.tasks) {
    L.push(
      `| ${t.taskId} | ${num(t.naiveMeanCost)} | ${num(t.governedMeanCost)} | ${pct(t.savingsPct)} | ` +
        `${t.naiveSuccesses}/${t.naiveTrials} | ${t.governedSuccesses}/${t.governedTrials} |`
    );
  }
  if (analysis.excludedTasks.length > 0) {
    L.push("");
    L.push(
      `Excluded (zero trials in an arm): ${analysis.excludedTasks.join(", ")}`
    );
  }
  L.push("");

  // --- Cost per completed task -------------------------------------------------
  L.push("## Cost per completed task (task-ledger)");
  L.push("");
  const ln = analysis.ledger.naive;
  const lg = analysis.ledger.governed;
  L.push(
    `- Naive: ${ln.totalTokens} tokens across ${ln.totalRequests} trials, ${ln.totalAccepted} accepted` +
      (ln.costUsd !== null ? `, $${ln.costUsd.toFixed(4)} total` : ", USD unpriced ⇒ null")
  );
  L.push(
    `- Governed: ${lg.totalTokens} tokens across ${lg.totalRequests} trials, ${lg.totalAccepted} accepted` +
      (lg.costUsd !== null ? `, $${lg.costUsd.toFixed(4)} total` : ", USD unpriced ⇒ null")
  );
  L.push("");

  // --- Pre-registration + disclosures -------------------------------------------
  L.push("## Pre-registered analysis plan");
  L.push("");
  L.push(`- Primary endpoint: ${analysis.preRegistration.primaryEndpoint}`);
  L.push(`- Secondary endpoint: ${analysis.preRegistration.secondaryEndpoint}`);
  L.push(
    `- K = ${analysis.preRegistration.trialsPerTask} trials/task/arm, α = ${analysis.preRegistration.alpha}, NI margin = ${pct(analysis.preRegistration.niMargin)}.`
  );
  L.push("");
  L.push("## Disclosed limitations");
  L.push("");
  L.push(
    "- Cache-WRITE tokens are billed at the plain input rate (no cache-write multiplier in the pricing table); this slightly understates spend equally in both arms.",
    "- Subagent (Task tool) usage aggregates into the parent turn; per-subagent attribution is not fabricated.",
    "- Track-1 tasks are mined from this repository's own history (bias disclosed); Track-2 external tasks control for it.",
    "- Timeout / cap exhaustion counts as failure in BOTH arms."
  );
  L.push("");
  return L.join("\n");
}
