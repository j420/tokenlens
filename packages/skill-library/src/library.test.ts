import { describe, expect, it } from "vitest";

import { SkillLibrary } from "./library.js";
import { crudSkill, makeSkill } from "./test-helpers.js";

describe("SkillLibrary basic store", () => {
  it("adds and lists skills deterministically", () => {
    const lib = new SkillLibrary();
    lib.add(crudSkill());
    expect(lib.size).toBe(1);
    expect(lib.list()[0]!.label).toBe("add-crud-endpoint");
  });

  it("dedups byte-identical skills (idempotent re-capture)", () => {
    const lib = new SkillLibrary();
    const a = crudSkill();
    const b = crudSkill(); // identical identity → same content hash
    lib.add(a);
    const returned = lib.add(b);
    expect(lib.size).toBe(1);
    expect(returned.contentHash).toBe(a.contentHash);
  });

  it("get() retrieves by content hash", () => {
    const lib = new SkillLibrary();
    const s = crudSkill();
    lib.add(s);
    expect(lib.get(s.contentHash)!.id).toBe(s.id);
    expect(lib.get("nonexistent")).toBeUndefined();
  });

  it("retire() removes a skill", () => {
    const lib = new SkillLibrary();
    const s = crudSkill();
    lib.add(s);
    expect(lib.retire(s.contentHash)).toBe(true);
    expect(lib.size).toBe(0);
    expect(lib.retire(s.contentHash)).toBe(false);
  });
});

describe("SkillLibrary.match", () => {
  it("matches a closely-worded new task above threshold", () => {
    const lib = new SkillLibrary();
    lib.add(crudSkill());
    const matches = lib.match("add a CRUD endpoint for invoices to the router", {
      threshold: 0.4,
    });
    expect(matches.length).toBe(1);
    expect(matches[0]!.skill.label).toBe("add-crud-endpoint");
    expect(matches[0]!.similarity).toBeGreaterThan(0.4);
    expect(matches[0]!.matchedTerms).toContain("crud");
    expect(matches[0]!.matchedTerms).toContain("endpoint");
  });

  it("does not match an unrelated task", () => {
    const lib = new SkillLibrary();
    lib.add(crudSkill());
    const matches = lib.match("upgrade the webpack configuration to v6", {
      threshold: 0.4,
    });
    expect(matches.length).toBe(0);
  });

  it("ranks by similarity, then useCount, then id", () => {
    const lib = new SkillLibrary();
    const broad = makeSkill(
      "add endpoint invoices router",
      "broad",
      [{ toolName: "Edit", target: "r.ts", tokenFootprint: 100 }]
    );
    const exact = makeSkill(
      "add a CRUD endpoint for invoices to the REST router",
      "exact",
      [{ toolName: "Edit", target: "r.ts", tokenFootprint: 100 }]
    );
    lib.add(broad);
    lib.add(exact);
    const matches = lib.match("add a CRUD endpoint for invoices to the REST router", {
      threshold: 0.1,
      limit: 5,
    });
    // 'exact' has the higher Jaccard with the identical prompt.
    expect(matches[0]!.skill.label).toBe("exact");
  });

  it("respects the limit", () => {
    const lib = new SkillLibrary();
    for (let i = 0; i < 5; i++) {
      lib.add(
        makeSkill(`add endpoint number ${i} invoices router crud`, `s${i}`, [
          { toolName: "Edit", target: `r${i}.ts`, tokenFootprint: 100 },
        ])
      );
    }
    const matches = lib.match("add endpoint invoices router crud", {
      threshold: 0.1,
      limit: 2,
    });
    expect(matches.length).toBe(2);
  });

  it("recordReuse increments useCount immutably", () => {
    const lib = new SkillLibrary();
    const s = crudSkill();
    lib.add(s);
    const updated = lib.recordReuse(s.contentHash);
    expect(updated!.useCount).toBe(1);
    expect(s.useCount).toBe(0); // original object untouched
    expect(lib.get(s.contentHash)!.useCount).toBe(1);
  });
});

describe("SkillLibrary.prune", () => {
  it("removes skills older than maxAgeDays", () => {
    const lib = new SkillLibrary();
    const old = makeSkill("old task crud endpoint", "old", [
      { toolName: "Read", target: "a", tokenFootprint: 1 },
    ], { at: new Date("2026-01-01T00:00:00.000Z") });
    const fresh = makeSkill("fresh task crud endpoint", "fresh", [
      { toolName: "Read", target: "b", tokenFootprint: 1 },
    ], { at: new Date("2026-06-01T00:00:00.000Z") });
    lib.add(old);
    lib.add(fresh);
    const removed = lib.prune({ maxAgeDays: 30 }, new Date("2026-06-15T00:00:00.000Z"));
    expect(removed).toContain(old.contentHash);
    expect(lib.size).toBe(1);
    expect(lib.get(fresh.contentHash)).toBeDefined();
  });

  it("trims to maxSkills keeping most-used then newest", () => {
    const lib = new SkillLibrary();
    const a = makeSkill("task a crud endpoint router", "a", [
      { toolName: "Read", target: "a", tokenFootprint: 1 },
    ], { at: new Date("2026-06-01T00:00:00.000Z") });
    const b = makeSkill("task b crud endpoint router", "b", [
      { toolName: "Read", target: "b", tokenFootprint: 1 },
    ], { at: new Date("2026-06-02T00:00:00.000Z") });
    const c = makeSkill("task c crud endpoint router", "c", [
      { toolName: "Read", target: "c", tokenFootprint: 1 },
    ], { at: new Date("2026-06-03T00:00:00.000Z") });
    lib.add(a);
    lib.add(b);
    lib.add(c);
    // Make 'a' the most-used so it survives despite being oldest.
    lib.recordReuse(a.contentHash);
    lib.recordReuse(a.contentHash);
    const removed = lib.prune({ maxSkills: 1 });
    expect(lib.size).toBe(1);
    expect(lib.list()[0]!.label).toBe("a");
    expect(removed.length).toBe(2);
  });
});

describe("SkillLibrary serialize/fromState", () => {
  it("round-trips through a serialized state", () => {
    const lib = new SkillLibrary();
    lib.add(crudSkill());
    lib.recordReuse(crudSkill().contentHash);
    const state = lib.serialize();
    expect(state.version).toBe(1);
    const restored = SkillLibrary.fromState(state);
    expect(restored.size).toBe(lib.size);
    expect(restored.list()[0]!.contentHash).toBe(lib.list()[0]!.contentHash);
  });

  it("throws on an unsupported state version", () => {
    expect(() =>
      SkillLibrary.fromState({ version: 2 as 1, skills: [] })
    ).toThrow(/unsupported state version/);
  });
});
