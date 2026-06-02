import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPersistedRegime, statePathFor } from "./state-reader.js";

function tmp() {
  return mkdtempSync(join(tmpdir(), "context-health-state-"));
}

describe("readPersistedRegime — missing file", () => {
  it("returns insufficient_data when transcript path is empty", () => {
    expect(readPersistedRegime("")).toBe("insufficient_data");
  });

  it("returns insufficient_data when state file does not exist", () => {
    const dir = tmp();
    expect(
      readPersistedRegime("/no/such/transcript.jsonl", { cacheDir: dir })
    ).toBe("insufficient_data");
  });
});

describe("readPersistedRegime — malformed file", () => {
  it("returns insufficient_data when JSON is corrupt", () => {
    const dir = tmp();
    const path = statePathFor("/x/y.jsonl", { cacheDir: dir });
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, "{this is not json");
    expect(
      readPersistedRegime("/x/y.jsonl", { cacheDir: dir })
    ).toBe("insufficient_data");
  });

  it("returns insufficient_data when cusum.regime is unknown", () => {
    const dir = tmp();
    const path = statePathFor("/x/y.jsonl", { cacheDir: dir });
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({ cusum: { regime: "exploded" } })
    );
    expect(
      readPersistedRegime("/x/y.jsonl", { cacheDir: dir })
    ).toBe("insufficient_data");
  });

  it("returns insufficient_data when cusum is missing", () => {
    const dir = tmp();
    const path = statePathFor("/x/y.jsonl", { cacheDir: dir });
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify({ junk: true }));
    expect(
      readPersistedRegime("/x/y.jsonl", { cacheDir: dir })
    ).toBe("insufficient_data");
  });
});

describe("readPersistedRegime — happy paths", () => {
  for (const regime of ["healthy", "warning", "critical", "insufficient_data"] as const) {
    it(`returns ${regime} when the file carries it`, () => {
      const dir = tmp();
      const path = statePathFor("/some/transcript.jsonl", { cacheDir: dir });
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        path,
        JSON.stringify({ cusum: { regime, sPlus: 0, sMinus: 0 } })
      );
      expect(
        readPersistedRegime("/some/transcript.jsonl", { cacheDir: dir })
      ).toBe(regime);
    });
  }
});

describe("statePathFor — deterministic naming", () => {
  it("returns a stable path keyed by SHA256[0:16] of the transcript path", () => {
    const a = statePathFor("/a.jsonl", { cacheDir: "/cache" });
    const b = statePathFor("/a.jsonl", { cacheDir: "/cache" });
    expect(a).toBe(b);
  });

  it("different transcripts yield different paths", () => {
    const a = statePathFor("/a.jsonl", { cacheDir: "/cache" });
    const b = statePathFor("/b.jsonl", { cacheDir: "/cache" });
    expect(a).not.toBe(b);
  });
});
