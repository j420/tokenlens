/**
 * Unified-diff serialization + a parser/applier that round-trips the SERIALIZED
 * artifact (not an in-memory structure). The string the caller would actually
 * send is the same string we parse back and apply — so `diffVerified` proves the
 * payload itself reconstructs `proposed`, byte-for-byte.
 *
 * FORMAT (a constrained, self-describing unified diff)
 * ----------------------------------------------------
 * Header lines:
 *   --- original
 *   +++ proposed
 * Then one or more hunks:
 *   @@ -aStart,aLen +bStart,bLen @@
 *   followed by body lines, each prefixed by exactly one marker byte:
 *     " " context (kept)   "-" deletion   "+" insertion
 *
 * EOL ENCODING (the subtle correctness bit)
 * -----------------------------------------
 * Lines are diffed WITH their trailing "\n" attached (see lcs.splitLinesKeepingEol),
 * so a body line normally renders as: <marker><content-without-its-\n>\n.
 * A source line that has NO trailing newline (only possible at end-of-file)
 * cannot be represented that way without inventing a newline. We mark such lines
 * by emitting an extra sentinel line `\\ No newline at end of file` immediately
 * after them (same convention GNU diff uses). The applier consumes that sentinel
 * to drop the synthetic newline, restoring the exact bytes.
 *
 * Because markers occupy column 0, body content can itself begin with "+","-"," "
 * or "\\" without ambiguity: the parser strips exactly one marker byte per body
 * line and treats the sentinel only when a full body line equals the sentinel.
 *
 * Everything here is pure and total.
 */

import type { EditOp } from "./lcs.js";

const NO_EOL_SENTINEL = "\\ No newline at end of file";

export interface Hunk {
  aStart: number; // 1-based start line in original (0 if hunk inserts only)
  aLen: number;
  bStart: number; // 1-based start line in proposed
  bLen: number;
  /** Body ops in order: context/del/ins, each carrying the raw line text. */
  body: EditOp[];
}

/** A change op is anything that is not a "keep". */
function isChange(op: EditOp): boolean {
  return op.kind !== "keep";
}

/**
 * Group the flat edit script into unified-diff hunks with up to `context` lines
 * of surrounding context. Hunks coalesce when their context windows overlap.
 * Pure; deterministic.
 */
export function buildHunks(ops: EditOp[], context: number): Hunk[] {
  const n = ops.length;
  // Indices of changed ops.
  const changeIdx: number[] = [];
  for (let i = 0; i < n; i++) if (isChange(ops[i])) changeIdx.push(i);
  if (changeIdx.length === 0) return [];

  // Merge changed indices into ranges whose context windows touch/overlap.
  const ranges: Array<{ start: number; end: number }> = [];
  let rs = Math.max(0, changeIdx[0] - context);
  let re = Math.min(n - 1, changeIdx[0] + context);
  for (let k = 1; k < changeIdx.length; k++) {
    const cs = Math.max(0, changeIdx[k] - context);
    const ce = Math.min(n - 1, changeIdx[k] + context);
    if (cs <= re + 1) {
      if (ce > re) re = ce;
    } else {
      ranges.push({ start: rs, end: re });
      rs = cs;
      re = ce;
    }
  }
  ranges.push({ start: rs, end: re });

  const hunks: Hunk[] = [];
  for (const { start, end } of ranges) {
    const body = ops.slice(start, end + 1);
    let aStart = 0;
    let bStart = 0;
    let aLen = 0;
    let bLen = 0;
    for (const op of body) {
      if (op.kind === "keep") {
        if (aStart === 0) aStart = op.aIndex + 1;
        if (bStart === 0) bStart = op.bIndex + 1;
        aLen++;
        bLen++;
      } else if (op.kind === "del") {
        if (aStart === 0) aStart = op.aIndex + 1;
        aLen++;
      } else {
        if (bStart === 0) bStart = op.bIndex + 1;
        bLen++;
      }
    }
    hunks.push({ aStart, aLen, bStart, bLen, body });
  }
  return hunks;
}

/** Render one body line: marker + content, handling the missing-EOL sentinel. */
function renderBodyLine(marker: " " | "-" | "+", line: string): string {
  const hasEol = line.endsWith("\n");
  if (hasEol) {
    return marker + line; // line already ends with \n
  }
  // No trailing newline: emit the content, then a real newline so the format
  // stays line-oriented, then the sentinel on its own line.
  return marker + line + "\n" + NO_EOL_SENTINEL + "\n";
}

/** Serialize hunks into the unified-diff string. Pure. */
export function renderUnifiedDiff(hunks: Hunk[]): string {
  if (hunks.length === 0) return "";
  let out = "--- original\n+++ proposed\n";
  for (const h of hunks) {
    out += `@@ -${h.aStart},${h.aLen} +${h.bStart},${h.bLen} @@\n`;
    for (const op of h.body) {
      if (op.kind === "keep") out += renderBodyLine(" ", op.line);
      else if (op.kind === "del") out += renderBodyLine("-", op.line);
      else out += renderBodyLine("+", op.line);
    }
  }
  return out;
}

interface ParsedBodyLine {
  marker: " " | "-" | "+";
  /** Raw content WITH its trailing newline, unless noEol. */
  content: string;
  noEol: boolean;
}

interface ParsedHunk {
  aStart: number;
  body: ParsedBodyLine[];
}

/**
 * Parse the serialized diff back into hunks. Returns null if the text is not a
 * well-formed diff produced by `renderUnifiedDiff` (defensive — used to fail
 * safe to "rewrite"). Pure; never throws.
 */
function parseUnifiedDiff(diff: string): ParsedHunk[] | null {
  if (diff.length === 0) return [];
  const lines = diff.split("\n");
  // diff.split("\n") on a string ending in "\n" leaves a trailing "" — fine,
  // we index explicitly and ignore the final empty element.
  let idx = 0;
  if (lines[idx] !== "--- original") return null;
  idx++;
  if (lines[idx] !== "+++ proposed") return null;
  idx++;

  const hunks: ParsedHunk[] = [];
  while (idx < lines.length) {
    const header = lines[idx];
    if (header === "" && idx === lines.length - 1) break; // trailing newline artifact
    if (!header.startsWith("@@ ")) return null;
    const aStart = parseHunkHeaderAStart(header);
    if (aStart === null) return null;
    idx++;

    const body: ParsedBodyLine[] = [];
    while (idx < lines.length) {
      const ln = lines[idx];
      if (ln.startsWith("@@ ")) break;
      if (ln === "" && idx === lines.length - 1) break; // final artifact
      if (ln.length === 0) return null; // unexpected blank body line
      const markerChar = ln[0];
      if (markerChar !== " " && markerChar !== "-" && markerChar !== "+") {
        return null;
      }
      const marker = markerChar as " " | "-" | "+";
      const rest = ln.slice(1);
      idx++;
      // Look ahead for the no-EOL sentinel.
      let noEol = false;
      if (lines[idx] === NO_EOL_SENTINEL) {
        noEol = true;
        idx++;
      }
      body.push({
        marker,
        content: noEol ? rest : rest + "\n",
        noEol,
      });
    }
    hunks.push({ aStart, body });
  }
  return hunks;
}

/** Parse "-aStart,aLen" out of a hunk header. Structural, no regex. */
function parseHunkHeaderAStart(header: string): number | null {
  // header form: "@@ -A,L +B,L @@"
  const parts = header.split(" ");
  // ["@@", "-A,L", "+B,L", "@@"]
  if (parts.length < 4) return null;
  if (parts[0] !== "@@" || parts[parts.length - 1] !== "@@") return null;
  const aPart = parts[1];
  if (aPart.length < 2 || aPart[0] !== "-") return null;
  const comma = aPart.indexOf(",");
  const numStr = comma === -1 ? aPart.slice(1) : aPart.slice(1, comma);
  if (numStr.length === 0) return null;
  let val = 0;
  for (let k = 0; k < numStr.length; k++) {
    const c = numStr.charCodeAt(k);
    if (c < 48 || c > 57) return null;
    val = val * 10 + (c - 48);
  }
  return val;
}

/**
 * Apply a serialized unified diff to `original`, returning the reconstructed
 * text, or null on any inconsistency (context/deletion lines not matching the
 * original at the stated position). Pure; never throws. The null path is what
 * forces a fail-safe "rewrite" recommendation.
 */
export function applyUnifiedDiff(
  original: string,
  diff: string,
  origLines: string[]
): string | null {
  const parsed = parseUnifiedDiff(diff);
  if (parsed === null) return null;
  if (parsed.length === 0) {
    // Empty diff means "no change": reconstruction is the original itself.
    return original;
  }

  const result: string[] = [];
  let cursor = 0; // 0-based index into origLines already emitted/consumed

  for (const hunk of parsed) {
    // 1-based aStart; 0 means the hunk is pure insertion at current cursor.
    const hunkStart = hunk.aStart === 0 ? cursor : hunk.aStart - 1;
    if (hunkStart < cursor || hunkStart > origLines.length) return null;
    // Emit untouched original lines between cursor and hunk start.
    for (let k = cursor; k < hunkStart; k++) result.push(origLines[k]);
    cursor = hunkStart;

    for (const bl of hunk.body) {
      if (bl.marker === " " || bl.marker === "-") {
        // Must match the current original line exactly.
        if (cursor >= origLines.length) return null;
        if (origLines[cursor] !== bl.content) return null;
        if (bl.marker === " ") result.push(bl.content);
        cursor++;
      } else {
        // insertion
        result.push(bl.content);
      }
    }
  }
  // Emit any remaining untouched original tail.
  for (let k = cursor; k < origLines.length; k++) result.push(origLines[k]);

  return result.join("");
}
