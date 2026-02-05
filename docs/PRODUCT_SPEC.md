# Prune v2: Local Observability Sidecar

## Product Vision

A zero-friction token intelligence tool for AI coding assistants. No API keys required. Works for ALL Cursor users (Pro, Business, Free).

**Core Principle**: Prevent token waste BEFORE it happens, not track it after.

---

## Architecture: Local Observability Sidecar

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PRUNE: LOCAL OBSERVABILITY SIDECAR                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  LAYER 1: Zero-Key Usage Tracking (State Scraper)                           │
│  ──────────────────────────────────────────────────                         │
│  • Read ~/Library/.../Cursor/.../state.vscdb                                │
│  • Extract WorkosCursorSessionToken                                         │
│  • Query api.cursor.com/usage for "Requests Remaining"                      │
│  • NO API KEY REQUIRED                                                      │
│                                                                              │
│  LAYER 2: Local Token Engine (Precision Counting)                           │
│  ──────────────────────────────────────────────────                         │
│  • tiktoken for OpenAI models (GPT-4o, o1, o3)                              │
│  • anthropic-tokenizer for Claude models                                    │
│  • Exact count BEFORE request leaves machine                                │
│  • Cost estimation with live pricing                                        │
│                                                                              │
│  LAYER 3: Incredible Squeezer (Tree-sitter AST Engine)                      │
│  ──────────────────────────────────────────────────────                     │
│  • Multi-language support via Tree-sitter grammars                          │
│  • Error-tolerant parsing (handles broken/partial code)                     │
│  • Three-tier compression: Lossless → Structural → Telegraphic              │
│  • Validation: compiles after pruning, reverts if broken                    │
│                                                                              │
│  LAYER 4: Review Gate (Human-in-the-Loop Trust Layer)                       │
│  ─────────────────────────────────────────────────────                      │
│  • Diff view before sending                                                 │
│  • User approval: [See Diff] [Proceed Optimized] [Send Original]            │
│                                                                              │
│  LAYER 5: MCP Server (AI Self-Regulation)                                   │
│  ─────────────────────────────────────────                                  │
│  • analyze_context: token count, cost estimate, bloat warnings              │
│  • squeeze_files: optimized content, diff summary, savings                  │
│  • check_budget: remaining requests, spend today, alerts                    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Layer 1: State Scraper (Zero-Key Usage Tracking)

### The SQLite Hook

Cursor (and VS Code) stores session metadata in a local SQLite database.

**Location**:
- Mac: `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb`
- Windows: `%APPDATA%\Cursor\User\globalStorage\state.vscdb`
- Linux: `~/.config/Cursor/User/globalStorage/state.vscdb`

**Mechanism**:
1. Read the `state.vscdb` file locally
2. Extract the `WorkosCursorSessionToken`
3. Query Cursor's internal usage API (`api.cursor.com/usage`)
4. Get real-time "Requests Remaining" data

**Benefit**: Zero API keys required. Works for ALL Cursor subscription types.

---

## Layer 2: Local Tokenization

### Why Local?

- No network calls required
- Exact token count BEFORE sending
- Works offline
- Privacy-preserving (code never leaves machine)

### Implementation

**OpenAI Models**: Use `tiktoken`
```typescript
import { encoding_for_model } from "tiktoken";

function countTokensOpenAI(text: string, model = "gpt-4o"): number {
  const enc = encoding_for_model(model);
  const tokens = enc.encode(text);
  enc.free();
  return tokens.length;
}
```

**Anthropic Models**: Use `@anthropic-ai/tokenizer`
```typescript
import { countTokens } from "@anthropic-ai/tokenizer";

function countTokensClaude(text: string): number {
  return countTokens(text);
}
```

### Cost Estimation

```typescript
const MODEL_PRICING = {
  // OpenAI (per 1M tokens)
  "gpt-4o": { input: 2.50, output: 10.00 },
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
  "o1": { input: 15.00, output: 60.00 },
  "o3-mini": { input: 1.10, output: 4.40 },

  // Anthropic (per 1M tokens)
  "claude-sonnet-4": { input: 3.00, output: 15.00 },
  "claude-opus-4": { input: 15.00, output: 75.00 },
  "claude-haiku-3.5": { input: 0.80, output: 4.00 },
};
```

---

## Layer 3: The Incredible Squeezer

### Why Tree-sitter?

**Regex is dangerous**:
- Might delete URLs inside strings
- Might delete `#` inside print statements
- Can break code

**Tree-sitter is incredible**:
- Parses code into AST (Abstract Syntax Tree)
- Knows exactly what is Comment vs Function vs Logic
- Error-tolerant (handles broken/partial code)
- Multi-language support

### Three-Tier Compression

| Tier | Strategy | Token Savings | Use Case |
|------|----------|---------------|----------|
| **Lossless** | Strip comments, whitespace, docstrings | ~15% | Direct code edits |
| **Structural** | Prune non-referenced function bodies | ~40% | RAG / Code exploration |
| **Telegraphic** | Summarize to interface definitions only | ~70% | Architectural reasoning |

### Implementation Strategy

```typescript
// Lossless: Remove all comments and docstrings
function losslessCompress(ast: Tree): string {
  // Walk AST, remove:
  // - Comment nodes
  // - Docstring nodes (but keep type hints)
  // - Excessive whitespace
  return reconstructCode(ast);
}

// Structural: Keep signatures, prune bodies
function structuralCompress(ast: Tree, activeFile: string): string {
  // For each function:
  // - If not in activeFile: replace body with `...`
  // - Keep: signature, return type, docstring summary
  return reconstructCode(ast);
}

// Telegraphic: Interface definitions only
function telegraphicCompress(ast: Tree): string {
  // Keep only:
  // - Import statements
  // - Type definitions
  // - Interface definitions
  // - Function signatures (no bodies)
  // - Class definitions (no method bodies)
  return reconstructCode(ast);
}
```

### Validation

After any compression, validate:
```typescript
function validateCompression(original: string, compressed: string): boolean {
  try {
    // Attempt to parse the compressed code
    const ast = parser.parse(compressed);
    // Check for syntax errors
    return !ast.rootNode.hasError();
  } catch {
    return false;
  }
}
```

If validation fails, revert to original.

---

## Layer 4: Review Gate (Human-in-the-Loop)

### The 3-Step Review Architecture

**Step 1: Interception**
When user triggers a "Large Context" request (>10K tokens), create a temporary file.

**Step 2: Diff View**
Show exactly what was removed using IDE's diff viewer:
```bash
code --diff original_file.py compressed_temp_file.py
```

**Step 3: User Approval**
```
┌───────────────────────────────────────────────────────────────────────┐
│  I've optimized your context:                                         │
│                                                                       │
│  • Removed 400 lines of comments                                      │
│  • Compressed 5 function bodies to signatures                         │
│  • 47,000 → 14,000 tokens (saved $0.66)                              │
│                                                                       │
│  [See Diff]  [Proceed Optimized]  [Send Original]                    │
└───────────────────────────────────────────────────────────────────────┘
```

---

## Layer 5: MCP Server (AI Self-Regulation)

### Tools Exposed to AI

**analyze_context**
```typescript
{
  name: "analyze_context",
  description: "Check token count and cost before proceeding with large operations",
  parameters: {
    files: "Array of file paths to analyze"
  },
  returns: {
    totalTokens: number,
    estimatedCost: number,
    recommendation: "proceed" | "squeeze" | "abort",
    bloatWarnings: string[]
  }
}
```

**squeeze_files**
```typescript
{
  name: "squeeze_files",
  description: "Compress files to reduce token count",
  parameters: {
    files: "Array of file paths",
    tier: "lossless" | "structural" | "telegraphic"
  },
  returns: {
    originalTokens: number,
    compressedTokens: number,
    savings: number,
    diffSummary: string,
    compressedContent: string
  }
}
```

**check_budget**
```typescript
{
  name: "check_budget",
  description: "Check remaining requests and budget",
  returns: {
    requestsRemaining: number,
    spentToday: number,
    alertLevel: "green" | "yellow" | "red"
  }
}
```

### .cursorrules Integration

```
# .cursorrules
Before performing codebase-wide searches or large file operations:
1. Call analyze_context to check token count
2. If tokens > 10000, call squeeze_files with "structural" tier
3. Present the diff summary to the user before proceeding
```

---

## Product Form Factor

### Primary: VS Code / Cursor Extension

**Status Bar**
```
[ Prune: 12K tokens · $0.24 · squeeze available ]
```

**Pre-flight Popup**
```
┌─────────────────────────────────────────────────────────────────────┐
│  Large context detected                                              │
│                                                                      │
│  23 files selected → 67,000 tokens (~$1.34)                         │
│                                                                      │
│  SQUEEZE OPTIONS                                                     │
│  ○ Lossless (strip comments)      → 57K tokens (~$1.14)            │
│  ● Structural (signatures only)   → 18K tokens (~$0.36) ✓          │
│  ○ Telegraphic (interfaces only)  → 8K tokens  (~$0.16)            │
│                                                                      │
│  [Preview Diff]  [Apply & Send]  [Send Original]                    │
└─────────────────────────────────────────────────────────────────────┘
```

### Secondary: MCP Server

Runs alongside extension. AI calls tools automatically via .cursorrules.

### Optional: Web Dashboard

For users who want historical trends and cross-device sync.

---

## Technical Stack

```json
{
  "core": {
    "tree-sitter": "Multi-language AST parsing",
    "tree-sitter-typescript": "TypeScript/JavaScript grammar",
    "tree-sitter-python": "Python grammar",
    "tree-sitter-go": "Go grammar",
    "tiktoken": "OpenAI token counting",
    "@anthropic-ai/tokenizer": "Claude token counting",
    "better-sqlite3": "Read Cursor's state.vscdb"
  },
  "extension": {
    "vscode": "VS Code Extension API",
    "@anthropic-ai/sdk": "MCP server implementation"
  }
}
```

---

## Build Order

| Phase | Component | Deliverable |
|-------|-----------|-------------|
| 1 | `packages/tokenizer` | Local token counting (tiktoken + anthropic) |
| 2 | `packages/squeezer` | Tree-sitter AST compression (3-tier) |
| 3 | `packages/state-scraper` | Cursor SQLite reader |
| 4 | `apps/extension` | VS Code extension with status bar + popup |
| 5 | `apps/mcp-server` | MCP tools for AI self-regulation |

---

## Success Metrics

1. **Zero-friction onboarding**: Install extension → immediate value
2. **First squeeze within 5 minutes**: User sees savings on first large context
3. **No API keys required**: Works for ALL Cursor users
4. **No broken code**: Validation ensures squeezed code always compiles
5. **User trust**: Review gate gives full control before sending

---

## Why This Wins

| Old Proxy Approach | New Sidecar Approach |
|-------------------|---------------------|
| Requires API keys | Zero keys needed |
| Post-hoc tracking | Pre-flight prevention |
| ~20% market | ~100% market |
| "Monitoring" tool | "Optimization" tool |
| Passive observation | Active intervention |
