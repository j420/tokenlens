/**
 * Shared runtime for Prune hook scripts.
 *
 * Reads the Claude Code hook payload from stdin, exposes helpers for
 * emitting decisions/additional context per the spec, and forwards
 * unhandled errors to stderr without taking the agent down.
 */

export async function readHookPayload() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`hook payload is not valid JSON: ${e.message}`);
  }
}

/**
 * Block the tool use / stop with a human-readable reason. Per the
 * Claude Code hook protocol: exit code 2 + JSON on stdout.
 */
export function emitBlock(reason, extra = {}) {
  process.stdout.write(
    JSON.stringify({ decision: "block", reason, ...extra }) + "\n"
  );
  process.exit(2);
}

/**
 * Inject `additionalContext` for downstream messages. Non-blocking.
 */
export function emitAdditionalContext(additionalContext, extra = {}) {
  process.stdout.write(
    JSON.stringify({ additionalContext, ...extra }) + "\n"
  );
  process.exit(0);
}

/**
 * Emit nothing meaningful — pass through.
 */
export function emitNoop() {
  process.exit(0);
}

/**
 * Wrap a hook entry function. Anything that throws is logged to stderr
 * (Claude Code surfaces it) but the hook exits 0 so the agent keeps
 * running. The "intelligence layer must never break the workflow"
 * invariant from CLAUDE.md.
 */
export async function safeRun(fn) {
  try {
    await fn();
  } catch (err) {
    process.stderr.write(
      `prune-hook error: ${err?.message ?? err}\n`
    );
    process.exit(0);
  }
}
