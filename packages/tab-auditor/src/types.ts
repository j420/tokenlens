/**
 * Public data shapes for the IDE Open-Tab Auditor.
 *
 * The canonical definitions live next to the orchestrator in `auditor.ts`
 * (so the entry point and its types stay in lockstep). This module simply
 * re-exports them as a stable, discoverable surface and documents the design
 * contract that every consumer can rely on:
 *
 *   - This package is PURE: it never reads the filesystem, counts tokens, or
 *     talks to an editor. It consumes a caller-supplied snapshot of open tabs.
 *   - It NEVER fabricates a token count. A tab with an unknown `tokenCount`
 *     suppresses the size signal and yields honest-unknown savings rather than
 *     a guessed 0-as-data.
 *   - It is deterministic and never throws on malformed input.
 */

export type {
  OpenTab,
  ImportEdge,
  AuditInput,
  AuditOptions,
  Recommendation,
  TabVerdict,
  AuditReport,
} from "./auditor.js";

export { DEFAULT_DROP_THRESHOLD } from "./auditor.js";
