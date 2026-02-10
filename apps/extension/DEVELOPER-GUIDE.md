# TokenLens Developer Guide

**A comprehensive guide for new developers to understand the TokenLens (Prune) VS Code Extension**

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Architecture](#architecture)
3. [Project Structure](#project-structure)
4. [Core Features](#core-features)
5. [Code Paths](#code-paths)
6. [Key Source Files](#key-source-files)
7. [Data Flow](#data-flow)
8. [Testing](#testing)
9. [Building & Packaging](#building--packaging)
10. [Extension Points](#extension-points)

---

## Project Overview

### What is TokenLens?

TokenLens (internal codename: **Prune**) is a VS Code extension that provides **token intelligence for AI coding assistants**. It solves a critical problem: developers using AI tools like Cursor, Claude Code, and Copilot have zero visibility into their token consumption.

### The Problem We Solve

| Problem | Impact |
|---------|--------|
| Invisible token burn | Simple edits consuming 100,000+ tokens |
| Agent loops | Same edit repeated 4x, wasting $2.40 |
| Context duplication | Same files read multiple times per session |
| No real-time visibility | Users only see costs after the fact |

### Core Philosophy

> **"Help developers reduce token consumption while maintaining the same context quality. Make every token count."**

### Key Design Principles

1. **Zero API Keys Required** - All processing happens locally
2. **Privacy First** - Code never leaves the machine
3. **Fail-Safe** - If intelligence crashes, basic token counting still works
4. **Zero External Binaries** - Uses WASM for SQLite and tree-sitter

---

## Architecture

### High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        VS CODE EXTENSION                                  │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌────────────────┐  ┌──────────────────┐  ┌─────────────────────────┐  │
│  │   extension.ts │  │  token-saver.ts  │  │  prune-intelligence.ts │  │
│  │   (Entry Point)│  │   (Token Saver)  │  │  (v2 DAG Engine)       │  │
│  └───────┬────────┘  └────────┬─────────┘  └───────────┬─────────────┘  │
│          │                    │                        │                 │
│  ┌───────▼────────────────────▼────────────────────────▼─────────────┐  │
│  │                      CORE SERVICES                                 │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────────┐  │  │
│  │  │ squeezer.ts  │  │context-      │  │ comprehensive-tests.ts  │  │  │
│  │  │ (WASM AST)   │  │analyzer.ts   │  │ (107 tests)             │  │  │
│  │  └──────────────┘  └──────────────┘  └─────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                         SHARED PACKAGES                                   │
├──────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │  @prune/     │  │  @prune/     │  │  @prune/     │  │  @prune/     │ │
│  │  tokenizer   │  │  squeezer    │  │  state-      │  │  shared      │ │
│  │              │  │              │  │  scraper     │  │              │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

### Monorepo Structure

The project uses **Turborepo** for monorepo management:

```
tokenlens/
├── apps/
│   ├── extension/          # VS Code extension (main product)
│   ├── dashboard/          # Next.js web dashboard
│   └── mcp-server/         # MCP server for AI tools
├── packages/
│   ├── tokenizer/          # Token counting (gpt-tokenizer)
│   ├── squeezer/           # Code compression
│   ├── state-scraper/      # Cursor usage tracking
│   ├── intelligence/       # Core algorithms
│   ├── shared/             # Shared types, pricing
│   └── db/                 # Database schema
└── turbo.json              # Turbo config
```

---

## Project Structure

### Extension Directory (`apps/extension/`)

```
apps/extension/
├── src/
│   ├── extension.ts              # Main entry point, command registration
│   ├── token-saver.ts            # Smart Copy, Pre-flight, Session Memory
│   ├── prune-intelligence.ts     # v2 DAG-based context selection
│   ├── context-analyzer.ts       # File relevance scoring
│   ├── squeezer.ts               # WASM tree-sitter integration
│   ├── token-saver.test.ts       # Token saver unit tests
│   ├── prune-intelligence.test.ts # Intelligence engine tests
│   └── comprehensive-tests.ts    # 107 comprehensive tests
├── wasm/                         # Tree-sitter WASM grammars
│   ├── tree-sitter.wasm
│   ├── tree-sitter-typescript.wasm
│   ├── tree-sitter-javascript.wasm
│   └── tree-sitter-python.wasm
├── dist/                         # Built extension
├── package.json                  # Extension manifest
├── DEVELOPER-GUIDE.md            # This file
├── COMPREHENSIVE-TEST-RESULTS.md # Test documentation
└── prune-0.1.0.vsix              # Packaged extension
```

### Package Dependencies

```
@prune/tokenizer
    └── @prune/shared (pricing, types)

@prune/squeezer
    └── @prune/tokenizer

@prune/state-scraper
    └── sql.js (SQLite WASM)

@prune/intelligence
    ├── @prune/tokenizer
    └── @prune/shared
```

---

## Core Features

### 1. Smart Copy (`token-saver.ts:687-765`)

**What it does:** Copies code optimized for AI by extracting function signatures instead of full implementations.

**Keybinding:** `Ctrl+Alt+C` / `Cmd+Alt+C`

**How it works:**

```
Input: Full TypeScript file (3,200 tokens)
                    │
                    ▼
        ┌───────────────────────┐
        │  extractSignatures()  │
        │  - Parse imports      │
        │  - Extract functions  │
        │  - Extract classes    │
        │  - Replace bodies     │
        └───────────────────────┘
                    │
                    ▼
Output: Signatures only (340 tokens, 89% savings)
```

**Code Flow:**
```
smartCopyCommand() [extension.ts:1029]
    │
    ├── Get selected files from explorer or editor
    │
    ├── recordFileRead() [token-saver.ts:90]
    │   └── Track files in session memory
    │
    ├── generateSmartCopy() [token-saver.ts:687]
    │   │
    │   └── extractSignatures() [token-saver.ts:317]
    │       │
    │       ├── For large files (>2500 lines):
    │       │   └── extractSignaturesInChunks() [token-saver.ts:331]
    │       │
    │       └── extractSignaturesFromLines() [token-saver.ts:435]
    │           ├── Parse imports
    │           ├── Match function patterns (regex)
    │           ├── Handle classes and methods
    │           └── Replace bodies with { /* ... */ }
    │
    └── Copy to clipboard
```

**Supported Languages:**
- TypeScript/JavaScript (.ts, .tsx, .js, .jsx)
- Python (.py)
- Go (.go)
- Rust (.rs)
- Java (.java)

---

### 2. Pre-flight Optimizer (`token-saver.ts:854-1018`)

**What it does:** Analyzes context before sending to AI, recommending which files to include.

**Keybinding:** `Ctrl+Alt+P` / `Cmd+Alt+P`

**How it works:**

```
User Prompt: "fix the header alignment"
                    │
                    ▼
        ┌───────────────────────┐
        │  analyzePreFlight()   │
        │  - Score each file    │
        │  - Match keywords     │
        │  - Detect intent      │
        │  - Rank by relevance  │
        └───────────────────────┘
                    │
                    ▼
Output: Current (47K tokens) vs Recommended (8K tokens)
        Savings: 82%
```

**Code Flow:**
```
preflightCommand() [extension.ts:1117]
    │
    ├── Show input box for prompt
    │
    ├── incrementTurn() [token-saver.ts:192]
    │   └── Track session turn number
    │
    ├── Find workspace files (*.ts, *.js, etc.)
    │
    └── analyzePreFlight() [token-saver.ts:854]
        │
        ├── Extract keywords from prompt
        │
        ├── Score each file:
        │   ├── +100 if active file
        │   ├── +15 for filename keyword match
        │   ├── +8 for path keyword match
        │   ├── +25 for intent pattern match
        │   └── -70% for config/lock files
        │
        ├── Filter: score > 5, max 15 files, max 50K tokens
        │
        └── Return recommendations
```

**Intent Patterns (`token-saver.ts:800-840`):**

| Keywords | Boost Files Matching |
|----------|---------------------|
| test, testing, spec | `*.test.ts`, `*.spec.ts` |
| style, css, layout | `*.css`, `*.scss`, `styles/` |
| api, endpoint, route | `api/`, `routes/`, `handlers/` |
| auth, login, session | `auth/`, `login/`, `token/` |

---

### 3. Session Memory (`token-saver.ts:19-249`)

**What it does:** Tracks files read during a session to detect duplicates and save tokens.

**How it works:**

```
Turn 1: AI reads auth.ts → 2,400 tokens (recorded)
Turn 5: AI tries to read auth.ts again
        │
        ▼
    ┌────────────────────────────┐
    │  isFileInContext()         │
    │  - Check content hash      │
    │  - Compare with cached     │
    └────────────────────────────┘
        │
        ▼
Result: "Already in context from turn 1"
        → Skip read, save 2,400 tokens
```

**Key Data Structures:**

```typescript
interface FileReadRecord {
  path: string;
  contentHash: string;     // djb2 hash for comparison
  tokens: number;
  readAt: Date;
  turnNumber: number;
  isPartial: boolean;
  lineRange?: { start: number; end: number };
}

interface SessionMemory {
  filesRead: Map<string, FileReadRecord>;
  totalTokensSaved: number;
  deduplicationCount: number;
  sessionStart: Date;
  changesDetected: number;
}
```

**Memory Limits:**
- `MAX_FILES_IN_MEMORY`: 200 files
- `MAX_SESSION_DURATION_MS`: 4 hours
- Auto-prunes oldest 20% when limit reached

---

### 4. Compaction Recovery (`token-saver.ts:1021-1300`)

**What it does:** Tracks important decisions to remind users when context compacts.

**How it works:**

```
During Session:
    User: "Use bcrypt, not md5 for passwords"
                    │
                    ▼
    trackDecision("Use bcrypt...", "requirement", "critical")
                    │
                    ▼
    Stored in compactionSession.decisions Map

Later (Turn 12):
                    │
                    ▼
    getDecisionsAtRisk() [token-saver.ts:1150]
    - Finds decisions from turn < (current - 2)
    - Sorted by priority
                    │
                    ▼
    generateCompactionReminder() [token-saver.ts:1166]
    - Creates copy-pasteable reminder text
```

**Decision Categories:**
- `architectural`: Design patterns, structure
- `configuration`: Settings, values, limits
- `requirement`: Must-haves, constraints
- `constraint`: Order, dependencies

**Priority Levels:**
- `critical`: 🔴 Must not forget
- `high`: 🟠 Very important
- `medium`: 🟡 Important
- `low`: 🟢 Nice to remember

---

### 5. Real-Time Token Counter (`extension.ts:216-264`)

**What it does:** Shows token count in VS Code status bar, updating on every keystroke.

**Code Flow:**
```
onDidChangeTextEditorSelection [extension.ts:192]
    │
    ▼
updateStatusBar() [extension.ts:216]
    │
    ├── Get active editor text
    │
    ├── analyzeContent() [@prune/tokenizer]
    │   └── countTokens() using gpt-tokenizer
    │
    ├── Get session stats
    │
    └── Update status bar:
        ├── Normal: "$(symbol-misc) 1.2K"
        └── Large: "$(warning) 15K tokens" (yellow)
```

---

### 6. Context Analyzer (`context-analyzer.ts`)

**What it does:** Analyzes all workspace files to determine relevance to current task.

**Keybinding:** `Ctrl+Alt+A` / `Cmd+Alt+A`

**Multi-Language Import Parsing:**

| Language | Parser Function | Import Patterns |
|----------|-----------------|-----------------|
| JavaScript/TypeScript | `parseJSImports()` | `import`, `require()` |
| Python | `parsePythonImports()` | `from X import`, `import X` |
| Go | `parseGoImports()` | `import "path"`, `import ( )` |
| Rust | `parseRustImports()` | `use crate::`, `mod X;` |
| C/C++ | `parseCppImports()` | `#include "local.h"`, `<system.h>` |
| Ruby | `parseRubyImports()` | `require`, `require_relative` |
| PHP | `parsePHPImports()` | `require`, `include`, `use` |
| Java/Kotlin | `parseJavaImports()` | `import com.example.Class;` |

**Relevance Scoring:**

```
Score Calculation:
├── +100: Active file
├── +80: Imported by active file
├── +60: Imports active file
├── +70: Related file (test, types)
├── +50: Config file
├── +40: Filename matches keyword
├── +20: Same directory
├── +15: Content contains keyword
└── Threshold: score >= 30 = relevant
```

---

### 7. Prune v2 Intelligence Engine (`prune-intelligence.ts`)

**What it does:** Symbol-level DAG analysis for optimal context selection.

**Architecture:**

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

**Symbol Kinds:**
- `function`, `class`, `interface`, `type`, `variable`, `constant`

**Edge Types:**
- `calls`, `extends`, `implements`, `imports`, `uses_type`, `instantiates`, `references`, `test_for`

**Intent Types:**
- `debug`, `generate`, `refactor`, `explain`, `edit`, `test`, `review`

**Relevance Weights:**
```typescript
const WEIGHTS = {
  intentMatch: 0.35,      // How well symbol matches query
  dependencyDepth: 0.25,  // Hops from intent-matched symbols
  temporalRecency: 0.20,  // File modification time
  errorProximity: 0.15,   // Distance to error locations
  editRecency: 0.05,      // Session edit history
};
```

---

### 8. Code Squeezer (`squeezer.ts`)

**What it does:** Compresses code using tree-sitter AST analysis while preserving semantics.

**Compression Tiers:**

| Tier | Savings | What's Preserved |
|------|---------|------------------|
| Lossless | ~15% | Everything except comments |
| Structural | ~40% | Signatures, imports, types |
| Telegraphic | ~70% | Ultra-compressed symbols only |

**WASM Integration:**
```
squeezer.ts
    │
    ├── initParser(wasmDir)
    │   └── Loads tree-sitter.wasm
    │
    ├── loadLanguage(lang, wasmDir)
    │   └── Loads tree-sitter-{lang}.wasm
    │
    └── SemanticSqueezer.squeeze(code, lang)
        └── AST-based compression
```

---

## Code Paths

### Command Registration Flow

```
activate() [extension.ts:146]
    │
    ├── Create output channel
    ├── Create status bar
    │
    ├── initSqueezer() [async, non-blocking]
    │   └── Load WASM grammars
    │
    ├── Initialize Intelligence Engine
    │
    └── Register Commands:
        ├── prune.smartCopy → smartCopyCommand()
        ├── prune.preflight → preflightCommand()
        ├── prune.sessionStats → sessionStatsCommand()
        ├── prune.compactionCheck → compactionCheckCommand()
        ├── prune.trackDecision → trackDecisionCommand()
        ├── prune.analyzeFile → analyzeCurrentFile()
        ├── prune.analyzeContext → analyzeContextCommand()
        ├── prune.smartContext → smartContextCommand()
        ├── prune.squeezeFile → squeezeCurrentFile()
        └── prune.runTests → runTestsCommand()
```

### Token Counting Flow

```
User types in editor
        │
        ▼
onDidChangeTextEditorSelection
        │
        ▼
updateStatusBar() [extension.ts:216]
        │
        ▼
analyzeContent() [@prune/tokenizer]
        │
        ├── countTokens()
        │   └── encode() [gpt-tokenizer]
        │
        └── estimateCost()
            └── MODEL_PRICING[@prune/shared]
        │
        ▼
Update status bar text
```

### Signature Extraction Flow

```
extractSignatures(code, language) [token-saver.ts:317]
        │
        ├── If lines > 2500:
        │   └── extractSignaturesInChunks()
        │       └── Process in 2500-line chunks
        │
        └── extractSignaturesFromLines()
                │
                ├── Parse each line:
                │   ├── Skip comments
                │   ├── Track brace depth
                │   ├── Collect imports
                │   ├── Match function patterns
                │   ├── Match class patterns
                │   └── Handle decorators
                │
                └── Build output:
                    ├── Imports (max 20)
                    ├── Types (max 30)
                    └── Signatures (max 100)
```

---

## Key Source Files

### Extension Core

| File | Purpose | Key Functions |
|------|---------|---------------|
| `extension.ts` | Entry point, commands | `activate()`, `updateStatusBar()`, `smartCopyCommand()` |
| `token-saver.ts` | Token saving features | `generateSmartCopy()`, `analyzePreFlight()`, `recordFileRead()` |
| `context-analyzer.ts` | File relevance | `analyzeContext()`, `parseImports()` |
| `prune-intelligence.ts` | v2 DAG engine | `PruneIntelligenceEngine`, `selectContext()` |
| `squeezer.ts` | WASM compression | `SemanticSqueezer`, `squeeze()` |

### Packages

| Package | Purpose | Key Exports |
|---------|---------|-------------|
| `@prune/tokenizer` | Token counting | `countTokens()`, `analyzeContent()` |
| `@prune/shared` | Pricing, types | `MODEL_PRICING`, `PruneConfig` |
| `@prune/state-scraper` | Cursor tracking | `getCursorStatus()`, `fetchCursorUsage()` |
| `@prune/squeezer` | Compression lib | `SqueezeResult`, `CompressionTier` |
| `@prune/intelligence` | Algorithms | `CompactionAuditor`, `CostPredictor` |

---

## Data Flow

### Session Lifecycle

```
Extension Activation
        │
        ▼
┌───────────────────┐
│  Session Memory   │◄───── Files read during session
│  - filesRead Map  │
│  - tokensSaved    │
│  - currentTurn    │
└───────────────────┘
        │
        ▼
┌───────────────────┐
│ Compaction State  │◄───── Decisions tracked
│  - decisions Map  │
│  - contextHistory │
└───────────────────┘
        │
        ▼
User calls resetSession
        │
        ▼
All state cleared
```

### Pre-flight Analysis Flow

```
User enters prompt
        │
        ▼
Find workspace files (max 50)
        │
        ▼
For each file:
┌─────────────────────────────────────┐
│  1. Extract keywords from prompt     │
│  2. Score file by:                   │
│     - Active file bonus (+100)       │
│     - Keyword matches (+15-40)       │
│     - Intent patterns (+15-25)       │
│     - Directory proximity (+20)      │
│     - Content relevance (+8-10)      │
│  3. Penalize config files (-70%)     │
└─────────────────────────────────────┘
        │
        ▼
Filter: score > 5, max 15 files
        │
        ▼
Calculate savings: current - recommended
        │
        ▼
Return analysis with recommendations
```

---

## Testing

### Test Suites

| Suite | Tests | File |
|-------|-------|------|
| Smart Copy | 22 | `comprehensive-tests.ts` |
| Pre-flight Optimizer | 21 | `comprehensive-tests.ts` |
| Session Memory | 21 | `comprehensive-tests.ts` |
| Compaction Recovery | 21 | `comprehensive-tests.ts` |
| Signature Extraction | 22 | `comprehensive-tests.ts` |
| **Total** | **107** | |

### Running Tests

```bash
# Standalone (no VS Code required)
cd apps/extension
npx ts-node run-comprehensive-tests.ts

# In VS Code
# Command Palette > "Prune: Run Intelligence Tests"
```

### Test Categories

1. **Output Quality Tests**
   - Signatures contain function names
   - Bodies replaced with `{ /* ... */ }`
   - Imports preserved

2. **Edge Case Tests**
   - Empty files
   - Comment-only files
   - Unicode/emoji in code
   - Multi-line signatures

3. **Performance Tests**
   - Large files (100+ functions)
   - 100 file analysis < 5 seconds
   - Chunk processing for big files

---

## Building & Packaging

### Development Build

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Watch mode for extension
cd apps/extension
npm run watch
```

### Package for Distribution

```bash
cd apps/extension
npm run package
# Creates prune-0.1.0.vsix
```

### Install VSIX

```bash
code --install-extension prune-0.1.0.vsix
```

### VSIX Contents

```
prune-0.1.0.vsix (2.03 MB)
├── extension/
│   ├── dist/extension.js (bundled)
│   ├── wasm/
│   │   ├── tree-sitter.wasm
│   │   ├── tree-sitter-typescript.wasm
│   │   ├── tree-sitter-javascript.wasm
│   │   └── tree-sitter-python.wasm
│   └── package.json
└── manifest files
```

---

## Extension Points

### Adding a New Command

1. Add command to `package.json`:
```json
{
  "commands": [
    {
      "command": "prune.newFeature",
      "title": "Prune: New Feature"
    }
  ]
}
```

2. Register in `extension.ts`:
```typescript
context.subscriptions.push(
  vscode.commands.registerCommand("prune.newFeature", newFeatureCommand)
);
```

3. Implement the command:
```typescript
async function newFeatureCommand() {
  // Implementation
}
```

### Adding a New Language for Signature Extraction

In `token-saver.ts`, add patterns to `extractSignaturesFromLines()`:

```typescript
// New language function pattern
if (!matched && language === "newlang" && /^def\s+\w+/.test(trimmed)) {
  // Extract signature
  matched = true;
}
```

### Adding a New Intent Pattern for Pre-flight

In `token-saver.ts`, add to `INTENT_PATTERNS`:

```typescript
{
  keywords: ["graphql", "query", "mutation"],
  boostPatterns: [/graphql\//, /\.graphql$/, /\.gql$/],
  boost: 20,
},
```

---

## Debugging

### Enable Debug Logging

```typescript
// In squeezer.ts
setDebugMode(true);
```

### View Extension Logs

1. Open Output panel (`Ctrl+Shift+U`)
2. Select "Prune" from dropdown

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| WASM not loading | Missing wasm/ directory | Check `possiblePaths` in `initSqueezer()` |
| Token count wrong | Using wrong tokenizer | Check `detectProvider()` in tokenizer |
| Signature missed | Pattern not matching | Add regex in `extractSignaturesFromLines()` |

---

## Quick Reference

### Keybindings

| Command | Windows/Linux | Mac |
|---------|---------------|-----|
| Smart Copy | `Ctrl+Alt+C` | `Cmd+Alt+C` |
| Pre-flight | `Ctrl+Alt+P` | `Cmd+Alt+P` |
| Analyze File | `Ctrl+Alt+T` | `Cmd+Alt+T` |
| Analyze Context | `Ctrl+Alt+A` | `Cmd+Alt+A` |

### Important Constants

| Constant | Value | Location |
|----------|-------|----------|
| `MAX_FILES_IN_MEMORY` | 200 | `token-saver.ts:38` |
| `MAX_SESSION_DURATION_MS` | 4 hours | `token-saver.ts:39` |
| `MAX_LINES_PER_CHUNK` | 2500 | `token-saver.ts:307` |
| `MAX_SIGNATURES` | 100 | `token-saver.ts:308` |
| `MAX_IMPORTS` | 20 | `token-saver.ts:309` |
| `MAX_TYPES` | 30 | `token-saver.ts:310` |

### Model Pricing (per 1M tokens)

| Model | Input | Output |
|-------|-------|--------|
| GPT-4o | $2.50 | $10.00 |
| GPT-4o-mini | $0.15 | $0.60 |
| Claude Opus 4 | $15.00 | $75.00 |
| Claude Sonnet 4 | $3.00 | $15.00 |
| Claude Haiku 3.5 | $0.80 | $4.00 |

---

## The Golden Rule

> **"If the intelligence layer crashes, does token counting still work?"**
> The answer must always be **YES**.

All intelligence features are wrapped in try/catch. On failure, log and continue. The developer's workflow must never break because of Prune.

---

*Last updated: 2026-02-07*
*Version: 0.1.0*
