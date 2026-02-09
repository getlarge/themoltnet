# Auto-Format & Typecheck Hooks for Claude Code Agents

**Date:** 2026-02-09
**Status:** Draft

## Problem

Agents waste time dealing with lint, formatting, and typecheck failures. Pre-commit hooks (husky + lint-staged) catch issues too late — after the agent has already written code and attempted to commit. Agents shouldn't need to think about code style at all.

## Solution

Two Claude Code hooks that run automatically during agent sessions:

1. **PostToolUse on Write/Edit** (synchronous) — auto-formats and lints each file immediately after it's written or edited. Reports unfixable lint errors back to the agent via `additionalContext`.
2. **Stop hook** (synchronous) — typechecks all touched workspaces before the agent finishes its turn. Blocks the agent from stopping if there are type errors, giving it a chance to fix them. Includes a retry safety valve (max 2 attempts).

## Architecture

```
Agent writes/edits file
        │
        ▼
PostToolUse hook fires (sync)
        │
        ├─ prettier --write <file>
        ├─ eslint --fix <file>  (ts/tsx only)
        ├─ Report unfixable errors → additionalContext
        └─ Append file to /tmp/moltnet-touched-$SESSION_ID

Agent finishes responding
        │
        ▼
Stop hook fires (sync)
        │
        ├─ Read /tmp/moltnet-touched-$SESSION_ID
        ├─ Resolve unique workspaces from file paths
        ├─ pnpm --filter './libs/auth' --filter './apps/rest-api' run typecheck
        ├─ If errors → block Stop (agent gets another turn)
        ├─ If retries >= 2 → let agent stop with warning
        └─ Clean up temp files
```

## Files

### New files

- `tools/scripts/auto-format.sh` — PostToolUse hook script
- `tools/scripts/auto-typecheck.sh` — Stop hook script

### Modified files

- `.claude/settings.json` — add PostToolUse and Stop hooks

## Hook configuration (`.claude/settings.json`)

Add to existing `hooks` object:

```json
{
  "PostToolUse": [
    {
      "matcher": "Write|Edit",
      "hooks": [
        {
          "type": "command",
          "command": "$CLAUDE_PROJECT_DIR/tools/scripts/auto-format.sh",
          "timeout": 10000
        }
      ]
    }
  ]
}
```

Append to existing `Stop` hooks array:

```json
{
  "type": "command",
  "command": "$CLAUDE_PROJECT_DIR/tools/scripts/auto-typecheck.sh",
  "timeout": 30000
}
```

## `tools/scripts/auto-format.sh`

**Trigger:** PostToolUse on Write or Edit
**Input:** JSON on stdin with `session_id` and `tool_input.file_path`
**Output:** JSON with `additionalContext` if unfixable lint errors exist

Logic:

1. Extract `file_path` and `session_id` from stdin JSON
2. Skip files outside project dir, in `node_modules/`, `dist/`, `.git/`
3. Skip unsupported extensions (only process ts, tsx, json, md, yaml, yml)
4. Run `prettier --write <file>`
5. For ts/tsx: run `eslint --fix <file>`, then re-check for remaining errors
6. If unfixable errors remain, return them as `additionalContext`
7. Append file path to `/tmp/moltnet-touched-$SESSION_ID`

## `tools/scripts/auto-typecheck.sh`

**Trigger:** Stop event
**Input:** JSON on stdin with `session_id`
**Output:** JSON with `decision: "block"` if type errors found

Logic:

1. Extract `session_id` from stdin JSON
2. Read `/tmp/moltnet-touched-$SESSION_ID`, exit if missing/empty
3. Check retry counter in `/tmp/moltnet-tc-retries-$SESSION_ID`
   - If >= 2: clean up temp files, exit 0 with warning context (let agent stop)
4. Increment retry counter
5. Resolve unique workspaces from file paths:
   - `apps/<name>/*` → `apps/<name>`
   - `libs/<name>/*` → `libs/<name>`
   - `tools/*` → `tools`
   - Others → skip
6. Build pnpm filter args, run `pnpm --filter '<ws>' run typecheck`
7. If errors: return `decision: "block"` with error output
8. If clean: clean up temp files, exit 0

## Retry safety valve

The retry counter prevents infinite loops when type errors are unfixable by the agent:

- Stored in `/tmp/moltnet-tc-retries-$SESSION_ID`
- Incremented each time the Stop hook runs typecheck
- At retry >= 2: hook outputs a warning as `additionalContext` but does NOT block, letting the agent stop normally
- Temp files cleaned up on successful typecheck or after max retries

## Edge cases

- **File deleted between write and format:** `[ -f "$FILE_PATH" ]` guard
- **No ts/tsx files touched:** prettier-only path, no eslint
- **File outside any workspace:** skipped by workspace resolution (root-level files like `eslint.config.mjs`)
- **Multiple agents same machine:** session IDs are unique per session, no collision
- **Agent writes to same file multiple times:** file path deduped by the typecheck script (reads unique lines)
