# CLAUDE.md — TokenLens (Prune)

> Token intelligence for AI coding assistants. Zero API keys required. All processing happens locally.

## What is this project

TokenLens (internally: Prune) started as an extension for AI coding assistants (Cursor, Claude Code, OpenAI Codex) that gives developers real-time visibility into token usage, and has grown into a **70-workspace monorepo** (67 `packages/*` + 3 `apps/*`) implementing a full **Token-Cost Reduction Program (TCRP)**. It works with any VS Code-based editor and is provider-neutral. It solves the invisible token burn problem — developers have zero visibility into what they're spending, where the waste is, and what they're about to spend — and then actively reduces that spend.

**The core philosophy:** Help developers reduce token consumption while maintaining the same context quality. Make every token count.

**What ships today, beyond the original extension:**

- **TCRP feature library (f1–f13 + Phase-8 Tier-1):** trajectory diet, tool-def auditing, semantic cache, QpD bench, context health, lazy-schema MCP proxy, what-if replay-cost, skill library, speculative tool pipeline, plus the five Phase-8 features (tool-result pruner, max_tokens calibrator, diff-vs-rewrite enforcer, reasoning-effort router, open-tab auditor). See **TCRP Feature Map** below.
- **MCP tool surface (72 tools):** `apps/mcp-server` exposes the feature library as MCP tools for AI self-regulation.
- **Hooks system:** `apps/extension/hooks/*.mjs` — Claude Code lifecycle hooks (advisors, recorders, breakers, forwarders) with a flag system and an auto-installer.
- **Persistence + telemetry:** local SQLite + a real Postgres sink (`@prune/persistence`), with open-standard exporters (OpenTelemetry GenAI + FOCUS FinOps).
  - **Known limitation (tracked follow-up #1):** the event schema's `estimated_cost_usd` column is `number` (non-nullable), and two hooks coerce an unknown cost with `?? 0` (`cache-habits-advisor.mjs`, `cost-guard.mjs`). So an UNPRICED-model event is persisted as `$0`, indistinguishable from a genuinely-free one — a dashboard `SUM(estimated_cost)` under-counts true spend. The package-level discipline is honest (unknown model ⇒ `null`); the masking is only at the telemetry boundary. Fix = make `estimatedCostUsd` `number | null` end-to-end (`feature-event.ts` + `EventRow` + SQLite/Postgres bindings + the two hook masks + persistence tests) so the dashboards never show a fabricated `$0`. Deferred as its own focused change (touches ~141 persistence tests).
- **Strict, honest pricing:** unknown model → `null`, never a fabricated default rate (`@prune/shared`).

---

## Quick Start

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Package the extension
cd apps/extension
npm run package

# Install the VSIX in your AI coding assistant (Cursor / Claude Code / OpenAI Codex)
# Extensions > ... > Install from VSIX > select prune-0.1.0.vsix
```

---

## Project Structure

```
tokenlens/
├── apps/
│   ├── extension/              # Editor extension (Cursor / Claude Code / Codex)
│   │   ├── src/
│   │   │   ├── extension.ts          # Entry point, commands, status bar, installHooks
│   │   │   ├── token-saver.ts        # Smart Copy, Pre-flight, Session Memory, Compaction
│   │   │   ├── squeezer.ts           # tree-sitter code compression
│   │   │   ├── context-analyzer.ts   # File-level relevance scoring
│   │   │   └── prune-intelligence.ts # v2 engine: symbol-level DAG analysis
│   │   └── hooks/             # Claude Code lifecycle hooks (.mjs) + flags + installer
│   ├── dashboard/              # Next.js web dashboard + telemetry read-side
│   └── mcp-server/             # MCP server: 72 tools for AI self-regulation
├── packages/                   # 67 workspaces — grouped by role below
│   # --- Core / foundation ---
│   ├── shared/                 # Shared types + STRICT pricing (unknown model → null)
│   ├── tokenizer/              # Local token counting (OpenAI + Anthropic)
│   ├── intelligence/           # Core algorithms: relevance, ROI, subagent-cost-predictor
│   ├── db/                     # Postgres schema (Drizzle ORM) + ORM re-exports (orm.ts)
│   ├── persistence/            # PersistenceSink: local SQLite + PostgresSink + forwarder
│   ├── telemetry/              # Telemetry event types / recording path
│   ├── equivalence/            # Output-equivalence relations (gate for cost transforms)
│   ├── quality/                # Statistical non-inferiority testing for TCRP
│   ├── outcome-bench/          # Benchmark v2: paired A/B outcome benchmark (oracle-graded, zero-spend dry-run)
│   ├── repo-proof/             # f20 — evidence-gated repo-local proof + flag promotion (prune-proof CLI)
│   # --- TCRP features f1–f13 ---
│   ├── trajectory-diet/        # f1  — low-influence retrieval-step advisor
│   ├── tab-auditor/            # (Phase-8) IDE open-tab relevance auditor
│   ├── qpd-bench/              # f4  — Pareto quality-per-dollar bench + effort-router
│   ├── context-health/         # f6  — Effective Context Fullness + CUSUM inflection warns
│   ├── semantic-cache/         # f7  — in-process embedder + equivalence-gated cache
│   ├── code-mode-mcp/          # f8  — JSON-schema → typed TS API + vm sandbox
│   ├── cache-habits/           # f9/E3 — pre-action prompt-cache-killer linter
│   ├── mcp-proxy/              # f10/E1 — lazy-schema cross-vendor MCP proxy
│   ├── replay-cost/            # f11/E2 — what-if deterministic replay cost engine
│   ├── replay-vault/           # tamper-evident audit log (canonicalization source)
│   ├── skill-library/          # f12/E4 — cross-session typed skill reuse
│   ├── speculative-pipeline/   # f13/E5 — speculative read-only tool pipeline + worktree exec
│   ├── response-tuner/         # (Phase-8) tool-result sub-token pruner + max_tokens calibrator
│   ├── diff-enforcer/          # (Phase-8) diff-vs-rewrite cost enforcer
│   # --- Routing / governance / safety ---
│   ├── router/                 # Deterministic three-tier routing (Haiku/Sonnet/Opus)
│   ├── budget-gate/            # Active budget tracking + enforcement
│   ├── slo/                    # Cost SLO + circuit-breaker (error-budget pattern)
│   ├── sentinel/               # Secret detection + MCP prompt-injection shield
│   ├── attribution/            # Per-dev / per-PR / per-project cost attribution
│   ├── export/                 # OpenTelemetry GenAI + FOCUS FinOps exporters
│   ├── agent-sdk-adapter/      # Provider-neutral Agent SDK control plane
│   ├── host-adapters/          # Real Claude Code session data → typed tool inputs
│   # --- Outcome-learning substrate (Phase-2) ---
│   ├── context-utility/        # F1  — Context-Utility Model (decayed empirical-Bayes per-atom utility)
│   # --- Deterministic value / economics levers (List1/List2) ---
│   ├── task-ledger/            # F11 — cost-per-completed-task ledger (the value denominator)
│   ├── waterbed/               # F12 — general induced-cost net-effect gate (veto phantom savings)
│   ├── price-tag/              # F14 — decision-time dual price tag + equivalence-gated default-flip
│   ├── churn-pin/              # F9  — git-churn cache-pin planner (forward-looking invalidation)
│   ├── waste-memo/             # F13 — cross-session recurring-waste memo (PII-safe fingerprints)
│   ├── lsp-graph/              # F10 — authoritative LSP symbol-graph substitution
│   # --- Code intelligence ---
│   ├── squeezer/               # TS Compiler API code compression
│   ├── squeezer-py/            # Python code compression
│   ├── repo-map/               # Symbol-level repo map (PageRank, signatures-only)
│   ├── response-tuner/         # (see above)
│   ├── state-scraper/          # Cursor usage tracking (sql.js, zero-key)
│   ├── sentinel/               # (see above)
│   ├── qpd-bench/              # (see above)
│   └── ...                     # (also: code-mode-mcp tests, qpd-bench, etc.)
├── turbo.json
└── package.json
```

> Note: a few packages appear under more than one role above for readability;
> the authoritative one-line description for each lives in its own `package.json`
> `description` field.

---

## TCRP Feature Map

> **Two feature-ID namespaces (read this — they are case-sensitive and would
> otherwise collide).** Lowercase **`f1`–`f19`** are the **shipped TCRP feature
> IDs** in the table below (the original program + the ROUND-16 set). Uppercase
> **`F1`–`F21`** are the **List1/List2/List3 research-proposal IDs** (see
> `docs/RESEARCH-*`) for the deterministic value/economics/paradigm levers built
> later — a SEPARATE numbering from the lowercase set (`F11` task-ledger is not
> `f11` replay-cost, etc.). The uppercase **F18–F20** are the cost-security suite
> (injection-cost / cost-guard / fan-out), already shipped as hooks, which is why
> the uppercase value-lever sequence jumps F17→F21. When mapping for an audit,
> always carry the case.

The Token-Cost Reduction Program features. Each is a standalone, tested package;
most are also surfaced as an MCP tool and/or a Claude Code hook. All are
deterministic (no model calls in decision logic, no regex parsing/classification),
fail-safe, and never fabricate a token/cost number.

| Feature | Package | What it does |
|---------|---------|--------------|
| **f1** Trajectory Diet | `trajectory-diet` | Predicts low-influence retrieval steps; advises skipping similar steps (advisory-only). |
| **f2** Tool-Def Auditor | `mcp-server` (`tool_audit`) | Flags MCP tool-definition bloat consuming context. |
| **f4** QpD Bench | `qpd-bench` | Finds model tiers statistically quality-equivalent to the current one at lower cost. |
| **f5** HUD | `extension` | Status-bar token/cost HUD (honest: shows `insufficient_data` when a model is unpriced). |
| **f6** Context Health | `context-health` | Effective Context Fullness + CUSUM change-point inflection warnings. |
| **f7** Semantic Cache | `semantic-cache` | In-process char-n-gram + IDF cosine cache; equivalence-gated; content-SHA poisoning defense. |
| **f8** Code-Mode MCP | `code-mode-mcp` | JSON-schema → typed TS API; vm sandbox; equivalence-proof harness. |
| **f9 / E3** Cache-Habits Linter | `cache-habits` | Pre-action warnings before a documented prompt-cache-killer pattern fires (CH-001..CH-014, incl. CH-013 stateful→stateless transport regression + CH-014 long-stateless transport advisor). |
| **f10 / E1** MCP Proxy | `mcp-proxy` | Lazy-schema cross-vendor proxy; returns only intent-matching tools. |
| **f11 / E2** Replay-Cost | `replay-cost` | What-if deterministic replay: shared-prefix re-serve vs cold re-run cost. |
| **f12 / E4** Skill Library | `skill-library` | Captures influential trajectory subset; replays typed skill on matching tasks. |
| **f13 / E5** Speculative Pipeline | `speculative-pipeline` | Parallel speculative READ-ONLY tool execution against a sandboxed worktree. |
| **P8(a)** Tool-Result Pruner | `response-tuner` | Sub-token pruning of large tool results. |
| **P8(b)** max_tokens Calibrator | `response-tuner` | Statistical `max_tokens` calibration. |
| **P8(c)** Diff-vs-Rewrite Enforcer | `diff-enforcer` | Decides diff vs full rewrite by real token cost (sound round-trip guarantee). |
| **P8(d)** Reasoning-Effort Router | `qpd-bench` (`effort-router`) | Routes reasoning effort by task; actuates cache-habit CH-009. |
| **P8(e)** Open-Tab Auditor | `tab-auditor` | Scores open editor tabs; recommends dropping low-relevance tabs from AI context. |
| **f14** Reward-Integrity Interlock | `reward-integrity` | AST + content-hash detector for reward-hacking edits (assertion removal/tautologizing, test disabling, grader writes); PreToolUse breaker, fail-safe to `inconclusive`. |
| **f15** Observation Masking + Belady | `observation-mask` | Sliding-window masking of stale tool results (reversible placeholders) capping context at O(n·window); Belady/LRU eviction under a token budget; monotone (cache-stable). |
| **f16** Dedup-VoI Read Gate | `read-gate` | Denies a re-read only when content is provably still in context (content-SHA × compaction-epoch); information-lossless by construction. |
| **f17** Program-Slice Selection | `program-slice` | Backward static slice (transitive dependency closure) over the symbol graph; sound reachability replacing heuristic relevance. |
| **f18** Clearing-Price Controller | `clearing-price` | One PID-paced price λ every actuator bids against (`act iff qualityGain ≥ λ·tokenCost`); null quote ⇒ no-op. The coordinator the actuators bid into. |
| **f19** WasteBench + Attestations | `wastebench` | Counterfactual net-savings accounting (overhead subtracted), reflexive overhead SLO, Ed25519-signed tamper-evident manifests. |
| **(f12)** Cross-Session Prefix Warm | `prefix-warm` | TTL-aware prompt-cache prefix warming (keep-alive / prime decisions + read-discount savings); completes cross-session reuse alongside the skill library. |
| **f20** Repo-Proof | `repo-proof` | Evidence-gated, repo-local outcome proof: mines SWE-bench-style tasks from the target repo's history (prompts human-curated), three-state-verifies them, runs the outcome-bench paired matrix under an explicit budget, and promotes flags `shadow → general` for that repo only on a passing Ed25519-attested proof. Surfaces: `prune-proof` CLI bin, `prune.repoProof` extension command (terminal launcher), `repo_proof_status` MCP tool (read-only). |

---

## MCP Tool Surface

`apps/mcp-server` registers 72 tools (names from `src/index.ts` / `src/tcrp-tools.ts` / `src/value-tools.ts` / `src/repo-proof-tools.ts`),
including: `analyze_context`, `squeeze_files`, `check_budget`, `cache_report`,
`cache_copilot`, `cache_habits`, `loop_status`, `routing_suggestion`,
`routing_decide`, `diff_context`, `diff_vs_rewrite`, `slo_define` / `slo_check` /
`slo_status`, `attribution_rollup`, `export_focus_csv`, `export_otel_genai`,
`sentinel_scan_prompt` / `sentinel_scan_mcp`, `repo_map`, `replay_verify` /
`replay_list`, `subagent_status` / `subagent_cost_predict`, `budget_status` /
`budget_configure`, `compaction_check`, `tool_audit`, `qpd_report`,
`code_mode_generate_api` / `code_mode_harness`, `semantic_cache_probe`,
`trajectory_replay_report`, `context_health_report`, `open_tab_audit`, and the
ROUND-16 exponential set: `reward_integrity_check`, `observation_mask_plan`,
`read_gate_check`, `program_slice`, `price_quote`, `prefix_warm_plan`,
`wastebench_attest`, and the value/economics levers: `task_ledger_rollup` (F11),
`waterbed_check` (F12), `price_tag` (F14), `context_utility_query` (F1).

The full List1/List2/List3 value/economics/paradigm lever set is also MCP-exposed
(`apps/mcp-server/src/value-tools.ts`) so no package is library-only: `known_knowledge_negotiate`
(F2), `pull_context_resolve` (F3), `churn_pin_plan` (F9), `waste_memo` (F13), `lsp_graph` (F10),
`allowance_market` (F15), `futures_desk` (F16), `bounty_evaluate` (F17), `batch_route`,
`prefix_align`, `ttl_regression_check`, `retry_reframe_advise` (F5), `ci_fix_context` (F6),
`fleet_cache` (F7), `marginal_value` (F8), `cache_poison_check` (F21), `anti_synergy_check`
(G1/G2/G3), `cache_reconcile` (U3), `repo_proof_status` (f20, read-only).

Some tools are **caller-fed**: they require typed inputs (e.g. a proposed-action
diff) that a Claude Code hook payload doesn't carry; `@prune/host-adapters`
converts available session data into those inputs, and any value absent from the
source is `null`, never guessed.

---

## Hooks System

`apps/extension/hooks/*.mjs` are Claude Code lifecycle hooks, installable via the
`prune.installHooks` command (`install.mjs`) and gated by a flag system
(`flags.mjs`; features f7–f13 currently ship in `mode: shadow`). The 28 functional
hooks include advisors (`cache-habits-advisor`, `context-health-advisor`,
`skill-advisor`, `trajectory-diet`), recorders (`replay-recorder`, `skill-capture`,
`speculative-record`), breakers (`loop-breaker`, `slo-breaker`,
`subagent-warden`), safety (`sentinel-prompt`, `sentinel-mcp`), integrity
(`reward-integrity`), context governors (`observation-mask`, `read-gate`), cache
(`cache-stabilize`, `speculative-prune`), recovery (`compaction-recover`), budget
(`budget-gate`), cost-security (`cost-guard`, `thrash-detector`, `injection-cost`,
`fanout-acceleration`, `edit-amplification`, `preturn-forecast`, plus the List3
runtime-neutral detectors `navigation-ratio` and `tool-error-rate`), and the
telemetry forwarder (`telemetry-forward`). Hooks are fail-safe: they must never
hang, throw uncaught, or block the agent.

**Cost-Security detectors (List2 + List3, `@prune/cost-security` + `@prune/intelligence`).**
Deterministic, fail-open, env-gated (not TCRP-flagged), surfaced as autonomous hooks
(no MCP tool). Runtime-neutral — tool classification uses a cross-runtime default
vocabulary (Claude Code / Cursor / Codex) and is overridable per host:

| Detector | Function (pkg) | Hook (event) | Fires when |
|----------|----------------|--------------|------------|
| Navigation-to-edit ratio | `assessNavigationRatio` (cost-security) | `navigation-ratio.mjs` (PostToolUse) | a window of read-only turns re-visits a file with zero edits (post-localization over-exploration) |
| Tool-error-rate breaker | `assessToolErrorRate` (cost-security) | `tool-error-rate.mjs` (PostToolUse) | host-tagged `is_error` rate ≥ threshold over enough tagged calls; `insufficient_signal` no-op when absent |
| Identical-action loop | `evaluateIdenticalActionLoop` (intelligence) | `loop-breaker.mjs` (2nd trip) | same tool + canonical input returns an identical result-SHA ≥ N times (provable no-progress) |

Config: `PRUNE_NAV_RATIO_*`, `PRUNE_TOOL_ERROR_*`, `PRUNE_IDENTICAL_ACTION_*`,
`PRUNE_NAV_TOOLS` / `PRUNE_MUT_TOOLS` (per-runtime vocabulary overrides).

---

## Extension Commands

### Token Saver Commands (High Impact)

| Command | Keybinding | Description |
|---------|------------|-------------|
| `prune.smartCopy` | `Ctrl+Alt+C` / `Cmd+Alt+C` | **Smart Copy** - Copy files optimized for AI (signatures only) |
| `prune.preflight` | `Ctrl+Alt+P` / `Cmd+Alt+P` | **Pre-flight Optimizer** - Analyze before sending to AI |
| `prune.sessionStats` | — | View session memory deduplication stats |
| `prune.compactionCheck` | — | Check for decisions at risk of being forgotten |
| `prune.resetSession` | — | Reset session memory |

### Analysis Commands

| Command | Keybinding | Description |
|---------|------------|-------------|
| `prune.analyzeFile` | `Ctrl+Alt+T` / `Cmd+Alt+T` | Show token count for current file |
| `prune.analyzeContext` | `Ctrl+Alt+A` / `Cmd+Alt+A` | Analyze workspace files for relevance to a task |
| `prune.smartContext` | — | Prune v2: Symbol-level DAG analysis |
| `prune.squeezeFile` | — | Compress file using tree-sitter AST |
| `prune.checkCursorUsage` | — | Check Cursor request usage (zero-key) |
| `prune.runTests` | — | Run intelligence engine tests |

---

## Key Features

### 1. Smart Copy (Highest Impact) ⭐

Right-click → "Copy for AI (Optimized)" or press `Ctrl+Alt+C`

Copies selected files as optimized signatures instead of full code. Typical savings: **70-90%**.

**What it generates:**

```typescript
// === src/auth/service.ts ===
import { Token, AuthConfig } from "./types"

interface AuthService {
  login(email: string, password: string): Promise<Token> { /* ... */ }
  logout(token: string): Promise<void> { /* ... */ }
  refresh(token: string): Promise<Token> { /* ... */ }
}

// === src/auth/types.ts ===
interface Token { value: string; expiresAt: Date }
interface AuthConfig { jwtSecret: string; expiry: number }
```

**Full files: 3,200 tokens → Optimized: 340 tokens (89% reduction)**

**Implementation:** `apps/extension/src/token-saver.ts`

---

### 2. Pre-flight Optimizer ⭐

Press `Ctrl+Alt+P` before sending a request to AI.

Shows what you're about to spend vs. what you could spend:

```
╔═══════════════════════════════════════════════════════════════╗
║              ⚡ PRE-FLIGHT OPTIMIZER                          ║
╚═══════════════════════════════════════════════════════════════╝

  📝 Your prompt: "fix the header alignment"

  CURRENT CONTEXT (what you'd send):
     Files:   34 files
     Tokens:  47,000
     Cost:    $0.1410 per request

  ✅ RECOMMENDED (optimized):
     Files:    3 files
     Tokens:   8,200
     Cost:    $0.0246 per request

  💰 SAVINGS: 38,800 tokens (82%)
```

**Implementation:** `apps/extension/src/token-saver.ts:analyzePreFlight()`

---

### 3. Session Memory Deduplication ⭐

Invisible. Works automatically.

Tracks files that have been read during a session. When AI tries to read the same file again, Prune knows it's already in context.

```
Turn 1: User asks about auth.ts → AI reads auth.ts (2,400 tokens)
Turn 5: AI tries to read auth.ts again
        → Prune: "Already in context from turn 1"
        → Skip read, save 2,400 tokens
```

**Typical session savings:** 15,000+ tokens (AI re-reads 5-6 files)

**Check stats:** Run `Prune: Session Memory Stats` command

**Implementation:** `apps/extension/src/token-saver.ts:recordFileRead()`

---

### 4. Compaction Recovery ⭐

When context compacts (AI tools summarize to save space), important decisions can be forgotten.

Prune tracks architectural decisions and shows what may be at risk:

```
╔═══════════════════════════════════════════════════════════════╗
║              📋 COMPACTION RECOVERY                           ║
╚═══════════════════════════════════════════════════════════════╝

  ⚠️  These decisions may be forgotten if context compacts:

  🏗️ JWT expiry set to 15 min
     └─ Turn 4, configuration

  ⚙️ Rate limiter runs BEFORE auth
     └─ Turn 7, architectural

  📋 Use bcrypt, not md5 for passwords
     └─ Turn 2, requirement

  📋 Copy this reminder to your next prompt:
  ─────────────────────────────────────────────
  Remember these decisions:
  • JWT expiry set to 15 min (turn 4)
  • Rate limiter runs BEFORE auth (turn 7)
  • Use bcrypt, not md5 (turn 2)
  ─────────────────────────────────────────────
```

**Implementation:** `apps/extension/src/token-saver.ts:getDecisionsAtRisk()`

---

### 5. Real-Time Token Counter (Status Bar)

Shows token count for the current file or selection in the editor status bar (works in Cursor, Claude Code, Codex). Updates on every keystroke. Color-coded based on spend thresholds.

**Implementation:** `apps/extension/src/extension.ts:187-231`

### 2. Smart Context Analysis

Given a task prompt, analyzes all workspace files and scores them for relevance. Shows which files to include vs. skip, with BEFORE/AFTER token comparisons.

**Implementation:** `apps/extension/src/context-analyzer.ts`

**Usage:**
1. Press `Ctrl+Alt+A` (or `Cmd+Alt+A` on Mac)
2. Enter your task: "fix the auth bug"
3. See recommended files with relevance scores

### 3. Prune v2 Intelligence Engine

The most advanced feature. Symbol-level analysis with:
- **Phase 1:** Extract functions, classes, types from source files
- **Phase 2:** Build a Relevance DAG with weighted dependency edges
- **Phase 3:** Classify user intent (debug, generate, refactor, explain)
- **Phase 4:** Walk DAG with token budget, selecting optimal context

**Implementation:** `apps/extension/src/prune-intelligence.ts`

**Key concepts:**
```typescript
// Symbol kinds
type SymbolKind = 'function' | 'class' | 'interface' | 'type' | 'variable' | 'constant';

// Edge types in the dependency graph
type EdgeKind = 'calls' | 'extends' | 'implements' | 'imports' | 'uses_type' | 'instantiates' | 'references' | 'test_for';

// Intent classification
type IntentType = 'debug' | 'generate' | 'refactor' | 'explain' | 'edit' | 'test' | 'review';

// Context inclusion modes
type InclusionMode = 'full' | 'signature' | 'reference';
```

### 4. Code Squeezer (Tree-Sitter WASM)

Compresses code while preserving semantics using AST analysis.

**Three compression tiers:**
- **Lossless** (~15% savings): Remove comments only
- **Structural** (~40% savings): Compress function bodies to signatures
- **Telegraphic** (~70% savings): Ultra-compressed format

**Implementation:** `apps/extension/src/squeezer.ts`, `packages/squeezer/`

**Supported languages:** JavaScript, TypeScript, Python, Go, Rust, Java, C/C++, Ruby, PHP

### 5. Cursor Usage Tracking (Zero-Key)

Reads Cursor's local SQLite database to show usage without any API keys.

**Implementation:** `packages/state-scraper/`

**How it works:**
1. Locates Cursor's `state.vscdb` file
2. Uses sql.js (SQLite compiled to WASM) for in-memory querying
3. Extracts session token, calls Cursor API for usage stats

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 20+, TypeScript 5.7 |
| Build | Turbo monorepo, esbuild |
| Token Counting | gpt-tokenizer (pure JS, no WASM) |
| AST Parsing | Tree-sitter via WASM |
| SQLite | sql.js (WASM, no native binaries) |
| Dashboard | Next.js 14, Tailwind CSS |
| Database | PostgreSQL, Drizzle ORM |
| MCP | @modelcontextprotocol/sdk |

**Design Decisions:**
- **Zero external binaries:** Uses WASM for SQLite and tree-sitter
- **Offline-first:** All tokenization happens locally
- **Privacy-preserving:** Code never leaves the machine for token counting
- **Composable packages:** Each package is independent and testable

---

## Development

### Building

```bash
# Full build
npm run build

# Build specific package
cd packages/tokenizer && npm run build

# Watch mode for extension
cd apps/extension && npm run watch
```

### Testing

```bash
# Run all tests
npm run test

# Run intelligence engine tests from your editor (Cursor / Claude Code / Codex)
# Command Palette > "Prune: Run Intelligence Tests"
```

### Debugging the Extension

1. Open the `apps/extension` folder in your editor (Cursor / Claude Code / Codex)
2. Press F5 to launch Extension Development Host
3. Test commands in the new window

---

## Code Conventions

- **TypeScript strict mode** everywhere
- **Zod** for input/output validation at boundaries
- **Fail-safe intelligence:** If analysis crashes, token counting still works
- **Structured logging:** Use `log()` and `logError()` functions in extension
- **Environment variables** for all config, no hardcoded values

### File Organization

```typescript
// extension.ts structure:
// ============================================================================
// State
// ============================================================================

// ============================================================================
// Logging
// ============================================================================

// ============================================================================
// Activation
// ============================================================================

// ============================================================================
// Commands
// ============================================================================

// ============================================================================
// Helpers
// ============================================================================
```

---

## Pricing Data

Model pricing is defined in `packages/shared/src/pricing.ts`:

```typescript
// Cost per 1M tokens
const MODEL_PRICING = {
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'claude-opus-4': { input: 15.0, output: 75.0 },
  'claude-sonnet-4': { input: 3.0, output: 15.0 },
  'claude-haiku-3.5': { input: 0.8, output: 4.0 },
  // ... more models
};
```

---

## The Problem We Solve

From the Cursor community:

| Problem | Evidence |
|---------|----------|
| Invisible token burn | "Simple edit eating 100,000+ tokens" |
| Agent loops | Same edit 4x, test still fails, $2.40 wasted |
| MCP overhead | Tool definitions consuming 22% of context |
| Context duplication | Duplicate rules, repeated file-state blocks |
| No real-time visibility | Top feature request on forums |

**Source:** [Cursor Forum Discussion](https://forum.cursor.com/t/why-is-a-simple-edit-eating-100-000-tokens-let-s-talk-about-this/120025)

---

## Prune v2 Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    PRUNE v2 ARCHITECTURE                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  INDEXING LAYER (on workspace load)                              │
│  ├─ Symbol Extractor (functions, classes, types)                │
│  ├─ Dependency Analyzer (calls, extends, imports)               │
│  └─ CODE INDEX (in-memory, per-session)                         │
│                                                                  │
│  CONTEXT SELECTION (on user prompt)                              │
│  ├─ Intent Classifier (debug/generate/refactor/explain)         │
│  ├─ Relevance DAG Walker (greedy, budget-aware)                 │
│  └─ CONTEXT PAYLOAD                                             │
│      ├─ Full code (critical/high relevance)                     │
│      ├─ Signatures (medium relevance)                           │
│      └─ References (low relevance, just names)                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Relevance Scoring Weights

```typescript
const WEIGHTS = {
  intentMatch: 0.35,      // How well symbol matches user's query
  dependencyDepth: 0.25,  // Hops from intent-matched symbols
  temporalRecency: 0.20,  // How recently file was modified
  errorProximity: 0.15,   // How close to error locations
  editRecency: 0.05,      // How recently edited in session
};
```

---

## Future Vision

### Phase 1: Foundation (Current)
- Symbol-level extraction with tree-sitter
- DAG with weighted edges
- Intent classification
- Signatures-only mode for peripherally relevant code

### Phase 2: Learning Layer
- Track which context contributed to successful completions
- Build a Context Utility Model
- Known Knowledge detection (don't send boilerplate the model knows)

### Phase 3: Bidirectional Negotiation
- Send manifest of available symbols
- Let LLM request what it needs
- Precise context delivery

### Target Metrics

| Metric | Target |
|--------|--------|
| Token Reduction | ≥70% vs naive |
| Context Precision | ≥85% (sent context appears in output) |
| Task Success Rate | ≥90% (user accepts without retry) |
| Latency Overhead | <200ms |

---

## Key Files to Know

| File | Purpose |
|------|---------|
| `apps/extension/src/extension.ts` | Extension entry point (Cursor / Claude Code / Codex) |
| `apps/extension/src/token-saver.ts` | **Smart Copy, Pre-flight, Session Memory, Compaction** |
| `apps/extension/src/prune-intelligence.ts` | v2 intelligence engine |
| `apps/extension/src/context-analyzer.ts` | File-level relevance scoring |
| `apps/extension/src/squeezer.ts` | Tree-sitter code compression |
| `packages/tokenizer/src/index.ts` | Token counting |
| `packages/state-scraper/src/index.ts` | Cursor usage tracking |
| `packages/shared/src/pricing.ts` | Model pricing data |
| `packages/intelligence/src/compaction-auditor.ts` | Compaction detection algorithms |

---

## MCP Server

The MCP server (`apps/mcp-server/`) provides tools for AI self-regulation:

| Tool | Description |
|------|-------------|
| `analyze_context` | Check token count before operations |
| `squeeze_files` | Compress files with three tiers |
| `check_budget` | Check remaining Cursor requests |

---

## What NOT to Build

- **No proxy architecture:** Extension works locally, no SaaS dependency
- **No heavy IDE integration:** Status bar + notifications only, under 300 lines for core
- **No cloud storage:** All data stays local
- **No model routing:** Suggestions only, user controls their tools

---

## Working Agreements (from usage insights)

> Distilled from how this repo is actually driven (orientation → research → catalog →
> build, with an adversarial second round and a high bar for verified, concrete output).
> These are operating rules for anyone — human or agent — working here.

1. **Deliverables are concrete, never abstract.** When asked for prompts, research lists,
   or meta-prompts, produce the **FULL verbatim text** — do not describe them abstractly or
   stop at a plan/summary. The artifact *is* the deliverable.

2. **Combined output means everything.** When asked to combine or display feature lists
   (e.g. List1 + List2, or "the catalog"), show **ALL items from every referenced list** in
   full, unless explicitly told to filter. Default to the union, not the latest slice.

3. **"Research"/"execute" means actually run it.** When asked to research or execute prompts,
   **run them** and map each result back to specific files/modules in the codebase — never
   stop at planning or synthesizing. State which prompts ran and show their outputs.

4. **Verify before commit.** Always run a clean compile + the test suite
   (`npm run build && npm run test`, or `tsc --noEmit` for a quick check) and fix any
   failures **before** committing. Catch a feature failing its own guards early, not after
   the push. (For autonomous-hook work, this includes the adversarial cases — malformed
   input, tokenization-DoS, fail-safe gaps.)

5. **Honesty bar (already load-bearing, restated):** no fabricated token/cost numbers
   (unknown model ⇒ `null`), no regex/model in a deterministic decision core, surfaces and
   feature handles in docs/dashboards must map to real MCP tools / hooks — never overclaim.

---

## The Golden Rule

> "If the intelligence layer crashes, does token counting still work?"
> The answer must always be YES.

Wrap all intelligence in try/catch. On failure, log and continue. The developer's workflow must never break because of Prune.

---

## Contributing

1. Fork the repo
2. Create a feature branch
3. Make changes with tests
4. Run `npm run build && npm run test`
5. Submit a PR

---

## License

MIT
