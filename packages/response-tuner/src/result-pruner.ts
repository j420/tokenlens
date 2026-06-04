/**
 * Tool-Result Sub-Token Pruner
 * ----------------------------
 * Reduce the token cost of a large tool RESULT string (file dump, grep/log
 * output, JSON blob) while preserving the information the model needs to act.
 *
 * The reduction is LAYERED and each layer is independently switchable:
 *
 *   1. trailing-whitespace strip   (cosmetic, lossless-ish — see `lossless`)
 *   2. identical-run collapse      (consecutive equal lines -> 1 + marker)
 *   3. blank-run collapse          (3+ consecutive blank lines -> 1)
 *   4. blob collapse               (long opaque base64/hex/data-URI runs)
 *   5. middle elision              (head/tail windowing for very long output)
 *
 * Every layer that removes information records an entry in `manifest`, so the
 * caller (and the model) can see EXACTLY what was dropped and how much
 * (line counts, char counts, content hashes). Nothing is silently discarded.
 *
 * REAL token counts: original/pruned token totals come from @prune/tokenizer,
 * never estimated by hand.
 *
 * DISCIPLINE:
 *   - No regex anywhere. Structure is found by explicit character-class SCANS
 *     (counting runs of base64/hex characters, counting blank lines, comparing
 *     whole lines for equality). See `isBlobChar` / `scanBlobRuns`.
 *   - Pure & deterministic. Same input + options => same output.
 *   - Idempotent-ish: pruning already-pruned output is ~stable. Re-running adds
 *     no new collapses because markers are not themselves collapsible and the
 *     surviving content already satisfies every layer's invariant.
 *   - Never throws on bad input: a null/undefined/non-string input yields a
 *     well-formed neutral result.
 */

import { createHash } from "node:crypto";
import { countTokens } from "@prune/tokenizer";

// ============================================================================
// Types
// ============================================================================

export type PruneLayerKind =
  | "identical_run"
  | "blank_run"
  | "blob"
  | "middle_elision";

export interface PruneManifestEntry {
  kind: PruneLayerKind;
  /** 1-based line number in the PRUNED output where the marker sits. */
  atLine?: number;
  /** Number of source lines removed by this entry (run/elision layers). */
  removedLines?: number;
  /** Number of source characters removed by this entry (blob layer). */
  removedChars?: number;
  /** First 12 hex chars of sha256 of the removed content (blob / elision). */
  sha256?: string;
}

export interface PruneOptions {
  /** Model used for token counting. Default "gpt-4o". */
  model?: string;
  /** Collapse runs of identical consecutive lines. Default true. */
  collapseIdenticalRuns?: boolean;
  /**
   * Treat lines that differ only by trailing whitespace as identical when
   * collapsing runs. Default true. (When false, only byte-identical lines
   * collapse.)
   */
  trimTrailingForRunEquality?: boolean;
  /** Strip trailing whitespace from every line. Default true. */
  stripTrailingWhitespace?: boolean;
  /** Collapse 3+ consecutive blank lines down to 1. Default true. */
  collapseBlankRuns?: boolean;
  /** Collapse long opaque blob runs. Default true. */
  collapseBlobs?: boolean;
  /**
   * Minimum length (in chars) of an opaque run before it is treated as a blob.
   * Default 512.
   */
  blobMinChars?: number;
  /** Enable head/tail middle elision. Default true. */
  middleElision?: boolean;
  /**
   * Only elide the middle when the (post-collapse) line count exceeds this.
   * Default 2000.
   */
  middleElisionTriggerLines?: number;
  /** Lines kept at head and tail when eliding. Default 500 each. */
  middleElisionKeep?: number;
}

export interface PruneResult {
  pruned: string;
  originalTokens: number;
  prunedTokens: number;
  savedTokens: number;
  /** Percentage saved, 0..100, rounded to 2 decimals. 0 when nothing saved. */
  savedPct: number;
  /**
   * True only if the transform removed no information — i.e. no manifest
   * entries AND no characters were dropped (trailing-whitespace stripping is
   * considered information-losing and flips this to false when it changes the
   * text, because it can change a diff/whitespace-significant file).
   */
  lossless: boolean;
  manifest: PruneManifestEntry[];
}

// ============================================================================
// Defaults
// ============================================================================

const DEFAULTS: Required<PruneOptions> = {
  model: "gpt-4o",
  collapseIdenticalRuns: true,
  trimTrailingForRunEquality: true,
  stripTrailingWhitespace: true,
  collapseBlankRuns: true,
  collapseBlobs: true,
  blobMinChars: 512,
  middleElision: true,
  middleElisionTriggerLines: 2000,
  middleElisionKeep: 500,
};

// Hard cap on per-line length we will scan character-by-character for blobs, to
// stay bounded on pathological input. Lines longer than this are still passed
// through verbatim; only the (linear) blob scan is skipped for them. 200k chars
// comfortably covers any realistic single line of tool output.
const MAX_BLOB_SCAN_LINE_LEN = 200_000;

// ============================================================================
// Helpers — hashing
// ============================================================================

function sha256_12(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex").slice(0, 12);
}

// ============================================================================
// Helpers — character-class scans (NO regex)
// ============================================================================

/**
 * Is `c` a character that belongs to an "opaque blob" alphabet?
 * Covers base64 (A-Z a-z 0-9 + / = -), hex (subset of the above), and the
 * inner payload of data URIs. We deliberately INCLUDE '-' and '_' (base64url)
 * but EXCLUDE spaces and most punctuation so that prose never qualifies.
 */
function isBlobChar(code: number): boolean {
  // 0-9
  if (code >= 48 && code <= 57) return true;
  // A-Z
  if (code >= 65 && code <= 90) return true;
  // a-z
  if (code >= 97 && code <= 122) return true;
  // '+' (43) '/' (47) '=' (61) '-' (45) '_' (95)
  if (code === 43 || code === 47 || code === 61 || code === 45 || code === 95) {
    return true;
  }
  return false;
}

interface BlobSpan {
  start: number; // inclusive index into the line
  end: number; // exclusive
}

/**
 * Scan a single line for maximal runs of blob characters whose length is
 * >= `minChars`. Pure linear scan over char codes — no regex.
 *
 * A run must also be "opaque enough": we require at least a couple of distinct
 * digit-vs-letter transitions OR contain a base64/hex-only structure. To keep
 * it mechanical and false-positive-resistant against e.g. a long lowercase
 * English word with no spaces, we additionally require the run to contain at
 * least one DIGIT or one of the base64 special chars (+ / = _) OR a mix of
 * upper and lower case — properties that natural single words rarely satisfy
 * across 512+ chars. This is a mechanical content test, not structural regex.
 */
function scanBlobRuns(line: string, minChars: number): BlobSpan[] {
  const spans: BlobSpan[] = [];
  if (line.length < minChars) return spans;
  if (line.length > MAX_BLOB_SCAN_LINE_LEN) return spans; // bounded

  let i = 0;
  const n = line.length;
  while (i < n) {
    if (!isBlobChar(line.charCodeAt(i))) {
      i++;
      continue;
    }
    const start = i;
    let hasDigit = false;
    let hasUpper = false;
    let hasLower = false;
    let hasSpecial = false;
    while (i < n && isBlobChar(line.charCodeAt(i))) {
      const c = line.charCodeAt(i);
      if (c >= 48 && c <= 57) hasDigit = true;
      else if (c >= 65 && c <= 90) hasUpper = true;
      else if (c >= 97 && c <= 122) hasLower = true;
      else hasSpecial = true;
      i++;
    }
    const len = i - start;
    if (len >= minChars) {
      const opaque =
        hasSpecial || hasDigit || (hasUpper && hasLower);
      if (opaque) spans.push({ start, end: i });
    }
  }
  return spans;
}

// ============================================================================
// Layer implementations
// ============================================================================

/** Strip trailing spaces and tabs from a single line (no regex). */
function stripTrailing(line: string): string {
  let end = line.length;
  while (end > 0) {
    const c = line.charCodeAt(end - 1);
    if (c === 32 || c === 9) end--; // space, tab
    else break;
  }
  return end === line.length ? line : line.slice(0, end);
}

function isBlank(line: string): boolean {
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/**
 * Apply the blob layer to one line. Returns the rewritten line plus any
 * manifest entries (atLine filled in later by the caller). Replacement marker:
 *   [blob: N chars, sha256 <12hex>]
 */
function applyBlobLayer(
  line: string,
  minChars: number,
  entries: PruneManifestEntry[]
): string {
  const spans = scanBlobRuns(line, minChars);
  if (spans.length === 0) return line;
  let out = "";
  let cursor = 0;
  for (const span of spans) {
    out += line.slice(cursor, span.start);
    const blob = line.slice(span.start, span.end);
    const hash = sha256_12(blob);
    out += `[blob: ${blob.length} chars, sha256 ${hash}]`;
    entries.push({
      kind: "blob",
      removedChars: blob.length,
      sha256: hash,
    });
    cursor = span.end;
  }
  out += line.slice(cursor);
  return out;
}

// ============================================================================
// Main
// ============================================================================

function neutralResult(text: string): PruneResult {
  return {
    pruned: text,
    originalTokens: 0,
    prunedTokens: 0,
    savedTokens: 0,
    savedPct: 0,
    lossless: true,
    manifest: [],
  };
}

export function pruneResult(
  input: unknown,
  options: PruneOptions = {}
): PruneResult {
  // ---- input guard: never throw -------------------------------------------
  if (typeof input !== "string") {
    return neutralResult("");
  }
  if (input.length === 0) {
    return neutralResult("");
  }

  const opt: Required<PruneOptions> = { ...DEFAULTS, ...options };
  // sanitize numeric options defensively
  const blobMin =
    Number.isFinite(opt.blobMinChars) && opt.blobMinChars > 0
      ? Math.floor(opt.blobMinChars)
      : DEFAULTS.blobMinChars;
  const trigger =
    Number.isFinite(opt.middleElisionTriggerLines) &&
    opt.middleElisionTriggerLines > 0
      ? Math.floor(opt.middleElisionTriggerLines)
      : DEFAULTS.middleElisionTriggerLines;
  const keep =
    Number.isFinite(opt.middleElisionKeep) && opt.middleElisionKeep >= 0
      ? Math.floor(opt.middleElisionKeep)
      : DEFAULTS.middleElisionKeep;

  const model = typeof opt.model === "string" && opt.model ? opt.model : "gpt-4o";

  const manifest: PruneManifestEntry[] = [];
  let losslessSoFar = true;

  // Split preserving the line structure. We normalize on '\n'; a trailing
  // newline produces a final empty element which we handle on rejoin.
  const hadTrailingNewline = input.endsWith("\n");
  const rawLines = input.split("\n");
  if (hadTrailingNewline) rawLines.pop(); // drop the empty tail from split

  // ---- pass 1: per-line transforms (strip, blob) --------------------------
  // We build an intermediate list of {text} lines. Manifest entries for blobs
  // are collected without atLine; atLine is assigned after the structural
  // collapses below, when final line numbers are known.
  const blobEntriesPerLine: PruneManifestEntry[][] = [];
  const pass1: string[] = new Array(rawLines.length);
  for (let li = 0; li < rawLines.length; li++) {
    let line = rawLines[li];

    if (opt.collapseBlobs) {
      const lineEntries: PruneManifestEntry[] = [];
      const rewritten = applyBlobLayer(line, blobMin, lineEntries);
      if (lineEntries.length > 0) {
        losslessSoFar = false;
        line = rewritten;
      }
      blobEntriesPerLine[li] = lineEntries;
    } else {
      blobEntriesPerLine[li] = [];
    }

    if (opt.stripTrailingWhitespace) {
      const stripped = stripTrailing(line);
      if (stripped !== line) {
        // trailing whitespace removal is information-losing for
        // whitespace-significant payloads; flip lossless.
        losslessSoFar = false;
        line = stripped;
      }
    }
    pass1[li] = line;
  }

  // ---- pass 2: structural collapses, emitting final lines + manifest ------
  // We walk pass1 and emit into `out`. For run/blank collapses we look at
  // the equality key (optionally trailing-trimmed).
  const out: string[] = [];
  const outEntries: PruneManifestEntry[] = []; // structural entries, atLine set

  // Helper to compute equality key for identical-run detection.
  const eqKey = (s: string): string =>
    opt.trimTrailingForRunEquality ? stripTrailing(s) : s;

  let i = 0;
  const n = pass1.length;
  while (i < n) {
    const line = pass1[i];

    // -- blank-run collapse --
    if (opt.collapseBlankRuns && isBlank(line)) {
      let j = i;
      while (j < n && isBlank(pass1[j])) j++;
      const runLen = j - i;
      if (runLen >= 3) {
        out.push(""); // single blank
        outEntries.push({
          kind: "blank_run",
          atLine: out.length,
          removedLines: runLen - 1,
        });
        losslessSoFar = false;
        // attach any blob entries that happened inside blank lines (none, but
        // be safe): blanks carry no blob entries.
        i = j;
        continue;
      }
      // run shorter than 3 — fall through to normal emission (1 or 2 blanks)
    }

    // -- identical-run collapse --
    if (opt.collapseIdenticalRuns) {
      const key = eqKey(line);
      let j = i + 1;
      while (j < n && eqKey(pass1[j]) === key) j++;
      const runLen = j - i;
      // Only collapse when it actually shrinks output: collapsing N identical
      // lines yields 2 lines (the kept line + a marker), so we need N >= 3.
      if (runLen >= 3) {
        // emit the first occurrence, then a marker
        out.push(line);
        // flush blob entries for the first line
        for (const be of blobEntriesPerLine[i]) {
          be.atLine = out.length;
          outEntries.push(be);
        }
        out.push(`… (×${runLen} identical lines)`);
        outEntries.push({
          kind: "identical_run",
          atLine: out.length,
          removedLines: runLen - 1,
        });
        losslessSoFar = false;
        i = j;
        continue;
      }
    }

    // -- plain emit --
    out.push(line);
    for (const be of blobEntriesPerLine[i]) {
      be.atLine = out.length;
      outEntries.push(be);
    }
    i++;
  }

  // ---- pass 3: middle elision --------------------------------------------
  let finalLines = out;
  let elisionEntries: PruneManifestEntry[] = [];
  if (opt.middleElision && out.length > trigger && out.length > keep * 2 + 1) {
    const head = out.slice(0, keep);
    const tail = out.slice(out.length - keep);
    const middle = out.slice(keep, out.length - keep);
    const removedLines = middle.length;
    const hash = sha256_12(middle.join("\n"));
    const marker = `[${removedLines} lines elided]`;
    finalLines = [...head, marker, ...tail];
    elisionEntries = [
      {
        kind: "middle_elision",
        atLine: head.length + 1,
        removedLines,
        sha256: hash,
      },
    ];
    losslessSoFar = false;

    // Manifest line numbers for entries after the elision point shift. Rebuild
    // atLine for structural/blob entries by re-deriving from finalLines is
    // overkill; instead, adjust entries whose atLine fell in head/tail/middle.
    const cutStart = keep + 1; // first middle line (1-based in `out`)
    const cutEnd = out.length - keep; // last middle line (1-based in `out`)
    const shift = removedLines - 1; // middle replaced by 1 marker line
    for (const e of outEntries) {
      if (e.atLine === undefined) continue;
      if (e.atLine < cutStart) {
        // in head — unchanged
      } else if (e.atLine > cutEnd) {
        e.atLine -= shift; // in tail — shifted up
      } else {
        // entry sat inside the elided middle; its content is now represented
        // by the elision hash. Drop its atLine (still counted via the elision
        // entry's removedLines) to avoid a dangling pointer.
        e.atLine = undefined;
      }
    }
  }

  // ---- assemble manifest (deterministic order: by atLine, then kind) ------
  const fullManifest = [...outEntries, ...elisionEntries].sort((a, b) => {
    const al = a.atLine ?? Number.MAX_SAFE_INTEGER;
    const bl = b.atLine ?? Number.MAX_SAFE_INTEGER;
    if (al !== bl) return al - bl;
    return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
  });
  manifest.push(...fullManifest);

  // ---- rejoin --------------------------------------------------------------
  let pruned = finalLines.join("\n");
  if (hadTrailingNewline && pruned.length > 0) pruned += "\n";

  // ---- real token accounting ----------------------------------------------
  const originalTokens = countTokens(input, model).tokens;
  const prunedTokens = countTokens(pruned, model).tokens;
  const savedTokens = originalTokens - prunedTokens;
  const savedPct =
    originalTokens > 0
      ? Math.round((savedTokens / originalTokens) * 10000) / 100
      : 0;

  // lossless is true only if no manifest entry exists AND text is byte-identical
  const lossless = manifest.length === 0 && pruned === input && losslessSoFar;

  return {
    pruned,
    originalTokens,
    prunedTokens,
    savedTokens,
    savedPct,
    lossless,
    manifest,
  };
}
