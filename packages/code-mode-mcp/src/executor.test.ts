import { describe, expect, it } from "vitest";
import { executeScript } from "./executor.js";

describe("executeScript — happy path", () => {
  it("returns a literal value", async () => {
    const r = await executeScript("return 42", async () => undefined, {
      allowedToolNames: ["nop"],
    });
    expect(r.ok).toBe(true);
    expect(r.result).toBe(42);
  });

  it("calls toolbox and returns the result", async () => {
    const invoke = async (name: string, params: unknown) => {
      expect(name).toBe("readFile");
      return { content: `read ${(params as { path: string }).path}` };
    };
    const r = await executeScript(
      `const x = await toolbox.readFile({ path: "/a.ts" }); return x.content;`,
      invoke,
      { allowedToolNames: ["readFile"] }
    );
    expect(r.ok).toBe(true);
    expect(r.result).toBe("read /a.ts");
    expect(r.diagnostics.invokeCount).toBe(1);
    expect(r.diagnostics.toolsInvoked).toEqual(["readFile"]);
  });

  it("composes multiple tool calls", async () => {
    const invoke = async (name: string, params: unknown) => {
      if (name === "add") {
        const p = params as { a: number; b: number };
        return p.a + p.b;
      }
      return null;
    };
    const r = await executeScript(
      `
      const a = await toolbox.add({ a: 1, b: 2 });
      const b = await toolbox.add({ a: a, b: 5 });
      return b;
      `,
      invoke,
      { allowedToolNames: ["add"] }
    );
    expect(r.ok).toBe(true);
    expect(r.result).toBe(8);
    expect(r.diagnostics.invokeCount).toBe(2);
  });

  it("uses nameMap to translate sanitized names to MCP names", async () => {
    const invoke = async (name: string) => name;
    const r = await executeScript(
      `return await toolbox.read_file({});`,
      invoke,
      {
        allowedToolNames: ["read_file"],
        nameMap: { read_file: "read-file" },
      }
    );
    expect(r.ok).toBe(true);
    expect(r.result).toBe("read-file");
    expect(r.diagnostics.toolsInvoked).toEqual(["read-file"]);
  });
});

describe("executeScript — sandbox isolation (denial of dangerous surfaces)", () => {
  it("blocks `require`", async () => {
    const r = await executeScript(
      `const fs = require("fs"); return "leaked";`,
      async () => undefined,
      { allowedToolNames: ["nop"] }
    );
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/require is not defined/);
  });

  it("blocks `process`", async () => {
    const r = await executeScript(
      `return process.env;`,
      async () => undefined,
      { allowedToolNames: ["nop"] }
    );
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/process is not defined/);
  });

  it("blocks `global` (no shared global)", async () => {
    const r = await executeScript(
      `return global;`,
      async () => undefined,
      { allowedToolNames: ["nop"] }
    );
    expect(r.ok).toBe(false);
  });

  it("blocks `fetch`", async () => {
    const r = await executeScript(
      `return await fetch("https://example.com");`,
      async () => undefined,
      { allowedToolNames: ["nop"] }
    );
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/fetch is not defined/);
  });

  it("blocks `setTimeout`", async () => {
    const r = await executeScript(
      `setTimeout(() => {}, 1000); return 1;`,
      async () => undefined,
      { allowedToolNames: ["nop"] }
    );
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/setTimeout is not defined/);
  });

  it("denies overwriting toolbox", async () => {
    const r = await executeScript(
      `toolbox.malicious = () => "x"; return "ok";`,
      async () => undefined,
      { allowedToolNames: ["nop"] }
    );
    // Frozen object — strict-mode assignment throws.
    expect(r.ok).toBe(false);
  });

  it("denies overwriting a toolbox method", async () => {
    const r = await executeScript(
      `toolbox.foo = () => "x"; return "ok";`,
      async () => undefined,
      { allowedToolNames: ["foo"] }
    );
    expect(r.ok).toBe(false);
  });

  it("disallowed tool name is not exposed", async () => {
    const r = await executeScript(
      `return await toolbox.notListed({});`,
      async () => undefined,
      { allowedToolNames: ["onlyThis"] }
    );
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/toolbox\.notListed is not a function/);
  });
});

describe("executeScript — guards", () => {
  it("rejects empty allowedToolNames", async () => {
    const r = await executeScript("return 1", async () => 0, {
      allowedToolNames: [],
    });
    expect(r.ok).toBe(false);
    expect(r.error?.kind).toBe("no_allowed_tools");
  });

  it("rejects empty script", async () => {
    const r = await executeScript("", async () => 0, {
      allowedToolNames: ["x"],
    });
    expect(r.ok).toBe(false);
    expect(r.error?.kind).toBe("invalid_script");
  });

  it("timeouts a synchronous infinite loop", async () => {
    const r = await executeScript(
      `while (true) {}`,
      async () => undefined,
      { allowedToolNames: ["nop"], timeoutMs: 100 }
    );
    expect(r.ok).toBe(false);
    expect(r.error?.message.toLowerCase()).toContain("script execution timed out");
  });

  it("propagates script-thrown errors", async () => {
    const r = await executeScript(
      `throw new Error("oops");`,
      async () => undefined,
      { allowedToolNames: ["nop"] }
    );
    expect(r.ok).toBe(false);
    expect(r.error?.message).toBe("oops");
  });

  it("rejects oversized result", async () => {
    const r = await executeScript(
      `return "x".repeat(5000);`,
      async () => undefined,
      { allowedToolNames: ["nop"], maxResultBytes: 100 }
    );
    expect(r.ok).toBe(false);
    expect(r.error?.kind).toBe("result_too_large");
  });
});

describe("executeScript — diagnostics", () => {
  it("counts every tool invocation, tracks unique tools", async () => {
    const invoke = async (name: string) => name;
    const r = await executeScript(
      `
      await toolbox.a({});
      await toolbox.b({});
      await toolbox.a({});
      return null;
      `,
      invoke,
      { allowedToolNames: ["a", "b"] }
    );
    expect(r.diagnostics.invokeCount).toBe(3);
    expect(r.diagnostics.toolsInvoked.sort()).toEqual(["a", "b"]);
  });

  it("reports elapsedMs for the run", async () => {
    const r = await executeScript("return 1;", async () => 0, {
      allowedToolNames: ["nop"],
    });
    expect(r.diagnostics.elapsedMs).toBeGreaterThanOrEqual(0);
  });
});

describe("executeScript — JSON cloning of args/results", () => {
  it("strips functions from input params (deep)", async () => {
    let received: unknown = null;
    const invoke = async (_name: string, params: unknown) => {
      received = params;
      return null;
    };
    const r = await executeScript(
      `await toolbox.x({ ok: true, fn: () => 1 }); return null;`,
      invoke,
      { allowedToolNames: ["x"] }
    );
    expect(r.ok).toBe(true);
    expect(received).toEqual({ ok: true });
  });
});
