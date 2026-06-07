import { describe, it, expect } from "vitest";
import { assessNavigationRatio, type NavTurn } from "./navigation.js";

/** Build a turn of read calls over the given paths. */
function readTurn(turn: number, ...paths: string[]): NavTurn {
  return { turn, tools: paths.map((path) => ({ name: "Read", path })) };
}

describe("assessNavigationRatio", () => {
  it("fires on a pure-navigation stall that re-visits a path", () => {
    // 3 turns, all reads, revisiting auth.ts; zero edits.
    const turns: NavTurn[] = [
      readTurn(1, "auth.ts", "user.ts"),
      readTurn(2, "auth.ts", "db.ts"),
      readTurn(3, "auth.ts"),
    ];
    const r = assessNavigationRatio(turns, { navFloor: 4 });
    expect(r.verdict).toBe("warn");
    expect(r.mutCount).toBe(0);
    expect(r.navCount).toBe(5);
    expect(r.revisitedPaths).toEqual(["auth.ts"]);
  });

  it("does NOT fire on a first-pass survey of DISTINCT files", () => {
    // Many reads but every file distinct → no revisit → not a stall.
    const turns: NavTurn[] = [
      readTurn(1, "a.ts", "b.ts"),
      readTurn(2, "c.ts", "d.ts"),
      readTurn(3, "e.ts", "f.ts"),
    ];
    const r = assessNavigationRatio(turns, { navFloor: 4 });
    expect(r.verdict).toBe("ok");
    expect(r.navCount).toBe(6);
    expect(r.revisitedPaths).toEqual([]);
  });

  it("does NOT fire when any mutation happened in the window", () => {
    const turns: NavTurn[] = [
      readTurn(1, "auth.ts"),
      readTurn(2, "auth.ts"),
      { turn: 3, tools: [{ name: "Edit", path: "auth.ts" }] },
    ];
    const r = assessNavigationRatio(turns, { navFloor: 1 });
    expect(r.verdict).toBe("ok");
    expect(r.mutCount).toBe(1);
  });

  it("respects the window — an old edit outside the window does not protect", () => {
    const turns: NavTurn[] = [
      { turn: 1, tools: [{ name: "Edit", path: "auth.ts" }] }, // dropped by window=3
      readTurn(2, "auth.ts", "x.ts"),
      readTurn(3, "auth.ts", "y.ts"),
      readTurn(4, "auth.ts"),
    ];
    const r = assessNavigationRatio(turns, { window: 3, navFloor: 4 });
    expect(r.turnsConsidered).toBe(3);
    expect(r.mutCount).toBe(0);
    expect(r.verdict).toBe("warn");
  });

  it("counts Bash/Task as 'other', neither nav nor mut, and does not let them block firing", () => {
    const turns: NavTurn[] = [
      { turn: 1, tools: [{ name: "Bash", path: null }, { name: "Read", path: "auth.ts" }] },
      readTurn(2, "auth.ts", "auth.ts"),
      readTurn(3, "auth.ts", "auth.ts"),
    ];
    const r = assessNavigationRatio(turns, { navFloor: 4 });
    expect(r.otherCount).toBe(1);
    expect(r.mutCount).toBe(0);
    expect(r.verdict).toBe("warn");
  });

  it("does not fire below the navigation floor", () => {
    const turns: NavTurn[] = [readTurn(1, "auth.ts"), readTurn(2, "auth.ts")];
    const r = assessNavigationRatio(turns, { navFloor: 5 });
    expect(r.navCount).toBe(2);
    expect(r.verdict).toBe("ok");
  });

  it("does not fire below minTurns even with many reads in one turn", () => {
    const turns: NavTurn[] = [readTurn(1, "a.ts", "a.ts", "a.ts", "a.ts", "a.ts", "a.ts")];
    const r = assessNavigationRatio(turns, { navFloor: 4, minTurns: 2 });
    // one turn → a path can't be revisited ACROSS turns → no revisit anyway
    expect(r.turnsConsidered).toBe(1);
    expect(r.verdict).toBe("ok");
  });

  it("is total on garbage input", () => {
    expect(assessNavigationRatio(null).verdict).toBe("ok");
    expect(assessNavigationRatio(undefined).verdict).toBe("ok");
    expect(assessNavigationRatio("nope" as unknown).verdict).toBe("ok");
    expect(
      assessNavigationRatio([{ turn: "x", tools: 3 }, null, 7] as unknown).verdict
    ).toBe("ok");
  });

  it("skips malformed tool calls without throwing", () => {
    const turns = [
      { turn: 1, tools: [{ name: "Read", path: "auth.ts" }, { bad: true }, 5, null] },
      { turn: 2, tools: [{ name: "Read", path: "auth.ts" }] },
      { turn: 3, tools: [{ name: "Read", path: "auth.ts" }, { name: "Read", path: "auth.ts" }] },
    ];
    const r = assessNavigationRatio(turns as unknown, { navFloor: 3 });
    expect(r.navCount).toBe(4);
    expect(r.revisitedPaths).toEqual(["auth.ts"]);
    expect(r.verdict).toBe("warn");
  });

  it("is runtime-neutral via the default vocabulary (Cursor/Codex tool names)", () => {
    // No overrides — a Cursor-style runtime using read_file / edit_file.
    const turns: NavTurn[] = [
      { turn: 1, tools: [{ name: "read_file", path: "auth.ts" }] },
      { turn: 2, tools: [{ name: "read_file", path: "auth.ts" }] },
      { turn: 3, tools: [{ name: "codebase_search", path: "auth.ts" }, { name: "read_file", path: "auth.ts" }] },
    ];
    const r = assessNavigationRatio(turns, { navFloor: 4 });
    expect(r.navCount).toBe(4);
    expect(r.mutCount).toBe(0);
    expect(r.verdict).toBe("warn");
  });

  it("honors a custom runtime vocabulary override", () => {
    // A bespoke agent whose read tool is "peek" and write tool is "poke".
    const turns: NavTurn[] = [
      { turn: 1, tools: [{ name: "peek", path: "auth.ts" }] },
      { turn: 2, tools: [{ name: "peek", path: "auth.ts" }] },
      { turn: 3, tools: [{ name: "peek", path: "auth.ts" }, { name: "peek", path: "auth.ts" }] },
    ];
    const warn = assessNavigationRatio(turns, {
      navFloor: 4,
      navTools: ["peek"],
      mutTools: ["poke"],
    });
    expect(warn.navCount).toBe(4);
    expect(warn.verdict).toBe("warn");

    // With the default vocabulary, "peek" is unknown → counted as "other" → no fire.
    const dflt = assessNavigationRatio(turns, { navFloor: 4 });
    expect(dflt.navCount).toBe(0);
    expect(dflt.otherCount).toBe(4);
    expect(dflt.verdict).toBe("ok");
  });

  it("treats a custom write tool as a mutation that suppresses firing", () => {
    const turns: NavTurn[] = [
      { turn: 1, tools: [{ name: "peek", path: "auth.ts" }] },
      { turn: 2, tools: [{ name: "peek", path: "auth.ts" }] },
      { turn: 3, tools: [{ name: "poke", path: "auth.ts" }] },
    ];
    const r = assessNavigationRatio(turns, {
      navFloor: 1,
      navTools: ["peek"],
      mutTools: ["poke"],
    });
    expect(r.mutCount).toBe(1);
    expect(r.verdict).toBe("ok");
  });

  it("is deterministic — same window, same report (sorted revisited paths)", () => {
    const turns: NavTurn[] = [
      readTurn(1, "z.ts", "a.ts"),
      readTurn(2, "z.ts", "a.ts"),
      readTurn(3, "z.ts", "a.ts"),
    ];
    const a = assessNavigationRatio(turns, { navFloor: 4 });
    const b = assessNavigationRatio(turns, { navFloor: 4 });
    expect(a).toEqual(b);
    expect(a.revisitedPaths).toEqual(["a.ts", "z.ts"]); // sorted
  });
});
