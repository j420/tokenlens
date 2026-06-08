import { StatusBadge, type StatusTone } from "@/components/status-badge";

interface Row {
  surface: string;
  tone: StatusTone;
  verdict: string;
  signal: string;
  delta: string;
}

// Real, accurate decisions (mirrors src/lib/execution-modes.ts). Honest:
// cited or illustrative, never fabricated; an unknown price prints as null.
const ROWS: Row[] = [
  { surface: "read-gate", tone: "deny", verdict: "DENY", signal: "sha 9f3c · epoch 2", delta: "−2,400" },
  { surface: "observation-mask", tone: "mask", verdict: "MASK", signal: "stale > 3 turns", delta: "−4,500" },
  { surface: "clearing-price", tone: "act", verdict: "ACT", signal: "gain 0.92 ≥ λ·0.47", delta: "+admit" },
  { surface: "smart-copy", tone: "act", verdict: "ACT", signal: "ast → signatures", delta: "−2,860" },
  { surface: "unknown-model", tone: "neutral", verdict: "SKIP", signal: "no price table", delta: "null" },
];

export function ResultLedger() {
  return (
    <div className="term-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line bg-panel-2 px-4 py-2.5">
        <span className="flex items-center gap-2 font-mono text-xs text-secondary">
          <span className="flex gap-1.5" aria-hidden>
            <span className="h-2.5 w-2.5 rounded-full border border-line" />
            <span className="h-2.5 w-2.5 rounded-full border border-line" />
            <span className="h-2.5 w-2.5 rounded-full border border-line" />
          </span>
          <span className="ml-2">prune ledger</span>
        </span>
        <span className="mono-label">deterministic</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse font-mono text-[12.5px]">
          <thead>
            <tr className="text-left text-muted">
              <th className="px-4 py-2 font-medium uppercase tracking-wider">surface</th>
              <th className="px-3 py-2 font-medium uppercase tracking-wider">decision</th>
              <th className="px-3 py-2 font-medium uppercase tracking-wider">signal</th>
              <th className="px-4 py-2 text-right font-medium uppercase tracking-wider">Δ tok</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.surface} className="border-t border-line">
                <td className="px-4 py-2.5 text-foreground">{r.surface}</td>
                <td className="px-3 py-2.5">
                  <StatusBadge tone={r.tone}>{r.verdict}</StatusBadge>
                </td>
                <td className="px-3 py-2.5 text-secondary">{r.signal}</td>
                <td
                  className={
                    "px-4 py-2.5 text-right tabular-nums " +
                    (r.delta === "null" ? "null-value" : "text-foreground")
                  }
                >
                  {r.delta}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-t border-line px-4 py-2.5 font-mono text-[11px] text-muted">
        — 5 surfaces · 9,760 tokens reclaimed · 0 fabricated · unknown ⇒{" "}
        <span className="null-value">null</span>
      </div>
    </div>
  );
}
