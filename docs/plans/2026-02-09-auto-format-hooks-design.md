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
        ├─ Check agent retry counter (>= 2? → exit with warning)
        ├─ Resolve unique workspaces from file paths
        ├─ pnpm --filter './libs/auth' --filter './apps/rest-api' run typecheck
        │
        ├─ If typecheck passes → clean up, exit 0
        │
        ├─ If typecheck fails → classify errors:
        │   ├─ Fork: pnpm install (missing refs / modules)  ─┐
        │   ├─ Fork: rm .tsbuildinfo (stale cache)          ─┤ wait all
        │   └─ Fork: rm -rf dist/ (stale artifacts)         ─┘
        │   └─ Re-run typecheck
        │       ├─ Pass → clean up, exit 0
        │       └─ Fail → real type errors → block Stop
        │
        └─ If agent retries >= 2 → let agent stop with warning
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
3. Check retry counters:
   - Agent retry counter (`/tmp/moltnet-tc-retries-$SESSION_ID`): if >= 2, clean up and exit with warning
   - Self-heal counter (`/tmp/moltnet-tc-heals-$SESSION_ID`): if >= 2, skip self-healing
4. Resolve unique workspaces from file paths:
   - `apps/<name>/*` → `apps/<name>`
   - `libs/<name>/*` → `libs/<name>`
   - `tools/*` → `tools`
   - Others → skip
5. Build pnpm filter args, run `pnpm --filter '<ws>' run typecheck`
6. If typecheck succeeds: clean up temp files, exit 0
7. If typecheck fails: classify errors and attempt self-healing (see below)
8. If self-healing was attempted: re-run typecheck
9. If real type errors remain after self-healing: increment agent retry counter, return `decision: "block"` with error output

## Self-healing typecheck (parallel repair)

When typecheck fails, the script classifies errors and forks parallel child processes to attempt fixes concurrently. This avoids sequential retries and keeps the hook fast.

### Error classification

The script scans `tsc` output for known fixable patterns:

| Error pattern                                               | Fix                                                                                                | Detection                                 |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `Referenced project '...' must exist`                       | Missing tsconfig project references → `pnpm install` (triggers `update-ts-references` postinstall) | grep for `TS6310` or `Referenced project` |
| `Cannot find module '@moltnet/...'`                         | Missing workspace dependency install → `pnpm install`                                              | grep for `TS2307` + `@moltnet/`           |
| `error TS6059: rootDir is expected` or stale `.tsbuildinfo` | Corrupted incremental build cache → delete `.tsbuildinfo` in affected workspaces                   | grep for `TS6059` or `TS6305`             |
| `error TS5110` or composite/declaration issues              | Stale build artifacts → delete `dist/` in affected workspaces                                      | grep for `TS5110` or `TS6306`             |

### Parallel repair strategy

```
typecheck fails
      │
      ▼
classify errors from tsc output
      │
      ├─ needs_install?  ──fork──▶  pnpm install (background)
      ├─ needs_cache_clear?  ──fork──▶  rm .tsbuildinfo in affected workspaces
      └─ needs_dist_clear?  ──fork──▶  rm -rf dist/ in affected workspaces
      │
      ▼
wait for all forks to complete
      │
      ▼
re-run typecheck once
      │
      ├─ success → clean up, exit 0
      └─ still errors → report to agent (real type errors)
```

In bash, each fix runs as a background job (`&`), then the script `wait`s for all of them before re-running typecheck. This is faster than sequential fixes when multiple issues co-occur (e.g., missing install + stale cache).

### Self-heal vs agent retries

Two separate counters prevent different kinds of loops:

- **Self-heal counter** (`/tmp/moltnet-tc-heals-$SESSION_ID`): tracks how many times the hook attempted infrastructure fixes. Max 2. After that, all errors are assumed to be real type errors and reported to the agent. Self-heal attempts do NOT count toward the agent retry limit.
- **Agent retry counter** (`/tmp/moltnet-tc-retries-$SESSION_ID`): tracks how many times real type errors were reported back to the agent. Max 2. After that, the hook lets the agent stop with a warning.

## Retry safety valve

The agent retry counter prevents infinite loops when type errors are unfixable:

- Stored in `/tmp/moltnet-tc-retries-$SESSION_ID`
- Incremented only when real type errors (not infrastructure issues) are reported
- At retry >= 2: hook outputs a warning as `additionalContext` but does NOT block, letting the agent stop normally
- Temp files cleaned up on successful typecheck or after max retries

## Edge cases

- **File deleted between write and format:** `[ -f "$FILE_PATH" ]` guard
- **No ts/tsx files touched:** prettier-only path, no eslint
- **File outside any workspace:** skipped by workspace resolution (root-level files like `eslint.config.mjs`)
- **Multiple agents same machine:** session IDs are unique per session, no collision
- **Agent writes to same file multiple times:** file path deduped by the typecheck script (reads unique lines)
- **pnpm install takes too long:** the Stop hook has a 30s timeout; if pnpm install exceeds that, the hook is killed and the agent stops normally. Consider increasing the timeout if install is typically slow.
- **Concurrent self-heal forks racing:** `pnpm install` and cache clearing don't conflict — install writes `node_modules` and tsconfig refs, cache clearing removes `.tsbuildinfo`/`dist`. Safe to run in parallel.
- **New workspace added but not installed:** the `Cannot find module` pattern catches this and triggers `pnpm install`
