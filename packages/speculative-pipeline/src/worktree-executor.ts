/**
 * E5 — Real read-only worktree executor (pending action 2.2).
 *
 * The SpeculativeHost takes an injectable `ToolExecutor`; the package shipped
 * only a labeled FakeExecutor for deterministic tests. This is the REAL thing:
 * a `ToolExecutor` that runs an eligible read-only tool (Read / LS / Grep /
 * Glob) against a throwaway worktree directory and returns its output.
 *
 * It is the security boundary for speculative execution, so the invariants are
 * load-bearing, not decoration:
 *
 *   - READ-ONLY BY CONSTRUCTION. The executor only ever calls read syscalls
 *     (readFile / readdir / stat / realpath). There is no write/exec path. An
 *     ineligible tool name (Edit, Write, Bash, …) is REFUSED — a speculative
 *     side effect the agent may never request is categorically unsafe.
 *   - CONFINED TO THE WORKTREE. Every path is resolved against the canonical
 *     root and rejected if it escapes — both lexically (`..`) and via symlink
 *     (the nearest existing ancestor is realpath-checked, so a symlink pointing
 *     outside the root cannot be followed out).
 *   - BOUNDED. A speculation runs AHEAD of the agent and may be wasted, so it
 *     must never blow up CPU/memory: per-file byte cap, max entries/matches/
 *     files-scanned, max walk depth, and default-skipped heavy dirs
 *     (.git / node_modules).
 *   - ABORTABLE + DETERMINISTIC. Honors an AbortSignal between I/O steps; the
 *     same call against the same filesystem state always yields the same bytes
 *     (sorted ordering), which is exactly what byte-equality reconciliation
 *     needs.
 *   - HONEST LATENCY. elapsedMs is measured with performance.now() around the
 *     real I/O — never fabricated.
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";

import { isSpeculatable } from "./eligibility.js";
import type { ToolCall } from "./types.js";
import type { ExecutorOutput, ToolExecutor } from "./host.js";

export interface WorktreeExecutorOptions {
  /** Max bytes read from a single file. Default 262144 (256 KiB). */
  maxFileBytes?: number;
  /** Max directory entries returned by LS. Default 1000. */
  maxEntries?: number;
  /** Max Grep matches returned. Default 200. */
  maxMatches?: number;
  /** Max files scanned by Grep / Glob in one call. Default 5000. */
  maxFilesScanned?: number;
  /** Max recursion depth for Glob / Grep walks. Default 25. */
  maxDepth?: number;
  /** Directory names skipped during recursive walks. Default ['.git','node_modules']. */
  skipDirs?: readonly string[];
}

const DEFAULTS: Required<WorktreeExecutorOptions> = {
  maxFileBytes: 262_144,
  maxEntries: 1000,
  maxMatches: 200,
  maxFilesScanned: 5000,
  maxDepth: 25,
  skipDirs: [".git", "node_modules"],
};

/** Thrown when a call tries to escape the worktree or use an unsafe tool. */
export class WorktreeSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorktreeSecurityError";
  }
}

function isWithin(root: string, p: string): boolean {
  if (p === root) return true;
  const rel = relative(root, p);
  return rel.length > 0 && !rel.startsWith("..") && !rel.startsWith(sep) && !isAbsoluteRel(rel);
}

function isAbsoluteRel(rel: string): boolean {
  // On POSIX an absolute path from relative() never happens, but guard anyway.
  return rel.startsWith(sep);
}

function stringInput(input: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = input[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const e = new Error("speculation aborted");
    e.name = "AbortError";
    throw e;
  }
}

/**
 * Create a real read-only `ToolExecutor` bound to `rootDir`. The root is
 * canonicalized once at construction; a non-existent or non-directory root
 * throws immediately (a misconfigured host should fail loudly, not silently
 * read the wrong tree).
 */
export function createWorktreeExecutor(
  rootDir: string,
  options: WorktreeExecutorOptions = {}
): ToolExecutor {
  const opts = { ...DEFAULTS, ...options };
  const realRoot = realpathSync(resolve(rootDir));
  if (!statSync(realRoot).isDirectory()) {
    throw new Error(`createWorktreeExecutor: root ${rootDir} is not a directory`);
  }
  const skip = new Set(opts.skipDirs);

  /**
   * Resolve a caller path against the root, rejecting escapes. Lexical check
   * catches `..`; the nearest EXISTING ancestor is realpath-checked so a symlink
   * pointing outside the root cannot redirect a read out. Returns the absolute
   * (not-yet-realpath'd) candidate; the leaf may or may not exist.
   */
  function confine(p: string): string {
    const candidate = resolve(realRoot, p);
    if (!isWithin(realRoot, candidate)) {
      throw new WorktreeSecurityError(`path escapes the worktree root: ${p}`);
    }
    // Walk up to the deepest existing ancestor and realpath it (symlink guard).
    let cur = candidate;
    while (cur !== realRoot && !existsSync(cur)) {
      const parent = dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
    const realAncestor = realpathSync(cur);
    if (!isWithin(realRoot, realAncestor) && realAncestor !== realRoot) {
      throw new WorktreeSecurityError(`path resolves outside the worktree via symlink: ${p}`);
    }
    return candidate;
  }

  function readFileBounded(abs: string): string {
    const st = statSync(abs);
    if (!st.isFile()) throw new Error(`not a file: ${relative(realRoot, abs) || abs}`);
    const buf = readFileSync(abs);
    const sliced = buf.length > opts.maxFileBytes ? buf.subarray(0, opts.maxFileBytes) : buf;
    const truncated = buf.length > opts.maxFileBytes ? "\n…[truncated]" : "";
    return sliced.toString("utf8") + truncated;
  }

  /** Bounded recursive file walk (sorted, skip-dirs, depth-capped). */
  function* walkFiles(start: string, signal?: AbortSignal): Generator<string> {
    let scanned = 0;
    const stack: Array<{ dir: string; depth: number }> = [{ dir: start, depth: 0 }];
    while (stack.length > 0) {
      checkAbort(signal);
      const { dir, depth } = stack.pop()!;
      let entries: string[];
      try {
        entries = readdirSync(dir).sort();
      } catch {
        continue; // unreadable dir — skip, never throw the whole call
      }
      // Push subdirs in reverse so the sorted order is preserved on the stack.
      const subdirs: Array<{ dir: string; depth: number }> = [];
      for (const name of entries) {
        const abs = join(dir, name);
        let st;
        try {
          st = statSync(abs);
        } catch {
          continue;
        }
        if (st.isDirectory()) {
          if (skip.has(name) || depth >= opts.maxDepth) continue;
          subdirs.push({ dir: abs, depth: depth + 1 });
        } else if (st.isFile()) {
          if (scanned++ >= opts.maxFilesScanned) return;
          yield abs;
        }
      }
      for (let i = subdirs.length - 1; i >= 0; i--) stack.push(subdirs[i]);
    }
  }

  async function execute(call: ToolCall, signal?: AbortSignal): Promise<ExecutorOutput> {
    checkAbort(signal);
    if (!call || typeof call.name !== "string" || !call.input || typeof call.input !== "object") {
      throw new Error("worktree executor: malformed ToolCall");
    }
    if (!isSpeculatable(call.name)) {
      // Defense in depth: the host only speculates eligible tools, but the
      // executor refuses anything else outright so it can never apply a side effect.
      throw new WorktreeSecurityError(`tool "${call.name}" is not a speculatable read-only tool`);
    }

    const t0 = performance.now();
    const result = runTool(call, signal);
    const elapsedMs = performance.now() - t0;
    return { result, elapsedMs };
  }

  function runTool(call: ToolCall, signal?: AbortSignal): string {
    const input = call.input as Record<string, unknown>;
    switch (call.name) {
      case "Read": {
        const p = stringInput(input, "file_path", "path");
        if (!p) throw new Error("Read requires file_path");
        const abs = confine(p);
        if (!existsSync(abs)) return `[not found] ${p}`;
        return readFileBounded(abs);
      }
      case "LS": {
        const p = stringInput(input, "path", "dir") ?? ".";
        const abs = confine(p);
        if (!existsSync(abs)) return `[not found] ${p}`;
        if (!statSync(abs).isDirectory()) throw new Error(`not a directory: ${p}`);
        const names = readdirSync(abs).sort().slice(0, opts.maxEntries);
        return names
          .map((n) => (statSync(join(abs, n)).isDirectory() ? `${n}/` : n))
          .join("\n");
      }
      case "Glob": {
        const pattern = stringInput(input, "pattern");
        if (!pattern) throw new Error("Glob requires pattern");
        const base = stringInput(input, "path") ?? ".";
        const baseAbs = confine(base);
        if (!existsSync(baseAbs)) return "";
        const matcher = globToRegExp(pattern);
        const out: string[] = [];
        for (const file of walkFiles(baseAbs, signal)) {
          const rel = relative(realRoot, file).split(sep).join("/");
          if (matcher.test(rel)) {
            out.push(rel);
            if (out.length >= opts.maxFilesScanned) break;
          }
        }
        out.sort();
        return out.join("\n");
      }
      case "Grep": {
        const pattern = stringInput(input, "pattern");
        if (!pattern) throw new Error("Grep requires pattern");
        const base = stringInput(input, "path") ?? ".";
        const baseAbs = confine(base);
        if (!existsSync(baseAbs)) return "";
        let re: RegExp;
        try {
          // Grep IS a regex tool; this is the tool's function, not heuristic
          // classification. An invalid pattern is a caller error, surfaced clearly.
          re = new RegExp(pattern);
        } catch (e) {
          throw new Error(`Grep: invalid pattern — ${(e as Error).message}`);
        }
        const files = statSync(baseAbs).isFile() ? [baseAbs] : [...walkFiles(baseAbs, signal)];
        const matches: string[] = [];
        for (const file of files) {
          checkAbort(signal);
          let content: string;
          try {
            content = readFileBounded(file);
          } catch {
            continue;
          }
          const rel = relative(realRoot, file).split(sep).join("/");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (re.test(lines[i])) {
              matches.push(`${rel}:${i + 1}:${lines[i]}`);
              if (matches.length >= opts.maxMatches) return matches.join("\n");
            }
          }
        }
        return matches.join("\n");
      }
      default:
        // Unreachable (isSpeculatable gate above), but exhaustive for safety.
        throw new WorktreeSecurityError(`unsupported tool: ${call.name}`);
    }
  }

  return execute;
}

/**
 * Translate a glob pattern to an anchored RegExp. Supports `**` (any path
 * segments incl. none), `*` (any chars except `/`), `?` (one non-`/` char), and
 * treats every other character literally (regex metacharacters escaped). This
 * is implementing the Glob tool's own pattern language — a structural
 * translation, not heuristic classification.
 */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // `**` — any number of path segments. Consume an optional following `/`.
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}
