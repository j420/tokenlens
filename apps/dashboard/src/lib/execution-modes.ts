// Real execution-mode sequences for the animated showcase.
// Every line is literally accurate to a shipped surface. Numbers are either
// `cited` (sourced) or `illustrative` (a concrete example of a deterministic
// mechanism) — never fabricated as a guaranteed rate. Unknown model ⇒ null.

export type Surface = "Hook" | "MCP tool" | "Extension" | "Request adapter";

export type LineTone = "trigger" | "signal" | "decision" | "muted";

export interface Line {
  tone: LineTone;
  /** mono text; use ▸ for the leading glyph where useful */
  text: string;
}

export type Verdict = "DENY" | "ACT" | "SKIP" | "MASK" | "REWRITE";

export interface TokenDelta {
  kind: "delta";
  from: number;
  to: number;
  /** short label under the number, e.g. "tokens in context" */
  label: string;
}

export interface VerdictResult {
  kind: "verdict";
  verdict: Verdict;
  /** small mono detail next to the stamp, e.g. "−2,400 tokens" */
  detail: string;
}

export type Result = TokenDelta | VerdictResult;

export interface ExecutionMode {
  id: string;
  surface: Surface;
  /** the real handle: hook file, MCP tool name, command id, or module */
  handle: string;
  title: string;
  blurb: string;
  trigger: string;
  lines: Line[];
  result: Result;
  /** honest provenance shown under the result */
  figure: { kind: "cited" | "illustrative" | "guarantee"; text: string };
}

export const EXECUTION_MODES: ExecutionMode[] = [
  {
    id: "read-gate",
    surface: "Hook",
    handle: "read-gate.mjs · PreToolUse",
    title: "Dedup-VoI read gate",
    blurb:
      "Denies a file re-read only when the exact bytes are provably still in context. Zero information loss by construction.",
    trigger: "▸ Read(auth.ts)  — agent asks to read a file it saw before",
    lines: [
      { tone: "signal", text: "content-sha   9f3c…e1   (unchanged)" },
      { tone: "signal", text: "resident      turn 1 · compaction-epoch 2" },
      { tone: "signal", text: "live epoch    2   → still in context" },
      { tone: "decision", text: "identical bytes already present ⇒ re-read is redundant" },
    ],
    result: { kind: "verdict", verdict: "DENY", detail: "−2,400 tokens" },
    figure: {
      kind: "guarantee",
      text: "Sound: denies only on proven duplicate. ~15,000+ tokens/session typical (CLAUDE.md).",
    },
  },
  {
    id: "observation-mask",
    surface: "Hook",
    handle: "observation-mask.mjs · UserPromptSubmit",
    title: "Observation masking",
    blurb:
      "Replaces tool observations older than a sliding window with short, reversible placeholders — caps O(n²) transcript growth at O(n·window).",
    trigger: "▸ next turn — transcript carries stale tool results",
    lines: [
      { tone: "signal", text: "turn 3  ls      1,200 tok   unreferenced ×4" },
      { tone: "signal", text: "turn 5  grep    3,300 tok   unreferenced ×3" },
      { tone: "decision", text: "collapse to reversible placeholders (Belady-ordered)" },
    ],
    result: { kind: "delta", from: 22700, to: 18200, label: "tokens in context" },
    figure: {
      kind: "cited",
      text: '52.7% cost cut at flat solve-rate — "The Complexity Trap", arXiv:2508.21433.',
    },
  },
  {
    id: "clearing-price",
    surface: "MCP tool",
    handle: "price_quote · clearing-price (f18)",
    title: "Token clearing-price controller",
    blurb:
      "One price λ, PID-paced against the cost-SLO error budget. Every actuator bids: act iff qualityGain ≥ λ·tokenCost.",
    trigger: "▸ an actuator asks: should I spend 500 tokens here?",
    lines: [
      { tone: "signal", text: "slo error     +6%   → λ rises (stingier)" },
      { tone: "signal", text: "λ             0.85" },
      { tone: "decision", text: "qualityGain 0.92  ≥  λ·cost 0.47   ⇒ admit" },
    ],
    result: { kind: "verdict", verdict: "ACT", detail: "bid cleared" },
    figure: {
      kind: "illustrative",
      text: "Illustrative λ/gains. Deterministic control math; a null quote ⇒ every consumer no-ops.",
    },
  },
  {
    id: "smart-copy",
    surface: "Extension",
    handle: "prune.smartCopy · ⌘⌥C",
    title: "Smart copy (signatures only)",
    blurb:
      "Tree-sitter AST extracts imports + type & function signatures, drops bodies. Paste the shape, not the implementation.",
    trigger: "▸ ⌘⌥C on auth/service.ts + auth/types.ts",
    lines: [
      { tone: "signal", text: "parse         tree-sitter (typescript)" },
      { tone: "signal", text: "keep          imports · interfaces · signatures" },
      { tone: "decision", text: "strip function bodies → /* … */" },
    ],
    result: { kind: "delta", from: 3200, to: 340, label: "tokens copied" },
    figure: {
      kind: "cited",
      text: "89% reduction on this example; 70–90% typical (CLAUDE.md).",
    },
  },
  {
    id: "cache-planner",
    surface: "Request adapter",
    handle: "agent-sdk-adapter · cache-planner",
    title: "Stable-prefix cache planning",
    blurb:
      "Places the prompt-cache breakpoint after the largest stable prefix so the volatile tail never busts the cached read.",
    trigger: "▸ assembling the next request",
    lines: [
      { tone: "signal", text: "stable    system · tool-defs · pinned ctx" },
      { tone: "signal", text: "volatile  last turn · fresh file" },
      { tone: "decision", text: "breakpoint after stable prefix ⇒ prefix served at read tier" },
    ],
    result: { kind: "verdict", verdict: "ACT", detail: "prefix @ 0.1× read" },
    figure: {
      kind: "cited",
      text: "Anthropic cache read = 0.1× input; write = 1.25× / 2.0× (provider docs).",
    },
  },
];

export const SURFACE_META: Record<
  Surface,
  { tag: string; note: string }
> = {
  Hook: { tag: "autonomous", note: "fires on lifecycle events · shadow → enforce" },
  "MCP tool": { tag: "self-regulation", note: "the agent calls it to govern itself" },
  Extension: { tag: "in-editor", note: "you run it · Cursor · Claude Code · Codex" },
  "Request adapter": { tag: "request assembly", note: "shapes the call before it's sent" },
};
