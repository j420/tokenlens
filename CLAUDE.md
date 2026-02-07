# CLAUDE.md — TokenLens (Prune)

> Token intelligence for AI coding assistants. Zero API keys required. All processing happens locally.

## What is this project

TokenLens (internally: Prune) is a VS Code extension that gives developers real-time visibility into token usage when working with AI coding tools like Cursor, Claude Code, and Codex. It solves the invisible token burn problem — developers have zero visibility into what they're spending, where the waste is, and what they're about to spend.

**The core philosophy:** Help developers reduce token consumption while maintaining the same context quality. Make every token count.

---

## Quick Start

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Package the VS Code extension
cd apps/extension
npm run package

# Install the VSIX in VS Code
# Extensions > ... > Install from VSIX > select prune-0.1.0.vsix
```

---

## Project Structure

```
tokenlens/
├── apps/
│   ├── extension/              # VS Code extension (main product)
│   │   ├── src/
│   │   │   ├── extension.ts          # Entry point, commands, status bar
│   │   │   ├── squeezer.ts           # WASM tree-sitter code compression
│   │   │   ├── context-analyzer.ts   # File-level relevance scoring
│   │   │   ├── prune-intelligence.ts # v2 engine: symbol-level DAG analysis
│   │   │   └── prune-intelligence.test.ts
│   │   └── wasm/               # Tree-sitter WASM grammars
│   ├── dashboard/              # Next.js web dashboard (in progress)
│   └── mcp-server/             # MCP server for AI self-regulation
├── packages/
│   ├── tokenizer/              # Local token counting (gpt-tokenizer)
│   ├── squeezer/               # Code compression library
│   ├── state-scraper/          # Cursor usage tracking (sql.js)
│   ├── intelligence/           # Core algorithms (relevance, ROI, cost)
│   ├── shared/                 # Shared types, pricing, config
│   └── db/                     # PostgreSQL schema (Drizzle ORM)
├── turbo.json
└── package.json
```

---

## Extension Commands

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

### 1. Real-Time Token Counter (Status Bar)

Shows token count for the current file or selection in the VS Code status bar. Updates on every keystroke. Color-coded based on spend thresholds.

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

# Run intelligence engine tests from VS Code
# Command Palette > "Prune: Run Intelligence Tests"
```

### Debugging the Extension

1. Open the `apps/extension` folder in VS Code
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
| `apps/extension/src/extension.ts` | VS Code extension entry point |
| `apps/extension/src/prune-intelligence.ts` | v2 intelligence engine |
| `apps/extension/src/context-analyzer.ts` | File-level relevance scoring |
| `apps/extension/src/squeezer.ts` | Tree-sitter code compression |
| `packages/tokenizer/src/index.ts` | Token counting |
| `packages/state-scraper/src/index.ts` | Cursor usage tracking |
| `packages/shared/src/pricing.ts` | Model pricing data |
| `packages/intelligence/src/analyzer.ts` | Core analysis algorithms |

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
