# CLAUDE.md — Prune by delimit.dev

## What is this project

Prune is a token intelligence middleware for AI coding tools. It sits as a transparent proxy between developers and their AI providers (Anthropic, OpenAI, Google), captures every API call, runs real-time intelligence on token usage, and surfaces insights through three thin clients: a web dashboard, a VS Code status bar companion, and a CLI wrapper.

The product solves one problem: developers using AI coding tools (Cursor, Claude Code, Codex) have zero visibility into what they're spending, where the waste is, and what they're about to spend. Prune gives them that visibility with active intervention.

---

## How People Actually Use Prune

Before building anything, understand the three user types and their exact experiences:

### User Type 1: Individual Developer

Their entire experience is:
- A tiny cost meter in their VS Code status bar or terminal they glance at while coding
- Occasional notifications (prune suggestions, waste alerts, compaction notices) that appear in their flow
- A web dashboard they open in their browser when curious about their day/week
- They never leave their IDE to use Prune. Prune comes to them.

### User Type 2: Multi-Tool Developer

Same as above, but they connect multiple tools (Cursor + Claude Code + Codex). Their dashboard shows unified spend across all tools. They can compare which tool is cheapest for which task type.

### User Type 3: Engineering Manager

They never code through Prune. Their entire experience is the web dashboard:
- Check team spend weekly
- Set budget rules (daily caps, project budgets, alerts)
- Export monthly reports for their VP/CFO
- They never touch an IDE or terminal for Prune.

---

## Architecture

Prune is protocol-first. The mental model:

```
Developer's IDE/Terminal
        ↓
    ONE ENV VARIABLE (e.g. ANTHROPIC_BASE_URL=https://delimit.dev/api/v1/proxy/anthropic)
        ↓
  Prune Proxy Layer (the brain)
   - Captures canonical event stream
   - Runs intelligence: pruning, waste detection, cost prediction, compaction diffing
   - Exposes WebSocket stream for real-time clients
   - Exposes REST API for async consumers
        ↓
  AI Provider (Anthropic / OpenAI / Google)
   - Prune speaks the exact same API contract as each provider
   - Transparent pass-through — adds intelligence without changing request/response schema
```

### Core URLs and Endpoints

```
# Proxy (transparent pass-through + intelligence)
POST /api/v1/proxy/anthropic/v1/messages
POST /api/v1/proxy/openai/v1/chat/completions
POST /api/v1/proxy/google/...

# Real-time stream (thin clients subscribe here)
WSS  /api/v1/stream/{session_id}
  Events: token_update | prune_suggestion | burn_alert | compaction_event

# Intelligence API
POST /api/v1/analyze/context
GET  /api/v1/predict/cost
GET  /api/v1/session/{id}/compaction-diff
GET  /api/v1/session/{id}/roi

# Dashboard API
GET  /api/v1/dashboard/overview
GET  /api/v1/dashboard/sessions
GET  /api/v1/dashboard/session/{id}
GET  /api/v1/dashboard/team
POST /api/v1/dashboard/budgets
GET  /api/v1/dashboard/alerts
```

### Canonical Event Schema

Every request flowing through the proxy produces this event:

```json
{
  "event_id": "uuid",
  "session_id": "uuid",
  "user_id": "uuid",
  "team_id": "uuid | null",
  "timestamp": "ISO-8601",
  "provider": "anthropic | openai | google",
  "tool": "claude-code | cursor | codex | direct-api | unknown",
  "model": "claude-sonnet-4-5-20250929",
  "tokens_in": 4200,
  "tokens_out": 1800,
  "tokens_cached": 2000,
  "latency_ms": 3400,
  "estimated_cost_usd": 0.042,
  "cumulative_session_cost_usd": 1.87,
  "tool_calls": ["read_file", "write_file"],
  "files_referenced": ["src/auth.ts", "src/utils.ts"],
  "compaction_triggered": false,
  "context_size_before": 48000,
  "context_size_after": 48000,
  "waste_flags": [],
  "classification": "productive | recursive | unknown",
  "roi_score": 0.87,
  "task_metadata": {
    "type": "refactor | debug | test | feature | unknown",
    "repo": "my-app",
    "branch": "feature/auth"
  }
}
```

---

## Tech Stack

- **Runtime:** Node.js with TypeScript
- **Proxy Framework:** Hono (lightweight, edge-ready, fast for proxy workloads)
- **Database:** PostgreSQL via Drizzle ORM
- **Real-time:** WebSocket via Hono upgrade
- **Queue:** BullMQ + Redis for async intelligence (waste detection, classification)
- **Auth:** API keys for proxy access. JWT for dashboard. Use Better Auth or Lucia.
- **Dashboard Frontend:** Next.js App Router + Tailwind CSS
- **Deployment:** Docker containers (Fly.io, Railway, AWS ECS, or self-hosted)

---

## The Onboarding Flow (Build This First in the Dashboard)

This is the first thing any user sees. It must be dead simple.

### Page: `delimit.dev` (Landing / Marketing)

Not part of the app. Just a marketing page explaining what Prune does. CTA button: "Get Started Free." Links to signup.

### Page: `delimit.dev/signup`

- Sign up with GitHub (primary) or email
- After signup, immediately redirect to onboarding — do NOT dump them on an empty dashboard

### Page: `delimit.dev/onboard`

Step 1 of 2: **"Connect your first tool"**

Show three cards the user can click:

```
┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
│  ⌨️  Claude Code     │  │  🖥️  Codex CLI       │  │  🔷 Cursor          │
│                     │  │                     │  │  (Max Mode)         │
│  Terminal / CLI     │  │  Terminal / CLI      │  │  VS Code            │
│  [Connect]          │  │  [Connect]           │  │  [Connect]          │
└─────────────────────┘  └─────────────────────┘  └─────────────────────┘
```

When they click "Connect" on Claude Code, show:

```
Add these two lines to your ~/.zshrc (or ~/.bashrc):

  export ANTHROPIC_BASE_URL=https://delimit.dev/api/v1/proxy/anthropic
  export PRUNE_API_KEY=prune_sk_abc123xyz

Then restart your terminal or run: source ~/.zshrc

That's it. Claude Code will now flow through Prune automatically.

[Copy to clipboard]    [I've added it →]
```

When they click "I've added it →", move to step 2.

For Codex CLI, same flow but with `OPENAI_BASE_URL`.
For Cursor, instructions to set the base URL in Cursor's settings panel.

Step 2 of 2: **"Verify connection"**

```
Run any Claude Code command in your terminal now.
Waiting for first request...

  ⏳ Listening for your first API call through Prune...
  ✅ Got it! Claude Code is connected. First request: 1,240 tokens, $0.04

[Open Dashboard →]
```

This page polls `/api/v1/dashboard/overview` until it sees the first event from this user. When it detects one, show the green checkmark and the "Open Dashboard" button. This moment is critical — the user must feel instant confirmation that it worked.

### Optional: VS Code Companion Install

After onboarding, show a dismissible banner on the dashboard:

```
💡 Want real-time cost tracking in your editor?
Install the Prune companion: ext install delimit.prune
It adds a cost meter to your status bar. Nothing else.
[Install] [Maybe later]
```

---

## UX Spec: The Real-Time Cost Meter (VS Code Companion)

### What it is

A single item in the VS Code status bar (the thin bar at the very bottom of the editor). It shows the running cost of the current AI session. That's all it does most of the time.

### Visual States

**Idle (no active AI session):**
```
Status bar: [ Prune: idle ]
Color: gray (#6b7280)
```

**Active session, normal spend:**
```
Status bar: [ 🟢 $0.45 · 12K tokens ]
Color: green (#10b981)
Updates: every time a new event comes through the WebSocket
```

**Active session, elevated spend (>$2 in current session):**
```
Status bar: [ 🟡 $3.20 · 84K tokens ]
Color: amber (#f59e0b)
```

**Active session, high spend (>$5 in current session) or waste detected:**
```
Status bar: [ 🔴 $7.40 · 192K tokens ⚠ ]
Color: red (#ef4444)
The ⚠ icon appears when there are unread waste alerts
```

**Thresholds for color changes (user-configurable in settings, defaults):**
- Green: $0 - $2.00
- Amber: $2.01 - $5.00
- Red: $5.01+

### Behavior

- Clicking the status bar item opens a small popup showing: current session cost, token count, ROI score, and a link to "Open in Dashboard"
- The meter resets when a new session starts (new Claude Code session, new Cursor Composer thread)
- Session detection: group events by `session_id` from the proxy. A new session ID = meter resets.

### Implementation

The VS Code extension subscribes to `wss://delimit.dev/api/v1/stream/{session_id}` and listens for `token_update` events. Each event contains `cumulative_session_cost_usd` and `cumulative_session_tokens`. The extension just updates the status bar text and color. The extension should be under 300 lines of TypeScript. No panels, no sidebars, no webviews, no tree views. Just the status bar item, a click popup, and notification handling (see below).

---

## UX Spec: Prune Suggestion (Context Pruning Notification)

### When it appears

When the proxy's context analyzer determines that >50% of attached tokens in a request are irrelevant to the prompt. This runs during the pre-flight phase before the request is forwarded to the provider.

### How it appears

**In VS Code:** As a notification toast (bottom-right corner of the editor). VS Code native notification API.

**In CLI (terminal wrapper):** As a colored terminal output between the user's prompt and the AI's response.

### The exact notification content

```
┌──────────────────────────────────────────────────────────────────┐
│  ✂️  Prune: Context can be trimmed                               │
│                                                                  │
│  You're about to send 15,200 tokens.                            │
│  Only lines 40-120 of styles.css appear relevant to this        │
│  CSS question. The remaining 13,500 tokens are unrelated         │
│  utility functions and API handlers.                             │
│                                                                  │
│  Estimated savings: $0.34                                        │
│                                                                  │
│  [Trim & Send]    [Send Full]    [Always trim for this repo]     │
└──────────────────────────────────────────────────────────────────┘
```

### Button behaviors

- **Trim & Send:** Prune strips the irrelevant context and forwards the leaner request. One-time action.
- **Send Full:** Prune forwards the original request unchanged. The developer knows best. No judgment.
- **Always trim for this repo:** Prune saves a per-repo rule: "For CSS questions in this repo, only include /styles/ directory and the component file." Future similar requests are auto-trimmed without asking. The user sees a brief confirmation: "Saved. Future CSS questions in my-app will auto-trim."

### If ignored

The notification auto-dismisses after 8 seconds and the request is sent in full (the safe default). Prune never blocks a request waiting for a response. If the developer is in flow and doesn't want to think about it, nothing happens — they just miss a savings opportunity.

### In the CLI wrapper

```
$ claude "fix the CSS bug on line 87 of styles.css"

  ✂️  Prune: Sending 15,200 tokens. Only ~1,700 are relevant to this CSS question.
  Trim to save $0.34? [Y/n/always]

> y

  ✓ Trimmed. Sending 1,700 tokens instead of 15,200.

  Claude: Looking at lines 40-120 of styles.css, the issue is...
```

If the user just hits Enter without typing anything, default is "n" (send full). Safe default. The `always` option sets the per-repo rule.

### What data the notification needs from the backend

The `prune_suggestion` WebSocket event must contain:

```json
{
  "type": "prune_suggestion",
  "request_id": "uuid",
  "total_tokens": 15200,
  "relevant_tokens": 1700,
  "relevant_ranges": [
    {"file": "styles.css", "start_line": 40, "end_line": 120}
  ],
  "irrelevant_summary": "utility functions and API handlers",
  "estimated_savings_usd": 0.34,
  "confidence": 0.89,
  "auto_dismiss_seconds": 8
}
```

The `confidence` field matters: only show suggestions when confidence > 0.75. Below that, Prune isn't sure enough and should stay silent. False positives (pruning relevant context) are much worse than missed savings.

---

## UX Spec: Burn Alert (Waste Detection Notification)

### When it appears

When the waste detection engine identifies one of the six waste patterns. This runs async after each event — it analyzes the pattern across recent events in the session.

### The six patterns and their exact alert messages

**Pattern 1: Circular Reasoning Loop**

Trigger: Model has produced 3+ code edits to the same file with >80% diff similarity, each followed by a test failure or error.

```
┌──────────────────────────────────────────────────────────────────┐
│  ⚠️  Prune Alert: Loop detected                                  │
│                                                                  │
│  The model has rewritten auth.test.ts 4 times with similar       │
│  edits. Each attempt failed the same assertion. 38K tokens       │
│  spent ($2.40) with no progress.                                 │
│                                                                  │
│  Suggestions:                                                    │
│  • Rephrase your prompt with more specific constraints           │
│  • Switch to Haiku for debugging (saves ~85% per attempt)        │
│  • Run /compact to reset context and try fresh                   │
│                                                                  │
│  [Switch to Haiku]    [Compact]    [Dismiss]                     │
└──────────────────────────────────────────────────────────────────┘
```

**Pattern 2: Redundant File Reads**

Trigger: Same file appears in `files_referenced` 3+ times in the session and file content hasn't changed between reads.

```
┌──────────────────────────────────────────────────────────────────┐
│  ⚠️  Prune Alert: Redundant reads                                │
│                                                                  │
│  The model has re-read src/auth.ts 4 times this session.         │
│  The file hasn't changed. ~16K tokens wasted ($0.42).            │
│                                                                  │
│  This usually happens when context is too large for the model    │
│  to "remember" earlier reads. Consider compacting or starting    │
│  a shorter session.                                              │
│                                                                  │
│  [Dismiss]                                                       │
└──────────────────────────────────────────────────────────────────┘
```

**Pattern 3: Compaction Storm**

Trigger: `compaction_triggered: true` more than 2 times in 60 minutes.

```
┌──────────────────────────────────────────────────────────────────┐
│  ⚠️  Prune Alert: Compaction storm                               │
│                                                                  │
│  Context has compacted 3 times in the last 45 minutes.           │
│  Each compaction costs ~30K tokens in overhead. Total waste:     │
│  ~90K tokens ($2.80) just on compaction summaries.               │
│                                                                  │
│  This session is too long for the context window. Start a        │
│  fresh session with a clear task description — it will be        │
│  cheaper and more effective.                                     │
│                                                                  │
│  [Dismiss]                                                       │
└──────────────────────────────────────────────────────────────────┘
```

**Pattern 4: Rapid Undo / Zero Acceptance**

Trigger: >30K tokens consumed in 10 minutes with no file writes persisted (all reverted or no writes at all).

```
┌──────────────────────────────────────────────────────────────────┐
│  ⚠️  Prune Alert: Low productivity                               │
│                                                                  │
│  42K tokens spent in the last 8 minutes ($3.40).                 │
│  0 code changes accepted. The model may be stuck.                │
│                                                                  │
│  Suggestions:                                                    │
│  • Break the task into smaller pieces                            │
│  • Provide a specific example of what you want                   │
│  • Switch to Flash for exploratory iteration (90% cheaper)       │
│                                                                  │
│  [Switch to Flash]    [Dismiss]                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Pattern 5: MCP Overhead Bloat**

Trigger: Tool call definitions in `tokens_in` exceed 15% of total input tokens.

```
┌──────────────────────────────────────────────────────────────────┐
│  💡 Prune Notice: High tool overhead                             │
│                                                                  │
│  MCP tool definitions are consuming 22% of your context          │
│  window (18K tokens) before any code or conversation.            │
│                                                                  │
│  Consider disabling unused MCP servers for this session.         │
│  You have 12 servers connected but this task only uses 3.        │
│                                                                  │
│  [Dismiss]                                                       │
└──────────────────────────────────────────────────────────────────┘
```

**Pattern 6: Statistical Cost Anomaly**

Trigger: Single event cost exceeds 3× the user's 30-day rolling average for that model + task type.

```
┌──────────────────────────────────────────────────────────────────┐
│  ⚠️  Prune Alert: Unusual cost spike                             │
│                                                                  │
│  Last request cost $4.20 — your average for similar requests     │
│  is $0.85. That's 5x higher than normal.                         │
│                                                                  │
│  This may indicate an oversized context or an unusually          │
│  complex response. Check if the attached context was             │
│  larger than intended.                                           │
│                                                                  │
│  [View Details]    [Dismiss]                                     │
└──────────────────────────────────────────────────────────────────┘
```

### Alert behavior rules

- **Never stack alerts.** If multiple patterns fire simultaneously, show only the most severe one (highest dollar waste). Queue others and show after the first is dismissed.
- **Cooldown period.** After an alert is dismissed, don't show another alert for the same pattern for 5 minutes. The developer said "I know" — respect it.
- **Never block.** Alerts are always notifications. They never pause the AI or block the request. The proxy forwards everything regardless of alerts. Alerts are advisory only.
- **Severity levels:** Patterns 1, 3, 4, 6 are ⚠️ (amber). Pattern 5 is 💡 (informational). Pattern 2 is ⚠️ but lower priority.
- **Sound:** No sound. Ever. Developers will uninstall anything that makes noise.

### Alert action buttons

- **Switch to [model]:** When clicked, this doesn't actually switch the model (Prune can't change the developer's tool config). Instead, it opens a small popup with the exact command or setting change needed: "In Claude Code, type /model and select haiku" or "In Cursor settings, change model to gpt-4.1-mini." In V2, Prune could auto-route at the proxy level, but V1 is advisory only.
- **Compact:** Opens a popup with the command: "Type /compact in Claude Code" or equivalent.
- **Dismiss:** Closes the alert. Starts the 5-minute cooldown for that pattern type.
- **View Details:** Opens `delimit.dev/dashboard/session/{id}` in the browser.

### Burn alert WebSocket event format

```json
{
  "type": "burn_alert",
  "alert_id": "uuid",
  "session_id": "uuid",
  "pattern": "circular_loop | redundant_reads | compaction_storm | zero_acceptance | mcp_bloat | cost_anomaly",
  "severity": "warning | info",
  "tokens_wasted": 38000,
  "cost_wasted_usd": 2.40,
  "file_involved": "auth.test.ts",
  "occurrences": 4,
  "message_title": "Loop detected",
  "message_body": "The model has rewritten auth.test.ts 4 times with similar edits...",
  "suggestions": [
    {"label": "Switch to Haiku", "action": "model_suggestion", "detail": "Type /model and select haiku"},
    {"label": "Compact", "action": "command_suggestion", "detail": "Type /compact"},
    {"label": "Dismiss", "action": "dismiss"}
  ],
  "cooldown_seconds": 300
}
```

---

## UX Spec: Compaction Notification

### When it appears

When the proxy detects `compaction_triggered: true` in a session event and the subsequent event shows reduced `context_size_after` compared to `context_size_before` of the previous event.

### What the notification shows

```
┌──────────────────────────────────────────────────────────────────┐
│  📋 Prune: Context compacted                                     │
│                                                                  │
│  Context was summarized at turn 22. Reduced from 148K → 42K      │
│  tokens (106K removed).                                          │
│                                                                  │
│  Lost references detected:                                       │
│  • JWT implementation pattern (discussed in turn 4)              │
│  • Token expiry set to 15min (decided in turn 8)                 │
│  • Auth middleware must chain before rate limiter (turn 11)       │
│  • /api/auth/refresh endpoint signature (turn 6)                 │
│                                                                  │
│  Consider re-stating these constraints in your next prompt       │
│  so the model doesn't drift.                                     │
│                                                                  │
│  [Copy lost items]    [View full diff]    [Dismiss]              │
└──────────────────────────────────────────────────────────────────┘
```

### Button behaviors

- **Copy lost items:** Copies the bullet points as plain text to clipboard. The developer can paste them directly into their next prompt to remind the model.
- **View full diff:** Opens `delimit.dev/dashboard/session/{id}#compaction-22` in the browser showing the detailed before/after comparison.
- **Dismiss:** Closes the notification.

### How the diff is generated

The proxy maintains a rolling buffer of recent messages/context in the session (from the events it has captured). When compaction is detected:

1. Take the list of specific entities (file names, function names, variable names, architectural decisions, configuration values, test requirements) mentioned in the pre-compaction messages
2. Check which of these entities are absent from the post-compaction context
3. For each lost entity, note which turn it was originally discussed in
4. Translate into plain English: "JWT implementation pattern (discussed in turn 4)"

The diff should NOT be a raw token-level comparison. It should be a semantic summary of what meaningful information was lost. Developers don't care about token deltas. They care about "what does the model no longer know."

### Compaction event WebSocket format

```json
{
  "type": "compaction_event",
  "session_id": "uuid",
  "turn_number": 22,
  "tokens_before": 148000,
  "tokens_after": 42000,
  "tokens_removed": 106000,
  "overhead_cost_usd": 0.84,
  "lost_references": [
    {"item": "JWT implementation pattern", "original_turn": 4, "category": "architectural_decision"},
    {"item": "Token expiry set to 15min", "original_turn": 8, "category": "configuration"},
    {"item": "Auth middleware chains before rate limiter", "original_turn": 11, "category": "architectural_constraint"},
    {"item": "/api/auth/refresh endpoint signature", "original_turn": 6, "category": "api_signature"}
  ],
  "lost_reference_count": 4,
  "summary": "4 references lost: 2 architectural decisions, 1 configuration value, 1 API signature"
}
```

---

## UX Spec: CLI Wrapper (Terminal Companion)

### What it is

A thin wrapper that sits around the `claude` and `codex` CLI commands. Installed via npm:

```
npm install -g @prune/cli
```

After installation, the developer uses `prune claude` instead of `claude`, or `prune codex` instead of `codex`. Alternatively, they can alias it in their shell:

```
alias claude="prune claude"
alias codex="prune codex"
```

### What it does

The wrapper starts the underlying CLI tool normally and subscribes to the WebSocket stream. After each AI response, it prints a one-line summary. When alerts fire, it prints the alert inline.

### The one-liner after each turn

```
$ claude "refactor auth to use JWT"

  [Claude's full response appears here as normal]

  ↳ Prune: 3.2K tokens · $0.12 · ROI 94% · session total $0.45
```

Format: `↳ Prune: {turn_tokens} tokens · ${turn_cost} · ROI {roi_score}% · session total ${session_total}`

Color coding:
- ROI 70-100%: green
- ROI 40-69%: amber
- ROI 0-39%: red
- Session total follows the same thresholds as the VS Code meter ($0-2 green, $2-5 amber, $5+ red)

### Prune suggestion in CLI

```
$ claude "fix the CSS bug on line 87"

  ✂️  Prune: Sending 15,200 tokens but ~1,700 are relevant.
  Trim to save $0.34? [Y/n/a(lways)]  _

> y
  ✓ Trimmed. Forwarding 1,700 tokens.

  [Claude's response appears]

  ↳ Prune: 1.7K tokens · $0.04 · ROI 100% · session total $0.49
```

- `Y` or `y` or Enter: trim and send
- `n`: send full
- `a`: save per-repo rule, trim this and all future similar requests

The prompt times out after 5 seconds. If no input, sends full (safe default).

### Burn alert in CLI

```
  [Claude's response appears — another failed attempt at auth.test.ts]

  ↳ Prune: 8.1K tokens · $0.52 · ROI 0% · session total $6.20

  ⚠  PRUNE ALERT: Loop detected
  │  auth.test.ts rewritten 4 times, same assertion failing each time.
  │  38K tokens ($2.40) spent with no progress.
  │
  │  Try: rephrase your prompt · /compact · switch to haiku
  └──────────────────────────────────────────────────────────────
```

The alert prints inline after the one-liner. It does not interrupt or block the CLI. The developer sees it and decides what to do.

### Compaction notice in CLI

```
  ↳ Prune: 2.1K tokens · $0.08 · ROI 82% · session total $3.10

  📋 Context compacted (148K → 42K tokens). 4 references may be lost:
  │  • JWT implementation pattern (turn 4)
  │  • Token expiry: 15min (turn 8)
  │  • Middleware chain order (turn 11)
  │  • /api/auth/refresh signature (turn 6)
  │
  │  Consider re-stating these in your next prompt.
  └──────────────────────────────────────────────────────────────
```

---

## UX Spec: Web Dashboard

### Page: `/dashboard` (Overview — the landing page after login)

This is the "holy shit I didn't know I was spending this" page. It should be visually simple and hit hard with one big number.

**Layout:**

```
┌─────────────────────────────────────────────────────────────────┐
│  Prune Dashboard                          [Settings ⚙️]  [Docs] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│              Today's Spend                                      │
│              $14.20                                              │
│              ▲ $3.40 more than your daily average               │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Sessions     │  │ Productive   │  │ Prune Saved  │          │
│  │ 6 today      │  │ 68%          │  │ $4.80        │          │
│  │              │  │ ████████░░░  │  │ 3 trims,     │          │
│  │              │  │              │  │ 1 alert      │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                 │
│  ─── Today's Sessions ──────────────────────────────────────    │
│                                                                 │
│  ┌─ 2:34 PM · Claude Code ─────────────────────────────────┐   │
│  │ auth-service refactor · 84K tokens · $4.20               │   │
│  │ ROI: 52% · ⚠ 2 waste events · 1 compaction              │   │
│  │ [View →]                                                  │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─ 11:15 AM · Cursor ─────────────────────────────────────┐   │
│  │ frontend button fix · 12K tokens · $0.45                  │   │
│  │ ROI: 94% · ✅ Clean session                               │   │
│  │ [View →]                                                  │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─ 9:02 AM · Claude Code ─────────────────────────────────┐   │
│  │ test generation · 42K tokens · $2.10                      │   │
│  │ ROI: 78% · ⚠ 1 waste event                               │   │
│  │ [View →]                                                  │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ─── Spend Over Time (7-day chart) ────────────────────────     │
│                                                                 │
│  $20│         ╭─╮                                               │
│  $15│    ╭────╯ │    ╭──╮                                       │
│  $10│ ───╯      ╰────╯  ╰──╮                                   │
│   $5│                       ╰──                                 │
│   $0└───┬────┬────┬────┬────┬────┬────                          │
│         Mon  Tue  Wed  Thu  Fri  Sat  Sun                       │
│                                                                 │
│  green area = productive spend                                  │
│  red area = waste spend                                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Key design decisions:**
- The biggest visual element is today's total spend. One number. Large font.
- The "Prune Saved" card is crucial — it shows the value of having Prune. "$4.80 saved" justifies the product's existence every day.
- Session list shows the tool icon (Claude Code / Cursor / Codex), a natural language task description, token count, cost, and ROI score. Waste events are flagged visually.
- The 7-day spend chart uses a stacked area: green for productive, red/orange for waste. The visual story is "how much of my spending is productive."
- Time period selector: Today / This Week / This Month / Custom range.

### Page: `/dashboard/session/[id]` (Session Drill-Down)

When the developer clicks "View →" on a session, they see the turn-by-turn breakdown.

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Back to Dashboard                                            │
│                                                                 │
│  Session: auth-service refactor                                 │
│  Claude Code · Claude Sonnet 4.5 · 2:34 PM - 3:12 PM          │
│  Total: 84K tokens · $4.20 · ROI: 52%                          │
│                                                                 │
│  ─── Turn-by-Turn Timeline ─────────────────────────────────    │
│                                                                 │
│  Turn 1 · 2:34 PM ──────────────────────── $0.12 · ✅          │
│  "Refactor auth module to use JWT"                              │
│  3.2K tokens in · 1.8K out · ROI: 100%                         │
│                                                                 │
│  Turn 2 · 2:36 PM ──────────────────────── $0.28 · ✅          │
│  "Also update the refresh token logic"                          │
│  4.1K tokens in · 3.2K out · ROI: 95%                          │
│                                                                 │
│  Turn 3 · 2:41 PM ──────────────────────── $0.45 · ⚠️          │
│  "Fix the failing test in auth.test.ts"                         │
│  8.4K tokens in · 6.2K out · ROI: 0% · LOOP START              │
│  ⚠ Circular loop: similar edit to auth.test.ts, test failed    │
│                                                                 │
│  Turn 4 · 2:43 PM ──────────────────────── $0.52 · 🔴          │
│  [AI retry — same approach]                                     │
│  8.1K tokens in · 5.9K out · ROI: 0% · LOOP CONTINUED          │
│  ⚠ 80% similarity to Turn 3 output                             │
│                                                                 │
│  Turn 5 · 2:45 PM ──────────────────────── $0.48 · 🔴          │
│  [AI retry — same approach]                                     │
│  7.8K tokens in · 6.1K out · ROI: 0% · LOOP CONTINUED          │
│  ⚠ BURN ALERT fired here: "Loop detected, $2.40 wasted"       │
│                                                                 │
│  Turn 6 · 2:48 PM ──────────────────────── $0.08 · ✅          │
│  "Let me try a different approach — mock the JWT library"       │
│  2.1K tokens in · 1.2K out · ROI: 100%                         │
│  ✅ Developer rephrased after Prune alert                       │
│                                                                 │
│  📋 COMPACTION · 2:52 PM ────────────────────────────────────   │
│  Context reduced from 68K → 24K tokens                          │
│  Lost references:                                               │
│  • JWT expiry: 15 minutes (turn 2)                              │
│  • Middleware chain order (turn 1)                               │
│  [View full diff]                                                │
│                                                                 │
│  Turn 7 · 2:52 PM ──────────────────────── $0.35 · ✅          │
│  "Continue — and remember JWT expiry is 15 minutes"             │
│  5.2K tokens in · 3.8K out · ROI: 88%                          │
│  ✅ Developer re-stated lost context from compaction notice     │
│                                                                 │
│  ... (remaining turns) ...                                       │
│                                                                 │
│  ─── Session Summary ───────────────────────────────────────    │
│                                                                 │
│  Total cost: $4.20                                              │
│  Productive cost: $2.18 (52%)                                   │
│  Wasted cost: $2.02 (48%)                                       │
│     Loop on auth.test.ts: $1.45                                 │
│     Compaction overhead: $0.42                                   │
│     Redundant file read (utils.ts): $0.15                       │
│  Prune interventions: 1 burn alert, 1 compaction notice         │
│  Estimated savings from Prune: $1.20                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Key design decisions:**
- Each turn shows: time, token counts, cost, ROI score, and any waste flags
- Waste turns are visually distinct (red/amber background)
- Compaction events appear inline in the timeline as distinct entries (not turns)
- The session summary at the bottom breaks down wasted cost by specific cause with dollar amounts
- "Estimated savings from Prune" reinforces the product's value

### Page: `/dashboard/settings`

```
┌─────────────────────────────────────────────────────────────────┐
│  Settings                                                        │
│                                                                 │
│  ─── Connected Tools ───────────────────────────────────────    │
│                                                                 │
│  ✅ Claude Code     ANTHROPIC_BASE_URL configured                │
│     Last seen: 2 minutes ago                                     │
│                                                                 │
│  ✅ Codex CLI       OPENAI_BASE_URL configured                   │
│     Last seen: 3 hours ago                                       │
│                                                                 │
│  ❌ Cursor          Not connected                                │
│     [Setup instructions]                                         │
│                                                                 │
│  ─── API Key ───────────────────────────────────────────────    │
│                                                                 │
│  prune_sk_abc123xyz...  [Copy] [Regenerate]                      │
│                                                                 │
│  ─── Alert Preferences ─────────────────────────────────────    │
│                                                                 │
│  Prune suggestions:        [On ✓]   Confidence threshold: [75%] │
│  Burn alerts:              [On ✓]   Cooldown: [5 min]           │
│  Compaction notices:       [On ✓]                                │
│  Cost meter color thresholds:                                    │
│     Green → Amber:  [$2.00]                                      │
│     Amber → Red:    [$5.00]                                      │
│                                                                 │
│  ─── Auto-Trim Rules ───────────────────────────────────────    │
│                                                                 │
│  my-app: CSS questions → only include /styles/ + component file  │
│  api-server: test questions → only include test file + source    │
│  [+ Add rule manually]                                           │
│                                                                 │
│  ─── Plan ──────────────────────────────────────────────────    │
│                                                                 │
│  Current: Free                                                   │
│  [Upgrade to Pro — $9/month]                                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Page: `/dashboard/team` (Manager View — Team tier only)

```
┌─────────────────────────────────────────────────────────────────┐
│  Team Dashboard                    Team: Acme Engineering        │
│                                                                 │
│              This Month's Spend                                  │
│              $4,200                                              │
│              Budget: $5,000 · 84% used · 12 days remaining      │
│              ████████████████████░░░░                            │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Team ROI     │  │ Waste        │  │ Prune Saved  │          │
│  │ 64%          │  │ $1,430       │  │ $820         │          │
│  │ productive   │  │ this month   │  │ this month   │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                 │
│  ─── By Developer ──────────────────────────────────────────    │
│                                                                 │
│  Developer       Spend    ROI    Waste    Sessions   Tool Mix   │
│  ─────────────────────────────────────────────────────────────  │
│  Alice K.        $620     82%    $112     42         CC 80%     │
│  Bob M.          $840     51%    $412     38         CC 60%     │
│  Charlie R.      $580     74%    $151     29         Cursor 90% │
│  Diana P.        $420     88%    $50      31         Codex 70%  │
│  ...                                                             │
│                                                                 │
│  ─── By Project ────────────────────────────────────────────    │
│                                                                 │
│  Project           Spend    ROI    Top Waste Pattern             │
│  ─────────────────────────────────────────────────────────────  │
│  auth-service      $1,200   58%    Circular loops ($340)        │
│  payment-api       $800     71%    Compaction storms ($120)     │
│  frontend          $600     84%    Clean                         │
│  ...                                                             │
│                                                                 │
│  ─── Budget Rules ──────────────────────────────────────────    │
│                                                                 │
│  Per-developer daily cap:    $30/day     [Edit]                  │
│  auth-service monthly:       $1,500/mo   [Edit]   82% used      │
│  payment-api monthly:        $1,000/mo   [Edit]   80% used      │
│                                                                 │
│  Alert channel: #engineering-costs on Slack    [Configure]       │
│  Alert rules:                                                    │
│  • Notify when any developer exceeds $20 in one session          │
│  • Notify when project hits 80% of monthly budget                │
│  • Block requests when developer hits daily cap                  │
│                                                                 │
│  [Export Monthly Report (PDF)]    [Export Raw Data (CSV)]        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Key design decisions for team dashboard:**
- The manager sees spend, ROI, and waste per developer — but NOT the content of their prompts. Privacy matters. Prune shows metrics, not conversations.
- "Tool Mix" column shows which tools each developer primarily uses (CC = Claude Code). Helps the manager understand tool adoption.
- Budget rules are configured here. When a budget is hit, the proxy enforces it: returns a clear message to the developer ("Daily budget reached. Contact your team admin.") instead of forwarding the request.
- Slack integration is critical for team tier. Budget alerts go to a channel, not just email.
- Export buttons for monthly reporting to leadership.

---

## What NOT to Build

- **No standalone model router.** Include routing as a suggestion inside burn alerts only.
- **No generic LLM observability.** Export to Langfuse/Datadog via OpenTelemetry. Don't compete.
- **No heavy IDE extensions.** VS Code companion is status bar + notifications. Under 300 lines. No panels, sidebars, webviews.
- **No long-term data warehouse ambitions.** Offer OTel export. Prune's value is intelligence, not storage.
- **No auth from scratch.** Use Better Auth or Lucia. API keys for proxy, JWT for dashboard.

---

## Project Structure

```
prune/
├── apps/
│   ├── proxy/                 # Hono proxy server
│   │   ├── src/
│   │   │   ├── providers/     # Anthropic, OpenAI, Google adapters
│   │   │   ├── intelligence/  # Pruning engine, waste detection, ROI classification
│   │   │   ├── events/        # Canonical event creation + storage
│   │   │   ├── stream/        # WebSocket real-time stream
│   │   │   └── api/           # Intelligence REST endpoints
│   │   └── package.json
│   ├── dashboard/             # Next.js web dashboard
│   │   ├── src/app/
│   │   │   ├── (auth)/        # Login, signup
│   │   │   ├── onboard/       # Onboarding wizard
│   │   │   ├── dashboard/     # Overview, sessions, session detail
│   │   │   ├── team/          # Team dashboard (team tier)
│   │   │   └── settings/      # User settings, API keys, alert prefs
│   │   └── package.json
│   └── docs/                  # Documentation site
├── packages/
│   ├── shared/                # Shared types, Zod schemas, event definitions
│   ├── db/                    # Drizzle schema + migrations
│   └── intelligence/          # Core algorithms (pruning, waste rules, ROI)
├── clients/
│   ├── vscode/                # VS Code companion extension
│   └── cli/                   # CLI wrapper for claude/codex
├── docker-compose.yml
├── turbo.json
└── CLAUDE.md                  # This file
```

---

## Code Conventions

- TypeScript strict mode everywhere
- Zod for all input/output validation at proxy boundary
- **Critical rule:** If Prune's intelligence layer crashes, the proxy must still forward the request and return the response. The developer's API call must never break because of Prune. Wrap all intelligence in try/catch. On failure, log and pass through silently.
- Structured JSON logs with correlation IDs tracing through proxy → intelligence → storage → alert
- Integration tests for proxy transparency are highest priority: requests through Prune must be byte-identical to direct requests (minus latency)
- Environment variables for all config. No hardcoded URLs, keys, or thresholds.

---

## Build Sequence

```
Phase 0 — Weeks 1-8: Foundation
├── P0-A: Proxy layer (Anthropic + OpenAI transparent pass-through)
├── P0-B: Canonical event capture + PostgreSQL storage
├── P0-C: WebSocket stream for real-time events
├── P0-D: Waste detection engine (6 pattern rules, async via BullMQ)
├── P0-E: Dashboard — onboarding flow (signup, connect tool, verify)
├── P0-F: Dashboard — overview page (today's spend, sessions list, chart)
├── P0-G: Dashboard — session drill-down (turn-by-turn timeline)
├── P0-H: Dashboard — settings (API keys, connected tools, alert prefs)
└── Deliverable: Working free tier. Developer connects, sees cost data, gets waste alerts.

Phase 1 — Weeks 6-14: SHADOW Intelligence + Clients
├── P1-A: Semantic Token Budgeter (context analysis + prune suggestions)
├── P1-B: Token ROI classification (productive vs recursive scoring)
├── P1-C: Compaction quality auditor (before/after diff)
├── P1-D: VS Code companion extension (status bar + notification handler)
├── P1-E: CLI wrapper (one-liner output + inline alerts)
└── Deliverable: Pro tier at $9/month. Full developer experience.

Phase 2 — Weeks 12-24: Team + Revenue
├── P2-A: Team management (invites, roles, team proxy keys)
├── P2-B: Team dashboard (by-developer, by-project, by-tool views)
├── P2-C: Budget guardrails (caps, rules, enforcement at proxy)
├── P2-D: Slack integration (alert routing)
├── P2-E: Monthly report export (PDF/CSV)
├── P2-F: Predictive cost estimator (ML model on aggregated data)
├── P2-G: OpenTelemetry export
└── Deliverable: Team tier at $25/seat/month. Enterprise ready.
```

### Starting a coding session

Always start with the proxy layer (P0-A). Get a single Anthropic messages request flowing through transparently. Then add event capture. Then add the WebSocket stream. Then waste detection. Then the dashboard. Layer by layer.

The golden rule: **"If my intelligence layer crashes, does the developer's API call still work?" The answer must always be yes.**
