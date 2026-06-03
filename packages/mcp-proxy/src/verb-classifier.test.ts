import { describe, expect, it } from "vitest";

import {
  classifyToolNameByVerbs,
  getVerbTable,
  tokenizeToolName,
} from "./verb-classifier.js";

describe("tokenizeToolName", () => {
  it("splits on underscore", () => {
    expect(tokenizeToolName("list_pull_requests")).toEqual(["list", "pull", "requests"]);
  });

  it("splits on hyphen", () => {
    expect(tokenizeToolName("create-issue")).toEqual(["create", "issue"]);
  });

  it("splits on dot and slash and colon", () => {
    expect(tokenizeToolName("linear/create.issue:scoped")).toEqual([
      "linear",
      "create",
      "issue",
      "scoped",
    ]);
  });

  it("collapses consecutive separators", () => {
    expect(tokenizeToolName("postgres__list_tables")).toEqual([
      "postgres",
      "list",
      "tables",
    ]);
  });

  it("splits camelCase", () => {
    expect(tokenizeToolName("createIssue")).toEqual(["create", "issue"]);
  });

  it("preserves consecutive uppercase as one token (acronyms)", () => {
    expect(tokenizeToolName("XMLParse")).toEqual(["xmlparse"]);
  });

  it("handles empty name", () => {
    expect(tokenizeToolName("")).toEqual([]);
  });

  it("lowercases all output", () => {
    expect(tokenizeToolName("LIST_TABLES")).toEqual(["list", "tables"]);
  });

  it("treats unknown punctuation as separator (fail-safe)", () => {
    expect(tokenizeToolName("read@file")).toEqual(["read", "file"]);
  });

  it("preserves digits inside tokens", () => {
    expect(tokenizeToolName("get_v2_user")).toEqual(["get", "v2", "user"]);
  });
});

describe("classifyToolNameByVerbs", () => {
  it("classifies retrieval verbs", () => {
    const r = classifyToolNameByVerbs("list_pull_requests");
    expect(r.intents).toContain("retrieve");
    expect(r.verbTokens).toEqual(["list"]);
  });

  it("classifies generation verbs", () => {
    const r = classifyToolNameByVerbs("create_issue");
    expect(r.intents).toContain("generate");
  });

  it("classifies refactor verbs", () => {
    const r = classifyToolNameByVerbs("update_user");
    expect(r.intents).toContain("refactor");
  });

  it("classifies destructive verbs as refactor", () => {
    const r = classifyToolNameByVerbs("delete_branch");
    expect(r.intents).toContain("refactor");
  });

  it("multiple verb tokens union their intents", () => {
    const r = classifyToolNameByVerbs("search_and_read");
    expect(r.verbTokens).toEqual(["search", "read"]);
    expect(r.intents).toContain("retrieve");
  });

  it("ambiguous tool name yields empty intents (caller applies fail-safe)", () => {
    const r = classifyToolNameByVerbs("ambiguous_tool_xyz");
    expect(r.intents).toEqual([]);
    expect(r.verbTokens).toEqual([]);
  });

  it("handles camelCase names", () => {
    const r = classifyToolNameByVerbs("createPullRequest");
    expect(r.intents).toContain("generate");
  });

  it("handles MCP-namespaced names", () => {
    const r = classifyToolNameByVerbs("postgres__query");
    expect(r.intents).toContain("retrieve");
  });

  it("is deterministic across multiple invocations", () => {
    const a = classifyToolNameByVerbs("list_issues");
    const b = classifyToolNameByVerbs("list_issues");
    expect(a).toEqual(b);
  });
});

describe("getVerbTable", () => {
  it("exposes a non-empty verb table for documentation", () => {
    const table = getVerbTable();
    expect(table.size).toBeGreaterThan(0);
    expect(table.has("list")).toBe(true);
    expect(table.has("create")).toBe(true);
  });
});
