/**
 * Flow A — the editor (human-driven) features, against the real extension core.
 * Each step records the real input, the real output, the invariant checks
 * (efficacy = all passed), and a quality/degradation signal where the feature
 * exposes one.
 */

import { extension } from "../drivers/extension-driver";
import type { ScenarioResult, Step } from "../types";
import { UNPRICED_MODEL, type SessionFixture } from "../fixtures/session";

export function runExtensionScenario(fx: SessionFixture): ScenarioResult {
  const steps: Step[] = [];

  // --- Smart Copy: full source → signatures (intentionally lossy) ---
  const codeFiles = fx.files.filter(
    (f) => f.path.startsWith("src/auth") || f.path.startsWith("src/routes")
  );
  const sc = extension.smartCopy(codeFiles);
  steps.push({
    name: "Smart Copy",
    status: "ok",
    detail: `${codeFiles.length} files: ${sc.originalTokens} → ${sc.optimizedTokens} tokens (${sc.savingsPercent}% saved)`,
    input: { files: codeFiles.map((f) => f.path), originalTokens: sc.originalTokens },
    output: { optimizedTokens: sc.optimizedTokens, savingsPercent: sc.savingsPercent, preview: sc.optimizedCode.slice(0, 400) },
    checks: [
      { label: "optimized ≤ original tokens", passed: sc.optimizedTokens <= sc.originalTokens },
      { label: "produced non-empty output", passed: sc.optimizedCode.length > 0 },
      { label: "retained ≥1 signature", passed: /\(/.test(sc.optimizedCode) },
    ],
    quality: {
      label: "signatures-only (lossy by design)",
      preserved: null,
      detail: "Smart Copy intentionally drops function bodies; equivalence is N/A — not a degradation.",
    },
    data: { originalTokens: sc.originalTokens, optimizedTokens: sc.optimizedTokens, savingsPercent: sc.savingsPercent },
  });

  // --- Pre-flight ---
  const pf = extension.preflight("fix the login bug", fx.files, fx.activeFile.path);
  steps.push({
    name: "Pre-flight",
    status: "ok",
    detail: `current ${pf.currentContext.files.length} files / ${pf.currentContext.tokens} tok → recommended ${pf.recommendedContext.files.length} files / ${pf.recommendedContext.tokens} tok (${pf.savings.percent}% saved)`,
    input: { prompt: "fix the login bug", files: fx.files.map((f) => f.path), activeFile: fx.activeFile.path },
    output: { current: pf.currentContext, recommended: pf.recommendedContext, savings: pf.savings },
    checks: [
      { label: "recommended files ≤ current", passed: pf.recommendedContext.files.length <= pf.currentContext.files.length },
      { label: "recommended tokens ≤ current", passed: pf.recommendedContext.tokens <= pf.currentContext.tokens },
      { label: "unrelated thumbnail.ts excluded", passed: !pf.recommendedContext.files.includes("src/media/thumbnail.ts") },
    ],
    quality: null,
    data: { savingsPercent: pf.savings.percent },
  });

  // --- Session-memory dedup ---
  const dedup = extension.sessionMemoryDedup(fx.activeFile);
  steps.push({
    name: "Session-memory dedup",
    status: "ok",
    detail: `re-read of ${fx.activeFile.path}: duplicate=${dedup.second.isDuplicate}, saved ${dedup.second.tokensSaved} tok`,
    input: { file: fx.activeFile.path, reads: 2 },
    output: { first: dedup.first, second: dedup.second, stats: dedup.stats },
    checks: [
      { label: "first read not a duplicate", passed: dedup.first.isDuplicate === false },
      { label: "second read detected as duplicate", passed: dedup.second.isDuplicate === true },
      { label: "tokens saved > 0", passed: dedup.second.tokensSaved > 0 },
    ],
    quality: null,
    data: { tokensSaved: dedup.second.tokensSaved },
  });

  // --- Compaction recovery ---
  const decisions = [
    { text: "Use bcrypt verify(), never plaintext compare", category: "requirement", priority: "critical" },
    { text: "JWT expiry stays 15 min", category: "architectural", priority: "high" },
  ];
  const comp = extension.compaction(decisions);
  steps.push({
    name: "Compaction recovery",
    status: "info",
    detail: `${comp.atRisk.length} decision(s) flagged at-risk; reminder ${comp.reminder.length} chars`,
    input: { decisions },
    output: { atRiskCount: comp.atRisk.length, reminder: comp.reminder },
    checks: [{ label: "reminder preserves the bcrypt decision", passed: comp.reminder.includes("bcrypt") }],
    quality: null,
  });

  // --- HUD: priced vs unpriced (strict pricing honesty) ---
  const hudPriced = extension.hud("fix the login bug in auth/service.ts", fx.activeModel);
  steps.push({
    name: "HUD (priced model)",
    status: hudPriced.severity === "red" ? "warn" : "ok",
    detail: `${fx.activeModel}: ${hudPriced.tokens} tok, $${hudPriced.cost.toFixed(5)}, severity=${hudPriced.severity}, priced=${hudPriced.priced}`,
    input: { model: fx.activeModel },
    output: { tokens: hudPriced.tokens, cost: hudPriced.cost, severity: hudPriced.severity, priced: hudPriced.priced },
    checks: [
      { label: "model recognized as priced", passed: hudPriced.priced === true },
      { label: "projected cost > 0", passed: hudPriced.cost > 0 },
    ],
    quality: null,
  });
  const hudUnpriced = extension.hud("fix the login bug in auth/service.ts", UNPRICED_MODEL);
  steps.push({
    name: "HUD (unpriced model)",
    status: "info",
    detail: `${UNPRICED_MODEL}: priced=${hudUnpriced.priced} → cost marked an estimate, no rate fabricated`,
    input: { model: UNPRICED_MODEL },
    output: { priced: hudUnpriced.priced, displayText: hudUnpriced.displayText },
    checks: [
      { label: "unpriced model flagged (priced=false)", passed: hudUnpriced.priced === false },
      { label: "display marks the estimate with '*'", passed: hudUnpriced.displayText.includes("*") },
    ],
    quality: { label: "strict pricing (no fabricated rate)", preserved: true, detail: "unknown model → estimate marked, never presented as fact" },
  });

  // --- Context relevance ---
  const others = fx.files.filter((f) => f.path !== fx.activeFile.path);
  const ctx = extension.context(fx.activeFile, "fix the login bug", others);
  const all = [...ctx.relevantFiles, ...ctx.excludedFiles];
  const types = all.find((f) => f.filePath === "src/auth/types.ts");
  const thumb = all.find((f) => f.filePath === fx.unrelatedFile.path);
  steps.push({
    name: "Context relevance",
    status: "ok",
    detail: `auth/types.ts score ${types?.relevanceScore ?? "?"} vs unrelated thumbnail.ts ${thumb?.relevanceScore ?? "?"}`,
    input: { activeFile: fx.activeFile.path, prompt: "fix the login bug", candidates: others.map((f) => f.path) },
    output: { relevant: ctx.relevantFiles.map((f) => ({ path: f.filePath, score: f.relevanceScore })), typesScore: types?.relevanceScore, thumbnailScore: thumb?.relevanceScore },
    checks: [{ label: "imported type ranks ≥ unrelated file", passed: (types?.relevanceScore ?? 0) >= (thumb?.relevanceScore ?? 0) }],
    quality: null,
  });

  // --- Intent classification ---
  const prompt = "the login always rejects valid users, help me fix it";
  const intent = extension.intent(prompt);
  steps.push({
    name: "Intent classification",
    status: "ok",
    detail: `primary intent = ${intent.primary}`,
    input: { prompt },
    output: { primary: intent.primary },
    checks: [{ label: "returned a concrete intent", passed: typeof intent.primary === "string" && intent.primary.length > 0 }],
    quality: null,
  });

  // --- Squeeze: three tiers, each re-validated (isValid = no syntax degradation) ---
  const tiers = (["lossless", "structural", "telegraphic"] as const).map((tier) => {
    const r = extension.squeeze(fx.activeFile.content, tier);
    return { tier, originalTokens: r.originalTokens, compressedTokens: r.compressedTokens, savingsPercent: r.savingsPercent, isValid: r.isValid };
  });
  const allValid = tiers.every((t) => t.isValid);
  steps.push({
    name: "Squeeze (3 tiers)",
    status: "ok",
    detail: tiers.map((t) => `${t.tier} ${t.savingsPercent}%`).join(" · "),
    input: { file: fx.activeFile.path, tiers: tiers.map((t) => t.tier) },
    output: { tiers },
    checks: [
      ...tiers.map((t) => ({ label: `${t.tier}: re-parse valid (isValid)`, passed: t.isValid })),
      ...tiers.map((t) => ({ label: `${t.tier}: compressed ≤ original`, passed: t.compressedTokens <= t.originalTokens })),
      { label: "telegraphic saves ≥ lossless", passed: (tiers.find((t) => t.tier === "telegraphic")?.savingsPercent ?? 0) >= (tiers.find((t) => t.tier === "lossless")?.savingsPercent ?? 0) },
    ],
    quality: {
      label: "syntax re-validated after compression",
      preserved: allValid,
      detail: allValid ? "every tier re-parsed clean — no syntax degradation introduced" : "a tier failed re-parse; squeezer would return the original uncompressed",
    },
    data: { tiers },
  });

  return {
    flow: "Extension",
    summary: "Editor features over the real extension core — Smart Copy, Pre-flight, dedup, compaction, HUD, relevance, intent, squeeze.",
    steps,
  };
}
