// ============================================================================
// Token-Cost Reduction Program (TCRP) catalog
// ============================================================================
// Single source of truth for the deterministic backend features — the
// MCP tools, Claude Code hooks, and library levers that make up the TCRP.
// These are NOT editor commands (those live in the page-level FEATURES lists);
// they run as MCP self-regulation tools and lifecycle hooks. Every entry is
// described factually — no fabricated savings %, accurate surface labels.
//
// Discipline mirrored from the packages: each is deterministic (no model call /
// no regex in the decision), fail-safe, and never fabricates a token/cost
// number (unknown model -> null). The `surface` says how it is reachable.

export type TcrpSurface = "MCP tool" | "Hook" | "Library";

export type TcrpCategory =
  | "cost-security"
  | "cache-provider"
  | "context-selection"
  | "value-economics"
  | "learning"
  | "integrity";

export interface TcrpFeature {
  /** Stable id. */
  id: string;
  name: string;
  /** How it's reachable in the product. */
  surface: TcrpSurface;
  /** The concrete handle: MCP tool name, hook file, or package. */
  ref: string;
  category: TcrpCategory;
  /** Factual one-liner (no fabricated numbers). */
  description: string;
  icon: string;
}

export const TCRP_CATEGORIES: { id: TcrpCategory; label: string; blurb: string }[] = [
  { id: "cost-security", label: "Cost-Security", blurb: "Defend the bill: detect runaway/adversarial spend." },
  { id: "cache-provider", label: "Cache & Provider", blurb: "Prompt-cache economics and provider-mechanic levers." },
  { id: "context-selection", label: "Context Selection", blurb: "Send less context without losing what matters." },
  { id: "value-economics", label: "Value & Economics", blurb: "Re-price the decision; account per completed task." },
  { id: "learning", label: "Learning (outcome-fed)", blurb: "Caller-fed accept/CI/equivalence signals; deterministic estimators." },
  { id: "integrity", label: "Integrity & Guardrails", blurb: "Reward-hacking interlocks and anti-synergy guards." },
];

export const TCRP_FEATURES: TcrpFeature[] = [
  // --- Cost-Security (autonomous hooks) ---
  { id: "navigation-ratio", name: "Navigation-to-Edit Ratio", surface: "Hook", ref: "navigation-ratio.mjs", category: "cost-security", icon: "🧭", description: "Flags post-localization over-exploration: read-only turns re-visiting a file with zero edits." },
  { id: "tool-error-rate", name: "Tool-Error-Rate Breaker", surface: "Hook", ref: "tool-error-rate.mjs", category: "cost-security", icon: "⚠️", description: "Advises when the host-tagged tool-error rate stays high over a window; insufficient_signal when untagged." },
  { id: "identical-action", name: "Identical-Action Loop", surface: "Hook", ref: "loop-breaker.mjs", category: "cost-security", icon: "🔁", description: "Same tool + canonical input returning an identical result-SHA N times — provable no-progress." },
  { id: "cost-guard", name: "Token-Bomb Guard", surface: "Hook", ref: "cost-guard.mjs", category: "cost-security", icon: "💣", description: "Quarantines a megabyte/expansion-bomb tool result with a stub; bounds oversized output at the source." },
  { id: "injection-cost", name: "Injection-Cost Attribution", surface: "Hook", ref: "injection-cost.mjs", category: "cost-security", icon: "🧨", description: "Meters per-source downstream token amplification; quarantines a cost-driving injection source." },
  { id: "fanout-acceleration", name: "Fan-out Acceleration", surface: "Hook", ref: "fanout-acceleration.mjs", category: "cost-security", icon: "🌪️", description: "Watches the 2nd-difference of projected subagent spawns; pauses a super-linear fan-out." },
  { id: "cache-poison", name: "Cache-Poisoning Economics", surface: "MCP tool", ref: "cache_poison_check", category: "cost-security", icon: "🧪", description: "Attributes equivalence-rejection / near-collision harm to a writer; quarantine = revalidate, never delete." },

  // --- Cache & Provider ---
  { id: "cache-habits", name: "Cache-Habits Linter", surface: "MCP tool", ref: "cache_habits", category: "cache-provider", icon: "📐", description: "14 prompt-cache-killer rules (CH-001..CH-014) incl. stateful→stateless transport regression." },
  { id: "prefix-warm", name: "Prefix Warming", surface: "MCP tool", ref: "prefix_warm_plan", category: "cache-provider", icon: "🔥", description: "TTL-aware keep-alive / prime decisions and the read-discount savings of a warm prefix." },
  { id: "churn-pin", name: "Git-Churn Cache-Pin", surface: "MCP tool", ref: "churn_pin_plan", category: "cache-provider", icon: "📌", description: "Pins low-churn files into the cacheable prefix and keeps high-churn out (forward-looking)." },
  { id: "prefix-align", name: "Increment Prefix Aligner", surface: "MCP tool", ref: "prefix_align", category: "cache-provider", icon: "📏", description: "Aligns the stable prefix to the provider cache boundary (OpenAI 1024 + 128·k)." },
  { id: "ttl-regression", name: "TTL-Regression Sentinel", surface: "MCP tool", ref: "ttl_regression_check", category: "cache-provider", icon: "⏳", description: "Flags a silent provider cache-TTL downgrade (configured 1h behaving like 5m)." },
  { id: "cache-reconcile", name: "Cache-Hit Reconciliation", surface: "MCP tool", ref: "cache_reconcile", category: "cache-provider", icon: "🔄", description: "Predicted vs realized cache reads; flags an under-performing/stranded cache write." },

  // --- Context Selection ---
  { id: "observation-mask", name: "Observation Masking", surface: "MCP tool", ref: "observation_mask_plan", category: "context-selection", icon: "🪟", description: "Sliding-window masking of stale tool results + Belady/LRU eviction under a token budget." },
  { id: "read-gate", name: "Dedup-VoI Read Gate", surface: "MCP tool", ref: "read_gate_check", category: "context-selection", icon: "🚪", description: "Denies a re-read only when content is provably still in context (SHA × compaction-epoch)." },
  { id: "program-slice", name: "Program-Slice Selection", surface: "MCP tool", ref: "program_slice", category: "context-selection", icon: "🔬", description: "Backward static slice over the symbol graph — sound reachability replacing heuristic relevance." },
  { id: "known-knowledge", name: "Known-Knowledge Negotiation", surface: "MCP tool", ref: "known_knowledge_negotiate", category: "context-selection", icon: "🧠", description: "Stubs content the model provably already knows (caller-fed equivalence probe, SHA-keyed)." },
  { id: "pull-context", name: "Negotiated Pull-Context", surface: "MCP tool", ref: "pull_context_resolve", category: "context-selection", icon: "🪝", description: "Push→pull: manifest → FETCH → inject only requested bodies + DAG-closure deps." },
  { id: "lsp-graph", name: "LSP Symbol-Graph", surface: "MCP tool", ref: "lsp_graph", category: "context-selection", icon: "🗺️", description: "Injects the language server's authoritative signatures+edges instead of re-deriving from bodies." },

  // --- Value & Economics ---
  { id: "task-ledger", name: "Cost-per-Task Ledger", surface: "MCP tool", ref: "task_ledger_rollup", category: "value-economics", icon: "🧾", description: "Re-aggregates spend by TASK; divides by accepted outcomes; surfaces retry/dead-end spend." },
  { id: "waterbed", name: "Waterbed Net-Effect Gate", surface: "MCP tool", ref: "waterbed_check", category: "value-economics", icon: "🛟", description: "Nets a saving against its induced cost; vetoes a 'saving' that merely reappears elsewhere." },
  { id: "price-tag", name: "Decision-Time Price Tag", surface: "MCP tool", ref: "price_tag", category: "value-economics", icon: "🏷️", description: "Prices the chosen vs a cheap-sufficient path; flips the default only when proven non-inferior." },
  { id: "clearing-price", name: "Clearing-Price Controller", surface: "MCP tool", ref: "price_quote", category: "value-economics", icon: "📉", description: "One PID-paced price λ every actuator bids against (act iff qualityGain ≥ λ·tokenCost)." },
  { id: "allowance-market", name: "Allowance Market", surface: "MCP tool", ref: "allowance_market", category: "value-economics", icon: "💱", description: "Owned, transferable per-actor token allowances (Coasean); overdraws rejected, never clamped." },
  { id: "futures-desk", name: "Token Futures Desk", surface: "MCP tool", ref: "futures_desk", category: "value-economics", icon: "📅", description: "Prices non-urgent reservations on the discounted slow lane (caller-supplied Batch discount)." },
  { id: "bounty", name: "Cheapest-Context Bounty", surface: "MCP tool", ref: "bounty_evaluate", category: "value-economics", icon: "🏆", description: "Among gate-passing submissions, deterministically picks the minimum-cost winner." },
  { id: "batch-router", name: "Batch-Tier Router", surface: "MCP tool", ref: "batch_route", category: "value-economics", icon: "🚚", description: "Routes non-interactive work to the Batch lane over caller-declared signals; quotes the discount." },

  // --- Learning (outcome-fed, deterministic estimators) ---
  { id: "context-utility", name: "Context-Utility Model", surface: "MCP tool", ref: "context_utility_query", category: "learning", icon: "📊", description: "Decayed Beta-Binomial per-atom utility learned from the accept/reject verdict; floor-safe." },
  { id: "ci-validator", name: "CI Fix-Context Validator", surface: "MCP tool", ref: "ci_fix_context", category: "learning", icon: "✅", description: "Red→green CI transitions as ground truth for which context atoms fix a failure class." },
  { id: "marginal-value", name: "Marginal-Value Probe", surface: "MCP tool", ref: "marginal_value", category: "learning", icon: "🔎", description: "Counterfactual equivalence verdicts → zero-value-chunk waste + Context-Utility observations." },
  { id: "retry-reframe", name: "Retry-vs-Reframe Advisor", surface: "MCP tool", ref: "retry_reframe_advise", category: "learning", icon: "↩️", description: "At a rejection, advises retry vs reframe by expected cost-per-success (cost / P(success))." },
  { id: "fleet-cache", name: "Fleet Resolved-Context Cache", surface: "MCP tool", ref: "fleet_cache", category: "learning", icon: "👥", description: "One dev's resolved repo-fact answer serves the team, gated by dependency content-SHA freshness." },
  { id: "waste-memo", name: "Recurring-Waste Memo", surface: "MCP tool", ref: "waste_memo", category: "learning", icon: "🗒️", description: "Cross-session digest of a developer's recurring expensive patterns (PII-safe fingerprints)." },

  // --- Integrity & Guardrails ---
  { id: "reward-integrity", name: "Reward-Integrity Interlock", surface: "MCP tool", ref: "reward_integrity_check", category: "integrity", icon: "🛡️", description: "AST + content-hash detector for reward-hacking edits (assertion removal, test disabling)." },
  { id: "anti-synergy", name: "Anti-Synergy Guardrails", surface: "MCP tool", ref: "anti_synergy_check", category: "integrity", icon: "🚧", description: "G1 pruner-vs-cache-bust · G2 skip-starves-capture · G3 re-squeeze-prefix-bust." },
  { id: "wastebench", name: "WasteBench Attestations", surface: "MCP tool", ref: "wastebench_attest", category: "integrity", icon: "🔏", description: "Counterfactual net-savings accounting + Ed25519-signed tamper-evident manifests." },
];

export const TCRP_COUNT = TCRP_FEATURES.length;
