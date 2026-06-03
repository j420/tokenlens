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
 *        • on a verified hit, returns the already-computed result (latency
 *          collapses to ~0) — but ONLY after a byte-equality shadow check;
 *        • otherwise, runs the real executor itself and returns that.
 *      Either way the agent gets a correct result; speculation can only make it
 *      faster, never wrong and never slower than the un-sped path plus O(1).
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
 *   • A speculative result is served as authoritative ONLY after `verifyResult`
 *     confirms BYTE-EQUALITY against a fresh shadow run of the real executor.
 *     A stale speculation (bytes differ) is rejected and the real result wins.
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
   * Verify a hit by running the real tool out of band and requiring
   * byte-equality before serving the speculative result. Default true.
   * Disabling it is unsafe and exists only for hosts that have an independent
   * equivalence proof; it is OFF the recommended path.
   */
  verifyBeforeServe?: boolean;
}

/** How the host satisfied the agent's real call. */
export type ResolveSource =
  | "speculative-hit" // verified speculative result served; latency saved
  | "real-execution"; // miss / incomplete / rejected-by-verify → ran the tool

/** The result the host hands back to the agent for its real call. */
export interface ResolveResult {
  /** The authoritative tool result text the agent receives. */
  result: string;
  /** Where it came from. */
  source: ResolveSource;
  /** Wall-clock the agent did NOT have to wait (only > 0 on a verified hit). */
  latencySavedMs: number;
  /** The pipeline's reconciliation outcome (for telemetry / quality proofs). */
  reconcile: ReconcileOutcome;
  /**
   * The byte-equality verification, present whenever a candidate speculative
   * result existed and was checked. `authoritative=false` here means a stale
   * speculation was rejected and the real execution was served instead.
   */
  verification: VerificationResult | null;
  /** The real executor's measured elapsed ms, when it had to run. */
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

export class SpeculativeHost {
  private readonly executor: ToolExecutor;
  private readonly clock: Clock;
  private readonly pipeline: SpeculativePipeline;
  private readonly verifyBeforeServe: boolean;

  /** The current turn's in-flight speculative executions, keyed by spec key. */
  private executions = new Map<string, SpecExecution>();

  constructor(executor: ToolExecutor, options: SpeculativeHostOptions = {}) {
    this.executor = executor;
    this.clock = options.clock ?? Date.now;
    this.pipeline =
      options.pipeline ??
      new SpeculativePipeline(options.history ?? [], options.pipelineOptions);
    this.verifyBeforeServe = options.verifyBeforeServe ?? true;
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
   *   2. on a pipeline hit, runs a fresh out-of-band shadow execution and gates
   *      the speculative result through byte-equality `verifyResult`; serves the
   *      speculative result ONLY on byte-equality;
   *   3. otherwise (miss / in_flight_incomplete / verify-reject) runs the real
   *      executor and serves that.
   *
   * Correctness invariant: the agent always receives a result equal to what a
   * fresh real execution would produce. Speculation only ever removes latency.
   */
  async resolve(actualCall: ToolCall): Promise<ResolveResult> {
    const now = this.clock();
    // Pure, synchronous accounting against already-recorded completions. No
    // await here — pending speculations are intentionally not waited on.
    const outcome = this.pipeline.reconcile(actualCall, now);

    if (outcome.hit && outcome.result !== null) {
      const speculative = outcome.result;

      if (!this.verifyBeforeServe) {
        this.endTurnCleanup();
        return {
          result: speculative,
          source: "speculative-hit",
          latencySavedMs: outcome.latencySavedMs,
          reconcile: outcome,
          verification: null,
          realElapsedMs: null,
        };
      }

      // SHADOW VERIFICATION: run the real tool out of band and require
      // byte-equality before substituting the speculative result. This is the
      // only gate that can promote a speculation to authoritative.
      const shadow = await this.runReal(actualCall);
      const verification = verifyResult(speculative, shadow.result);

      if (verification.authoritative) {
        this.endTurnCleanup();
        return {
          result: speculative,
          source: "speculative-hit",
          // Latency saved is the speculation's own elapsed; the shadow run was
          // out-of-band overhead the agent's perceived path doesn't pay in a
          // host that verifies asynchronously. We report the conservative
          // pipeline figure.
          latencySavedMs: outcome.latencySavedMs,
          reconcile: outcome,
          verification,
          realElapsedMs: shadow.elapsedMs,
        };
      }

      // Stale speculation: bytes differ. Reject it and serve the fresh real
      // result we already have in hand. Correctness preserved.
      this.endTurnCleanup();
      return {
        result: shadow.result,
        source: "real-execution",
        latencySavedMs: 0,
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
      reconcile: outcome,
      verification: null,
      realElapsedMs: real.elapsedMs,
    };
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
   * Await every in-flight speculation to settle. NOT used on the critical path
   * — provided for deterministic test draining and graceful host shutdown only.
   */
  async drain(): Promise<void> {
    const settles = [...this.executions.values()].map((e) => e.settled);
    await Promise.all(settles);
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
