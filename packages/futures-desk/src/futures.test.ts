import { describe, it, expect } from "vitest";
import { priceReservations, type Reservation } from "./futures.js";

const M = "claude-sonnet-4-5-20250929"; // input 3, output 15
const NOW = "2026-06-01T00:00:00Z";

function res(id: string, deadlineIso: string, over: Partial<Reservation> = {}): Reservation {
  return { id, model: M, inputTokens: 100_000, outputTokens: 10_000, deadlineIso, ...over };
}

describe("priceReservations", () => {
  it("applies the batch discount to an eligible (far-deadline) reservation", () => {
    // deadline 1 day out, minLead default 1h → eligible
    const r = priceReservations([res("a", "2026-06-02T00:00:00Z")], { batchDiscount: 0.5, nowIso: NOW });
    const q = r.quotes[0]!;
    expect(q.lane).toBe("batch");
    expect(q.eligible).toBe(true);
    // interactive = (100000*3 + 10000*15)/1e6 = 0.45 ; batch = 0.225 ; save 0.225
    expect(q.interactiveCostUsd).toBeCloseTo(0.45, 9);
    expect(q.laneCostUsd).toBeCloseTo(0.225, 9);
    expect(q.savingsUsd).toBeCloseTo(0.225, 9);
  });

  it("keeps a near-deadline reservation interactive at full price", () => {
    // deadline 10 min out, minLead 1h → ineligible
    const r = priceReservations([res("a", "2026-06-01T00:10:00Z")], { batchDiscount: 0.5, nowIso: NOW });
    const q = r.quotes[0]!;
    expect(q.lane).toBe("interactive");
    expect(q.eligible).toBe(false);
    expect(q.savingsUsd).toBe(0);
    expect(q.laneCostUsd).toBeCloseTo(q.interactiveCostUsd!, 9);
  });

  it("treats a past-due reservation as ineligible", () => {
    const r = priceReservations([res("a", "2026-05-31T00:00:00Z")], { batchDiscount: 0.5, nowIso: NOW });
    expect(r.quotes[0]!.eligible).toBe(false);
    expect(r.quotes[0]!.leadMs).toBeLessThan(0);
  });

  it("null cost + null saving on an unpriced model (never fabricated)", () => {
    const r = priceReservations([res("a", "2026-06-02T00:00:00Z", { model: "made-up" })], {
      batchDiscount: 0.5,
      nowIso: NOW,
    });
    expect(r.quotes[0]!.interactiveCostUsd).toBeNull();
    expect(r.quotes[0]!.savingsUsd).toBeNull();
    expect(r.totalSavingsUsd).toBeNull(); // any unpriced ⇒ totals null
  });

  it("an out-of-range discount disables the saving", () => {
    const r = priceReservations([res("a", "2026-06-02T00:00:00Z")], { batchDiscount: 9, nowIso: NOW });
    expect(r.quotes[0]!.eligible).toBe(false);
    expect(r.quotes[0]!.savingsUsd).toBe(0);
  });

  it("respects a custom minLeadMs", () => {
    const r = priceReservations([res("a", "2026-06-01T02:00:00Z")], {
      batchDiscount: 0.5,
      minLeadMs: 3 * 3_600_000, // need 3h, only 2h out
      nowIso: NOW,
    });
    expect(r.quotes[0]!.eligible).toBe(false);
  });

  it("aggregates totals across reservations", () => {
    const r = priceReservations(
      [res("a", "2026-06-02T00:00:00Z"), res("b", "2026-06-01T00:05:00Z")],
      { batchDiscount: 0.5, nowIso: NOW }
    );
    // a eligible (save 0.225), b not (save 0)
    expect(r.totalSavingsUsd).toBeCloseTo(0.225, 9);
    expect(r.totalInteractiveUsd).toBeCloseTo(0.9, 9);
  });

  it("skips malformed reservations and is total on garbage", () => {
    const r = priceReservations([res("a", "2026-06-02T00:00:00Z"), { id: "x" }, null], {
      batchDiscount: 0.5,
      nowIso: NOW,
    } as Parameters<typeof priceReservations>[1]);
    expect(r.skipped).toBe(2);
    expect(priceReservations(null, { batchDiscount: 0.5 }).quotes).toEqual([]);
  });

  it("is deterministic", () => {
    const input = [res("a", "2026-06-02T00:00:00Z")];
    const opts = { batchDiscount: 0.5, nowIso: NOW };
    expect(priceReservations(input, opts)).toEqual(priceReservations(input, opts));
  });
});
