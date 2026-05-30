# Prune hooks for Claude Code

Standalone hook scripts that run the Prune intelligence layer against a
live session. They read the Claude Code hook payload on stdin (a JSON
object with `transcript_path` and `hook_event_name`), do their analysis,
and emit a JSON decision on stdout per the
[Claude Code hooks spec](https://code.claude.com/docs/en/hooks).

Each script depends only on the workspace packages — no compilation
step. You can run them directly with Node 20+:

```bash
echo '{"hook_event_name":"Stop","transcript_path":"/abs/path/to/session.jsonl"}' | \
  node apps/extension/hooks/loop-breaker.mjs
```

| Script | Hook events | What it does |
|---|---|---|
| `loop-breaker.mjs` | `Stop`, `PostToolUse` | Replay the transcript ROI; if 3 consecutive low-ROI turns, exit 2 with a block message and routing suggestion. |
| `cache-stabilize.mjs` | `UserPromptSubmit` | Inspect the recent window for cache-bust signals (timestamps, MCP tool drift, low hit rate) and emit advisory `additionalContext`. |
| `compaction-recover.mjs` | `PostCompact` | Analyze what entities were lost on compaction; emit a recovery reminder as `additionalContext`. |

Install (manual for now): point a Claude Code hook entry at the script
path. A future `prune.installHooks` extension command will automate
this with user-scoped vs project-scoped settings management.
