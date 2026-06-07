/**
 * Navigation-to-Edit Ratio Detector  (Cost-Security)
 * ==================================================
 * After an agent has localized a fix, the cheap-but-common failure mode is
 * *over-exploration*: turn after turn of Read/Grep/Glob/LS over files it has
 * already seen, with ZERO Write/Edit in between. Every such turn re-transmits
 * the growing context (fresh_input + cache_read + output) and produces no edit —
 * pure navigation tax. Grounded in arXiv 2511.00197 (navigation dominates
 * patch-writing; localization is usually already correct).
 *
 * `assessNavigationRatio(turns, options?)` is a PURE function over a caller-fed
 * window of per-turn tool activity. It classifies each tool call by SET
 * MEMBERSHIP only — NAV = {Read, Grep, Glob, LS, NotebookRead}, MUT = {Write,
 * Edit, MultiEdit, NotebookEdit} — and fires an advisory iff, over the window,
 * the agent made NO mutations, enough navigation calls, and is re-visiting a
 * path it already touched.
 *
 * DISCIPLINE:
 *   - Deterministic & total. Same window => same report. Malformed entries are
 *     skipped, never thrown on.
 *   - No regex, no model. Tool classification is set membership; the
 *     revisited-path signal is path EQUALITY across turns. Nothing inspects
 *     tool *content*.
 *   - Caller-fed only. Operates on tool names + paths the caller supplies; it
 *     carries no file bodies (PII-safe by construction).
 *   - Advisory. Returns a verdict + the counts that drove it; it never blocks.
 *     The revisited-path gate keeps a legitimate first-pass wide survey
 *     ("explain this module" — many reads, but of DISTINCT files) from firing.
 */

// ============================================================================
// Types
// ============================================================================

/** One tool invocation within a turn. `path` is the file it touched, if any. */
export interface NavToolCall {
  /** Tool name as reported by the host (identity key; not interpreted). */
  name: string;
  /** File path the call touched, or null/undefined when not file-scoped. */
  path?: string | null;
}

/** The tool activity of a single turn. */
export interface NavTurn {
  /** Monotonic turn index (ordering + span reporting only). */
  turn: number;
  /** Tool calls made during this turn, in order. */
  tools: NavToolCall[];
}

export interface NavigationOptions {
  /**
   * Only consider the most recent `window` turns. 0 / unset = all supplied.
   * Default 4 — long enough to see a stall, short enough to stay current.
   */
  window?: number;
  /**
   * Minimum navigation calls in the window before the detector may fire.
   * Default 5 — below this, a read-only stretch is too short to be wasteful.
   */
  navFloor?: number;
  /**
   * Minimum turns that must be present (post-window) before firing. Default 2 —
   * a single navigation turn is normal localization, not a stall.
   */
  minTurns?: number;
  /**
   * Runtime-neutral classification override. The defaults cover the common
   * agent runtimes (Claude Code / Cursor / Codex) — `DEFAULT_NAV_TOOLS` and
   * `DEFAULT_MUT_TOOLS`. A host whose tool vocabulary differs (a different
   * agent, a custom MCP toolset) supplies its OWN read-class / write-class
   * names here; the detector is otherwise identical. Names are matched by
   * exact set membership (never regex). When provided, these REPLACE the
   * defaults so a runtime gets exactly the taxonomy it declares.
   */
  navTools?: readonly string[];
  mutTools?: readonly string[];
}

export interface NavigationReport {
  verdict: "ok" | "warn";
  /** Navigation (read-class) tool calls counted in the window. */
  navCount: number;
  /** Mutation (write-class) tool calls counted in the window. */
  mutCount: number;
  /** Tool calls that were neither nav nor mut (Bash, Task, …). Informational. */
  otherCount: number;
  /** Turns actually considered after applying the window. */
  turnsConsidered: number;
  /** Paths touched in >= 2 distinct considered turns (sorted, deterministic). */
  revisitedPaths: string[];
}

// ============================================================================
// Classification (set membership — never regex)
// ============================================================================

/**
 * Read-class ("navigation") tool names across the common agent runtimes. The
 * detector is runtime-neutral: a host with a different vocabulary overrides
 * these via NavigationOptions.navTools.
 */
export const DEFAULT_NAV_TOOLS: readonly string[] = [
  // Claude Code
  "Read",
  "Grep",
  "Glob",
  "LS",
  "NotebookRead",
  // Cursor / Codex / generic
  "read_file",
  "list_dir",
  "grep_search",
  "file_search",
  "codebase_search",
  "search",
];

/** Write-class ("mutation") tool names across the common agent runtimes. */
export const DEFAULT_MUT_TOOLS: readonly string[] = [
  // Claude Code
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  // Cursor / Codex / generic
  "edit_file",
  "write_file",
  "apply_patch",
  "create_file",
  "search_replace",
];

// ============================================================================
// assessNavigationRatio
// ============================================================================

export function assessNavigationRatio(
  turns: unknown,
  options: NavigationOptions = {}
): NavigationReport {
  const window = posInt(options.window, 4, /*allowZero*/ true);
  const navFloor = posInt(options.navFloor, 5);
  const minTurns = posInt(options.minTurns, 2);
  const navTools = toNameSet(options.navTools, DEFAULT_NAV_TOOLS);
  const mutTools = toNameSet(options.mutTools, DEFAULT_MUT_TOOLS);

  // --- Coerce + filter to well-formed turns (never throw). -------------------
  const all: NavTurn[] = Array.isArray(turns)
    ? (turns.filter(isNavTurn) as NavTurn[])
    : [];
  // Stable ordering by turn index; window keeps the most recent.
  const ordered = [...all].sort((a, b) => a.turn - b.turn);
  const considered = window > 0 ? ordered.slice(-window) : ordered;

  let navCount = 0;
  let mutCount = 0;
  let otherCount = 0;
  // path -> set of distinct turn indices that touched it (for revisit detection)
  const pathTurns = new Map<string, Set<number>>();

  for (const t of considered) {
    for (const call of t.tools) {
      if (!isNavToolCall(call)) continue;
      if (navTools.has(call.name)) navCount++;
      else if (mutTools.has(call.name)) mutCount++;
      else otherCount++;

      if (typeof call.path === "string" && call.path.length > 0) {
        const set = pathTurns.get(call.path) ?? new Set<number>();
        set.add(t.turn);
        pathTurns.set(call.path, set);
      }
    }
  }

  const revisitedPaths = [...pathTurns.entries()]
    .filter(([, turnSet]) => turnSet.size >= 2)
    .map(([path]) => path)
    .sort();

  // Fire iff: enough history, no edits at all, enough navigation, and at least
  // one path was re-visited across turns (distinguishes a stall from a
  // first-pass survey of distinct files).
  const warn =
    considered.length >= minTurns &&
    mutCount === 0 &&
    navCount >= navFloor &&
    revisitedPaths.length >= 1;

  return {
    verdict: warn ? "warn" : "ok",
    navCount,
    mutCount,
    otherCount,
    turnsConsidered: considered.length,
    revisitedPaths,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function isNavTurn(v: unknown): v is NavTurn {
  if (!v || typeof v !== "object") return false;
  const t = v as Record<string, unknown>;
  return (
    typeof t.turn === "number" &&
    Number.isFinite(t.turn) &&
    Array.isArray(t.tools)
  );
}

function isNavToolCall(v: unknown): v is NavToolCall {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return typeof c.name === "string" && c.name.length > 0;
}

/** Build a name set from a caller override, falling back to the default list. */
function toNameSet(
  override: readonly string[] | undefined,
  fallback: readonly string[]
): Set<string> {
  const source =
    Array.isArray(override) && override.length > 0 ? override : fallback;
  return new Set(source.filter((n) => typeof n === "string" && n.length > 0));
}

function posInt(v: unknown, dflt: number, allowZero = false): number {
  const min = allowZero ? 0 : 1;
  return typeof v === "number" && Number.isFinite(v) && v >= min
    ? Math.floor(v)
    : dflt;
}
