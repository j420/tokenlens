# TokenLens

> **The cost control plane for agentic coding.** See every token before you spend it, reduce the waste automatically, and prove the savings — locally, with zero API keys.

TokenLens (engine name: **Prune**) works inside any VS Code-based AI editor — Cursor, Claude Code, OpenAI Codex — and is provider-neutral. All processing happens on your machine; your code never leaves it.

**MIT licensed · 68-workspace TypeScript monorepo · 28 Claude Code hooks · 70 MCP tools · 17 editor commands**

---

## The problem

AI coding agents burn tokens invisibly. From the [Cursor forum](https://forum.cursor.com/t/why-is-a-simple-edit-eating-100-000-tokens-let-s-talk-about-this/120025) and daily practice:

| Problem | Evidence |
|---------|----------|
| Invisible token burn | "Simple edit eating 100,000+ tokens" |
| Agent loops | Same edit 4×, test still fails, $2.40 wasted |
| MCP overhead | Tool definitions consuming 22% of context |
| Context duplication | Duplicate rules, repeated file-state blocks, re-read files |
| No real-time visibility | Top feature request on the forums |

Developers have zero visibility into what they're spending, where the waste is, and what they're about to spend. TokenLens makes that visible — then actively reduces it.

## How it works: See → Reduce → Prove

### 1. SEE — know what you're about to spend

A status-bar HUD shows live token counts and projected cost as you type. Before sending a request, the **Pre-flight Optimizer** (`Ctrl+Alt+P`) shows what you'd spend vs. what you could:

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

Pricing is **strict and honest**: an unknown model yields `null` ("insufficient data"), never a fabricated rate or a fake `$0`.

### 2. REDUCE — make every token count

A library of deterministic reducers, surfaced as editor commands, Claude Code lifecycle hooks, and MCP tools the agent can call on itself:

- **Smart Copy** (`Ctrl+Alt+C`) — copy files as typed signatures instead of full source.
- **Cache-habits linter** — warns *before* a documented prompt-cache-killer pattern fires (14 rules, CH-001..CH-014).
- **Session memory** — knows what's already in context, so the agent doesn't pay to re-read it (read-gate denies a re-read only when content is *provably* still in context).
- **Squeezer** — AST-level code compression (tree-sitter / TS Compiler API) in three tiers, up to ~70% reduction.
- **Symbol-level context selection** — a relevance DAG over your codebase picks full code / signatures / references per symbol, under a token budget.
- **Clearing-price controller** — one PID-paced price λ that every reducer bids against (`act iff qualityGain ≥ λ·tokenCost`), so the fleet of optimizations can't thrash.
- **Breakers** — identical-action loop breaker, budget gate, cost SLOs, fan-out and edit-amplification detectors.

Every cost-affecting transform is **equivalence-gated**: it ships only when output quality is statistically non-inferior. Decision logic is deterministic — no model calls, no regex classification, fail-safe by construction.

### 3. PROVE — attested savings, not vibes

**WasteBench** does counterfactual net-savings accounting — savings measured against the do-nothing baseline, *with TokenLens's own overhead subtracted* — and emits tamper-evident, Ed25519-signed attestation manifests. Observability tools show you a dashboard; TokenLens hands you a signed receipt.

Benchmark methodology and current results: [`docs/BENCHMARK-DOGFOOD.md`](docs/BENCHMARK-DOGFOOD.md).

## Quick start

```bash
npm install
npm run build

# Package the extension
cd apps/extension && npm run package
# Install the VSIX: Extensions > … > Install from VSIX > prune-0.1.0.vsix
```

Then in your editor:

| Command | Keys | What it does |
|---------|------|--------------|
| Copy for AI (Optimized) | `Ctrl+Alt+C` | Signatures-only copy, typically 70–90% smaller |
| Pre-flight Optimizer | `Ctrl+Alt+P` | Spend preview + recommended context before you send |
| Smart Context Analysis | `Ctrl+Alt+A` | Score workspace files for relevance to a task |
| Analyze Current File | `Ctrl+Alt+T` | Token count + cost for the current file |
| Install Claude Code Hooks | — | One command installs the 28-hook lifecycle suite |

The MCP server (`apps/mcp-server`) exposes 70 tools so the agent can regulate its own spend: `analyze_context`, `squeeze_files`, `cache_habits`, `routing_decide`, `replay_verify`, `wastebench_attest`, and more.

## Architecture

```
tokenlens/
├── apps/
│   ├── extension/     # Editor extension: HUD, Pre-flight, Smart Copy, 28 Claude Code hooks
│   ├── mcp-server/    # 70 MCP tools for AI self-regulation
│   └── dashboard/     # Next.js dashboard + telemetry read-side
└── packages/          # 65 packages: tokenizer, squeezers, relevance DAG, semantic cache,
                       # cache-habits, replay-cost, wastebench, routing, budget/SLO gates,
                       # sentinel (secrets + prompt-injection), exporters (OTel GenAI, FOCUS)
```

Design principles:

- **Zero API keys, offline-first** — tokenization, analysis, and pricing all run locally.
- **Privacy-preserving** — code never leaves the machine; telemetry is local SQLite (Postgres sink optional, self-hosted).
- **No fabricated numbers** — unknown model ⇒ `null`, everywhere, always.
- **Fail-safe** — if the intelligence layer crashes, token counting still works. The developer's workflow must never break because of TokenLens.
- **Open standards** — OpenTelemetry GenAI and FOCUS FinOps exporters built in.

## Tech stack

Node.js 20+ · TypeScript 5.7 (strict) · Turbo monorepo · esbuild · gpt-tokenizer · tree-sitter (WASM) · sql.js (WASM, no native binaries) · Next.js 14 · Drizzle ORM · `@modelcontextprotocol/sdk`

## Development

```bash
npm run build   # build all workspaces
npm run test    # full test suite
```

See [`CLAUDE.md`](CLAUDE.md) for the full feature map (TCRP f1–f19 + value levers), hook system documentation, and working agreements.

## Contributing

1. Fork, branch, make changes with tests
2. `npm run build && npm run test`
3. Submit a PR

## License

[MIT](LICENSE)
