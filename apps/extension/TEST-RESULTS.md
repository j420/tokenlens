# TokenLens Test Results

**Date:** 2026-02-07
**Version:** 0.1.0
**VSIX File:** prune-0.1.0.vsix (2.03 MB)

---

## Test Summary

| Test Suite | Result | Tests Passed |
|------------|--------|--------------|
| Signature Extraction | PASS | 7/7 |
| Edge Cases | PASS | 4/4 |
| Large Files | PASS | 6/6 |
| Helper Functions | PASS | 7/7 |
| **Total** | **PASS** | **24/24** |

---

## Test Details

### 1. Signature Extraction Tests (7/7)

Tests for extracting function/method signatures from various code patterns.

| Test | Status |
|------|--------|
| TypeScript function | PASS |
| Arrow function | PASS |
| Class with methods | PASS |
| Interface and type | PASS |
| Braces in strings | PASS |
| Python function | PASS |
| Go function | PASS |

**Examples Tested:**
```typescript
// TypeScript function
export function calculateTotal(items: Item[], taxRate: number): number

// Arrow function
export const processData = async (input: string): Promise<Result> =>

// Class with methods
export class AuthService {
  async login(email: string): Promise<Token> { /* ... */ }
  logout(): void { /* ... */ }
}

// Python function with decorator
@app.route("/api")
def get_users(request): ...

// Go function with receiver
func (s *Server) HandleRequest(w http.ResponseWriter, r *http.Request) error
```

---

### 2. Edge Cases Tests (4/4)

Tests for handling unusual or boundary conditions.

| Test | Status |
|------|--------|
| Empty file | PASS |
| Comment-only file | PASS |
| Special characters in code | PASS |
| Unicode in code | PASS |

**Edge Cases Verified:**
- Empty files return empty output
- Files with only comments don't produce false function signatures
- Regex special characters `[{}]` in code are handled correctly
- Unicode characters and emojis don't break extraction

---

### 3. Large File Tests (6/6)

Tests for processing files larger than chunk size (2500 lines).

| Test | Status |
|------|--------|
| Large file (6000 lines) processed | PASS |
| func_0 captured (start - chunk 1) | PASS |
| func_40 captured (chunk 2) | PASS |
| func_70 captured (chunk 3) | PASS |
| Most functions captured (80/80) | PASS |
| Chunk processing used | PASS |

**Large File Handling:**
- Files over 2500 lines are processed in chunks
- Functions from all chunks are captured
- Chunk markers indicate which section of the file each signature came from
- Up to 100 signatures per file (configurable)

**Bug Fixed:** Previously, chunk markers were incorrectly counted against the signature limit, causing functions in later chunks to be missed. Fixed by only counting actual signatures, not markers.

---

### 4. Helper Function Tests (7/7)

Tests for utility functions used by the signature extraction.

| Test | Status |
|------|--------|
| stripStringsAndComments removes strings | PASS |
| stripStringsAndComments removes comments | PASS |
| countBraces ignores strings | PASS |
| hashContent is deterministic | PASS |
| hashContent differs for different content | PASS |
| fuzzyMatch: auth -> authentication | PASS |
| fuzzyMatch: xyz !-> abc | PASS |

---

## Commands Tested

### Token Saver Commands

| Command | Keybinding | Status |
|---------|------------|--------|
| `prune.smartCopy` | `Ctrl+Alt+C` | PASS |
| `prune.preflight` | `Ctrl+Alt+P` | PASS |
| `prune.sessionStats` | — | PASS |
| `prune.compactionCheck` | — | PASS |
| `prune.resetSession` | — | PASS |

### Analysis Commands

| Command | Keybinding | Status |
|---------|------------|--------|
| `prune.analyzeFile` | `Ctrl+Alt+T` | PASS |
| `prune.analyzeContext` | `Ctrl+Alt+A` | PASS |
| `prune.smartContext` | — | PASS |
| `prune.squeezeFile` | — | PASS |
| `prune.checkCursorUsage` | — | PASS |
| `prune.runTests` | — | PASS |

---

## File Type Support

| Language | Extension | Signature Extraction |
|----------|-----------|---------------------|
| TypeScript | .ts, .tsx | PASS |
| JavaScript | .js, .jsx | PASS |
| Python | .py | PASS |
| Go | .go | PASS |

---

## Performance Characteristics

| Metric | Value |
|--------|-------|
| MAX_LINES_PER_CHUNK | 2500 lines |
| MAX_SIGNATURES | 100 per file |
| MAX_IMPORTS | 20 per file |
| MAX_TYPES | 30 per file |
| MAX_SESSION_DURATION | 4 hours |
| MAX_FILES_IN_MEMORY | 200 files |

---

## VSIX Package Contents

```
prune-0.1.0.vsix (2.03 MB)
├── extension/
│   ├── dist/extension.js (3.44 MB bundled)
│   ├── wasm/
│   │   ├── sql-wasm.wasm (644 KB)
│   │   ├── tree-sitter-javascript.wasm (402 KB)
│   │   ├── tree-sitter-python.wasm (447 KB)
│   │   ├── tree-sitter-tsx.wasm (1.38 MB)
│   │   ├── tree-sitter-typescript.wasm (1.35 MB)
│   │   ├── tree-sitter.wasm (192 KB)
│   │   └── web-tree-sitter.wasm (192 KB)
│   ├── package.json
│   └── README.md
└── manifest files
```

---

## Issues Found and Fixed

### 1. Large File Chunk Processing Bug

**Issue:** When processing large files in chunks, chunk markers were being counted against the MAX_SIGNATURES limit. This caused functions in later chunks to not be captured.

**Root Cause:** The condition for adding chunk markers was being checked for every signature, not just the first one in each chunk. Additionally, the signature count check included markers in the count.

**Fix:**
1. Added `chunkMarkerAdded` flag to ensure marker is only added once per chunk
2. Changed limit checks to count only actual signatures (filtering out markers)
3. Updated calculation of remaining signatures to exclude markers

**Before Fix:** Only 67/80 functions captured from a 6000-line file
**After Fix:** All 80/80 functions captured correctly

### 2. TypeScript Null Check Errors

**Issue:** Array access `lines[j]` in while loops could be undefined.

**Fix:** Added null checks: `while (j < lines.length && lines[j] && !lines[j].includes("{"))`

---

## How to Run Tests

### Standalone Tests (No VS Code Required)

```bash
cd apps/extension
npx ts-node standalone-test.ts
```

### In VS Code

1. Install the VSIX: `code --install-extension prune-0.1.0.vsix`
2. Open Command Palette: `Ctrl+Shift+P`
3. Run: "Prune: Run Intelligence Tests"

---

## Conclusion

All 24 tests pass. The Token Saver features are working correctly:

- **Smart Copy** extracts signatures from single and multiple files
- **Pre-flight Optimizer** analyzes context before sending to AI
- **Session Memory** tracks file reads to prevent duplicate context
- **Compaction Recovery** tracks important decisions

The extension is ready for use. Install the VSIX file to get started.
