import { describe, it, expect } from "vitest";
import { allocate, spend, transfer, balance, balances, emptyMarket } from "./market.js";

describe("allocate", () => {
  it("splits an envelope equally and exactly (remainder distributed deterministically)", () => {
    const s = allocate(100, [{ actorId: "a" }, { actorId: "b" }, { actorId: "c" }]);
    const total = balances(s).reduce((sum, b) => sum + b.granted, 0);
    expect(total).toBe(100); // exact, no rounding loss
    // 100/3 = 33 each + 1 leftover → sorted 'a' gets the extra
    expect(balance(s, "a")!.granted).toBe(34);
    expect(balance(s, "b")!.granted).toBe(33);
    expect(balance(s, "c")!.granted).toBe(33);
  });

  it("splits by weight", () => {
    const s = allocate(100, [{ actorId: "a", weight: 3 }, { actorId: "b", weight: 1 }]);
    expect(balance(s, "a")!.granted).toBe(75);
    expect(balance(s, "b")!.granted).toBe(25);
  });

  it("is total on garbage", () => {
    expect(allocate(0, [{ actorId: "a" }]).actors).toEqual({});
    expect(allocate(100, null).actors).toEqual({});
  });
});

describe("spend", () => {
  const base = allocate(100, [{ actorId: "a" }, { actorId: "b" }]);
  it("draws down an actor's allowance", () => {
    const r = spend(base, "a", 30);
    expect(r.ok).toBe(true);
    expect(balance(r.state, "a")!.remaining).toBe(20); // 50 - 30
    expect(balance(r.state, "a")!.utilization).toBeCloseTo(0.6);
  });

  it("REJECTS an overdraw (never silently clamps)", () => {
    const r = spend(base, "a", 60); // only 50 granted
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("overdraw");
    expect(balance(r.state, "a")!.spent).toBe(0); // unchanged
  });

  it("rejects unknown actor and non-positive amount", () => {
    expect(spend(base, "ghost", 10).ok).toBe(false);
    expect(spend(base, "a", -5).ok).toBe(false);
    expect(spend(base, "a", 0).ok).toBe(false);
  });
});

describe("transfer (Coasean trade)", () => {
  const base = allocate(100, [{ actorId: "a" }, { actorId: "b" }]);
  it("moves unspent allowance between actors", () => {
    const r = transfer(base, "a", "b", 20);
    expect(r.ok).toBe(true);
    expect(balance(r.state, "a")!.granted).toBe(30);
    expect(balance(r.state, "b")!.granted).toBe(70);
    // conservation: total granted unchanged
    expect(balances(r.state).reduce((s, x) => s + x.granted, 0)).toBe(100);
  });

  it("rejects a transfer exceeding the sender's remaining balance", () => {
    const spent = spend(base, "a", 40).state; // a has 10 left
    const r = transfer(spent, "a", "b", 20);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("insufficient");
  });

  it("rejects self-transfer and unknown parties", () => {
    expect(transfer(base, "a", "a", 5).ok).toBe(false);
    expect(transfer(base, "a", "ghost", 5).ok).toBe(false);
  });

  it("does not let a transfer strand already-spent amounts (granted >= spent invariant)", () => {
    const spent = spend(base, "a", 30).state; // a: granted 50, spent 30, remaining 20
    const r = transfer(spent, "a", "b", 20); // moves exactly the remaining
    expect(r.ok).toBe(true);
    const a = balance(r.state, "a")!;
    expect(a.granted).toBe(30);
    expect(a.spent).toBe(30);
    expect(a.remaining).toBe(0);
  });

  it("is immutable (operations return new state)", () => {
    const r = spend(base, "a", 10);
    expect(balance(base, "a")!.spent).toBe(0); // original untouched
    expect(balance(r.state, "a")!.spent).toBe(10);
  });
});

describe("queries", () => {
  it("balance returns null for an unknown actor", () => {
    expect(balance(emptyMarket(), "x")).toBeNull();
  });
  it("balances are sorted by actor id (deterministic)", () => {
    const s = allocate(100, [{ actorId: "z" }, { actorId: "a" }]);
    expect(balances(s).map((b) => b.actorId)).toEqual(["a", "z"]);
  });
});
