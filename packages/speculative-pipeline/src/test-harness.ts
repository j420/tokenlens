/**
 * Deterministic test harness for the SpeculativeHost concurrent loop.
 *
 * The host runs a genuinely concurrent speculate → execute → reconcile → verify
 * loop. To unit-test that loop without real I/O or wall-clock flakiness we need
 * two injectables whose behaviour the test fully controls:
 *
 *   • ManualClock     — a monotonic clock the test advances by hand. The host
 *                       reads every wall-clock value through it, so there are no
 *                       real timers anywhere on the path under test.
 *
 *   • FakeExecutor    — a `ToolExecutor` whose every invocation returns a promise
 *                       that does NOT settle until the test explicitly releases
 *                       it. This is what makes the concurrent race deterministic:
 *                       the test decides the exact interleaving of speculative
 *                       completions vs. the agent's real call, with no reliance
 *                       on the event-loop's timing.
 *
 * The FakeExecutor is a FAITHFUL fake, not a stub: it is a real async function
 * the host fires-and-forgets exactly as it would a sandboxed-worktree executor,
 * it honours the AbortSignal it is handed, and it records every call it received
 * so a test can assert what was (and was not) speculated. A real host swaps it
 * for an executor that runs the tool against a throwaway git worktree / overlay;
 * the host code under test is identical either way.
 *
 * This harness is shipped in `src/` and exported from the package so downstream
 * integrators can use it to test their own executor wiring. It is plainly a
 * fake — it never touches the filesystem and never fabricates a result the test
 * did not supply.
 */

import type { ExecutorOutput, ToolExecutor } from "./host.js";
import type { ToolCall } from "./types.js";

/** A monotonic clock the test advances explicitly. No real time involved. */
export class ManualClock {
  private t: number;

  constructor(start = 0) {
    this.t = start;
  }

  /** The injectable `Clock` — pass `clock.now` to the host. */
  now = (): number => this.t;

  /** Advance the clock by `ms` and return the new value. */
  advance(ms: number): number {
    this.t += ms;
    return this.t;
  }

  /** Jump the clock to an absolute value (must not go backwards). */
  set(value: number): void {
    if (value < this.t) {
      throw new Error("ManualClock: time must not go backwards");
    }
    this.t = value;
  }
}

/** A handle to one in-flight fake execution the test can settle by hand. */
export interface PendingExecution {
  /** The call the host asked the executor to run. */
  readonly call: ToolCall;
  /** The abort signal the host handed in (null on the out-of-band real run). */
  readonly signal: AbortSignal | null;
  /** Resolve this execution with the given output. Idempotent no-op if settled. */
  resolve(output: ExecutorOutput): void;
  /** Reject this execution with the given error. Idempotent no-op if settled. */
  reject(error: unknown): void;
  /** Has this execution settled (resolved or rejected) yet? */
  readonly settled: boolean;
  /** Was this execution aborted via its signal? */
  readonly aborted: boolean;
}

interface Deferred {
  call: ToolCall;
  signal: AbortSignal | null;
  resolve: (output: ExecutorOutput) => void;
  reject: (error: unknown) => void;
  settled: boolean;
  aborted: boolean;
}

/**
 * A controllable `ToolExecutor`. By default every call becomes a `PendingExecution`
 * the test must settle by hand, giving total control over completion ordering.
 * A test may also program canned outputs by call-match for the runs whose timing
 * it does not care about (e.g. the verification shadow run).
 */
export class FakeExecutor {
  /** Every call the executor received, in order. */
  readonly calls: ToolCall[] = [];
  /** Pending handles for calls that are awaiting a manual settle, in order. */
  readonly pending: PendingExecution[] = [];

  /** Programmed canned outputs, matched by a predicate, consumed FIFO-by-match. */
  private programmed: Array<{
    match: (call: ToolCall) => boolean;
    output: ExecutorOutput | (() => ExecutorOutput);
    once: boolean;
    used: boolean;
  }> = [];

  /** The injectable executor — pass `fake.executor` to the host. */
  executor: ToolExecutor = (call, signal) => this.run(call, signal);

  /**
   * Program a canned, immediately-resolving output for calls matching `match`.
   * Used for runs whose timing the test does not need to sequence — most
   * importantly the out-of-band shadow verification run. Returns `this`.
   */
  program(
    match: (call: ToolCall) => boolean,
    output: ExecutorOutput | (() => ExecutorOutput),
    once = false
  ): this {
    this.programmed.push({ match, output, once, used: false });
    return this;
  }

  /** Convenience: program by exact tool name + JSON-equal input. */
  programCall(
    target: ToolCall,
    output: ExecutorOutput | (() => ExecutorOutput),
    once = false
  ): this {
    const key = JSON.stringify({ name: target.name, input: target.input });
    return this.program(
      (c) => JSON.stringify({ name: c.name, input: c.input }) === key,
      output,
      once
    );
  }

  /** The most recent still-unsettled pending handle, or undefined. */
  lastPending(): PendingExecution | undefined {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (!this.pending[i]!.settled) return this.pending[i];
    }
    return undefined;
  }

  /**
   * The first still-unsettled pending handle whose call equals `target` (by tool
   * name + JSON-equal input), or undefined. Lets a test address a specific
   * speculation when a turn launched several.
   */
  pendingFor(target: ToolCall): PendingExecution | undefined {
    const key = JSON.stringify({ name: target.name, input: target.input });
    return this.pending.find(
      (p) =>
        !p.settled &&
        JSON.stringify({ name: p.call.name, input: p.call.input }) === key
    );
  }

  private run(call: ToolCall, signal?: AbortSignal): Promise<ExecutorOutput> {
    this.calls.push(call);

    // Programmed canned output (immediate) wins, if one matches.
    const prog = this.programmed.find((p) => (!p.once || !p.used) && p.match(call));
    if (prog) {
      prog.used = true;
      const out = typeof prog.output === "function" ? prog.output() : prog.output;
      return Promise.resolve(out);
    }

    // Otherwise: a manually-controlled pending execution.
    let resolveFn!: (output: ExecutorOutput) => void;
    let rejectFn!: (error: unknown) => void;
    const promise = new Promise<ExecutorOutput>((res, rej) => {
      resolveFn = res;
      rejectFn = rej;
    });

    const deferred: Deferred = {
      call,
      signal: signal ?? null,
      resolve: resolveFn,
      reject: rejectFn,
      settled: false,
      aborted: false,
    };

    if (signal) {
      if (signal.aborted) deferred.aborted = true;
      else signal.addEventListener("abort", () => {
        deferred.aborted = true;
      });
    }

    const handle: PendingExecution = {
      call,
      signal: signal ?? null,
      get settled() {
        return deferred.settled;
      },
      get aborted() {
        return deferred.aborted;
      },
      resolve(output: ExecutorOutput) {
        if (deferred.settled) return;
        deferred.settled = true;
        deferred.resolve(output);
      },
      reject(error: unknown) {
        if (deferred.settled) return;
        deferred.settled = true;
        deferred.reject(error);
      },
    };
    this.pending.push(handle);
    return promise;
  }
}

/**
 * Flush the microtask queue so already-settled promises propagate their
 * `.then`/`.catch` callbacks (e.g. the host's `recordResult` wiring) before the
 * test makes its next assertion. Deterministic: it yields to the microtask
 * queue a fixed number of times, never to a real timer.
 *
 * A speculation that the test has `resolve()`d will, after this, have been fed
 * back into the pipeline via `recordResult`. A speculation the test has NOT
 * settled remains genuinely pending — the host will classify the real call as
 * `in_flight_incomplete`, exactly the production race.
 */
export async function flushMicrotasks(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}
