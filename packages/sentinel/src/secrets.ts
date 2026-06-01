/**
 * Secret pattern library.
 *
 * Same shape gitleaks / TruffleHog / detect-secrets ship — explicit
 * per-vendor patterns plus a high-entropy fallback. Detection is
 * pattern + token-class, not regex parsing of code (CLAUDE.md hard
 * rule). Patterns scan raw text payloads (prompts, MCP responses);
 * they never parse source code structure.
 *
 * Patterns are tuned conservatively: we'd rather alert on a real
 * fake-key in a test fixture than let a real key leak. Callers can
 * pre-allowlist false-positives.
 *
 * Context: GitGuardian's State of Secrets Sprawl 2026 reports
 * AI-assisted commits leak secrets at 3.2% vs 1.5% baseline
 * (https://oecd.ai/en/incidents/2026-03-17-2273). Pre-prompt
 * interception (this module) catches the leak BEFORE it enters the
 * model context, not just before it enters a git commit.
 */

export interface SecretPattern {
  /** Stable id for dashboards / allowlists. */
  id: string;
  /** Human label. */
  label: string;
  /** Compiled regex applied to the payload. */
  regex: RegExp;
  /**
   * Minimum match length to count — defends against trivial false-positives
   * where the prefix appears in a comment.
   */
  minLength?: number;
}

export const SECRET_PATTERNS: SecretPattern[] = [
  // === Vendor API keys ===
  {
    id: "anthropic_api_key",
    label: "Anthropic API key",
    regex: /sk-ant-(?:api|admin)\d{2}-[A-Za-z0-9\-_]{80,}/g,
  },
  {
    id: "openai_api_key",
    label: "OpenAI API key",
    regex: /sk-(?:proj-)?[A-Za-z0-9_-]{40,}/g,
    minLength: 45,
  },
  {
    id: "openai_project_key",
    label: "OpenAI project key",
    regex: /sk-proj-[A-Za-z0-9_-]{80,}/g,
  },
  {
    id: "github_token",
    label: "GitHub token",
    regex: /gh[pousr]_[A-Za-z0-9]{36,}/g,
  },
  {
    id: "github_fine_grained_token",
    label: "GitHub fine-grained PAT",
    regex: /github_pat_[A-Za-z0-9_]{82,}/g,
  },
  {
    id: "aws_access_key",
    label: "AWS access key id",
    regex: /\bAKIA[A-Z0-9]{16}\b/g,
  },
  {
    id: "aws_secret_key",
    label: "AWS secret key",
    // 40-char base64 that is not all-zero / all-one and not lowercased
    // hex (hex regex excluded to drop most file hashes).
    regex: /\b(?=.*[A-Z])(?=.*[a-z])(?=.*[0-9+/])[A-Za-z0-9+/]{40}\b/g,
    minLength: 40,
  },
  {
    id: "stripe_live_secret",
    label: "Stripe live secret key",
    regex: /\bsk_live_[A-Za-z0-9]{24,}\b/g,
  },
  {
    id: "stripe_live_public",
    label: "Stripe live publishable key",
    regex: /\bpk_live_[A-Za-z0-9]{24,}\b/g,
  },
  {
    id: "stripe_restricted",
    label: "Stripe restricted key",
    regex: /\brk_(?:live|test)_[A-Za-z0-9]{24,}\b/g,
  },
  {
    id: "slack_token",
    label: "Slack token",
    regex: /\bxox[abprso]-[A-Za-z0-9-]{10,}\b/g,
  },
  {
    id: "google_api_key",
    label: "Google API key",
    regex: /\bAIza[0-9A-Za-z\-_]{35}\b/g,
  },
  {
    id: "twilio_api_key",
    label: "Twilio API key",
    regex: /\bSK[a-f0-9]{32}\b/g,
  },
  {
    id: "sendgrid_api_key",
    label: "SendGrid API key",
    regex: /\bSG\.[A-Za-z0-9_\-]{22}\.[A-Za-z0-9_\-]{43}\b/g,
  },
  {
    id: "datadog_api_key",
    label: "Datadog API key",
    regex: /\bdatadog[_-]?api[_-]?key['"]?\s*[:=]\s*['"]?[a-f0-9]{32}\b/gi,
  },

  // === Generic private keys ===
  {
    id: "private_key_pem",
    label: "PEM-encoded private key",
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g,
  },
  {
    id: "ssh_private_key",
    label: "SSH private key body",
    regex: /-----BEGIN OPENSSH PRIVATE KEY-----[\s\S]{60,}-----END OPENSSH PRIVATE KEY-----/g,
  },

  // === Connection strings / credentials ===
  {
    id: "postgres_url",
    label: "Postgres connection URL with credentials",
    regex: /\bpostgres(?:ql)?:\/\/[^\/\s:@]+:[^\/\s@]+@[^\/\s]+/g,
  },
  {
    id: "mongodb_url",
    label: "MongoDB connection URL with credentials",
    regex: /\bmongodb(?:\+srv)?:\/\/[^\/\s:@]+:[^\/\s@]+@[^\/\s]+/g,
  },
  {
    id: "mysql_url",
    label: "MySQL connection URL with credentials",
    regex: /\bmysql:\/\/[^\/\s:@]+:[^\/\s@]+@[^\/\s]+/g,
  },
];

export interface SecretFinding {
  patternId: string;
  label: string;
  /** Start index into the original payload. */
  start: number;
  /** End index (exclusive). */
  end: number;
  /** Length of the matched substring. */
  length: number;
  /** First 4 + last 4 chars with `…` in between — for human review without leak. */
  preview: string;
}

function previewOf(matched: string): string {
  if (matched.length <= 12) return matched.slice(0, 2) + "…" + matched.slice(-2);
  return matched.slice(0, 4) + "…" + matched.slice(-4);
}

export interface ScanOptions {
  /** Pattern ids to skip. */
  skipPatternIds?: string[];
  /** Extra patterns to merge in. */
  extraPatterns?: SecretPattern[];
}

export function scanForSecrets(payload: string, opts: ScanOptions = {}): SecretFinding[] {
  const skip = new Set(opts.skipPatternIds ?? []);
  const patterns = SECRET_PATTERNS.concat(opts.extraPatterns ?? []);
  const findings: SecretFinding[] = [];
  for (const p of patterns) {
    if (skip.has(p.id)) continue;
    // Use exec loop to capture all matches with positions.
    p.regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = p.regex.exec(payload)) !== null) {
      const matched = m[0];
      if (p.minLength !== undefined && matched.length < p.minLength) continue;
      findings.push({
        patternId: p.id,
        label: p.label,
        start: m.index,
        end: m.index + matched.length,
        length: matched.length,
        preview: previewOf(matched),
      });
      // Defensive: prevent zero-width infinite loop in pathological regexes.
      if (m.index === p.regex.lastIndex) p.regex.lastIndex++;
    }
  }
  // Sort by start position so overlapping reports are reviewable in order.
  findings.sort((a, b) => a.start - b.start);
  return findings;
}

/**
 * Replace every finding's bytes with the same-length string of
 * `redactChar` (default `*`), preserving payload length. Useful when
 * downstream tooling depends on offsets being stable.
 */
export function redactFindings(
  payload: string,
  findings: SecretFinding[],
  redactChar = "*"
): string {
  if (findings.length === 0) return payload;
  const ranges = findings
    .slice()
    .sort((a, b) => a.start - b.start);
  // Coalesce overlapping ranges.
  const merged: Array<{ start: number; end: number }> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) {
      if (r.end > last.end) last.end = r.end;
    } else {
      merged.push({ start: r.start, end: r.end });
    }
  }
  let out = "";
  let cursor = 0;
  for (const r of merged) {
    out += payload.slice(cursor, r.start);
    out += redactChar.repeat(r.end - r.start);
    cursor = r.end;
  }
  out += payload.slice(cursor);
  return out;
}
