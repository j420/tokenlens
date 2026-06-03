import { describe, expect, it } from "vitest";
import {
  generateToolboxApi,
  sanitizeIdentifier,
  type McpToolDef,
} from "./schema-to-ts.js";

describe("sanitizeIdentifier", () => {
  it("keeps ASCII identifiers verbatim", () => {
    expect(sanitizeIdentifier("read_file")).toBe("read_file");
    expect(sanitizeIdentifier("readFile")).toBe("readFile");
    expect(sanitizeIdentifier("ReadFile2")).toBe("ReadFile2");
  });

  it("replaces non-identifier chars with underscore", () => {
    expect(sanitizeIdentifier("read-file")).toBe("read_file");
    expect(sanitizeIdentifier("read.file/x")).toBe("read_file_x");
    expect(sanitizeIdentifier("a@b")).toBe("a_b");
  });

  it("prefixes digit-start with underscore", () => {
    expect(sanitizeIdentifier("2read")).toBe("_2read");
  });

  it("quotes reserved words via leading underscore", () => {
    expect(sanitizeIdentifier("default")).toBe("_default");
    expect(sanitizeIdentifier("class")).toBe("_class");
  });

  it("empty / non-string ⇒ _tool", () => {
    expect(sanitizeIdentifier("")).toBe("_tool");
    expect(sanitizeIdentifier(null as never)).toBe("_tool");
  });
});

describe("generateToolboxApi — minimal shapes", () => {
  it("emits a Toolbox interface with one method per tool", () => {
    const tools: McpToolDef[] = [
      {
        name: "read_file",
        description: "Read a file.",
        inputSchema: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      },
    ];
    const spec = generateToolboxApi(tools);
    expect(spec.code).toContain("export interface Toolbox");
    expect(spec.code).toContain("read_file(params:");
    expect(spec.code).toContain("path: string;");
    expect(spec.methodNames).toEqual(["read_file"]);
    expect(spec.nameMap.read_file).toBe("read_file");
  });

  it("renders enums as string-union types", () => {
    const tools: McpToolDef[] = [
      {
        name: "set_mode",
        inputSchema: {
          type: "object",
          properties: { mode: { enum: ["fast", "slow"] } },
          required: ["mode"],
        },
      },
    ];
    const spec = generateToolboxApi(tools);
    expect(spec.code).toContain(`mode: "fast" | "slow"`);
  });

  it("renders arrays as Array<T>", () => {
    const tools: McpToolDef[] = [
      {
        name: "ingest",
        inputSchema: {
          type: "object",
          properties: { paths: { type: "array", items: { type: "string" } } },
          required: ["paths"],
        },
      },
    ];
    expect(generateToolboxApi(tools).code).toContain("paths: Array<string>;");
  });

  it("optional fields end with ?", () => {
    const tools: McpToolDef[] = [
      {
        name: "do_thing",
        inputSchema: {
          type: "object",
          properties: { a: { type: "string" }, b: { type: "number" } },
          required: ["a"],
        },
      },
    ];
    const spec = generateToolboxApi(tools);
    expect(spec.code).toContain("a: string;");
    expect(spec.code).toContain("b?: number;");
  });

  it("oneOf becomes a TS union", () => {
    const tools: McpToolDef[] = [
      {
        name: "f",
        inputSchema: {
          type: "object",
          properties: {
            v: { oneOf: [{ type: "string" }, { type: "number" }] },
          },
          required: ["v"],
        },
      },
    ];
    expect(generateToolboxApi(tools).code).toContain("v: string | number;");
  });

  it("missing inputSchema gracefully degrades to unknown", () => {
    const tools = [{ name: "weird", inputSchema: undefined as never }];
    const spec = generateToolboxApi(tools as McpToolDef[]);
    expect(spec.code).toContain("weird(params: unknown):");
  });

  it("outputSchema generates the return type when present", () => {
    const tools: McpToolDef[] = [
      {
        name: "f",
        inputSchema: { type: "object", properties: {} },
        outputSchema: {
          type: "object",
          properties: { result: { type: "string" } },
          required: ["result"],
        },
      },
    ];
    const code = generateToolboxApi(tools).code;
    expect(code).toContain("Promise<{");
    expect(code).toContain("result: string;");
  });

  it("default toolbox name is 'Toolbox', overridable", () => {
    const spec = generateToolboxApi(
      [{ name: "x", inputSchema: { type: "object" } }],
      { toolboxName: "AgentAPI" }
    );
    expect(spec.code).toContain("export interface AgentAPI");
  });
});

describe("generateToolboxApi — collisions and reserved names", () => {
  it("disambiguates colliding sanitized names", () => {
    const tools: McpToolDef[] = [
      { name: "read.file", inputSchema: { type: "object" } },
      { name: "read-file", inputSchema: { type: "object" } },
    ];
    const spec = generateToolboxApi(tools);
    // Both sanitize to "read_file"; the second becomes "read_file_2".
    expect(spec.methodNames).toEqual(["read_file", "read_file_2"]);
  });

  it("reserved word in property keys gets quoted", () => {
    const tools: McpToolDef[] = [
      {
        name: "x",
        inputSchema: {
          type: "object",
          properties: { default: { type: "string" } },
          required: ["default"],
        },
      },
    ];
    expect(generateToolboxApi(tools).code).toContain(`"default": string;`);
  });

  it("hyphenated keys are quoted", () => {
    const tools: McpToolDef[] = [
      {
        name: "x",
        inputSchema: {
          type: "object",
          properties: { "file-path": { type: "string" } },
          required: ["file-path"],
        },
      },
    ];
    expect(generateToolboxApi(tools).code).toContain(`"file-path": string;`);
  });
});

describe("generateToolboxApi — robustness", () => {
  it("skips tools with no name without throwing", () => {
    const tools = [
      { name: "", inputSchema: { type: "object" } },
      { name: "good", inputSchema: { type: "object" } },
    ];
    const spec = generateToolboxApi(tools as McpToolDef[]);
    expect(spec.methodNames).toEqual(["good"]);
  });

  it("description with */ is escaped to not close the JSDoc", () => {
    const tools: McpToolDef[] = [
      {
        name: "x",
        description: "Bad */ inside",
        inputSchema: { type: "object" },
      },
    ];
    const code = generateToolboxApi(tools).code;
    // The legitimate JSDoc close `*/` appears exactly once;
    // an unescaped user-supplied `*/` would produce two.
    expect(code.split("*/")).toHaveLength(2);
    // And the user text must have been rewritten so the `*/` isn't intact:
    expect(code).not.toContain("Bad */ inside");
    expect(code).toContain("Bad * / inside");
  });
});
