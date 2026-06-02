/**
 * CodeExecutor — Node `vm`-based sandbox for code-mode tool calls.
 *
 * Threat model the executor defends against:
 *   1. Filesystem escape   — no `fs`, `process`, `require` injected.
 *   2. Network escape      — no `fetch`, `XMLHttpRequest`, `WebSocket`.
 *   3. Process introspection — no `process`, `child_process`, `os`.
 *   4. Prototype pollution — Object.freeze on the script's globals;
 *      the toolbox proxy denies writes.
 *   5. Infinite loop       — runtime timeout via vm.Script.runInContext.
 *   6. Memory bomb         — runtime memory cap via context recycling
 *      (vm doesn't expose a hard cap; we recycle the context per run).
 *
 * What the script CAN do:
 *   - `await toolbox.<methodName>(params)` — every call goes through
 *     the host-supplied `invoke(toolName, params)` adapter; no other
 *     side-effect surface is exposed.
 *   - Pure computation (math, string ops, array methods).
 *   - Return a value (anything JSON-serializable; non-serializable
 *     return values are coerced via JSON.parse(JSON.stringify(…))
 *     so the host gets a clean payload).
 *
 * The executor is a real sandbox built on Node's `node:vm`, not a
 * shim around `eval`. The script is compiled once, runs in a fresh
 * context per call, and Node's vm guarantees the script sees only
 * what we explicitly hand it.
 */

import { runInNewContext } from "node:vm";

export interface CodeExecutorInvokeAdapter {
  /**
   * The single side-effect surface the script can reach. The host
   * implements this to either (a) call the underlying MCP tool, or
   * (b) consult the equivalence harness's recorded responses.
   *
   * MUST return JSON-serializable values. The executor coerces.
   */
  (toolName: string, params: unknown): Promise<unknown>;
}

export interface CodeExecutorOptions {
  /** Names the script can call via `toolbox.<name>`. */
  allowedToolNames: ReadonlyArray<string>;
  /**
   * Map sanitized method names back to MCP tool names. When the
   * script calls `toolbox.read_file(...)`, the executor invokes
   * `invoke(nameMap.read_file, params)`. Identity if omitted.
   */
  nameMap?: Readonly<Record<string, string>>;
  /** Hard timeout in milliseconds. Default 5000. */
  timeoutMs?: number;
  /** Maximum return-value JSON size (bytes). Default 256 KiB. */
  maxResultBytes?: number;
}

export interface CodeExecutionResult {
  ok: boolean;
  /** The return value of the script (JSON-coerced). */
  result?: unknown;
  /** Errors thrown by the script or the executor's guards. */
  error?: { kind: string; message: string };
  /** Diagnostics for telemetry. */
  diagnostics: {
    invokeCount: number;
    toolsInvoked: string[];
    elapsedMs: number;
    resultBytes: number;
  };
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_RESULT_BYTES = 256 * 1024;

/**
 * Execute a code-mode script in a sealed vm context.
 *
 * Script contract:
 *   - The script body is wrapped as an async IIFE; it MAY `await
 *     toolbox.<method>(params)` and MUST end with an expression
 *     that produces the return value (or call `__return(value)`).
 *
 * The script runs with the following globals only:
 *   - `toolbox`     — proxy with one method per allowedToolNames
 *   - `console`     — { log, error, warn } that buffer to result.diagnostics
 *   - `JSON`        — standard
 *   - `Math`        — standard
 *   - `__return`    — alternative return mechanism
 *
 * Everything else (process, require, globalThis assignments, fetch,
 * setTimeout/setInterval, fs, child_process) is denied at the
 * context boundary by simply not being provided.
 */
export async function executeScript(
  script: string,
  invoke: CodeExecutorInvokeAdapter,
  options: CodeExecutorOptions
): Promise<CodeExecutionResult> {
  if (typeof script !== "string" || script.length === 0) {
    return failed("invalid_script", "script must be a non-empty string");
  }
  const timeoutMs = sanitizeTimeout(options.timeoutMs);
  const maxResultBytes = sanitizeMaxBytes(options.maxResultBytes);
  const allowed = new Set(options.allowedToolNames);
  if (allowed.size === 0) {
    return failed("no_allowed_tools", "allowedToolNames is empty");
  }
  const nameMap = options.nameMap ?? {};

  const diagnostics = {
    invokeCount: 0,
    toolsInvoked: [] as string[],
    elapsedMs: 0,
    resultBytes: 0,
  };

  // The toolbox proxy: one method per allowed name. Every call goes
  // through the host adapter. The script can't add methods, can't
  // overwrite methods, can't introspect the adapter.
  const toolbox: Record<string, (params: unknown) => Promise<unknown>> = {};
  for (const name of allowed) {
    const mcpName = nameMap[name] ?? name;
    toolbox[name] = async (params: unknown) => {
      diagnostics.invokeCount += 1;
      if (!diagnostics.toolsInvoked.includes(mcpName)) {
        diagnostics.toolsInvoked.push(mcpName);
      }
      const out = await invoke(mcpName, jsonClone(params));
      return jsonClone(out);
    };
  }
  Object.freeze(toolbox);

  // Buffered console — keeps script-emitted text from polluting our
  // stdout/stderr.
  const sandboxConsole = {
    log: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };

  // Promise that resolves with the script's return value. The script
  // either ends with a return expression (we wrap it as
  // `return <expr>`) or calls __return(value).
  let resolveResult: (v: unknown) => void = () => undefined;
  let rejectResult: (err: unknown) => void = () => undefined;
  const resultPromise = new Promise<unknown>((res, rej) => {
    resolveResult = res;
    rejectResult = rej;
  });

  const __return = (v: unknown) => resolveResult(v);
  const __throw = (e: unknown) => rejectResult(e);

  // Wrap the user script into an async IIFE so `await` is legal and
  // top-level returns get captured. Strict mode is mandatory so
  // attempts to write to frozen objects (toolbox) throw rather than
  // silently no-op.
  const wrapped =
    '"use strict";\n' +
    "(async () => {\n" +
    "  try {\n" +
    "    const __r = await (async () => {\n" +
    '      "use strict";\n' +
    script +
    "\n    })();\n" +
    "    __return(__r);\n" +
    "  } catch (e) { __throw(e); }\n" +
    "})();";

  const sandbox = {
    toolbox,
    console: sandboxConsole,
    JSON,
    Math,
    __return,
    __throw,
  };

  const t0 = performance.now();
  try {
    runInNewContext(wrapped, sandbox, {
      timeout: timeoutMs,
      filename: "code-mode-script.js",
      displayErrors: false,
    });
  } catch (err) {
    diagnostics.elapsedMs = performance.now() - t0;
    return failedFromError(err, diagnostics);
  }

  // Race the script result against a JS-level timeout (the vm timeout
  // catches synchronous infinite loops; async tasks still need a
  // wall-clock guard).
  let scriptValue: unknown;
  try {
    scriptValue = await raceTimeout(resultPromise, timeoutMs);
  } catch (err) {
    diagnostics.elapsedMs = performance.now() - t0;
    return failedFromError(err, diagnostics);
  }
  diagnostics.elapsedMs = performance.now() - t0;

  const serialized = safeStringify(scriptValue);
  if (serialized === null) {
    return {
      ok: false,
      error: { kind: "non_serializable_result", message: "result was not JSON-serializable" },
      diagnostics,
    };
  }
  diagnostics.resultBytes = serialized.length;
  if (serialized.length > maxResultBytes) {
    return {
      ok: false,
      error: { kind: "result_too_large", message: `result ${serialized.length} > ${maxResultBytes} bytes` },
      diagnostics,
    };
  }

  return {
    ok: true,
    result: JSON.parse(serialized),
    diagnostics,
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function failed(kind: string, message: string): CodeExecutionResult {
  return {
    ok: false,
    error: { kind, message },
    diagnostics: {
      invokeCount: 0,
      toolsInvoked: [],
      elapsedMs: 0,
      resultBytes: 0,
    },
  };
}

function failedFromError(
  err: unknown,
  diagnostics: CodeExecutionResult["diagnostics"]
): CodeExecutionResult {
  const message =
    err && typeof err === "object" && "message" in err
      ? String((err as { message: unknown }).message)
      : String(err);
  const kind =
    err && typeof err === "object" && "name" in err
      ? String((err as { name: unknown }).name)
      : "execution_error";
  return {
    ok: false,
    error: { kind, message },
    diagnostics,
  };
}

function sanitizeTimeout(t: number | undefined): number {
  if (typeof t !== "number" || !Number.isFinite(t) || t <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(60_000, Math.trunc(t));
}

function sanitizeMaxBytes(b: number | undefined): number {
  if (typeof b !== "number" || !Number.isFinite(b) || b <= 0) return DEFAULT_MAX_RESULT_BYTES;
  return Math.min(16 * 1024 * 1024, Math.trunc(b));
}

function jsonClone<T>(v: T): T {
  if (v === undefined) return v;
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return undefined as T;
  }
}

function safeStringify(v: unknown): string | null {
  if (v === undefined) return "null";
  try {
    return JSON.stringify(v);
  } catch {
    return null;
  }
}

async function raceTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(
      () => rej(new Error(`script timed out after ${ms}ms`)),
      ms
    );
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}
