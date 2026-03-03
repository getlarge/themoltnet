---
date: '2026-03-03T18:00:00Z'
author: claude
session: github-token-346
type: handoff
importance: 0.7
tags: [cli, legreffier, github-app, gh-token, agent-rules]
supersedes: null
signature: null
---

# Feature: `github token` Subcommand + Agent Rules

## Context

The `moltnet github credential-helper` only works for git operations via the git credential protocol. The `gh` CLI uses `GH_TOKEN` and doesn't go through credential helpers. Agents working as GitHub Apps had no clean way to use `gh pr create`, `gh issue create`, etc. with their app identity.

## What Changed

### 1. `moltnet github token` (Go CLI)

New subcommand in `cmd/moltnet/github.go` that prints a raw GitHub App installation access token to stdout. Reuses existing `getInstallationToken()`. Supports `--credentials` flag and `MOLTNET_CREDENTIALS_PATH` env var fallback.

### 2. `legreffier github token` (TS CLI)

New subcommand in `packages/legreffier-cli/` that infers the credentials path from agent name. Resolution order: `--name` flag > `GIT_CONFIG_GLOBAL` pattern (`.moltnet/<name>/gitconfig`) > error. Shells out to `npx @themoltnet/cli github token`.

### 3. Agent rules via `legreffier setup`

Each adapter (`ClaudeAdapter`, `CodexAdapter`) now implements `writeRules()` that generates a markdown rule file instructing AI agents to prefix `gh` CLI commands with `GH_TOKEN=$(moltnet github token --credentials <path>)`. Rules are portable across Claude (`.claude/rules/`), Codex (`.codex/rules/`), and any agent that reads instruction files.

## Decisions

- **Rules over hooks**: Hooks are Claude Code-specific. Rules work across Claude, Codex, and Copilot — all support instruction files.
- **No token caching**: Tokens are short-lived (~1 hour) and the generation is fast. Caching adds complexity for minimal benefit.
- **Env var fallback**: `MOLTNET_CREDENTIALS_PATH` allows the Go CLI to work without `--credentials` in environments where the path is set once.

## Files Changed

- `cmd/moltnet/github.go` — added `runGitHubToken()`
- `cmd/moltnet/github_test.go` — 2 new tests
- `cmd/moltnet/main.go` — wired `token` subcommand
- `packages/legreffier-cli/src/github-token.ts` — new module
- `packages/legreffier-cli/src/github-token.test.ts` — 6 new tests
- `packages/legreffier-cli/src/index.tsx` — `github token` dispatch
- `packages/legreffier-cli/src/setup.ts` — `buildGhTokenRule()` + permission
- `packages/legreffier-cli/src/setup.test.ts` — 1 new test
- `packages/legreffier-cli/src/adapters/types.ts` — `writeRules()` interface
- `packages/legreffier-cli/src/adapters/claude.ts` — `writeRules()` impl
- `packages/legreffier-cli/src/adapters/codex.ts` — `writeRules()` impl
- `packages/legreffier-cli/src/SetupApp.tsx` — calls `writeRules()`

## What's Next

- Test end-to-end with a real GitHub App (requires `legreffier setup` run)
- Consider adding Copilot adapter (`.github/copilot-instructions.md`)
- The `@themoltnet/legreffier` npm package needs a new release for the TS CLI changes
