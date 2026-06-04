/**
 * Line-level diff via Longest Common Subsequence (LCS).
 *
 * ALGORITHM
 * ---------
 * Classic Hirschberg-free, table-based LCS dynamic program over two arrays of
 * lines. We build an (n+1) x (m+1) DP table `dp` where
 *
 *     dp[i][j] = length of the LCS of original[0..i) and proposed[0..j)
 *
 * with the standard recurrence
 *
 *     dp[i][j] = dp[i-1][j-1] + 1                         if a[i-1] === b[j-1]
 *              = max(dp[i-1][j], dp[i][j-1])              otherwise
 *
 * We then backtrack from dp[n][m] to recover an edit script of
 * keep / delete / insert operations in original document order.
 *
 * COMPLEXITY
 * ----------
 * Time  O(n * m), Space O(n * m), where n = #lines(original), m = #lines(proposed).
 * This is intentionally the textbook DP (NOT a diff library, NOT regex). It is
 * exact and deterministic. The quadratic cost is why callers MUST bound it — see
 * `diffEnforce`'s `maxCells` guard, which refuses to run the DP on pathological
 * inputs and falls back to a full rewrite instead.
 *
 * Everything here is pure and total: it never throws on any string input.
 */

export type EditOp =
  | { kind: "keep"; line: string; aIndex: number; bIndex: number }
  | { kind: "del"; line: string; aIndex: number }
  | { kind: "ins"; line: string; bIndex: number };

/**
 * Split text into lines for line-level diffing WITHOUT losing any byte.
 *
 * We keep each line's trailing newline attached to the line token. This makes
 * the join trivially lossless (`lines.join("")` === original) and lets the diff
 * distinguish "file ends with newline" from "file has no trailing newline" —
 * a real correctness concern the tests exercise.
 *
 * A purely empty string yields an empty array (zero lines). A non-empty string
 * with a trailing newline does NOT produce a spurious trailing empty line.
 */
export function splitLinesKeepingEol(text: string): string[] {
  if (text.length === 0) return [];
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) {
      out.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < text.length) {
    // Final chunk with no trailing newline.
    out.push(text.slice(start));
  }
  return out;
}

/**
 * Number of leading lines `a` and `b` share, and the number of trailing lines
 * they share (without overlapping the prefix). This is the standard prefix/
 * suffix trim that shrinks the quadratic LCS to the differing MIDDLE region —
 * the reason a single-line edit in a huge file costs O(window^2), not O(n^2).
 * Pure.
 */
export function commonAffix(
  a: string[],
  b: string[]
): { prefix: number; suffix: number } {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n, m);
  let prefix = 0;
  while (prefix < max && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < max - prefix &&
    a[n - 1 - suffix] === b[m - 1 - suffix]
  ) {
    suffix++;
  }
  return { prefix, suffix };
}

/**
 * Compute the LCS-based edit script transforming `a` into `b` at line level,
 * after trimming the common prefix/suffix. The trimmed lines are emitted as
 * "keep" ops with correct indices, so the result is identical to a full-array
 * LCS but the DP only runs on the differing middle window.
 *
 * Pure DP + backtrack. Deterministic: ties in the recurrence prefer deletions
 * before insertions (mirrors standard unified-diff ordering).
 */
export function computeLineEdits(a: string[], b: string[]): EditOp[] {
  const { prefix, suffix } = commonAffix(a, b);
  const aMid = a.slice(prefix, a.length - suffix);
  const bMid = b.slice(prefix, b.length - suffix);

  const ops: EditOp[] = [];
  for (let k = 0; k < prefix; k++) {
    ops.push({ kind: "keep", line: a[k], aIndex: k, bIndex: k });
  }
  for (const op of computeLineEditsRaw(aMid, bMid)) {
    // Re-base indices from the trimmed window back to full-array coordinates.
    if (op.kind === "keep") {
      ops.push({
        kind: "keep",
        line: op.line,
        aIndex: op.aIndex + prefix,
        bIndex: op.bIndex + prefix,
      });
    } else if (op.kind === "del") {
      ops.push({ kind: "del", line: op.line, aIndex: op.aIndex + prefix });
    } else {
      ops.push({ kind: "ins", line: op.line, bIndex: op.bIndex + prefix });
    }
  }
  for (let k = 0; k < suffix; k++) {
    const aIdx = a.length - suffix + k;
    const bIdx = b.length - suffix + k;
    ops.push({ kind: "keep", line: a[aIdx], aIndex: aIdx, bIndex: bIdx });
  }
  return ops;
}

/**
 * The raw, untrimmed LCS DP + backtrack over two line arrays. Exposed for the
 * size guard, which measures the trimmed window before deciding whether to run
 * this quadratic core. Pure.
 */
export function computeLineEditsRaw(a: string[], b: string[]): EditOp[] {
  const n = a.length;
  const m = b.length;

  // dp is (n+1) x (m+1). Use flat typed array for locality and to avoid the
  // overhead of nested arrays on large inputs (still O(n*m) space).
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

  // Backtrack from (0,0) forward to produce ops in document order.
  const ops: EditOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: "keep", line: a[i], aIndex: i, bIndex: j });
      i++;
      j++;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + (j + 1)]) {
      ops.push({ kind: "del", line: a[i], aIndex: i });
      i++;
    } else {
      ops.push({ kind: "ins", line: b[j], bIndex: j });
      j++;
    }
  }
  while (i < n) {
    ops.push({ kind: "del", line: a[i], aIndex: i });
    i++;
  }
  while (j < m) {
    ops.push({ kind: "ins", line: b[j], bIndex: j });
    j++;
  }
  return ops;
}
