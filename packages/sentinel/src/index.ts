/**
 * @prune/sentinel
 *
 * Pre-prompt secret detection + MCP-response prompt-injection shield.
 * Pattern-based, deterministic, no opaque ML. Each pattern carries a
 * stable id so dashboards and incident review can roll up by signature.
 *
 * Citations in code:
 *   - GitGuardian State of Secrets Sprawl 2026 (3.2% AI-commit leak)
 *   - arXiv 2601.17548 (prompt injection on agentic coding assistants)
 *   - OWASP LLM Top 10 (prompt-injection prevalence)
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
