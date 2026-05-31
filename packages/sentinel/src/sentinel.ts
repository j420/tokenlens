/**
 * Sentinel — public API composing the secret / entropy / injection
 * detectors into two task-shaped front doors:
 *
 *   - scanPromptForSecrets(payload) — pre-prompt scan. Used by the
 *     UserPromptSubmit hook to refuse / redact before code or
 *     credentials enter the cloud context.
 *
 *   - scanMcpResponseForInjection(payload) — post-tool scan. Used by
 *     a PostToolUse hook to gate untrusted external content (MCP
 *     tool results, web fetches, file reads from untrusted sources).
 *
 * Both return a single `SentinelReport` with a verdict the hook can
 * route on (allow / warn / block).
 */

import {
  scanForSecrets,
  redactFindings,
  type ScanOptions as SecretScanOptions,
  type SecretFinding,
} from "./secrets.js";
import {
  scanByEntropy,
  type EntropyScanOptions,
  type EntropyFinding,
} from "./entropy.js";
import {
  scanForInjection,
  type InjectionScanOptions,
  type InjectionFinding,
} from "./injection.js";

export type SentinelVerdict = "allow" | "warn" | "block";

export interface PromptReport {
  verdict: SentinelVerdict;
  /** Filled when verdict = "block". */
  reason: string | null;
  secretFindings: SecretFinding[];
  entropyFindings: EntropyFinding[];
  /** Same length as payload, with secret bytes replaced by `*`. */
  redactedPayload: string;
}

export interface InjectionReport {
  verdict: SentinelVerdict;
  reason: string | null;
  injectionFindings: InjectionFinding[];
}

export interface PromptScanOptions {
  secrets?: SecretScanOptions;
  entropy?: EntropyScanOptions;
  /**
   * Pattern ids that, if matched, demand a block (not a warn). Default:
   * all vendor-keyed patterns (anthropic, openai, github_*, aws_*,
   * stripe_*, slack, twilio, sendgrid, google, datadog) plus private
   * key headers + connection URLs. Entropy findings always warn-only.
   */
  blockOnPatternIds?: string[];
}

const DEFAULT_BLOCK_IDS = new Set<string>([
  "anthropic_api_key",
  "openai_api_key",
  "openai_project_key",
  "github_token",
  "github_fine_grained_token",
  "aws_access_key",
  "aws_secret_key",
  "stripe_live_secret",
  "stripe_live_public",
  "stripe_restricted",
  "slack_token",
  "google_api_key",
  "twilio_api_key",
  "sendgrid_api_key",
  "datadog_api_key",
  "private_key_pem",
  "ssh_private_key",
  "postgres_url",
  "mongodb_url",
  "mysql_url",
]);

export function scanPromptForSecrets(
  payload: string,
  opts: PromptScanOptions = {}
): PromptReport {
  const secretFindings = scanForSecrets(payload, opts.secrets);
  const entropyFindings = scanByEntropy(payload, opts.entropy);
  const blockSet = opts.blockOnPatternIds
    ? new Set(opts.blockOnPatternIds)
    : DEFAULT_BLOCK_IDS;
  const blockedFindings = secretFindings.filter((f) => blockSet.has(f.patternId));
  const redactedPayload = redactFindings(payload, secretFindings);
  if (blockedFindings.length > 0) {
    const labels = [...new Set(blockedFindings.map((f) => f.label))].join(", ");
    return {
      verdict: "block",
      reason:
        `Sentinel blocked send: detected ${blockedFindings.length} ` +
        `vendor-key match(es) [${labels}]. Pre-prompt interception per ` +
        `GitGuardian's 3.2% AI-commit leak baseline. Set sentinel allowlist ` +
        `or remove the secret before retrying.`,
      secretFindings,
      entropyFindings,
      redactedPayload,
    };
  }
  if (secretFindings.length > 0 || entropyFindings.length > 0) {
    const labels = [
      ...secretFindings.map((f) => f.label),
      ...(entropyFindings.length > 0
        ? [`${entropyFindings.length} high-entropy token(s)`]
        : []),
    ].join("; ");
    return {
      verdict: "warn",
      reason: `Sentinel advisory: ${labels}. Verify before sending.`,
      secretFindings,
      entropyFindings,
      redactedPayload,
    };
  }
  return {
    verdict: "allow",
    reason: null,
    secretFindings,
    entropyFindings,
    redactedPayload,
  };
}

export interface InjectionShieldOptions {
  injection?: InjectionScanOptions;
  /**
   * Categories that force a block. Default: SHADOWING, PATH_TRAVERSAL,
   * ARGUMENT_INJECTION. HIDDEN_HTML and INDIRECT_MARKUP warn-only by
   * default (they're frequently legitimate in MCP tool docs/examples).
   */
  blockOnCategories?: Array<InjectionFinding["category"]>;
}

const DEFAULT_BLOCK_CATEGORIES: Array<InjectionFinding["category"]> = [
  "SHADOWING",
  "PATH_TRAVERSAL",
  "ARGUMENT_INJECTION",
];

export function scanMcpResponseForInjection(
  payload: string,
  opts: InjectionShieldOptions = {}
): InjectionReport {
  const findings = scanForInjection(payload, opts.injection);
  const blockSet = new Set(opts.blockOnCategories ?? DEFAULT_BLOCK_CATEGORIES);
  const blockers = findings.filter((f) => blockSet.has(f.category));
  if (blockers.length > 0) {
    const cats = [...new Set(blockers.map((f) => f.category))].join(", ");
    return {
      verdict: "block",
      reason:
        `Sentinel blocked MCP response: ${blockers.length} hostile signature(s) ` +
        `[${cats}]. Pattern matches the Jan 20 2026 Anthropic Git MCP RCE ` +
        `incident class (arXiv 2601.17548).`,
      injectionFindings: findings,
    };
  }
  if (findings.length > 0) {
    return {
      verdict: "warn",
      reason: `Sentinel advisory: ${findings.length} suspicious markup signature(s) — review before acting.`,
      injectionFindings: findings,
    };
  }
  return { verdict: "allow", reason: null, injectionFindings: findings };
}
