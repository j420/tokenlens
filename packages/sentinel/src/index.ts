/**
 * @prune/sentinel
 *
 * Pre-prompt secret detection + MCP-response prompt-injection shield.
 * Pattern-based, deterministic, no opaque ML. Each pattern carries a
 * stable id so dashboards and incident review can roll up by signature.
 *
 * Citations in code (independently verified Jun 2026):
 *   - GitGuardian, "State of Secrets Sprawl 2026": Claude Code commits leak
 *     secrets at 3.2% vs a 1.5% baseline (~2x).
 *     https://blog.gitguardian.com/the-state-of-secrets-sprawl-2026/
 *   - Anthropic Git MCP server RCE (disclosed Jan 20 2026, Cyata): a chain of
 *     CVE-2025-68143 (path traversal in git_init), CVE-2025-68144 (argument
 *     injection in git_diff/git_checkout) and CVE-2025-68145 (repository-
 *     scoping bypass), reachable via prompt injection alone; fixed in 2025.12.18.
 *   - arXiv 2601.17548 — Maloyan & Namiot, "Prompt Injection Attacks on
 *     Agentic Coding Assistants" (SoK, the attack *class*; success >85% vs SOTA
 *     defenses under adaptive attack). https://arxiv.org/abs/2601.17548
 *   - OWASP LLM Top 10 — LLM01 Prompt Injection (~73% of assessed production
 *     deployments carry a prompt-injection flaw).
 */

export {
  scanPromptForSecrets,
  scanMcpResponseForInjection,
  type PromptReport,
  type InjectionReport,
  type PromptScanOptions,
  type InjectionShieldOptions,
  type SentinelVerdict,
} from "./sentinel.js";

export {
  scanForSecrets,
  redactFindings,
  SECRET_PATTERNS,
  type SecretPattern,
  type SecretFinding,
  type ScanOptions as SecretScanOptions,
} from "./secrets.js";

export {
  scanByEntropy,
  shannon,
  type EntropyFinding,
  type EntropyScanOptions,
} from "./entropy.js";

export {
  scanForInjection,
  INJECTION_PATTERNS,
  type InjectionPattern,
  type InjectionFinding,
  type InjectionCategory,
  type InjectionScanOptions,
} from "./injection.js";
