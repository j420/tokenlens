/**
 * Test-only builders. Construct deterministic typed timelines to exercise the
 * pure planner — the same posture as sentinel.test.ts building minimal
 * payloads. These are NOT session-transcript fixtures (Phase 7 hard-rule #9
 * governs those); they are minimal structural inputs for pure-logic tests.
 */

import { buildTimeline } from "./segment.js";
import type { ReplaySegment, SessionTimeline } from "./types.js";
import type { Provider } from "@prune/shared";

export interface SegSpec {
  role: ReplaySegment["role"];
  /** A content marker; any JSON value works. Distinct markers ⇒ distinct hashes. */
  content: unknown;
  tokensIn: number;
  tokensOut: number;
}

export function seg(
  role: ReplaySegment["role"],
  content: unknown,
  tokensIn: number,
  tokensOut = 0
): SegSpec {
  return { role, content, tokensIn, tokensOut };
}

export function timeline(
  specs: SegSpec[],
  model = "claude-sonnet-4-5-20250929",
  provider: Provider = "anthropic"
): SessionTimeline {
  const segments: ReplaySegment[] = specs.map((s, i) => ({
    index: i,
    role: s.role,
    payload: { role: s.role, content: s.content },
    tokensIn: s.tokensIn,
    tokensOut: s.tokensOut,
  }));
  return buildTimeline({ model, provider, segments });
}

/**
 * The canonical 5-segment session used across the cost tests. Token figures
 * are chosen so the arithmetic in cost-model.test.ts is hand-verifiable.
 *
 *   0 system    in=2000 out=0
 *   1 user      in=500  out=0
 *   2 assistant in=800  out=800
 *   3 user      in=300  out=0
 *   4 assistant in=1000 out=1000
 */
export function canonicalSession(
  model = "claude-sonnet-4-5-20250929"
): SessionTimeline {
  return timeline(
    [
      seg("system", "SYS", 2000, 0),
      seg("user", "Q1", 500, 0),
      seg("assistant", "A1", 800, 800),
      seg("user", "Q2", 300, 0),
      seg("assistant", "A2", 1000, 1000),
    ],
    model
  );
}
