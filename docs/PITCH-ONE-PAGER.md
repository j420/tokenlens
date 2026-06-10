# TokenLens — one-pager

> **The cost control plane for agentic coding.** See every token before it's spent, reduce the waste automatically, prove the savings with signed receipts. Local-first, zero API keys.

*(Structured to map onto accelerator application questions — problem / insight / product / market / moat / risks / team / ask.)*

## Problem

AI coding agents burn tokens invisibly. Practitioners report simple edits eating 100k+ tokens, agents retrying the same failing edit four times, MCP tool definitions consuming 22% of context, and files re-read every few turns ([Cursor forum, top-requested feature class](https://forum.cursor.com/t/why-is-a-simple-edit-eating-100-000-tokens-let-s-talk-about-this/120025)). As teams move from autocomplete to autonomous agents, spend per developer is rising from tens to hundreds-to-thousands of dollars per month — and nobody can see where it goes, let alone stop it.

## Why now

Agentic coding is crossing into default practice; coding-agent spend is becoming a real line item that platform/engineering leadership must govern. The FinOps stack for it doesn't exist yet: today's LLM observability tools (Langfuse, Helicone, Portkey) *watch* spend after the fact. Nothing sits in the agent loop and *acts* on it.

## Product

TokenLens works inside any VS Code-based AI editor (Cursor, Claude Code, Codex) plus a 70-tool MCP server and 28 Claude Code lifecycle hooks, so the agent governs its own spend. Three layers:

1. **See** — live token/cost HUD; Pre-flight Optimizer shows "you're about to send 47k tokens; 8.2k would do" before the request goes out.
2. **Reduce** — deterministic reducers: signatures-only copy, AST compression, prompt-cache-habit linting (14 documented cache-killer patterns), provable re-read denial, loop breakers, budget gates — all coordinated by a single clearing price so optimizations can't thrash, all gated on statistical non-inferiority of output quality.
3. **Prove** — WasteBench: counterfactual net-savings accounting (TokenLens's own overhead subtracted) emitting **Ed25519-signed attestation manifests**. The buyer gets a signed receipt, not a dashboard claim.

## Differentiation / moat

- **Acts, not watches** — in the loop at decision time (pre-flight, pre-tool-call, pre-cache-bust), not post-hoc analytics.
- **Trust posture as a feature** — local-first, zero API keys, code never leaves the machine, and a hard honesty rule: unknown model ⇒ `null`, never a fabricated number. This is what lets enterprises adopt a tool that touches every prompt.
- **Attested savings** — signed, counterfactual, overhead-subtracted receipts. Nobody else can put a cryptographic signature under "we saved you 30%."
- **Provider neutrality is structural** — a cost-reduction layer must be neutral to be trusted; first-party vendors are conflicted (they bill the tokens).

## Platform risk (the obvious question)

Won't Anthropic/Cursor build this in? Partially, for visibility. But (a) cross-runtime developers need one governance layer across Cursor + Claude Code + Codex, (b) the vendor selling tokens auditing its own bill is a conflict the buyer sees, and (c) the moat is the reduction + attestation machinery (equivalence gates, clearing-price coordination, signed counterfactual accounting), not the token counter.

## Market

Bottom-up: heavy agentic developers already spend $200–$1,000+/mo; team plans put coding-agent spend at $1k–$5k+/dev/yr and climbing. A tool that attestably cuts 20–40% of that self-pays — pricing as a fraction of attested savings aligns incentives perfectly. Buyer: platform engineering / FinOps lead. Wedge: free local extension for developers → paid fleet dashboard + attestation for the org.

## Traction & status

Pre-launch (repo flips public + ships to VS Code Marketplace / OpenVSX / npm this sprint). Shipping today: 68-workspace TypeScript monorepo, fully green CI (134/134 turbo build+test tasks), the f1–f19 feature program, 70 MCP tools, 28 hooks, OpenTelemetry GenAI + FOCUS exporters. Signed dogfood benchmark: **84.5% measured token reduction** (structural tier, 46 of TokenLens's own source files, Ed25519-attested) — [`docs/BENCHMARK-DOGFOOD.md`](BENCHMARK-DOGFOOD.md). *(Update this section with install counts and session-level attested savings before submitting.)*

## Team

Solo founder. Built the entire system agent-first — using AI coding agents governed by the product itself — which is both the velocity proof (68 workspaces, full test coverage, in months) and the founder-market fit: the product exists because its builder felt every dollar of agent waste personally. Actively seeking a distribution-minded cofounder, including within the batch.

## Ask

*(Fill per program: YC standard deal / grant amount.)* Funds buy: full-time focus, design-partner program (5–10 teams with ≥$5k/mo coding-agent spend), and the hosted fleet dashboard.
