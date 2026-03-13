# Context Evals Anthropic SDK Debugging

Date: 2026-03-12

## Goal

Make the `@moltnet/context-evals` Anthropic SDK executor work reliably inside
the `gpack` worktree-based evaluator so we can run:

- empty-context baseline
- raw-entry context baseline
- compiled-pack baseline
- GEPA optimization runs

The failure mode under investigation was:

- `taskStepPassed: false`
- `taskStepOutput: Claude Code process exited with code 1`
- no turns
- no tool activity
- no git diff

## What Was Confirmed Early

The following parts were working and were not the core blocker:

- task loading from `tasksmith`
- worktree creation and cleanup
- setup command execution
- `fail_to_pass` / `pass_to_pass` scoring
- post-task dependency refresh when manifests change
- `compile-pack` writer and package boundary

The main open failure was isolated to the Anthropic SDK task step.

## Dead Ends We Tried

### 1. Treating it as a task-quality problem

Wrong direction.

The task being red on `@testcontainers/postgresql` was expected. The real issue
was that Claude never made a first move in the failing runs.

### 2. Treating it as an auth problem only

Partly useful, but incomplete.

We wired:

- `CLAUDE_CODE_OAUTH_TOKEN`
- `ANTHROPIC_AUTH_TOKEN`
- `.env.local` loading before config resolution

This removed one class of ambiguity, but the wrapper still failed before first
turn in some runs.

### 3. Using the SDK package `cli.js` path as the executable override

Wrong for the wrapper path.

This produced:

- `Claude Code executable not found at .../@anthropic-ai/claude-agent-sdk/cli.js`

The SDK package path is not a universally valid `pathToClaudeCodeExecutable`
override for our wrapper.

### 4. Assuming the worktree itself was broken

Wrong.

We reproduced the SDK call successfully:

- in repo root
- in a real fixture worktree
- in a worktree under the same macOS `tmpdir()` family as `gpack`
- after the same pre-steps `gpack` runs:
  - `pnpm install --ignore-scripts`
  - failing pre-task test
  - writing `eval-task.md`

That falsified the "worktree setup is broken" hypothesis.

### 5. Assuming prompt shape was the issue

Wrong.

Both of these worked in standalone repro:

- direct task prompt text
- the exact `gpack` wrapper prompt:
  - `Complete the task described in eval-task.md in the current directory...`

## Root Causes Identified

Three distinct causes were identified for the `Claude Code process exited with
code 1` / `toolCallCount: 0` failure:

### Cause 1: `CLAUDECODE` env var (nested-session guard)

When the pipeline runs from inside a Claude Code session, `CLAUDECODE=1` is set
in the process environment. The SDK inherits `process.env`, including this
variable. When the SDK spawns Claude Code, it sees `CLAUDECODE=1` and
immediately refuses to start:

```
Error: Claude Code cannot be launched inside another Claude Code session.
```

This was **not** the cause of the original terminal-run failures (where
`CLAUDECODE` was unset), but it blocks any run kicked off from within Claude
Code (e.g. during development or agent-team workflows).

**Fix:** `getRuntimeEnv()` in `config.ts` now clones `process.env` and deletes
`CLAUDECODE` before returning the env to the SDK.

### Cause 2: Project hooks firing inside eval worktrees

The `.claude/settings.json` checked into the repo contains project hooks:

- `SessionStart` → `agent-sync.sh session-start`
- `PreToolUse` → `check-legreffier-commit.sh`
- `Stop` / `Notification` → more `agent-sync.sh` invocations

These hooks depend on env vars and services that may not be available inside an
eval worktree. The `settings.local.json` we wrote with `hooks: {}` was intended
to override them, but Claude Code's settings merge treats `{}` as "no local
overrides" — it falls through to the project-level hooks.

**Fix:** Pass `settings: { disableAllHooks: true }` directly to `query()`.
This loads at the SDK's "flag settings" layer — the highest priority layer —
which completely disables all hook execution.

### Cause 3: `CLAUDE_CODE_OAUTH_TOKEN` env contamination (THE terminal-run root cause)

`pipeline.ts` line 82 calls `process.loadEnvFile('.env.local')` which loads
`CLAUDE_CODE_OAUTH_TOKEN` into `process.env`. This token propagates through
`getRuntimeEnv()` → SDK env → Claude Code subprocess.

Claude Code then attempts OAuth authentication against the Anthropic API:

```
[API:auth] OAuth token check starting
[API:auth] OAuth token check complete
API error: 401 "OAuth authentication is currently not supported."
```

**Critical insight**: stripping `CLAUDE_CODE_OAUTH_TOKEN` from the env was
necessary but NOT sufficient. The original `evaluate.ts` spawned
`claude-task-runner.ts` as a child process via `spawnText()`, which inherited
`process.env` including the contaminated token. Even with `getRuntimeEnv()`
stripping it in the child, Claude Code also reads OAuth credentials from the
**macOS system keychain**, not just env vars.

**Why the repro script worked**: `repro-query.ts` never loaded `.env.local`.
It ran with a clean `process.env` where `CLAUDE_CODE_OAUTH_TOKEN` was never set,
so the OAuth token check found nothing problematic.

**Final fix**: Rewrote `runAnthropicSdk()` in `evaluate.ts` to call
`createClaudeQuery()` directly in-process (like `repro-query.ts` does) instead
of spawning a separate subprocess. Combined with `getRuntimeEnv()` stripping
the token, this ensures the SDK subprocess env is clean.

## Architecture Change: In-Process SDK Call

The original architecture had three layers:

```
evaluate.ts → spawnText(claude-task-runner.ts) → createClaudeQuery() → SDK → Claude Code CLI
```

The new architecture eliminates the subprocess:

```
evaluate.ts → createClaudeQuery() → SDK → Claude Code CLI
```

This removes the env inheritance problem entirely and matches the pattern that
always worked in `repro-query.ts`.

The `claude-task-runner.ts` file is retained as a standalone CLI tool but is no
longer used by the eval harness. The `repro-query.ts` script has been removed
since the eval harness now uses the same direct-call pattern.

## Fixes Applied

| File                                  | Change                                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------------------- |
| `libs/context-evals/src/config.ts`    | `getRuntimeEnv()` strips `CLAUDECODE` and `CLAUDE_CODE_OAUTH_TOKEN`                       |
| `libs/context-evals/src/anthropic.ts` | `query()` passes `settings: { disableAllHooks: true }`                                    |
| `libs/context-evals/src/evaluate.ts`  | `runAnthropicSdk()` calls `createClaudeQuery()` in-process instead of spawning subprocess |

## Verification

After all three fixes, the pipeline runs end-to-end:

```
[gpack] running baseline (empty pack)...
  [setup] pnpm install --ignore-scripts
  [task] running anthropic-sdk...
  [setup] pnpm install --ignore-scripts (post-task)
[gpack] baseline scores: 0.00 avg=0.00
```

- Session ID populated (SDK connected)
- 21 turns executed ($0.25 cost)
- Claude Code read files and made edits (wrote `index.ts`, `package.json`)
- Post-task setup ran (dependency refresh)
- Score=0 because the task wasn't fully solved (missing pnpm catalog entry) — this is a legitimate eval result, not a runner failure

## Tool Count Fix

The `tool_progress` SDK message type was used to count tool calls, but this
event only fires for streaming progress (suppressed by `includePartialMessages:
false`). Fixed to count `tool_use` content blocks in `assistant` messages
instead.

## Practical Lessons

1. Do not debug this path by changing multiple SDK options at once.
2. Always compare against a minimal standalone repro.
3. If repro works and wrapper fails, diff the env vars — `process.loadEnvFile()` is invisible pollution.
4. Preserve failed worktrees; otherwise the evidence disappears.
5. `~/.claude/debug/<session-id>.txt` is the definitive source for auth failures.
6. `settings.local.json` `hooks: {}` does NOT override project hooks. Use the SDK's
   `settings: { disableAllHooks: true }` flag-layer override instead.
7. Claude Code reads OAuth credentials from the system keychain, not just env vars.
   Stripping env vars alone is not enough if the keychain has cached tokens.
8. When `process.loadEnvFile()` is called early in a pipeline, every downstream
   subprocess inherits those vars. This is the most dangerous form of env contamination
   because it's invisible — the vars don't appear in any config file the subprocess reads.

## Current State

The eval runner is operational. Remaining work:

- Task quality tuning (prompts, context packs)
- GEPA optimization loop testing
- MCP profile for eval worktrees (TODO in `anthropic.ts`)
