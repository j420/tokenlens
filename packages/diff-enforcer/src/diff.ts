/**
 * Line-level diff engine for the Diff-vs-Rewrite Enforcer.
 *
 * Algorithm
 * ---------
 * The longest common subsequence (LCS) of the two line arrays is computed with
 * the classic Wagner-Fischer dynamic-programming table:
 *
 *   dp[i][j] = length of LCS of original[0..i) and proposed[0..j)
 *
 *   dp[i][j] = dp[i-1][j-1] + 1                if lines equal
 *            = max(dp[i-1][j], dp[i][j-1])     otherwise
 *
 * Backtracking the table produces an edit script — an ordered list of
 * `equal` / `delete` / `insert` operations that transforms `original` into
 * `proposed`. This is a REAL diff: it is optimal (minimal edit distance under
 * the insert/delete model) and deterministic.
 *
 * Complexity
 * ----------
 * Time and space are O(n * m) where n, m are the line counts of the two
 * inputs. To stay bounded on pathological inputs we refuse to allocate a
 * table larger than `maxMatrixCells` cells (default 4,000,000 ≈ 2000x2000
 * lines, a few MB of Int32). Above that, `computeLineDiff` returns
 * `{ bounded: false }` and the caller falls back to a full rewrite rather than
 * running an unbounded O(n*m) computation.
 *
 * Round-trip safety
 * -----------------
 * The structured edit script (not a re-parsed text blob) is the artifact that
 * gets applied. `applyEditScript` walks `original` consuming the script's
 * `equal`/`delete` lines positionally and emitting `equal`/`insert` lines,
 * reconstructing `proposed`. The enforcer asserts byte-equality before ever
 * recommending a diff.
 *
 * Line model
 * ----------
 * `splitLines` keeps each line's terminator attached to that line, so
 * `splitLines(s).join("") === s` for every string. This is what lets the diff
 * round-trip exactly across trailing-newline differences, missing final
 * newlines, CRLF, etc. — terminators are ordinary content, never normalized.
 *
 * No regex is used anywhere: splitting scans characters, the diff works on
 * arrays, and rendering concatenates strings.
 */

export type EditOpKind = "equal" | "delete" | "insert";

export interface EditOp {
  kind: EditOpKind;
  /** The exact line text (terminator included) this op carries. */
  line: string;
  /** Index into the original line array (for equal/delete), else -1. */
  origIndex: number;
  /** Index into the proposed line array (for equal/insert), else -1. */
  propIndex: number;
}

export interface LineDiffResult {
  /** False when the input was too large to diff within the cell bound. */
  bounded: boolean;
  /** Ordered edit script transforming original -> proposed. Empty if !bounded. */
  ops: EditOp[];
  /** Length of the LCS (count of equal lines). */
  lcsLength: number;
  origLineCount: number;
  propLineCount: number;
}

/**
 * Split a string into lines, KEEPING each line's `\n` terminator attached to
 * it. A final segment without a trailing newline is emitted as its own line.
 * The empty string yields an empty array (join("") === "").
 *
 * Examples:
 *   ""          -> []
 *   "a"         -> ["a"]
 *   "a\n"       -> ["a\n"]
 *   "a\nb"      -> ["a\n", "b"]
 *   "a\n\n"     -> ["a\n", "\n"]
 *   "a\r\nb"    -> ["a\r\n", "b"]   (\r is ordinary content)
 *
 * Property: splitLines(s).join("") === s for all s.
 */
export function splitLines(text: string): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) {
      lines.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < text.length) {
    lines.push(text.slice(start));
  }
  return lines;
}

export interface ComputeDiffOptions {
  /** Hard cap on the DP matrix size (cells). Above it we decline (bounded:false). */
  maxMatrixCells?: number;
}

const DEFAULT_MAX_MATRIX_CELLS = 4_000_000;

/**
 * Compute the optimal line-level edit script via LCS dynamic programming.
 * Bounded: declines (bounded:false) rather than allocating a table larger
 * than `maxMatrixCells`.
 */
export function computeLineDiff(
  original: string,
  proposed: string,
  options: ComputeDiffOptions = {}
): LineDiffResult {
  const a = splitLines(original);
  const b = splitLines(proposed);
  const n = a.length;
  const m = b.length;
  const maxCells = options.maxMatrixCells ?? DEFAULT_MAX_MATRIX_CELLS;

  // Fast paths that avoid the table entirely.
  if (n === 0 && m === 0) {
    return { bounded: true, ops: [], lcsLength: 0, origLineCount: 0, propLineCount: 0 };
  }

  // Bound check uses the full table size (n+1)*(m+1).
  if ((n + 1) * (m + 1) > maxCells) {
    return { bounded: false, ops: [], lcsLength: 0, origLineCount: n, propLineCount: m };
  }

  // DP table flattened: dp[(i*(m+1)) + j].
  const width = m + 1;
  const dp = new Int32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    const ai = a[i];
    const rowBase = i * width;
    const nextRowBase = (i + 1) * width;
    for (let j = m - 1; j >= 0; j--) {
      if (ai === b[j]) {
        dp[rowBase + j] = dp[nextRowBase + (j + 1)] + 1;
      } else {
        const down = dp[nextRowBase + j];
        const right = dp[rowBase + (j + 1)];
        dp[rowBase + j] = down >= right ? down : right;
      }
    }
  }

  // Backtrack from (0,0) to build the edit script in forward order.
  const ops: EditOp[] = [];
  let i = 0;
  let j = 0;
  let lcsLength = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: "equal", line: a[i], origIndex: i, propIndex: j });
      lcsLength++;
      i++;
      j++;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + (j + 1)]) {
      ops.push({ kind: "delete", line: a[i], origIndex: i, propIndex: -1 });
      i++;
    } else {
      ops.push({ kind: "insert", line: b[j], origIndex: -1, propIndex: j });
      j++;
    }
  }
  while (i < n) {
    ops.push({ kind: "delete", line: a[i], origIndex: i, propIndex: -1 });
    i++;
  }
  while (j < m) {
    ops.push({ kind: "insert", line: b[j], origIndex: -1, propIndex: j });
    j++;
  }

  return { bounded: true, ops, lcsLength, origLineCount: n, propLineCount: m };
}

/**
 * Apply a structured edit script to `original` and return the reconstructed
 * string. This is a genuine patch application: it walks the original line
 * array positionally, requiring each `equal`/`delete` op to match the original
 * line at the current cursor, and emits `equal`/`insert` lines in script order.
 *
 * Returns `null` if the script is inconsistent with `original` (a corrupt or
 * mis-ordered script) — never throws. A `null` result means the diff is
 * unsound and must not be recommended.
 */
export function applyEditScript(original: string, ops: EditOp[]): string | null {
  const a = splitLines(original);
  let cursor = 0;
  const out: string[] = [];
  for (const op of ops) {
    switch (op.kind) {
      case "equal":
        if (cursor >= a.length || a[cursor] !== op.line) return null;
        out.push(a[cursor]);
        cursor++;
        break;
      case "delete":
        if (cursor >= a.length || a[cursor] !== op.line) return null;
        cursor++;
        break;
      case "insert":
        out.push(op.line);
        break;
      default:
        return null;
    }
  }
  // Every original line must have been consumed (matched or deleted).
  if (cursor !== a.length) return null;
  return out.join("");
}

export interface Hunk {
  origStart: number; // 1-based start line in original
  origLines: number;
  propStart: number; // 1-based start line in proposed
  propLines: number;
  /** Rendered body lines, each already carrying its own '\n' if present. */
  body: string[];
}

export interface RenderOptions {
  /** Lines of unchanged context around each change group. Default 3. */
  context?: number;
}

/**
 * Render the edit script as a unified-diff-style string with `@@` hunk headers
 * and `+`/`-`/` ` markers. Context-collapsed: runs of equal lines longer than
 * 2*context are split so unchanged regions are not re-sent.
 *
 * This is the artifact whose tokens we measure. It is derived purely from the
 * structured ops (no parsing), so it cannot disagree with what we apply.
 *
 * Marker handling: a line may or may not end in '\n'. We prefix the marker and
 * preserve the line's terminator. For a line with NO terminator (last line of
 * a file without a trailing newline) we append the git-style annotation
 * "\n\\ No newline at end of file\n" so the rendering is unambiguous. This
 * annotation is presentational only — it never feeds back into apply.
 */
export function renderUnifiedDiff(
  result: LineDiffResult,
  options: RenderOptions = {}
): string {
  if (result.ops.length === 0) return "";
  const context = Math.max(0, options.context ?? 3);
  const ops = result.ops;

  // Group ops into hunks: a change op (insert/delete) anchors a hunk; we keep
  // up to `context` equal lines before and after, and merge change groups that
  // are within 2*context equal lines of each other.
  const isChange = (k: EditOpKind) => k !== "equal";

  // Index of each op; we scan to find change clusters.
  type Cluster = { start: number; end: number }; // inclusive op indices (change-only span)
  const clusters: Cluster[] = [];
  for (let idx = 0; idx < ops.length; idx++) {
    if (isChange(ops[idx].kind)) {
      const start = idx;
      let end = idx;
      let gap = 0;
      let scan = idx + 1;
      // extend cluster across small equal gaps
      while (scan < ops.length) {
        if (isChange(ops[scan].kind)) {
          end = scan;
          gap = 0;
        } else {
          gap++;
          if (gap > 2 * context) break;
        }
        scan++;
      }
      clusters.push({ start, end });
      idx = end; // continue after this cluster's last change
    }
  }

  if (clusters.length === 0) return ""; // all equal -> no diff body

  const pieces: string[] = [];
  for (const cluster of clusters) {
    const hunkStart = Math.max(0, cluster.start - context);
    const hunkEnd = Math.min(ops.length - 1, cluster.end + context);

    // Compute 1-based start lines and counts by inspecting indices.
    let origStart = -1;
    let propStart = -1;
    let origLines = 0;
    let propLines = 0;
    const body: string[] = [];
    for (let k = hunkStart; k <= hunkEnd; k++) {
      const op = ops[k];
      if (op.kind === "equal") {
        if (origStart < 0) origStart = op.origIndex;
        if (propStart < 0) propStart = op.propIndex;
        origLines++;
        propLines++;
        body.push(markerLine(" ", op.line));
      } else if (op.kind === "delete") {
        if (origStart < 0) origStart = op.origIndex;
        origLines++;
        body.push(markerLine("-", op.line));
      } else {
        if (propStart < 0) propStart = op.propIndex;
        propLines++;
        body.push(markerLine("+", op.line));
      }
    }
    // If a hunk is pure-insert it may have no orig anchor; clamp to insertion point.
    const oStart = origStart < 0 ? originAnchorBefore(ops, hunkStart) : origStart;
    const pStart = propStart < 0 ? proposedAnchorBefore(ops, hunkStart) : propStart;

    const header =
      `@@ -${origLines === 0 ? oStart : oStart + 1},${origLines} ` +
      `+${propLines === 0 ? pStart : pStart + 1},${propLines} @@\n`;
    pieces.push(header);
    pieces.push(body.join(""));
  }

  return pieces.join("");
}

function markerLine(marker: string, line: string): string {
  // Preserve terminator; flag missing final newline explicitly.
  if (line.length > 0 && line.charCodeAt(line.length - 1) === 10) {
    return marker + line;
  }
  return marker + line + "\n\\ No newline at end of file\n";
}

function originAnchorBefore(ops: EditOp[], start: number): number {
  for (let k = start - 1; k >= 0; k--) {
    if (ops[k].origIndex >= 0) return ops[k].origIndex;
  }
  return -1; // before first line
}

function proposedAnchorBefore(ops: EditOp[], start: number): number {
  for (let k = start - 1; k >= 0; k--) {
    if (ops[k].propIndex >= 0) return ops[k].propIndex;
  }
  return -1;
}

/** Count of changed lines (inserts + deletes) in the script. */
export function countChangedLines(result: LineDiffResult): number {
  let changed = 0;
  for (const op of result.ops) {
    if (op.kind !== "equal") changed++;
  }
  return changed;
}
