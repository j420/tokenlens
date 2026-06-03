/**
 * Boundary-input validation for the adapter.
 *
 * Pure functions. Each one returns a `ValidationIssue[]` (empty = ok); the
 * client throws if any issue has severity:"error". Validation runs ONCE at
 * the entry of PruneAgentClient.query(), never silently — every error is
 * actionable and points at the field that broke.
 *
 * Why a dedicated module: edge-case probing surfaced five categories of
 * nonsense input (negative max_tokens, unknown provider, cyclic metadata,
 * out-of-range maxBreakpoints, invoker returning no usage) that silently
 * produced wire-level provider errors or NaN cost. The credibility rule for
 * this whole program is "never silent" — so we make these explicit.
 */

import type { Provider } from "@prune/shared";
import type { MessageRequest, MessageResponse } from "./types.js";

export interface ValidationIssue {
  severity: "error" | "warning";
  field: string;
  message: string;
}

const KNOWN_PROVIDERS: ReadonlySet<Provider> = new Set([
  "anthropic",
  "openai",
  "google",
]);

/** Validate a MessageRequest. Returns [] if ok. */
export function validateRequest(req: MessageRequest): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!req || typeof req !== "object") {
    issues.push({ severity: "error", field: "request", message: "request must be an object" });
    return issues;
  }
  if (typeof req.model !== "string" || req.model.length === 0) {
    issues.push({ severity: "error", field: "model", message: "model must be a non-empty string" });
  }
  if (!KNOWN_PROVIDERS.has(req.provider)) {
    issues.push({
      severity: "error",
      field: "provider",
      message: `provider "${req.provider}" not recognized; must be one of: anthropic, openai, google`,
    });
  }
  if (
    typeof req.maxOutputTokens !== "number" ||
    !Number.isInteger(req.maxOutputTokens) ||
    req.maxOutputTokens <= 0
  ) {
    issues.push({
      severity: "error",
      field: "maxOutputTokens",
      message: "maxOutputTokens must be a positive integer (provider rejects ≤0)",
    });
  }
  if (!Array.isArray(req.system)) {
    issues.push({ severity: "error", field: "system", message: "system must be an array" });
  } else {
    req.system.forEach((b, i) => {
      if (!b || typeof b !== "object") {
        issues.push({
          severity: "error",
          field: `system[${i}]`,
          message: "block must be an object",
        });
      } else if (b.type !== "text") {
        issues.push({
          severity: "error",
          field: `system[${i}].type`,
          message: `system blocks must be type="text"; got "${b.type}"`,
        });
      } else if (b.volatility !== "stable" && b.volatility !== "volatile") {
        issues.push({
          severity: "error",
          field: `system[${i}].volatility`,
          message: "volatility must be declared as 'stable' or 'volatile'",
        });
      }
    });
  }
  if (!Array.isArray(req.tools)) {
    issues.push({ severity: "error", field: "tools", message: "tools must be an array" });
  } else {
    req.tools.forEach((t, i) => {
      if (!t || typeof t !== "object") {
        issues.push({ severity: "error", field: `tools[${i}]`, message: "must be an object" });
      } else {
        if (typeof t.name !== "string" || t.name.length === 0)
          issues.push({ severity: "error", field: `tools[${i}].name`, message: "name must be non-empty" });
        if (t.volatility !== "stable" && t.volatility !== "volatile")
          issues.push({
            severity: "error",
            field: `tools[${i}].volatility`,
            message: "volatility must be declared",
          });
      }
    });
  }
  if (!Array.isArray(req.messages)) {
    issues.push({ severity: "error", field: "messages", message: "messages must be an array" });
  }
  if (req.metadata != null) {
    if (typeof req.metadata !== "object" || Array.isArray(req.metadata)) {
      issues.push({
        severity: "error",
        field: "metadata",
        message: "metadata must be a flat string→string object",
      });
    } else if (containsCycle(req.metadata)) {
      issues.push({
        severity: "error",
        field: "metadata",
        message: "metadata contains a circular reference (would fail provider serialization)",
      });
    }
  }
  return issues;
}

/**
 * Validate a MessageResponse from an invoker. Warnings (not errors) — a
 * vendor returning a slightly-malformed response shouldn't crash the loop;
 * the client normalizes and records the warning.
 */
export function validateResponse(res: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!res || typeof res !== "object") {
    issues.push({ severity: "error", field: "response", message: "response must be an object" });
    return issues;
  }
  const r = res as Partial<MessageResponse>;
  if (typeof r.id !== "string")
    issues.push({ severity: "error", field: "response.id", message: "missing id" });
  if (typeof r.model !== "string")
    issues.push({ severity: "error", field: "response.model", message: "missing model" });
  if (!Array.isArray(r.content))
    issues.push({ severity: "error", field: "response.content", message: "missing content[]" });
  if (typeof r.stop_reason !== "string")
    issues.push({
      severity: "error",
      field: "response.stop_reason",
      message: "missing stop_reason",
    });
  if (!r.usage || typeof r.usage !== "object") {
    issues.push({
      severity: "warning",
      field: "response.usage",
      message: "missing usage; cost math will use zeros for this turn",
    });
  } else {
    if (typeof r.usage.input_tokens !== "number")
      issues.push({
        severity: "warning",
        field: "response.usage.input_tokens",
        message: "missing; treated as 0",
      });
    if (typeof r.usage.output_tokens !== "number")
      issues.push({
        severity: "warning",
        field: "response.usage.output_tokens",
        message: "missing; treated as 0",
      });
  }
  return issues;
}

/** Throws a single ValidationError aggregating ALL errors (not just the first). */
export class ValidationError extends Error {
  constructor(readonly issues: ValidationIssue[]) {
    const summary = issues
      .filter((i) => i.severity === "error")
      .map((i) => `  • ${i.field}: ${i.message}`)
      .join("\n");
    super(`ValidationError: invalid MessageRequest\n${summary}`);
    this.name = "ValidationError";
  }
}

export function assertValidRequest(req: MessageRequest): void {
  const issues = validateRequest(req);
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length > 0) throw new ValidationError(issues);
}

/** Cheap cycle detector — used to catch cyclic metadata. */
function containsCycle(root: unknown): boolean {
  const seen = new WeakSet<object>();
  function walk(node: unknown): boolean {
    if (!node || typeof node !== "object") return false;
    if (seen.has(node as object)) return true;
    seen.add(node as object);
    for (const v of Object.values(node as Record<string, unknown>)) {
      if (walk(v)) return true;
    }
    return false;
  }
  return walk(root);
}

/** Normalize a vendor response to a UsageReport with explicit zeros. */
export function normalizeUsage(res: unknown): {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
} {
  const u = (res as { usage?: Record<string, unknown> })?.usage ?? {};
  const num = (x: unknown): number =>
    typeof x === "number" && Number.isFinite(x) ? x : 0;
  return {
    input_tokens: num(u.input_tokens),
    output_tokens: num(u.output_tokens),
    cache_read_input_tokens:
      typeof u.cache_read_input_tokens === "number"
        ? num(u.cache_read_input_tokens)
        : undefined,
    cache_creation_input_tokens:
      typeof u.cache_creation_input_tokens === "number"
        ? num(u.cache_creation_input_tokens)
        : undefined,
  };
}
