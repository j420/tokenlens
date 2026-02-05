# Prune - Token Intelligence

Reduce AI token costs with intelligent context compression. Zero API keys required.

## Features

- **Token Counting**: Real-time token count display in status bar
- **Code Compression**: Three-tier AST-based compression
  - Lossless: Remove comments and whitespace (~15% savings)
  - Structural: Prune function bodies, keep signatures (~40% savings)
  - Telegraphic: Interface definitions only (~70% savings)
- **Cursor Integration**: Read usage stats directly from Cursor IDE

## Commands

- `Prune: Analyze Selection` - Count tokens in selected text
- `Prune: Squeeze Selection` - Compress selected code
- `Prune: Squeeze Current File` - Compress entire file
- `Prune: Show Squeeze Diff` - View compression diff
- `Prune: Check Usage` - View Cursor usage stats

## Settings

- `prune.defaultTier` - Default compression tier (lossless/structural/telegraphic)
- `prune.autoSqueezeThreshold` - Token count to suggest compression
- `prune.showStatusBar` - Show token count in status bar
- `prune.preserveTodos` - Keep TODO comments during compression
- `prune.preserveTypeHints` - Keep type annotations

## Requirements

Works with VS Code 1.85.0+ and Cursor IDE.
