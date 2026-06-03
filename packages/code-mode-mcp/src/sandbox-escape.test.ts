/**
 * Adversarial sandbox-escape probe.
 *
 * Every test in this file represents an attempted escape an attacker
 * could place in a code-mode script. Each must fail — either via
 * runtime error or by being silently denied — and NONE may produce
 * an executable side-effect outside the sandbox.
 */

import { describe, expect, it } from "vitest";
import { executeScript } from "./executor.js";

const NOOP = async () => undefined;
const OPTS = { allowedToolNames: ["nop"] as const, timeoutMs: 500 };

describe("escape: filesystem", () => {
  it("require('fs') is denied", async () => {
    const r = await executeScript(`require('fs').readFileSync('/etc/passwd')`, NOOP, OPTS);
    expect(r.ok).toBe(false);
  });

  it("import('fs') is denied (no dynamic import)", async () => {
    const r = await executeScript(
      `const m = await import('fs'); return m.readFileSync('/etc/passwd');`,
      NOOP,
      OPTS
    );
    expect(r.ok).toBe(false);
  });
});

describe("escape: network", () => {
  it("fetch is denied", async () => {
    const r = await executeScript(`return fetch('https://example.com');`, NOOP, OPTS);
    expect(r.ok).toBe(false);
  });
  it("XMLHttpRequest is denied", async () => {
    const r = await executeScript(`return new XMLHttpRequest();`, NOOP, OPTS);
    expect(r.ok).toBe(false);
  });
  it("WebSocket is denied", async () => {
    const r = await executeScript(`return new WebSocket('ws://x');`, NOOP, OPTS);
    expect(r.ok).toBe(false);
  });
});

describe("escape: process / child_process", () => {
  it("process is denied", async () => {
    const r = await executeScript(`return process.pid;`, NOOP, OPTS);
    expect(r.ok).toBe(false);
  });
  it("require('child_process') is denied", async () => {
    const r = await executeScript(
      `require('child_process').exec('rm -rf /');`,
      NOOP,
      OPTS
    );
    expect(r.ok).toBe(false);
  });
});

describe("escape: prototype pollution", () => {
  it("modifying Object.prototype doesn't escape — toolbox shape unchanged", async () => {
    // The script can mutate Object.prototype within its context, but
    // the host's Object.prototype is unaffected because vm gives each
    // context its own globals. Verify we still get the script error
    // (or the prototype touch returns normally) without poisoning
    // the host.
    const r = await executeScript(
      `Object.prototype.toString = () => 'pwned'; return ({}).toString();`,
      NOOP,
      OPTS
    );
    expect(r.ok).toBe(true);
    // Host's Object.prototype unaffected:
    expect(({}).toString()).toBe("[object Object]");
  });

  it("__proto__ assignment doesn't escape", async () => {
    const r = await executeScript(
      `const o = {}; o.__proto__.x = 'leak'; return o.x;`,
      NOOP,
      OPTS
    );
    expect(r.ok).toBe(true);
    expect(({} as Record<string, unknown>)["x"]).toBeUndefined();
  });
});

describe("escape: vm-context escape via global manipulation", () => {
  it("`globalThis` exists but is just the context's globals (no host)", async () => {
    const r = await executeScript(`return typeof globalThis.process;`, NOOP, OPTS);
    expect(r.ok).toBe(true);
    expect(r.result).toBe("undefined");
  });

  it("`globalThis.constructor.constructor` (Function-constructor escape) is contained", async () => {
    // The classic Function-constructor escape: `(0).constructor.constructor('return process')()`
    const r = await executeScript(
      `return (0).constructor.constructor('return process')();`,
      NOOP,
      OPTS
    );
    // The Function call runs in the same vm context, so `process`
    // is still undefined; the script throws ReferenceError or
    // returns undefined.
    expect(r.ok === false || r.result === undefined).toBe(true);
  });
});

describe("escape: timer scheduling", () => {
  it("setInterval is denied", async () => {
    const r = await executeScript(`setInterval(() => {}, 10); return 1;`, NOOP, OPTS);
    expect(r.ok).toBe(false);
  });
  it("setImmediate is denied", async () => {
    const r = await executeScript(`setImmediate(() => {}); return 1;`, NOOP, OPTS);
    expect(r.ok).toBe(false);
  });
});

describe("escape: queueMicrotask + Promise resolver tricks", () => {
  it("queueMicrotask is denied (we never expose it)", async () => {
    const r = await executeScript(`queueMicrotask(() => {}); return 1;`, NOOP, OPTS);
    expect(r.ok).toBe(false);
  });

  it("Promise resolver running infinitely defers to timeout", async () => {
    const r = await executeScript(
      `return new Promise((resolve) => { /* never resolves */ });`,
      NOOP,
      { allowedToolNames: ["nop"], timeoutMs: 200 }
    );
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/timed out/);
  });
});

describe("escape: error-in-error to leak host state", () => {
  it("throwing a host-typed Error doesn't leak prototypes back", async () => {
    const r = await executeScript(
      `throw { name: 'EscapedError', message: 'oh no', leak: process };`,
      NOOP,
      OPTS
    );
    expect(r.ok).toBe(false);
    // The error message is "process is not defined" — the rejection
    // never carries a real process reference back to the host.
    expect(r.error?.message).toContain("process");
  });

  it("error.cause chain doesn't leak host objects (no `cause: process`)", async () => {
    const r = await executeScript(
      `throw new Error('outer', { cause: process });`,
      NOOP,
      OPTS
    );
    expect(r.ok).toBe(false);
  });
});

describe("escape: Reflect-based introspection", () => {
  it("Reflect.has on globalThis doesn't surface host globals", async () => {
    const r = await executeScript(
      `return Reflect.has(globalThis, 'process');`,
      NOOP,
      OPTS
    );
    // Reflect itself is allowed (it's a standard intrinsic), but the
    // context's globalThis doesn't carry process.
    expect(r.ok).toBe(true);
    expect(r.result).toBe(false);
  });

  it("Reflect.construct on Function constructor stays sandboxed", async () => {
    const r = await executeScript(
      `const F = Reflect.construct(Function, ['return process']); return F();`,
      NOOP,
      OPTS
    );
    expect(r.ok === false || r.result === undefined).toBe(true);
  });
});

describe("escape: AsyncFunction constructor", () => {
  it("(async () => {}).constructor('return process')() is contained", async () => {
    const r = await executeScript(
      `const AF = (async () => {}).constructor; return AF('return process')();`,
      NOOP,
      OPTS
    );
    // AF runs in the sandbox context where process is undefined.
    if (r.ok) {
      expect(r.result).toBeUndefined();
    }
  });
});

describe("escape: Atomics / SharedArrayBuffer", () => {
  it("SharedArrayBuffer isn't injected (denied or no-op)", async () => {
    const r = await executeScript(
      `return new SharedArrayBuffer(1024).byteLength;`,
      NOOP,
      OPTS
    );
    // SharedArrayBuffer may or may not exist in the vm context
    // depending on Node flags. Either way, the call MUST NOT crash
    // the harness or leak anything.
    if (!r.ok) {
      expect(r.error).toBeDefined();
    } else {
      expect(typeof r.result).toBe("number");
    }
  });
});

describe("escape: read invariants under deep object input", () => {
  it("a parameter with a deep prototype chain doesn't leak host state through cloning", async () => {
    let received: unknown = null;
    const invoke = async (_n: string, params: unknown) => {
      received = params;
      return null;
    };
    const r = await executeScript(
      `
      const inner = Object.create({ leak: 'from-host-proto' });
      inner.payload = 42;
      await toolbox.f(inner);
      return null;
      `,
      invoke,
      { allowedToolNames: ["f"] }
    );
    expect(r.ok).toBe(true);
    // JSON.parse(JSON.stringify(...)) drops the prototype; only own
    // enumerable properties survive.
    expect(received).toEqual({ payload: 42 });
  });
});
