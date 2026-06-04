/**
 * Flow A — the editor (human-driven) features, against the real extension core.
 */

import { extension } from "../drivers/extension-driver";
import { step, type ScenarioResult } from "../types";
import { UNPRICED_MODEL, type SessionFixture } from "../fixtures/session";

export function runExtensionScenario(fx: SessionFixture): ScenarioResult {
  const steps = [];

  // --- Smart Copy: full source → signatures ---
  const codeFiles = fx.files.filter(
    (f) => f.path.startsWith("src/auth") || f.path.startsWith("src/routes")
  );
  const sc = extension.smartCopy(codeFiles);
  steps.push(
    step(
      "Smart Copy",
      "ok",
      `${codeFiles.length} files: ${sc.originalTokens} → ${sc.optimizedTokens} tokens (${sc.savingsPercent}% saved)`,
      {
        originalTokens: sc.originalTokens,
        optimizedTokens: sc.optimizedTokens,
        savingsPercent: sc.savingsPercent,
      }
    )
  );

  // --- Pre-flight: full context vs recommended ---
  const pf = extension.preflight(
    "fix the login bug",
    fx.files,
    fx.activeFile.path
  );
  steps.push(
    step(
      "Pre-flight",
      "ok",
      `current ${pf.currentContext.files.length} files / ${pf.currentContext.tokens} tok → recommended ${pf.recommendedContext.files.length} files / ${pf.recommendedContext.tokens} tok (${pf.savings.percent}% saved)`,
      {
        currentFiles: pf.currentContext.files.length,
        currentTokens: pf.currentContext.tokens,
        recommendedFiles: pf.recommendedContext.files.length,
        recommendedTokens: pf.recommendedContext.tokens,
        savingsPercent: pf.savings.percent,
        recommendedList: pf.recommendedContext.files,
      }
    )
  );

  // --- Session-memory dedup ---
  const dedup = extension.sessionMemoryDedup(fx.activeFile);
  steps.push(
    step(
      "Session-memory dedup",
      "ok",
      `re-read of ${fx.activeFile.path}: duplicate=${dedup.second.isDuplicate}, saved ${dedup.second.tokensSaved} tok`,
      {
        firstDuplicate: dedup.first.isDuplicate,
        secondDuplicate: dedup.second.isDuplicate,
        tokensSaved: dedup.second.tokensSaved,
      }
    )
  );

  // --- Compaction recovery ---
  const comp = extension.compaction([
    { text: "Use bcrypt verify(), never plaintext compare", category: "requirement", priority: "critical" },
    { text: "JWT expiry stays 15 min", category: "architectural", priority: "high" },
  ]);
  steps.push(
    step(
      "Compaction recovery",
      "info",
      `${comp.atRisk.length} decision(s) flagged at-risk; reminder ${comp.reminder.length} chars`,
      { atRiskCount: comp.atRisk.length, reminderIncludesBcrypt: comp.reminder.includes("bcrypt") }
    )
  );

  // --- HUD: priced vs unpriced (strict pricing honesty) ---
  const hudPriced = extension.hud("fix the login bug in auth/service.ts", fx.activeModel);
  const hudUnpriced = extension.hud("fix the login bug in auth/service.ts", UNPRICED_MODEL);
  steps.push(
    step(
      "HUD (priced)",
      hudPriced.severity === "red" ? "warn" : "ok",
      `${fx.activeModel}: ${hudPriced.tokens} tok, $${hudPriced.cost.toFixed(5)}, severity=${hudPriced.severity}, priced=${hudPriced.priced}`,
      { priced: hudPriced.priced, cost: hudPriced.cost, severity: hudPriced.severity }
    )
  );
  steps.push(
    step(
      "HUD (unpriced)",
      "info",
      `${UNPRICED_MODEL}: priced=${hudUnpriced.priced} → display marks the cost an estimate (no fabricated rate)`,
      { priced: hudUnpriced.priced, displayHasStar: hudUnpriced.displayText.includes("*") }
    )
  );

  // --- Context relevance: related file beats the unrelated one ---
  const others = fx.files.filter((f) => f.path !== fx.activeFile.path);
  const ctx = extension.context(fx.activeFile, "fix the login bug", others);
  const all = [...ctx.relevantFiles, ...ctx.excludedFiles];
  const types = all.find((f) => f.filePath === "src/auth/types.ts");
  const thumb = all.find((f) => f.filePath === fx.unrelatedFile.path);
  steps.push(
    step(
      "Context relevance",
      "ok",
      `auth/types.ts score ${types?.relevanceScore ?? "?"} vs unrelated thumbnail.ts score ${thumb?.relevanceScore ?? "?"}`,
      {
        typesScore: types?.relevanceScore ?? null,
        thumbnailScore: thumb?.relevanceScore ?? null,
        relevantCount: ctx.relevantFiles.length,
      }
    )
  );

  // --- Intent classification ---
  const intent = extension.intent("the login always rejects valid users, help me fix it");
  steps.push(
    step("Intent classification", "ok", `primary intent = ${intent.primary}`, {
      primary: intent.primary,
    })
  );

  // --- Squeeze: three tiers ---
  const tiers = (["lossless", "structural", "telegraphic"] as const).map((tier) => {
    const r = extension.squeeze(fx.activeFile.content, tier);
    return { tier, originalTokens: r.originalTokens, compressedTokens: r.compressedTokens, savingsPercent: r.savingsPercent, isValid: r.isValid };
  });
  steps.push(
    step(
      "Squeeze (3 tiers)",
      "ok",
      tiers.map((t) => `${t.tier} ${t.savingsPercent}%`).join(" · "),
      { tiers }
    )
  );

  return {
    flow: "Extension",
    summary: "Editor features over the real extension core (Smart Copy, Pre-flight, dedup, compaction, HUD, relevance, intent, squeeze).",
    steps,
  };
}
