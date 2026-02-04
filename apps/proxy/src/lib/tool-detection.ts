import type { ToolType } from "@prune/shared";

/**
 * Detect which AI coding tool is making the request based on the User-Agent header
 */
export function detectTool(userAgent: string | undefined): ToolType {
  if (!userAgent) {
    return "unknown";
  }

  const ua = userAgent.toLowerCase();

  // Claude Code detection
  if (ua.includes("claude-code") || ua.includes("claudecode")) {
    return "claude-code";
  }

  // Cursor detection
  if (ua.includes("cursor") || ua.includes("cursorai")) {
    return "cursor";
  }

  // Codex CLI detection
  if (ua.includes("codex") || ua.includes("openai-codex")) {
    return "codex";
  }

  // Check for common SDK/library patterns that suggest direct API use
  if (
    ua.includes("python") ||
    ua.includes("node") ||
    ua.includes("anthropic-sdk") ||
    ua.includes("openai-sdk")
  ) {
    return "direct-api";
  }

  return "unknown";
}
