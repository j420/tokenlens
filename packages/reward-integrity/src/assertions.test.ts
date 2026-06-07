import { describe, expect, it } from "vitest";
import { inventoryAssertions } from "./assertions.js";

describe("inventoryAssertions", () => {
  it("counts expect matcher calls once each (not the bare head call)", () => {
    const inv = inventoryAssertions(`
      it("works", () => {
        expect(add(1, 2)).toBe(3);
        expect(name).toEqual("ada");
      });
    `);
    expect(inv.parsed).toBe(true);
    expect(inv.assertions).toBe(2);
  });

  it("counts chained matchers (resolves.toBe) once", () => {
    const inv = inventoryAssertions(`
      await expect(p).resolves.toBe(7);
    `);
    expect(inv.assertions).toBe(1);
  });

  it("counts node:assert direct and member forms", () => {
    const inv = inventoryAssertions(`
      assert(ok);
      assert.equal(a, b);
      assert.deepEqual(x, y);
    `);
    expect(inv.assertions).toBe(3);
  });

  it("detects skipped tests via .skip, todo, and x-identifiers", () => {
    const inv = inventoryAssertions(`
      it.skip("a", () => {});
      describe.todo("b");
      xit("c", () => {});
      xdescribe("d", () => {});
    `);
    expect(inv.skippedTests).toBe(4);
  });

  it("detects focused tests via .only and f-identifiers", () => {
    const inv = inventoryAssertions(`
      it.only("a", () => {});
      fdescribe("b", () => {});
    `);
    expect(inv.focusedTests).toBe(2);
  });

  it("counts throw/rejection expectations", () => {
    const inv = inventoryAssertions(`
      expect(() => boom()).toThrow();
      await expect(p).rejects.toThrow("x");
      assert.throws(() => boom());
    `);
    expect(inv.throwExpectations).toBeGreaterThanOrEqual(2);
  });

  describe("tautology detection", () => {
    it("flags expect(LIT).toBe(LIT) with equal literals", () => {
      expect(inventoryAssertions(`expect(true).toBe(true);`).tautologies).toBe(1);
      expect(inventoryAssertions(`expect(1).toBe(1);`).tautologies).toBe(1);
      expect(inventoryAssertions(`expect("x").toEqual("x");`).tautologies).toBe(1);
    });

    it("does NOT flag expect(LIT).toBe(OTHER_LIT)", () => {
      expect(inventoryAssertions(`expect(1).toBe(2);`).tautologies).toBe(0);
      expect(inventoryAssertions(`expect("a").toBe("b");`).tautologies).toBe(0);
    });

    it("does NOT flag a real assertion over a variable", () => {
      expect(inventoryAssertions(`expect(result).toBe(3);`).tautologies).toBe(0);
    });

    it("flags expect(true).toBeTruthy() and assert(true)", () => {
      expect(inventoryAssertions(`expect(true).toBeTruthy();`).tautologies).toBe(1);
      expect(inventoryAssertions(`assert(true);`).tautologies).toBe(1);
    });

    it("does NOT flag assert over a variable", () => {
      expect(inventoryAssertions(`assert(isReady);`).tautologies).toBe(0);
    });
  });

  it("returns parsed:false with zeroed counts on syntax errors", () => {
    const inv = inventoryAssertions(`function ( { this is not code`);
    expect(inv.parsed).toBe(false);
    expect(inv.assertions).toBe(0);
  });

  it("handles tsx", () => {
    const inv = inventoryAssertions(
      `const C = () => <div>{expect(x).toBe(1)}</div>;`,
      "tsx"
    );
    expect(inv.parsed).toBe(true);
    expect(inv.assertions).toBe(1);
  });
});
