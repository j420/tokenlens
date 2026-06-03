/**
 * SpeculativeHost — end-to-end concurrent-loop tests.
 *
 * These exercise the REAL driver (not a sequential stub) against a deterministic
 * fake executor + manual clock, proving every fail-safe and accounting claim:
 *   • end-to-end hit (verified, latency saved)
 *   • end-to-end miss (zero token cost; only wasted CPU accounted)
 *   • in-flight-incomplete (real call arrives before the speculation finishes)
 *   • a THROWING speculative executor never breaks/delays the real call
 *   • a HANGING speculative executor never breaks/delays the real call
 *   • breaker-open stops speculation end to end
 *   • byte-equality verification rejects a stale speculative result
 *   • concurrency: multiple speculations launched in parallel
 */

import { describe, expect, it, vi } from "vitest";

import { SpeculativeHost } from "./host.js";
import { SpeculativePipeline } from "./pipeline.js";
import { speculationKey } from "./canonical-input.js";
import {
  FakeExecutor,
  ManualClock,
  flushMicrotasks,
} from "./test-harness.js";
import type { Speculation, ToolCall } from "./types.js";

const read = (p: string): ToolCall => ({ name: "Read", input: { file_path: p } });
const edit = (p: string): ToolCall => ({ name: "Edit", input: { file_path: p } });

/** A history where Read(a) → Read(b) is a strong, repeated transition. */
function warmHistory(): ToolCall[] {
  return [read("a"), read("b"), read("a"), read("b"), read("a"), read("b")];
}

/** Build a host wired to a fresh fake executor + manual clock. */
function makeHost(
  opts: {
    history?: ToolCall[];
    pipeline?: SpeculativePipeline;
    verifyBeforeServe?: boolean;
    clock?: ManualClock;
  } = {}
) {
  const fake = new FakeExecutor();
  const clock = opts.clock ?? new ManualClock(1000);
  const host = new SpeculativeHost(fake.executor, {
    clock: clock.now,
    pipeline:
      opts.pipeline ??
      new SpeculativePipeline(opts.history ?? warmHistory(), { minProbability: 0 }),
    verifyBeforeServe: opts.verifyBeforeServe ?? true,
  });
  return { fake, clock, host };
}

/** A caller candidate for a concrete read, probability `p`. */
function candidate(p: string, prob: number): Speculation {
  return {
    call: read(p),
    key: "",
    probability: prob,
    source: "caller-candidate",
  };
}

describe("SpeculativeHost — sync-verify hit is byte-correct but saves ~0 NET latency", () => {
  it("serves the verified result but reports NET latency saved = max(0, gross − shadow) ≈ 0 (HIGH-1)", async () => {
    // DEFAULT serve mode: the host awaits a fresh shadow run ON the critical
    // path before serving. The agent therefore pays the full shadow wall-clock,
    // so the honest NET saving is ~0 — NOT the speculation's 1800ms elapsed.
    const { fake, host, clock } = makeHost();

    const launched = host.beginTurn(read("a"));
    expect(launched.length).toBeGreaterThan(0);
    const target = launched.find((s) => s.key === speculationKey(read("b")));
    expect(target).toBeDefined();

    // The speculation for Read(b) completes first (gross potential = 1800ms).
    const spec = fake.pendingFor(read("b"));
    expect(spec).toBeDefined();
    spec!.resolve({ result: "contents of b", elapsedMs: 1800 });
    await flushMicrotasks();

    // The shadow verification run takes REAL injected-clock time: it is a
    // controlled pending handle the test settles only after advancing the clock,
    // proving the agent genuinely waited the full shadow execution on-path.
    const before = clock.now();
    const resolvePromise = host.resolve(read("b"));
    await flushMicrotasks();
    const shadow = fake.pendingFor(read("b"));
    expect(shadow).toBeDefined(); // a fresh shadow run was dispatched on-path
    clock.advance(1700); // the agent waits the shadow run...
    shadow!.resolve({ result: "contents of b", elapsedMs: 1700 });
    const out = await resolvePromise;
    const elapsedOnPath = clock.now() - before;

    // The result is correct (byte-verified) ...
    expect(out.result).toBe("contents of b");
    expect(out.reconcile.classification).toBe("hit");
    expect(out.verification?.authoritative).toBe(true);
    // ... but it is HONESTLY labeled as saving no latency under sync verify.
    expect(out.source).toBe("verified-no-latency-saved");
    // NET = max(0, gross 1800 − shadow 1700) = 100ms. Defensible by arithmetic.
    expect(out.latencySavedMs).toBe(100);
    // The GROSS potential is still surfaced separately (for "could have saved").
    expect(out.speculativeElapsedMs).toBe(1800);
    // And the agent really did wait the shadow run on the critical path.
    expect(elapsedOnPath).toBe(1700);

    // The host's honest ledger reflects the NET figure, not the gross.
    const ledger = host.getLatencyLedger();
    expect(ledger.netLatencySavedMs).toBe(100);
    expect(ledger.grossSpeculativeElapsedMs).toBe(1800);
    expect(ledger.verifiedNoSaveHits).toBe(1);
    expect(ledger.latencySavingHits).toBe(0);

    // Pipeline GROSS stat is unchanged (it tracks potential, clearly labeled).
    const stats = host.getPipeline().getStats();
    expect(stats.hits).toBe(1);
    expect(stats.totalSpeculativeElapsedMs).toBe(1800);
  });

  it("reports NET latency saved = 0 when the shadow run is as slow as the speculation", async () => {
    // The realistic case: a fresh shadow run costs ~the same as the speculation.
    // gross − shadow ≤ 0 ⇒ NET clamps to 0. The earlier code reported 1800 here.
    const { fake, host, clock } = makeHost();
    host.beginTurn(read("a"));
    const spec = fake.pendingFor(read("b"))!;
    spec.resolve({ result: "contents of b", elapsedMs: 1800 });
    await flushMicrotasks();

    const resolvePromise = host.resolve(read("b"));
    await flushMicrotasks();
    const shadow = fake.pendingFor(read("b"))!;
    clock.advance(1900); // shadow run is even slower than the speculation
    shadow.resolve({ result: "contents of b", elapsedMs: 1900 });
    const out = await resolvePromise;

    expect(out.source).toBe("verified-no-latency-saved");
    expect(out.latencySavedMs).toBe(0); // clamped, never negative
    expect(out.speculativeElapsedMs).toBe(1800);
    expect(host.getLatencyLedger().netLatencySavedMs).toBe(0);
  });
});

describe("SpeculativeHost — async-serve genuinely saves latency", () => {
  it("serves the speculative result IMMEDIATELY (no on-path shadow); full elapsed saved; verifies out of band", async () => {
    const onAsync = vi.fn();
    const fake = new FakeExecutor();
    const clock = new ManualClock(1000);
    const host = new SpeculativeHost(fake.executor, {
      clock: clock.now,
      pipeline: new SpeculativePipeline(warmHistory(), { minProbability: 0 }),
      verifyBeforeServe: true,
      serveMode: "async-serve",
      onAsyncVerification: onAsync,
    });

    host.beginTurn(read("a"));
    const spec = fake.pendingFor(read("b"))!;
    spec.resolve({ result: "contents of b", elapsedMs: 1800 });
    await flushMicrotasks();

    // Program the out-of-band shadow run's output up front so the fire-and-forget
    // verification (launched DURING resolve) has a canned result to compare.
    fake.programCall(read("b"), { result: "contents of b", elapsedMs: 1750 });

    // Resolve must NOT block on any shadow run: the clock does not advance.
    const before = clock.now();
    const out = await host.resolve(read("b"));
    expect(clock.now() - before).toBe(0); // served immediately, zero on-path wait

    expect(out.source).toBe("speculative-hit-async");
    expect(out.result).toBe("contents of b");
    // The FULL speculation elapsed is genuinely saved — the agent waited nothing.
    expect(out.latencySavedMs).toBe(1800);
    expect(out.speculativeElapsedMs).toBe(1800);
    expect(out.verification).toBeNull(); // resolved out of band
    expect(out.realElapsedMs).toBeNull();

    const ledger = host.getLatencyLedger();
    expect(ledger.netLatencySavedMs).toBe(1800);
    expect(ledger.latencySavingHits).toBe(1);
    expect(ledger.verifiedNoSaveHits).toBe(0);

    // The out-of-band verification settles AFTER serving and matches.
    await host.drain();
    await flushMicrotasks();
    expect(onAsync).toHaveBeenCalledTimes(1);
    expect(onAsync.mock.calls[0]![0].verification.authoritative).toBe(true);
    expect(host.getLatencyLedger().asyncMismatches).toBe(0);
  });

  it("records an async mismatch when the out-of-band shadow bytes differ (served bytes were stale)", async () => {
    const onAsync = vi.fn();
    const fake = new FakeExecutor();
    const clock = new ManualClock(1000);
    const host = new SpeculativeHost(fake.executor, {
      clock: clock.now,
      pipeline: new SpeculativePipeline(warmHistory(), { minProbability: 0 }),
      serveMode: "async-serve",
      onAsyncVerification: onAsync,
    });

    host.beginTurn(read("a"));
    const spec = fake.pendingFor(read("b"))!;
    spec.resolve({ result: "STALE bytes", elapsedMs: 1800 });
    await flushMicrotasks();

    // The out-of-band shadow returns the TRUE bytes; they differ → mismatch.
    fake.programCall(read("b"), { result: "FRESH bytes", elapsedMs: 1700 });

    const out = await host.resolve(read("b"));
    // The agent already received the (stale) speculative bytes — that is the
    // documented async-serve tradeoff. Latency was genuinely saved.
    expect(out.source).toBe("speculative-hit-async");
    expect(out.result).toBe("STALE bytes");
    expect(out.latencySavedMs).toBe(1800);

    await host.drain();
    await flushMicrotasks();
    expect(onAsync).toHaveBeenCalledTimes(1);
    expect(onAsync.mock.calls[0]![0].verification.authoritative).toBe(false);
    expect(host.getLatencyLedger().asyncMismatches).toBe(1);
  });
});

describe("SpeculativeHost — byte-equality verification rejects stale speculation", () => {
  it("a speculative result whose bytes differ from the shadow run is rejected; real wins", async () => {
    const { fake, host } = makeHost();

    const launched = host.beginTurn(read("a"));
    const spec = fake.pendingFor(read("b"))!;
    // The speculation produced STALE content (e.g. the worktree changed since).
    spec.resolve({ result: "STALE contents of b", elapsedMs: 1800 });
    await flushMicrotasks();

    // The fresh shadow run returns the TRUE current bytes — they differ.
    fake.programCall(read("b"), { result: "FRESH contents of b", elapsedMs: 1700 });

    const out = await host.resolve(read("b"));
    // Reconcile saw a completed match (a pipeline "hit") ...
    expect(out.reconcile.classification).toBe("hit");
    // ... but byte-equality verification REJECTED it, so we serve the real bytes.
    expect(out.verification?.authoritative).toBe(false);
    expect(out.source).toBe("real-execution");
    expect(out.result).toBe("FRESH contents of b");
    expect(out.latencySavedMs).toBe(0);
    void launched;
  });
});

describe("SpeculativeHost — end-to-end miss", () => {
  it("an unpredicted real call costs zero tokens; only wasted CPU is accounted", async () => {
    const { fake, host } = makeHost();

    const launched = host.beginTurn(read("a"));
    expect(launched.length).toBeGreaterThan(0);
    // Complete the speculation(s) so they count as genuine wasted CPU, not as
    // in-flight.
    for (const pend of [...fake.pending]) {
      pend.resolve({ result: "some bytes", elapsedMs: 1000 });
    }
    await flushMicrotasks();

    // Agent reads a totally different file. The real run must produce the result.
    fake.programCall(read("zzz-unexpected"), {
      result: "the real zzz bytes",
      elapsedMs: 900,
    });

    const out = await host.resolve(read("zzz-unexpected"));
    expect(out.source).toBe("real-execution");
    expect(out.result).toBe("the real zzz bytes");
    expect(out.reconcile.classification).toBe("miss");
    expect(out.latencySavedMs).toBe(0);
    expect(out.verification).toBeNull();

    const stats = host.getPipeline().getStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(1);
    // Every launched speculation is wasted CPU (it never matched).
    expect(stats.wastedSpeculations).toBe(launched.length);
  });
});

describe("SpeculativeHost — in-flight incomplete race", () => {
  it("real call arrives BEFORE the speculation finishes → in_flight_incomplete, real path serves", async () => {
    const { fake, host } = makeHost();

    const launched = host.beginTurn(read("a"));
    const target = launched.find((s) => s.key === speculationKey(read("b")));
    expect(target).toBeDefined();

    // The speculation for Read(b) is still pending — we deliberately do NOT
    // settle it. The real call lands first.
    const specPending = fake.lastPending();
    expect(specPending!.settled).toBe(false);

    fake.programCall(read("b"), { result: "contents of b", elapsedMs: 1700 });
    const out = await host.resolve(read("b"));

    // The prediction was correct but hadn't finished → not a hit, not wasted.
    expect(out.reconcile.classification).toBe("in_flight_incomplete");
    expect(out.source).toBe("real-execution");
    expect(out.result).toBe("contents of b");
    expect(out.latencySavedMs).toBe(0);

    const stats = host.getPipeline().getStats();
    expect(stats.inFlightIncomplete).toBe(1);
    expect(stats.hits).toBe(0);
    // The correct-but-unfinished speculation is NOT counted wasted.
    expect(stats.wastedSpeculations).toBe(launched.length - 1);
  });
});

describe("SpeculativeHost — a THROWING speculative executor never breaks/delays the real call", () => {
  it("swallows the throw and serves the real call correctly", async () => {
    const { fake, host } = makeHost();

    const launched = host.beginTurn(read("a"));
    expect(launched.length).toBeGreaterThan(0);

    // Make every in-flight speculation THROW.
    for (const pend of [...fake.pending]) {
      pend.reject(new Error("speculative executor blew up"));
    }
    await flushMicrotasks();

    // The report shows the failures; none of them rejected out of the host.
    const report = host.speculationReport();
    expect(report.failed).toBe(launched.length);
    expect(report.completed).toBe(0);

    // The real call still resolves correctly via the real executor.
    fake.programCall(read("b"), { result: "real contents of b", elapsedMs: 1600 });
    const out = await host.resolve(read("b"));
    expect(out.result).toBe("real contents of b");
    expect(out.source).toBe("real-execution");
    // A correct prediction that FAILED is in_flight_incomplete (never recorded).
    expect(out.reconcile.classification).toBe("in_flight_incomplete");
  });

  it("an UnhandledRejection is impossible: the host owns the speculation promise", async () => {
    // If the host leaked the rejected promise, vitest would surface an
    // unhandled rejection and fail. Resolving the turn and draining proves the
    // promise is fully owned and swallowed.
    const { fake, host } = makeHost();
    host.beginTurn(read("a"));
    for (const pend of [...fake.pending]) pend.reject("boom");
    await host.drain(); // settles cleanly despite the throw
    await flushMicrotasks();
    expect(host.speculationReport().failed).toBeGreaterThan(0);
  });
});

describe("SpeculativeHost — a HANGING speculative executor never delays the real call", () => {
  it("the real path proceeds without awaiting the hung speculation", async () => {
    const { fake, host } = makeHost();

    const launched = host.beginTurn(read("a"));
    expect(launched.length).toBeGreaterThan(0);

    // Never settle ANY speculation — they hang forever.
    expect(fake.lastPending()!.settled).toBe(false);

    // The real call must STILL resolve — proving `resolve` never awaits a
    // pending speculation. (If it did, this test would hang and time out.)
    fake.programCall(read("b"), { result: "real b bytes", elapsedMs: 1500 });
    const out = await host.resolve(read("b"));

    expect(out.source).toBe("real-execution");
    expect(out.result).toBe("real b bytes");
    expect(out.reconcile.classification).toBe("in_flight_incomplete");

    // The hung speculations are aborted on turn cleanup (best-effort signal).
    for (const pend of fake.pending) {
      if (pend.call.name === "Read" && pend.call.input.file_path === "b") {
        // the speculation for b (distinct handle from the shadow run)
        expect(pend.settled).toBe(false);
      }
    }
  });

  it("resolve does not await: it returns even while a speculation is structurally pending", async () => {
    const { fake, host } = makeHost();
    host.beginTurn(read("a"));
    const before = host.speculationReport();
    expect(before.pending).toBeGreaterThan(0);

    fake.programCall(read("b"), { result: "b", elapsedMs: 1 });
    // No flush, no settle of the speculation — straight to resolve.
    const out = await host.resolve(read("b"));
    expect(out.result).toBe("b");
  });
});

describe("SpeculativeHost — breaker-open stops speculation end to end", () => {
  it("an open circuit yields an empty batch and runs nothing speculatively", async () => {
    // Build a pipeline whose breaker is already tripped by feeding the budget a
    // run of wasted speculations over the min-sample threshold.
    const pipeline = new SpeculativePipeline([], {
      minProbability: 0,
      budget: { minSamples: 4, windowSize: 10, wastedRateThreshold: 0.5, cooldownMs: 60_000 },
    });
    const clock = new ManualClock(0);

    // Drive enough wasted speculations to trip the breaker, via real turns.
    const { fake, host } = (() => {
      const f = new FakeExecutor();
      const h = new SpeculativeHost(f.executor, { clock: clock.now, pipeline });
      return { fake: f, host: h };
    })();

    for (let i = 0; i < 6; i++) {
      const launched = host.beginTurn(null, [candidate(`file-${i}`, 0.9)]);
      // complete then miss (reconcile against an unrelated call) → wasted
      for (const pend of [...fake.pending]) {
        pend.resolve({ result: `bytes-${i}`, elapsedMs: 10 });
      }
      await flushMicrotasks();
      fake.programCall(read(`MISS-${i}`), { result: "x", elapsedMs: 5 }, true);
      await host.resolve(read(`MISS-${i}`));
      void launched;
      clock.advance(1);
    }

    expect(host.getPipeline().getBudget().isDisabled(clock.now())).toBe(true);

    // Now a new turn: the breaker is open, so NOTHING is speculated.
    const callsBefore = fake.calls.length;
    const launched = host.beginTurn(null, [candidate("would-be-spec", 0.99)]);
    expect(launched.length).toBe(0);
    await flushMicrotasks();
    // No new speculative executor invocations happened.
    expect(fake.calls.length).toBe(callsBefore);

    // The real call still works (runs the real executor directly).
    fake.programCall(read("would-be-spec"), { result: "real bytes", elapsedMs: 7 }, true);
    const out = await host.resolve(read("would-be-spec"));
    expect(out.source).toBe("real-execution");
    expect(out.result).toBe("real bytes");
  });
});

describe("SpeculativeHost — concurrency", () => {
  it("launches multiple speculations in parallel within one turn", async () => {
    const pipeline = new SpeculativePipeline([], {
      minProbability: 0,
      maxSpeculationsPerTurn: 3,
      budget: { maxConcurrent: 4 },
    });
    const { fake, host } = makeHost({ pipeline });

    const launched = host.beginTurn(null, [
      candidate("f1", 0.9),
      candidate("f2", 0.8),
      candidate("f3", 0.7),
    ]);
    expect(launched.length).toBe(3);

    // All three were dispatched to the executor concurrently (before any settle).
    expect(fake.pending.length).toBe(3);
    const report = host.speculationReport();
    expect(report.launched).toBe(3);
    expect(report.pending).toBe(3);

    // Settle them out of order — completion order is independent of launch order.
    fake.pending[2]!.resolve({ result: "f3-bytes", elapsedMs: 30 });
    fake.pending[0]!.resolve({ result: "f1-bytes", elapsedMs: 10 });
    await flushMicrotasks();
    expect(host.speculationReport().completed).toBe(2);
    expect(host.speculationReport().pending).toBe(1);

    // Real call hits f1 (completed). Default sync-verify: a fresh shadow run is
    // executed on-path and byte-matches. The agent waited that shadow run, so
    // NET = max(0, gross 10 − shadow 9) = 1; gross potential is 10.
    fake.programCall(read("f1"), { result: "f1-bytes", elapsedMs: 9 });
    const out = await host.resolve(read("f1"));
    expect(out.source).toBe("verified-no-latency-saved");
    expect(out.result).toBe("f1-bytes");
    expect(out.latencySavedMs).toBe(1);
    expect(out.speculativeElapsedMs).toBe(10);
  });
});

describe("SpeculativeHost — eligibility gate is never bypassed", () => {
  it("never speculates a write/edit even when the caller hints one", async () => {
    const { fake, host } = makeHost({ history: [] });
    const launched = host.beginTurn(null, [
      { call: edit("x"), key: "", probability: 0.99, source: "caller-candidate" },
    ]);
    expect(launched.length).toBe(0);
    expect(fake.pending.length).toBe(0);
  });

  it("an ineligible real call is classified ineligible, not miss", async () => {
    const { fake, host } = makeHost();
    host.beginTurn(read("a"));
    for (const pend of [...fake.pending]) pend.resolve({ result: "x", elapsedMs: 1 });
    await flushMicrotasks();
    fake.programCall(edit("a"), { result: "edited", elapsedMs: 2 });
    const out = await host.resolve(edit("a"));
    expect(out.reconcile.classification).toBe("ineligible");
    expect(out.source).toBe("real-execution");
  });
});

describe("SpeculativeHost — verifyBeforeServe=false (off-path)", () => {
  it("serves the speculative result without a shadow run when verification is disabled", async () => {
    const { fake, host } = makeHost({ verifyBeforeServe: false });
    host.beginTurn(read("a"));
    const spec = fake.pendingFor(read("b"))!;
    spec.resolve({ result: "b-bytes", elapsedMs: 1200 });
    await flushMicrotasks();

    const callsBefore = fake.calls.length;
    const out = await host.resolve(read("b"));
    expect(out.source).toBe("speculative-hit-unverified");
    expect(out.result).toBe("b-bytes");
    expect(out.verification).toBeNull();
    // Served immediately with no shadow run → the full elapsed is genuinely saved.
    expect(out.latencySavedMs).toBe(1200);
    expect(out.speculativeElapsedMs).toBe(1200);
    // No out-of-band shadow run happened.
    expect(fake.calls.length).toBe(callsBefore);
  });
});

describe("SpeculativeHost — abort on turn replacement", () => {
  it("a new turn aborts the prior turn's still-pending speculations", async () => {
    const { fake, host } = makeHost();
    host.beginTurn(read("a"));
    const stale = fake.lastPending()!;
    expect(stale.settled).toBe(false);
    expect(stale.aborted).toBe(false);

    // Begin a new turn without resolving the prior one.
    host.beginTurn(read("a"));
    expect(stale.aborted).toBe(true);
  });
});

describe("SpeculativeHost — observe feeds the predictor", () => {
  it("teaches the transition model so a cold start warms up", async () => {
    const { fake, host } = makeHost({ history: [] });
    // Cold: nothing predicted.
    expect(host.beginTurn(read("p")).length).toBe(0);
    await flushMicrotasks();

    // Teach p → q a few times.
    for (let i = 0; i < 3; i++) {
      host.observe(read("p"), read("q"));
    }
    const launched = host.beginTurn(read("p"));
    expect(launched.some((s) => s.key === speculationKey(read("q")))).toBe(true);
    void fake;
  });
});
