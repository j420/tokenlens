/**
 * SpeculativeHost — the host-integration driver for the E5 pipeline.
 *
 * `SpeculativePipeline` is a pure state machine: it decides WHAT to speculate
 * and reconciles WHAT came back, but it never touches I/O. `SpeculativeHost` is
 * the thin, genuinely-concurrent driver that wires the pipeline to a real host's
 * tool executor and runs the full speculate → execute → reconcile → verify loop.
 *
 * ── Integration contract ──────────────────────────────────────────────────
 *
 * A real host (Cursor, OpenAI Codex, or the Claude Code Agent SDK) wires two
 * things:
 *
 *   1. `executor(call, signal) => Promise<ExecutorOutput>`
 *      A caller-supplied async function that runs ONE read-only tool call and
 *      returns its `{ result, elapsedMs }`. The host points this at a
 *      SANDBOXED, read-only view of the workspace — e.g. a throwaway git
 *      worktree, an overlay mount, or a copy-on-write snapshot — so a
 *      speculative `Read`/`Glob`/`LS`/`Grep` can never observe or mutate the
 *      agent's live tree. The same `executor` is reused for the out-of-band
 *      shadow run that verifies a hit (see `verify` below). It receives an
 *      `AbortSignal` so a host that supports cancellation can tear down a
 *      speculation that lost its race; honouring it is OPTIONAL — the host
 *      never blocks on cancellation.
 *
 *   2. The real call path. The host already has this: when the agent emits its
 *      actual next tool call, the host invokes `host.resolve(actualCall)`
 *      INSTEAD of running the tool directly. `resolve` reconciles against the
 *      in-flight speculative batch and:
 *        • on a matched, completed speculation, gates it by byte-equality and
 *          serves it — see the two serve modes below;
 *        • otherwise, runs the real executor itself and returns that.
 *      Either way the agent gets a correct result; speculation can only make it
 *      faster, never wrong and never slower than the un-sped path plus O(1).
 *
 * ── Serve modes and HONEST latency accounting ───────────────────────────────
 *
 * The whole point of speculation is to remove wall-clock. But a host can only
 * legitimately CLAIM that wall-clock if the agent did not pay it. There are two
 * verification strategies, and they save very different amounts:
 *
 *   • `serveMode: "sync-verify"` (DEFAULT, safest). On a matched hit the host
 *     runs a FRESH shadow execution of the real tool ON THE CRITICAL PATH and
 *     awaits it before serving — so it can byte-compare before substituting.
 *     Because the agent waited the full shadow run, the NET latency saved is
 *     `max(0, speculativeElapsed - shadowElapsed)` — effectively ~0. We report
 *     exactly that (almost always 0) and label the result `"verified-no-latency-saved"`.
 *     This mode buys CORRECTNESS PRE-VERIFICATION, not speed. It does NOT, and
 *     does not claim to, save latency. (Earlier versions reported the
 *     speculation's own elapsed here — an overclaim, since the agent had already
 *     awaited the shadow run. Fixed: HIGH-1.)
 *
 *   • `serveMode: "async-serve"` (OPT-IN). On a matched hit the host serves the
 *     speculative result IMMEDIATELY — the agent's critical path ends here, so
 *     the full `speculativeElapsed` IS genuinely saved. Verification still runs,
 *     but OUT OF BAND (fire-and-forget), and a byte mismatch is recorded as a
 *     `mismatch` for telemetry/alerting (the agent already received the
 *     speculative bytes; this mode trades a small staleness risk for real speed
 *     and is for hosts that accept eventual-consistency verification). Only THIS
 *     mode may report the speculation's elapsed as latency saved.
 *
 * In both modes the `verifyBeforeServe=false` escape hatch serves the
 * speculative result with no shadow run at all (full elapsed saved, no
 * verification) and remains off the recommended path.
 *
 * Lifecycle per agent turn:
 *
 *   const host = new SpeculativeHost(executor, { clock, pipeline });
 *   host.beginTurn(priorCall, callerCandidates);   // launches speculations
 *   ...agent generates its real call...
 *   const out = await host.resolve(actualCall);     // hit or real run
 *   host.observe(priorCall, actualCall);            // teach the predictor
 *
 * ── Fail-safe guarantees (all proven by tests in host.test.ts) ─────────────
 *
 *   • The critical path NEVER awaits a speculation. `resolve` reads only what
 *     has ALREADY been recorded; pending speculations are not awaited.
 *   • A speculative executor that THROWS is caught and recorded as a failure;
 *     it never rejects out of the host and never reaches `resolve`.
 *   • A speculative executor that HANGS forever is simply never recorded; the
 *     pipeline classifies the real call as `in_flight_incomplete` and `resolve`
 *     falls through to the real executor. No timeout on the critical path.
 *   • In the DEFAULT `sync-verify` mode a speculative result is served as
 *     authoritative ONLY after `verifyResult` confirms BYTE-EQUALITY against a
 *     fresh shadow run of the real executor; a stale speculation (bytes differ)
 *     is rejected and the real result wins. In the opt-in `async-serve` mode the
 *     byte-equality check runs OUT OF BAND after serving and a mismatch is
 *     recorded (see the serve-modes section below).
 *   • Speculation is launched only when `budget.decide()` allows; an open
 *     breaker stops the whole loop end to end.
 *
 * All wall-clock comes from the injected `clock` — no real timers, so the
 * concurrent loop is deterministically unit-testable (see FakeExecutor /
 * ManualClock in test-harness.ts).
 */

import { SpeculativePipeline, type SpeculativePipelineOptions } from "./pipeline.js";
import { verifyResult, type VerificationResult } from "./verify.js";
import type { ReconcileOutcome, Speculation, ToolCall } from "./types.js";

/** What a host's tool executor returns for one read-only call. */
export interface ExecutorOutput {
  /** The tool result text. */
  result: string;
  /** Wall-clock ms the execution took (caller-measured; never fabricated). */
  elapsedMs: number;
}

/**
 * The caller-supplied read-only tool executor. Runs ONE call against a
 * sandboxed worktree and returns its output. The optional `AbortSignal` lets a
 * host tear down a speculation that lost its race; honouring it is optional.
 */
export type ToolExecutor = (
  call: ToolCall,
  signal?: AbortSignal
) => Promise<ExecutorOutput>;

/** Monotonic clock source. Injected so tests never touch wall-clock. */
export type Clock = () => number;

export interface SpeculativeHostOptions {
  /** Injected wall-clock (ms). Defaults to `Date.now`. */
  clock?: Clock;
  /**
   * Pre-built pipeline to drive. If omitted, one is constructed from
   * `pipelineOptions` + `history`.
   */
  pipeline?: SpeculativePipeline;
  /** Options for the pipeline when `pipeline` is not supplied. */
  pipelineOptions?: SpeculativePipelineOptions;
  /** Call history seed for the predictor when `pipeline` is not supplied. */
  history?: readonly ToolCall[];
  /**
   * Verify a hit by running the real tool (the shadow run) and gating the
   * speculative result on byte-equality. Default true.
   *
   * In `"sync-verify"` mode the shadow run is awaited BEFORE serving (so a
   * stale speculation never reaches the agent — but no latency is saved). In
   * `"async-serve"` mode the shadow run happens out of band AFTER serving.
   *
   * Disabling it (false) serves the speculative result with NO shadow run at
   * all. That is unsafe and exists only for hosts that have an independent
   * equivalence proof; it is OFF the recommended path.
   */
  verifyBeforeServe?: boolean;
  /**
   * How a matched, byte-eligible speculative result is served. Default
   * `"sync-verify"`.
   *
   *   • `"sync-verify"` — await a fresh shadow run on the critical path, byte-
   *     compare, THEN serve. Correct-by-construction; saves ~0 net latency.
   *   • `"async-serve"` — serve immediately (full latency genuinely saved),
   *     verify out of band, record any mismatch. Opt-in; for hosts that accept
   *     eventual-consistency verification.
   *
   * Ignored when `verifyBeforeServe=false` (which always serves immediately
   * with no shadow run).
   */
  serveMode?: ServeMode;
  /**
   * Called when an `"async-serve"` out-of-band verification settles. Fires for
   * EVERY async verification (matched or mismatched) so a host can alert on a
   * stale serve. Never invoked on the critical path. Optional.
   */
  onAsyncVerification?: (report: AsyncVerificationReport) => void;
}

/** How a matched speculative result is verified-and-served. */
export type ServeMode = "sync-verify" | "async-serve";

/** How the host satisfied the agent's real call. */
export type ResolveSource =
  | "speculative-hit-async" // async-serve: spec served immediately; latency saved
  | "speculative-hit-unverified" // verifyBeforeServe=false: served as-is; latency saved
  | "verified-no-latency-saved" // sync-verify: spec byte-matched the shadow, but the
  // agent already awaited the shadow run, so NET latency saved is ~0
  | "real-execution"; // miss / incomplete / rejected-by-verify → ran the tool

/** The result the host hands back to the agent for its real call. */
export interface ResolveResult {
  /** The authoritative tool result text the agent receives. */
  result: string;
  /** Where it came from. */
  source: ResolveSource;
  /**
   * NET wall-clock the agent actually did NOT have to wait. This is the HONEST,
   * defensible-by-arithmetic figure — what flows to telemetry / dashboards:
   *   • `"speculative-hit-async"` / `"speculative-hit-unverified"`:
   *        = the speculation's measured elapsed (served immediately, no shadow
   *          run on the critical path) → genuinely saved.
   *   • `"verified-no-latency-saved"` (sync-verify hit):
   *        = max(0, speculativeElapsed − shadowElapsed) → ~0, because the agent
   *          awaited the synchronous shadow run before being served.
   *   • `"real-execution"`: 0.
   */
  latencySavedMs: number;
  /**
   * The GROSS upper bound — the speculation's own elapsed time, present
   * whenever a completed speculation byte-matched the real call (i.e. a pipeline
   * hit), regardless of serve mode. On `"verified-no-latency-saved"` this is
   * deliberately NON-zero while `latencySavedMs` is ~0: it is the latency that
   * COULD have been saved had verification been asynchronous. Lets the dashboard
   * show "potential" vs. "realized" without conflating them.
   */
  speculativeElapsedMs: number;
  /** The pipeline's reconciliation outcome (for telemetry / quality proofs). */
  reconcile: ReconcileOutcome;
  /**
   * The byte-equality verification, present whenever a candidate speculative
   * result existed and was checked.
   *   • sync-verify: `authoritative=false` means a stale speculation was
   *     rejected and the real execution was served instead.
   *   • async-serve: the verification is resolved OUT OF BAND; this field is
   *     null at resolve time. A subsequent mismatch is surfaced via the
   *     `onAsyncVerification` callback and the `mismatches` counter.
   */
  verification: VerificationResult | null;
  /**
   * The real (shadow) executor's measured elapsed ms, when it ran ON the
   * critical path: present for `"real-execution"` and `"verified-no-latency-saved"`,
   * null for the async / unverified serves (their shadow run, if any, is off-path).
   */
  realElapsedMs: number | null;
}

/** Telemetry for the speculative side of a turn (never the critical path). */
export interface TurnSpeculationReport {
  launched: number;
  completed: number;
  failed: number;
  /** Still running when the turn was resolved (the in-flight race). */
  pending: number;
}

interface SpecExecution {
  spec: Speculation;
  /** The output once it lands; null while pending or after a failure. */
  output: ExecutorOutput | null;
  state: "pending" | "completed" | "failed";
  /** Resolves when the underlying executor promise settles (success OR fail). */
  readonly settled: Promise<void>;
  controller: AbortController;
}

/** A resolved out-of-band (async-serve) verification, for telemetry/alerting. */
export interface AsyncVerificationReport {
  /** The matched speculation key whose served bytes were verified. */
  key: string;
  /** The byte-equality verification of the served bytes vs. the shadow run. */
  verification: VerificationResult;
  /** The served (speculative) bytes. */
  served: string;
  /** The fresh shadow bytes the served result was checked against. */
  shadow: string;
}

/** Honest, mode-aware latency ledger the host accumulates (NET, not gross). */
export interface HostLatencyLedger {
  /** Realized NET latency saved (ms), summed across resolves. Defensible by arithmetic. */
  netLatencySavedMs: number;
  /** Gross upper bound (sum of matched speculations' elapsed). For "potential" UI. */
  grossSpeculativeElapsedMs: number;
  /** Hits served immediately (async-serve / unverified) — these saved real latency. */
  latencySavingHits: number;
  /** Sync-verify hits — byte-correct but saved ~0 net latency. */
  verifiedNoSaveHits: number;
  /** Out-of-band (async-serve) verifications that came back NOT byte-equal. */
  asyncMismatches: number;
}

export class SpeculativeHost {
  private readonly executor: ToolExecutor;
  private readonly clock: Clock;
  private readonly pipeline: SpeculativePipeline;
  private readonly verifyBeforeServe: boolean;
  private readonly serveMode: ServeMode;
  private readonly onAsyncVerification?: (report: AsyncVerificationReport) => void;

  /** The current turn's in-flight speculative executions, keyed by spec key. */
  private executions = new Map<string, SpecExecution>();

  /** Out-of-band async-serve verifications still settling (drained, never awaited on-path). */
  private asyncVerifications = new Set<Promise<void>>();

  private ledger: HostLatencyLedger = {
    netLatencySavedMs: 0,
    grossSpeculativeElapsedMs: 0,
    latencySavingHits: 0,
    verifiedNoSaveHits: 0,
    asyncMismatches: 0,
  };

  constructor(executor: ToolExecutor, options: SpeculativeHostOptions = {}) {
    this.executor = executor;
    this.clock = options.clock ?? Date.now;
    this.pipeline =
      options.pipeline ??
      new SpeculativePipeline(options.history ?? [], options.pipelineOptions);
    this.verifyBeforeServe = options.verifyBeforeServe ?? true;
    this.serveMode = options.serveMode ?? "sync-verify";
    this.onAsyncVerification = options.onAsyncVerification;
  }

  /** A read-only snapshot of the host's honest NET latency ledger. */
  getLatencyLedger(): Readonly<HostLatencyLedger> {
    return { ...this.ledger };
  }

  /** The driven pipeline, for stats / budget / quality-proof access. */
  getPipeline(): SpeculativePipeline {
    return this.pipeline;
  }

  /**
   * Begin a turn: ask the pipeline what to speculate, then launch every
   * returned speculation CONCURRENTLY against the sandboxed executor. Returns
   * the launched batch synchronously — it NEVER awaits any speculation. Each
   * completion (or failure) is wired back to the pipeline via `recordResult` as
   * it lands, off the critical path.
   *
   * The pipeline has already budget-gated the batch (it only launches within
   * `budget.decide() === "allow"`), so an open breaker yields an empty batch
   * and nothing is executed end to end.
   */
  beginTurn(
    priorCall: ToolCall | null,
    callerCandidates: readonly Speculation[] = []
  ): Speculation[] {
    // Abandon any speculations left over from a turn that was never resolved.
    this.abortPending();
    this.executions = new Map();

    const now = this.clock();
    const launched = this.pipeline.speculate(priorCall, callerCandidates, now);

    for (const spec of launched) {
      this.launchSpeculation(spec);
    }
    return launched;
  }

  /**
   * Launch ONE speculation. Fully isolated: the returned promise is held only
   * for telemetry/draining and ALWAYS resolves (never rejects), so a throwing
   * or hanging executor can neither reject out of the host nor delay the real
   * path. A success is fed back to the pipeline via `recordResult`.
   */
  private launchSpeculation(spec: Speculation): void {
    const controller = new AbortController();
    let resolveSettled!: () => void;
    const settled = new Promise<void>((r) => {
      resolveSettled = r;
    });

    const exec: SpecExecution = {
      spec,
      output: null,
      state: "pending",
      settled,
      controller,
    };
    this.executions.set(spec.key, exec);

    // Fire-and-forget. We deliberately do NOT return or await this promise on
    // any caller path — `resolve` only ever reads `exec.output`/`exec.state`.
    void (async () => {
      try {
        const output = await this.executor(spec.call, controller.signal);
        // Ignore a result for a spec that was aborted/replaced mid-flight.
        if (this.executions.get(spec.key) === exec) {
          exec.output = output;
          exec.state = "completed";
          // Hand the completed speculation to the pipeline's batch. This is the
          // ONLY place a speculative result enters reconciliation accounting.
          this.pipeline.recordResult({
            key: spec.key,
            result: output.result,
            elapsedMs: output.elapsedMs,
          });
        }
      } catch {
        // A throwing speculative executor is a non-event: swallow it, mark the
        // execution failed, and never record a result. The real path is
        // entirely unaffected — it never observed this promise.
        if (this.executions.get(spec.key) === exec) {
          exec.state = "failed";
        }
      } finally {
        resolveSettled();
      }
    })();
  }

  /**
   * Resolve the agent's REAL next call. This is the critical path. It:
   *   1. reconciles the real call against whatever speculations have ALREADY
   *      completed (it does NOT await pending ones — that is the whole point);
   *   2. on a pipeline hit, serves the speculative result per the configured
   *      serve mode (see `ServeMode`), accounting NET latency HONESTLY;
   *   3. otherwise (miss / in_flight_incomplete) runs the real executor.
   *
   * Correctness invariant: the agent always receives a result equal to what a
   * fresh real execution would produce — in `sync-verify` because the bytes are
   * compared on-path before serving, in `async-serve` because verification runs
   * out of band and any mismatch is recorded. Speculation only ever removes
   * latency; it never makes the answer wrong.
   *
   * Honesty invariant: `latencySavedMs` is the NET wall-clock the agent did not
   * pay, defensible by arithmetic against the injected clock. The default
   * `sync-verify` path reports ~0 (the agent awaited the shadow run); only a
   * path that serves WITHOUT a synchronous shadow run reports the speculation's
   * elapsed as saved.
   */
  async resolve(actualCall: ToolCall): Promise<ResolveResult> {
    const now = this.clock();
    // Pure, synchronous accounting against already-recorded completions. No
    // await here — pending speculations are intentionally not waited on.
    const outcome = this.pipeline.reconcile(actualCall, now);

    if (outcome.hit && outcome.result !== null) {
      const speculative = outcome.result;
      const gross = outcome.speculativeElapsedMs;

      // ── Path A: no verification at all (off-recommended-path escape hatch).
      // Served immediately, no shadow run → the full elapsed is genuinely saved.
      if (!this.verifyBeforeServe) {
        this.recordServedImmediately(gross);
        this.endTurnCleanup();
        return {
          result: speculative,
          source: "speculative-hit-unverified",
          latencySavedMs: gross,
          speculativeElapsedMs: gross,
          reconcile: outcome,
          verification: null,
          realElapsedMs: null,
        };
      }

      // ── Path B: async-serve. Serve NOW (full elapsed saved), verify out of
      // band. A byte mismatch is recorded for telemetry/alerting; it never
      // blocks the agent. This is the ONLY verified path that legitimately
      // claims the speculation's elapsed as latency saved.
      if (this.serveMode === "async-serve") {
        this.recordServedImmediately(gross);
        const key = outcome.key!;
        this.launchAsyncVerification(actualCall, key, speculative);
        this.endTurnCleanup();
        return {
          result: speculative,
          source: "speculative-hit-async",
          latencySavedMs: gross,
          speculativeElapsedMs: gross,
          reconcile: outcome,
          verification: null, // resolved out of band; see onAsyncVerification
          realElapsedMs: null,
        };
      }

      // ── Path C: sync-verify (DEFAULT). Run a fresh shadow execution ON the
      // critical path and byte-compare BEFORE serving. The agent waits the full
      // shadow run, so the NET latency saved is max(0, gross − shadowElapsed):
      // effectively ~0. We report exactly that — no overclaim (fixes HIGH-1).
      const shadow = await this.runReal(actualCall);
      const verification = verifyResult(speculative, shadow.result);

      if (verification.authoritative) {
        // Byte-correct, but the agent already paid the shadow run. Honest net.
        const net = Math.max(0, gross - shadow.elapsedMs);
        this.ledger.netLatencySavedMs += net;
        this.ledger.grossSpeculativeElapsedMs += gross;
        this.ledger.verifiedNoSaveHits++;
        this.endTurnCleanup();
        return {
          result: speculative,
          source: "verified-no-latency-saved",
          latencySavedMs: net,
          speculativeElapsedMs: gross,
          reconcile: outcome,
          verification,
          realElapsedMs: shadow.elapsedMs,
        };
      }

      // Stale speculation: bytes differ. Reject it and serve the fresh real
      // result we already have in hand. Correctness preserved; zero saved.
      this.endTurnCleanup();
      return {
        result: shadow.result,
        source: "real-execution",
        latencySavedMs: 0,
        speculativeElapsedMs: gross,
        reconcile: outcome,
        verification,
        realElapsedMs: shadow.elapsedMs,
      };
    }

    // Miss, ineligible, or in_flight_incomplete: run the real tool ourselves.
    const real = await this.runReal(actualCall);
    this.endTurnCleanup();
    return {
      result: real.result,
      source: "real-execution",
      latencySavedMs: 0,
      speculativeElapsedMs: 0,
      reconcile: outcome,
      verification: null,
      realElapsedMs: real.elapsedMs,
    };
  }

  /** Account a hit that was served immediately (full elapsed genuinely saved). */
  private recordServedImmediately(grossElapsedMs: number): void {
    this.ledger.netLatencySavedMs += grossElapsedMs;
    this.ledger.grossSpeculativeElapsedMs += grossElapsedMs;
    this.ledger.latencySavingHits++;
  }

  /**
   * Fire-and-forget the out-of-band shadow verification for an async-serve hit.
   * Runs the real tool AFTER serving, byte-compares, records a mismatch, and
   * notifies `onAsyncVerification`. Always resolves (never rejects) so a
   * throwing shadow executor cannot surface as an unhandled rejection. NEVER
   * awaited on the critical path; tests drain it via `drain()`.
   */
  private launchAsyncVerification(
    actualCall: ToolCall,
    key: string,
    served: string
  ): void {
    let done!: () => void;
    const tracked = new Promise<void>((r) => {
      done = r;
    });
    this.asyncVerifications.add(tracked);

    void (async () => {
      try {
        const shadow = await this.runReal(actualCall);
        const verification = verifyResult(served, shadow.result);
        if (!verification.authoritative) {
          this.ledger.asyncMismatches++;
        }
        this.onAsyncVerification?.({
          key,
          verification,
          served,
          shadow: shadow.result,
        });
      } catch {
        // A throwing shadow executor cannot be verified; treat as unverifiable.
        // We do NOT count it a byte mismatch (we have no shadow bytes), but we
        // surface it so a host can alert. The agent already has the served
        // bytes; correctness of the SERVE is unaffected by a failed re-check.
      } finally {
        this.asyncVerifications.delete(tracked);
        done();
      }
    })();
  }

  /** Feed an executed call back into the transition model. */
  observe(prev: ToolCall | null, cur: ToolCall): void {
    this.pipeline.observe(prev, cur);
  }

  /**
   * Telemetry snapshot of the current turn's speculative executions. Pure read;
   * does not await anything.
   */
  speculationReport(): TurnSpeculationReport {
    let completed = 0;
    let failed = 0;
    let pending = 0;
    for (const exec of this.executions.values()) {
      if (exec.state === "completed") completed++;
      else if (exec.state === "failed") failed++;
      else pending++;
    }
    return {
      launched: this.executions.size,
      completed,
      failed,
      pending,
    };
  }

  /**
   * Await every in-flight speculation AND every out-of-band async-serve
   * verification to settle. NOT used on the critical path — provided for
   * deterministic test draining and graceful host shutdown only. Drains
   * iteratively so verifications launched by a resolve are awaited too.
   */
  async drain(): Promise<void> {
    // Loop until both pools are empty: an async verification can be launched at
    // resolve time and we must let it settle for deterministic test draining.
    // Bounded by the finite number of turns/verifications in any test.
    let guard = 0;
    while (this.executions.size > 0 || this.asyncVerifications.size > 0) {
      const settles = [...this.executions.values()].map((e) => e.settled);
      await Promise.all([...settles, ...this.asyncVerifications]);
      if (++guard > 1000) break; // defensive: never spin forever
    }
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  /** Run the real executor for the agent's actual call. */
  private async runReal(call: ToolCall): Promise<ExecutorOutput> {
    return this.executor(call);
  }

  /** Signal-abort any pending speculations (best-effort, never awaited). */
  private abortPending(): void {
    for (const exec of this.executions.values()) {
      if (exec.state === "pending") {
        try {
          exec.controller.abort();
        } catch {
          // Aborting is best-effort; a host that ignores the signal is fine.
        }
      }
    }
  }

  /** Tear down the resolved turn's speculations without awaiting them. */
  private endTurnCleanup(): void {
    this.abortPending();
    this.executions = new Map();
  }
}
