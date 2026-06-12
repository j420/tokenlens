# TokenLens — 3-minute demo script

> Shot-by-shot, written to record in one take with OBS/QuickTime + a mic.
> Setup: a real mid-size TypeScript repo open in Cursor (or Claude Code) with the
> TokenLens VSIX installed and hooks installed (`Prune: Install Claude Code Hooks`).
> Font size 16+, dark theme, status bar visible. Rehearse once; total runtime target 2:45.

## Shot 1 — the problem (0:00–0:25)

**Screen:** the editor, an AI chat pane open, a normal-looking session.

**Say:** "AI coding agents burn tokens invisibly. Practitioners report simple edits eating a hundred thousand tokens, agents retrying the same failing edit four times, files re-read every few turns. You see the bill at the end of the month — never the waste while it's happening. TokenLens is the cost control plane for agentic coding: it runs entirely locally, zero API keys, and it does three things — see, reduce, prove."

## Shot 2 — SEE: the HUD (0:25–0:45)

**Do:** click into a source file; point at the status bar token/cost counter; type a few lines — counter updates live. Switch to a large file — counter turns red.

**Say:** "First, visibility. Every file, every selection, every prompt has a live token count and a projected cost, right in the status bar. Unknown model? It says 'insufficient data' — TokenLens never invents a number."

## Shot 3 — SEE: Pre-flight (0:45–1:20) — *the money shot*

**Do:** in a file related to a small task, press `Ctrl+Alt+P`. Type the task: "fix the header alignment". The Pre-flight panel renders: current context (N files / ~47k tokens / $X per request) vs. recommended (3 files / ~8k / $Y), with the savings line.

**Say:** "Before you send anything, Pre-flight shows what you're *about* to spend — and what you actually need. Forty-seven thousand tokens requested; eight thousand would do. That's an 82% cut on this one request, computed locally from a symbol-level relevance graph of your codebase, before a single token leaves your machine."

## Shot 4 — REDUCE: Smart Copy (1:20–1:45)

**Do:** select 2–3 implementation files in the explorer → right-click → "Copy for AI (Optimized)" → paste into the chat pane. Show the signatures-only output and the notification: "3,200 tokens → 340 (89% reduction)".

**Say:** "Reduction is built into the workflow. Smart Copy sends typed signatures instead of full source — the model gets the contract, you keep ninety percent of the tokens."

## Shot 5 — REDUCE: the agent governing itself (1:45–2:15)

**Do:** in a Claude Code session with hooks installed, trigger a visible advisory — e.g. ask the agent to re-read a file it already read (read-gate denial appears), or show the cache-habits advisor warning firing on a cache-killer pattern in the transcript.

**Say:** "With one command, TokenLens installs twenty-eight lifecycle hooks into Claude Code, and exposes seventy MCP tools — so the *agent itself* is governed: re-reads of content provably still in context get denied, prompt-cache-killing patterns get flagged before they fire, identical-action loops get broken after the second provably-no-progress repeat. Every reducer is deterministic and quality-gated: it acts only when output is statistically non-inferior."

## Shot 6 — PROVE: the attestation (2:15–2:45)

**Do:** run the WasteBench attestation (per `docs/BENCHMARK-DOGFOOD.md` reproduction commands); show the output manifest: net savings with overhead subtracted, and the Ed25519 signature block.

**Say:** "And here's the part nobody else does. WasteBench measures savings *counterfactually* — against doing nothing — and subtracts TokenLens's own overhead. Then it signs the result. This is a tamper-evident receipt for every dollar saved. Observability tools give you a dashboard; TokenLens gives you a signed receipt. TokenLens — see it, cut it, prove it. It's open source — link below."

## Recording checklist

- [ ] Status bar visible; HUD enabled (`prune.hud.enabled`)
- [ ] Hooks installed and at least one advisory pre-triggered in rehearsal
- [ ] Pre-flight task rehearsed so the recommended-files list is sensible
- [ ] Benchmark attestation pre-run once so Shot 6 is instant
- [ ] No real secrets/repos on screen you can't publish
- [ ] Export 1080p; captions on the three numbers (82% / 89% / signed receipt)
