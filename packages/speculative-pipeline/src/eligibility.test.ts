import { describe, expect, it } from "vitest";

import { isSpeculatable, SPECULATABLE_TOOLS } from "./eligibility.js";

describe("isSpeculatable", () => {
  it("allows the pure-read tools", () => {
    for (const t of ["Read", "Glob", "LS", "Grep"]) {
      expect(isSpeculatable(t)).toBe(true);
    }
  });

  it("rejects write/edit/destructive tools", () => {
    for (const t of ["Write", "Edit", "Bash", "NotebookEdit", "Task"]) {
      expect(isSpeculatable(t)).toBe(false);
    }
  });

  it("is case-sensitive (tool names are canonical identifiers)", () => {
    expect(isSpeculatable("read")).toBe(false);
    expect(isSpeculatable("READ")).toBe(false);
  });

  it("rejects unknown tools (fail-safe-to-exclude)", () => {
    expect(isSpeculatable("SomeMcpTool")).toBe(false);
  });

  it("exposes the allowlist", () => {
    expect([...SPECULATABLE_TOOLS]).toEqual(["Read", "Glob", "LS", "Grep"]);
  });
});
