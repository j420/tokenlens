# TokenLens / Prune - Research & Vision Document

> This document captures research, competitive analysis, and the roadmap for building a differentiated token intelligence solution for AI coding assistants.

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Market Research: User Pain Points](#market-research-user-pain-points)
3. [Competitive Analysis: CAP (Contextual Addressing Protocol)](#competitive-analysis-cap)
4. [Our Current Implementation](#our-current-implementation)
5. [Gap Analysis: CAP vs Our Approach](#gap-analysis-cap-vs-our-approach)
6. [Principal Engineer's Vision: Prune v2](#principal-engineers-vision-prune-v2)
7. [Implementation Roadmap](#implementation-roadmap)

---

## Problem Statement

Developers using AI coding tools (Cursor, Claude Code, Codex) have **zero visibility** into:
- What they're spending on AI API calls
- Where token waste is happening
- What they're about to spend before a request

**The Numbers:**
- Simple edits consuming 100,000+ tokens unexpectedly
- Agent mode burning tokens with loops and multiple API calls
- MCP servers adding 20%+ overhead
- Users getting surprise bills ($200/month plans exhausted in days)

**Source:** [Cursor Forum - Why is a simple edit eating 100,000+ tokens?](https://forum.cursor.com/t/why-is-a-simple-edit-eating-100-000-tokens-let-s-talk-about-this/120025)

---

## Market Research: User Pain Points

### From Cursor Community

| Problem | User Evidence |
|---------|--------------|
| Invisible token burn | "Simple edit eating 100,000+ tokens" |
| Agent loops | Same edit 4x, test still fails, $2.40 wasted |
| MCP overhead | Tool definitions consuming 22% of context |
| Context duplication | Duplicate rules, repeated file-state blocks |
| Surprise bills | Users burning entire Pro subscription in hours |
| No real-time visibility | Top feature request on forums |

### Pricing Changes (June 2025)

- Cursor moved from request-based to usage-based billing
- New tiers: Pro+ ($60/month), Ultra ($200/month)
- Claude Opus 4 costs $15/M input, $75/M output tokens
- Users reporting unexpected charges, refunds issued

---

## Competitive Analysis: CAP

### CAP (Contextual Addressing Protocol) - Full Specification

```
cap/
├── src/
│   ├── index.ts                  # CLI entry point
│   ├── intent/
│   │   ├── parser.ts             # Intent classification (edit/debug/explain/generate/refactor)
│   │   └── types.ts
│   ├── analysis/
│   │   ├── typescript-analyzer.ts # TS/JS static analysis using ts-morph
│   │   ├── python-analyzer.ts     # Python static analysis using tree-sitter
│   │   ├── types.ts              # CodeUnit, Dependency types
│   │   └── file-discovery.ts     # Git-aware file discovery
│   ├── dag/
│   │   ├── relevance-dag.ts      # Core DAG data structure
│   │   ├── scorer.ts             # Multi-signal relevance scoring
│   │   ├── walker.ts             # Budget-aware DAG traversal
│   │   └── types.ts
│   ├── context/
│   │   ├── compiler.ts           # Assembles final context payload
│   │   ├── deduplicator.ts       # Cross-turn semantic deduplication
│   │   ├── formatter.ts          # Output formatting
│   │   └── types.ts
│   ├── signals/
│   │   ├── git-recency.ts        # Temporal recency signal
│   │   ├── error-proximity.ts    # Stack trace parsing
│   │   └── edit-history.ts       # Session edit tracking
│   └── utils/
│       ├── tokenizer.ts          # Token counting (tiktoken)
│       ├── config.ts
│       └── logger.ts
```

### CAP Core Concepts

#### 1. Intent Classification

```typescript
type IntentType = 'edit' | 'debug' | 'explain' | 'generate' | 'refactor';

interface ParsedIntent {
  type: IntentType;
  query: string;
  entities: {
    filePaths: string[];
    symbols: string[];
    errorMessages: string[];
    keywords: string[];
  };
  confidence: number;
}
```

**Rules:**
- "fix", "bug", "error", "crash" → `debug`
- "add", "create", "implement" → `generate`
- "refactor", "rename", "extract" → `refactor`
- "explain", "how does", "what does" → `explain`
- "change", "update", "modify" → `edit`

#### 2. Code Unit Extraction

```typescript
interface CodeUnit {
  id: string;                    // filePath#symbolName
  filePath: string;
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'module';
  startLine: number;
  endLine: number;
  tokenCount: number;
  content: string;
}

interface Dependency {
  from: string;
  to: string;
  kind: 'imports' | 'calls' | 'extends' | 'implements' | 'references';
}
```

#### 3. Relevance DAG

```typescript
interface DAGNode {
  codeUnit: CodeUnit;
  relevanceScore: number;
  signals: {
    intentMatch: number;         // How well matches intent (0-1)
    dependencyDepth: number;     // Hops from intent-matched node
    temporalRecency: number;     // How recently modified (0-1)
    errorProximity: number;      // How close to error locations (0-1)
    editRecency: number;         // How recently edited in session (0-1)
  };
}

interface DAGEdge {
  from: string;
  to: string;
  weight: number;                // 0-1
  kind: Dependency['kind'];
}
```

#### 4. Scoring Weights

```typescript
const WEIGHTS = {
  intentMatch: 0.35,
  dependencyDepth: 0.25,
  temporalRecency: 0.20,
  errorProximity: 0.15,
  editRecency: 0.05,
};

// Dynamic weight adjustment:
// - Debug intents: errorProximity → 0.30, temporalRecency → 0.05
// - Generate intents: intentMatch → 0.45
// - Refactor intents: dependencyDepth → 0.35
```

#### 5. DAG Walker Algorithm

```typescript
function walkDAG(dag: RelevanceDAG, tokenBudget: number): WalkResult {
  // 1. Sort all nodes by relevanceScore descending
  // 2. Greedily add nodes while under token budget
  // 3. For each added node, boost scores of direct neighbors
  //    (multiply by edge weight × 0.3 bonus)
  // 4. Re-sort and continue
  // 5. At 80% budget → switch to "signatures only" mode
  // 6. Stop when budget reached or no nodes above minRelevance
}
```

#### 6. Context Payload Output

```typescript
interface ContextPayload {
  metadata: {
    intent: ParsedIntent;
    tokenBudget: number;
    tokensUsed: number;
    tokenSavings: number;
    savingsPercentage: number;
  };
  context: Array<{           // Full code (high relevance)
    filePath: string;
    symbol: string;
    relevanceScore: number;
    content: string;
  }>;
  signatures: Array<{        // Signatures only (medium relevance)
    filePath: string;
    symbol: string;
    signature: string;
  }>;
  manifest: Array<{          // What's available but excluded
    filePath: string;
    symbols: string[];
    reason: string;
  }>;
}
```

---

## Our Current Implementation

### What We've Built

1. **Semantic Code Squeezer**
   - Uses tree-sitter WASM for AST parsing
   - Compresses function bodies with semantic hints
   - Example: `{ /* file I/O, async, → result */ }`
   - 25-80% token reduction

2. **Smart Context Analyzer**
   - Multi-language import parsing (JS, TS, Python, Go, Rust, Java, C++, Ruby, PHP)
   - File-level relevance scoring
   - Keyword matching from prompt
   - Auto-excludes: lock files, node_modules, dist

3. **VS Code Extension**
   - Real-time token counting in status bar
   - Commands: Analyze, Squeeze, Context Analysis
   - VSIX packaging for easy installation

### Current Architecture

```
apps/extension/
├── src/
│   ├── extension.ts          # VS Code integration
│   ├── squeezer.ts           # Semantic compression (tree-sitter)
│   └── context-analyzer.ts   # File relevance scoring
├── wasm/                     # Tree-sitter WASM grammars
└── package.json
```

---

## Gap Analysis: CAP vs Our Approach

| Aspect | Our Approach | CAP | Gap |
|--------|--------------|-----|-----|
| **Granularity** | File-level | Symbol-level | HIGH |
| **Analysis** | Regex imports | Deep AST (ts-morph) | MEDIUM |
| **Graph** | Flat list | DAG with weighted edges | HIGH |
| **Intent** | Keywords only | Classification + weight adjustment | MEDIUM |
| **Output** | Files + compression | Full + signatures + manifest | MEDIUM |
| **Fallback** | Compress bodies | Signatures only | LOW |
| **Learning** | None | None | OPPORTUNITY |

### What CAP Has That We Don't

1. Symbol-level granularity (function/class extraction)
2. Deep call graph analysis
3. Dynamic weight adjustment based on intent type
4. "Signatures only" mode for peripherally relevant code
5. Manifest of excluded code
6. Session-based edit history tracking
7. Error/stack trace proximity analysis

### What We Have That CAP Doesn't

1. Semantic extraction hints (`/* file I/O, async */`)
2. More language support (Go, Rust, Ruby, PHP, etc.)
3. VS Code integration (status bar, commands)
4. One-click VSIX installation
5. Real-time token counting

---

## Principal Engineer's Vision: Prune v2

### The Fundamental Problem

All current approaches try to **guess** what the LLM needs. They're all heuristics. None of them **know**.

### Three Paradigm Shifts

#### Paradigm 1: Learn What Context Actually Matters

**Insight:** Measure which context contributed to successful completions.

```
Turn 1: User asks "fix auth bug"
├─ Sent: auth.ts, utils.ts, types.ts (3,200 tokens)
├─ LLM output: Code change to auth.ts:42
└─ User: ACCEPTED ✓

Analysis:
├─ auth.ts lines 30-60: USED (referenced in output)
├─ auth.ts lines 1-29: UNUSED
├─ utils.ts: UNUSED
└─ types.ts: PARTIALLY USED (User type only)

Learning:
"For auth debug tasks, auth.ts:30-60 has 94% utility rate"
```

**Build a Context Utility Model** trained on this data.

#### Paradigm 2: Known Knowledge Elimination

**Insight:** LLMs know common patterns from training. Don't pay to send information the model already has.

```javascript
// Your code:
const express = require('express');
const app = express();
app.use(express.json());
// YOUR CUSTOM CODE
const authMiddleware = (req, res, next) => {
  const token = req.headers['x-custom-auth'];
  // ...
};

// Analysis:
// Lines 1-3: STANDARD EXPRESS BOILERPLATE
//   Model knows this. Send: "[express-setup]" (1 token)
// Lines 5+: CUSTOM BUSINESS LOGIC
//   Novel code. Send: FULL (180 tokens)

// Result: 400 tokens → 181 tokens (55% reduction)
```

#### Paradigm 3: Bidirectional Context Negotiation

**Insight:** Let the LLM tell us what it needs.

```
Phase 1: Send manifest (200 tokens)
  "Available: validateToken(), refreshToken(), User, Session..."

Phase 2: LLM requests (50 tokens)
  "I need: validateToken(), Token interface"

Phase 3: Send requested context (800 tokens)

Total: 1,050 tokens vs 8,000 naive (87% reduction)
```

### Full Architecture: Prune v2

```
┌─────────────────────────────────────────────────────────────────┐
│                    PRUNE v2 ARCHITECTURE                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  INDEXING LAYER (on file save / git commit)                     │
│  ├─ Symbol Extractor (functions, classes, types)                │
│  ├─ Pattern Detector (known libs, boilerplate, novel code)      │
│  ├─ History Tracker (git recency, edit freq, bug history)       │
│  └─ CODE INDEX (SQLite, ~10MB per project)                      │
│                                                                  │
│  REQUEST INTERCEPTION (on every AI request)                     │
│  ├─ Intent Classifier (debug/generate/refactor/explain)         │
│  ├─ Context Selector (utility model, DAG walk, novelty filter)  │
│  ├─ Negotiation (optional: manifest → LLM requests → precise)   │
│  └─ CONTEXT PAYLOAD                                             │
│      ├─ Full code (high relevance)                              │
│      ├─ Signatures (medium relevance)                           │
│      ├─ References (known patterns)                             │
│      └─ Manifest (available but excluded)                       │
│                                                                  │
│  FEEDBACK LOOP (on every response)                              │
│  ├─ Extract symbols used in output                              │
│  ├─ Compare to symbols sent in context                          │
│  ├─ Mark unused context as "low utility"                        │
│  ├─ Track user accept/reject                                    │
│  └─ Update utility scores in index                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Novel Features

1. **Adaptive Token Budget**
   - "fix typo" → 500 tokens
   - "add validation" → 4,000 tokens
   - "refactor auth to OAuth2" → 20,000 tokens

2. **Incremental Context (Multi-Turn)**
   - Track what's already in LLM's context
   - Don't re-send on follow-up turns

3. **Semantic Diff Context**
   - Send diffs from known state
   - "React 19 changes from React 18: [500 tokens]"

4. **Context Provenance Tracking**
   - When LLM makes mistake, diagnose WHY
   - Learn: "For User type tasks, send FULL interface, not signature"

5. **Cross-Session Learning**
   - Federated learning across users (anonymized)
   - Context selection improves for everyone

### Metrics That Matter

| Metric | Target |
|--------|--------|
| Token Reduction | ≥70% vs naive |
| Context Precision | ≥85% (sent context appears in output) |
| Task Success Rate | ≥90% (user accepts without retry) |
| Latency Overhead | <200ms |
| Learning Rate | +5%/week improvement |

---

## Implementation Roadmap

### Phase 1: Foundation (2 weeks)
- Symbol-level extraction (use existing tree-sitter)
- DAG with weighted edges
- Intent classification
- Signatures-only mode

### Phase 2: Intelligence Layer (4 weeks)
- Context Utility Model (ML-based selection)
- Known Knowledge detection
- Adaptive budgets

### Phase 3: Feedback Loop (4 weeks)
- Response analysis
- Utility tracking
- Provenance tracking
- Per-codebase learning

### Phase 4: Advanced Features (8 weeks)
- Bidirectional negotiation
- Cross-session learning
- Federated learning network

---

## The Vision

> "By Dec 2026, Prune will know what context an LLM needs better than the LLM knows itself. Developers will pay 80% less for AI coding, get better results, and never think about tokens again."

**The Moat:** Data flywheel. Every interaction makes context selection better. After 1M interactions, the utility model is unbeatable.

---

## References

- [Cursor Forum: Token Usage Discussion](https://forum.cursor.com/t/why-is-a-simple-edit-eating-100-000-tokens-let-s-talk-about-this/120025)
- [Cursor Pricing Changes (June 2025)](https://cursor.com/blog/june-2025-pricing)
- [Context Duplication Bug Report](https://forum.cursor.com/t/context-duplication-wastes-tokens/148414)
- [Cursor Dynamic Context](https://supergok.com/cursor-dynamic-context-ai-token-optimization/)
