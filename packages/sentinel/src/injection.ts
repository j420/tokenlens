/**
 * Prompt-injection / indirect-injection signature library for MCP
 * responses and other untrusted external data.
 *
 * Target incident class: the Jan 20 2026 RCE in Anthropic's Git MCP
 * server (path traversal + argument injection + repository-scoping
 * bypass, achieving remote code execution through prompt injection
 * alone — arXiv 2601.17548). OWASP reports 73% of live AI rollouts
 * have prompt-injection flaws; attack success rate against SOTA
 * defenses exceeds 85% when adaptive attacks are used. Detection here
 * is layered defense, not a complete shield.
 *
 * Detection categories (each pattern carries a stable id):
 *   - SHADOWING        — "ignore previous", "you are now", "system:"
 *                        embedded inside an MCP tool result body.
 *   - PATH_TRAVERSAL   — `../../`, `..\\..\\`, encoded variants.
 *   - ARGUMENT_INJECTION — backtick / $(…) / | rm -rf chains in
 *                          unexpected positions of a tool argument.
 *   - HIDDEN_HTML      — invisible elements / CSS that hide content
 *                        from the human reviewer.
 *   - INDIRECT_MARKUP  — markdown links / images whose target encodes
 *                        a directive ("[click here](javascript:…)").
 */

export type InjectionCategory =
  | "SHADOWING"
  | "PATH_TRAVERSAL"
  | "ARGUMENT_INJECTION"
  | "HIDDEN_HTML"
  | "INDIRECT_MARKUP";

export interface InjectionPattern {
  id: string;
  category: InjectionCategory;
  label: string;
  regex: RegExp;
}

export const INJECTION_PATTERNS: InjectionPattern[] = [
  // SHADOWING — direct override attempts.
  {
    id: "shadow_ignore_previous",
    category: "SHADOWING",
    label: '"ignore previous instructions" override attempt',
    regex: /\b(?:ignore|disregard|override|forget)\s+(?:all\s+|the\s+|your\s+|previous|prior|above)\b[^.]*?(?:instruction|prompt|context|system|rule)/gi,
  },
  {
    id: "shadow_you_are_now",
    category: "SHADOWING",
    label: '"you are now" persona swap',
    regex: /\byou\s+are\s+now\b[^.\n]{0,80}/gi,
  },
  {
    id: "shadow_system_role_injection",
    category: "SHADOWING",
    label: "system role injection",
    regex: /\b(?:system|assistant|developer)\s*[:>]\s*\n?\s*(?:you|do|run|execute|ignore)/gi,
  },

  // PATH_TRAVERSAL — relative-path escape attempts.
  {
    id: "path_traversal_dotdot_unix",
    category: "PATH_TRAVERSAL",
    label: "path traversal (.. /)",
    regex: /(?:\.\.\/){2,}/g,
  },
  {
    id: "path_traversal_dotdot_windows",
    category: "PATH_TRAVERSAL",
    label: "path traversal (..\\)",
    regex: /(?:\.\.\\){2,}/g,
  },
  {
    id: "path_traversal_url_encoded",
    category: "PATH_TRAVERSAL",
    label: "URL-encoded path traversal",
    regex: /(?:%2e%2e[%2f%5c])+/gi,
  },
  {
    id: "path_traversal_sensitive_paths",
    category: "PATH_TRAVERSAL",
    label: "reference to sensitive system path",
    // Note: no leading \b — the preceding char is typically a non-word
    // char (slash, space, quote) so \b fails. Trailing \b is fine
    // because the path ends in a word char.
    regex: /(?:\/etc\/(?:passwd|shadow|hosts)|\/root\/\.[a-z]+|~\/\.ssh\/|C:\\Windows\\System32\\config)\b/gi,
  },

  // ARGUMENT_INJECTION — shell metacharacters in unexpected positions.
  {
    id: "arg_injection_command_substitution",
    category: "ARGUMENT_INJECTION",
    label: "command substitution",
    regex: /\$\([^)]{1,200}\)|`[^`]{1,200}`/g,
  },
  {
    id: "arg_injection_rm_rf_root",
    category: "ARGUMENT_INJECTION",
    label: "rm -rf with destructive scope",
    regex: /\brm\s+-rf?\s+(?:\/|\$HOME|~|\.{1,2}\/?)/g,
  },
  {
    id: "arg_injection_pipe_to_shell",
    category: "ARGUMENT_INJECTION",
    label: "pipe-to-shell (`curl|sh`)",
    regex: /(?:curl|wget|fetch)[^\n|]{1,200}\|\s*(?:sh|bash|zsh|powershell)/gi,
  },
  {
    id: "arg_injection_eval",
    category: "ARGUMENT_INJECTION",
    label: "eval / Function() execution",
    regex: /\b(?:eval|Function|exec)\s*\(\s*['"`]/g,
  },

  // HIDDEN_HTML — try to hide content from a human reviewer.
  {
    id: "hidden_html_display_none",
    category: "HIDDEN_HTML",
    label: "display:none / visibility:hidden",
    regex: /style\s*=\s*['"][^'"]*?(?:display\s*:\s*none|visibility\s*:\s*hidden)/gi,
  },
  {
    id: "hidden_html_script_tag",
    category: "HIDDEN_HTML",
    label: "<script> tag",
    regex: /<script\b[^>]*>/gi,
  },
  {
    id: "hidden_html_comment",
    category: "HIDDEN_HTML",
    label: "HTML comment carrying instructions",
    regex: /<!--[\s\S]*?(?:ignore|you are|system|run|execute)[\s\S]*?-->/gi,
  },

  // INDIRECT_MARKUP — markdown / link-target abuse.
  {
    id: "indirect_javascript_link",
    category: "INDIRECT_MARKUP",
    label: "javascript: URL",
    regex: /\[[^\]]{0,200}\]\(\s*javascript:[^)]+\)/gi,
  },
  {
    id: "indirect_data_url_html",
    category: "INDIRECT_MARKUP",
    label: "data: URL with HTML payload",
    regex: /data:text\/html(?:[;,])[^"'\s)]*/gi,
  },
];

export interface InjectionFinding {
  patternId: string;
  category: InjectionCategory;
  label: string;
  start: number;
  end: number;
  excerpt: string;
}

export interface InjectionScanOptions {
  skipPatternIds?: string[];
  extraPatterns?: InjectionPattern[];
  /** Max excerpt length to include per finding. Default 120. */
  maxExcerptChars?: number;
}

function excerpt(payload: string, start: number, end: number, max: number): string {
  const span = payload.slice(start, end);
  if (span.length <= max) return span;
  return span.slice(0, max - 1) + "…";
}

export function scanForInjection(
  payload: string,
  opts: InjectionScanOptions = {}
): InjectionFinding[] {
  const skip = new Set(opts.skipPatternIds ?? []);
  const patterns = INJECTION_PATTERNS.concat(opts.extraPatterns ?? []);
  const maxEx = opts.maxExcerptChars ?? 120;
  const out: InjectionFinding[] = [];
  for (const p of patterns) {
    if (skip.has(p.id)) continue;
    p.regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = p.regex.exec(payload)) !== null) {
      out.push({
        patternId: p.id,
        category: p.category,
        label: p.label,
        start: m.index,
        end: m.index + m[0].length,
        excerpt: excerpt(payload, m.index, m.index + m[0].length, maxEx),
      });
      if (m.index === p.regex.lastIndex) p.regex.lastIndex++;
    }
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}
