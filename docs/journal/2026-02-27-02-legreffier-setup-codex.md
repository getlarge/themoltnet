---
date: '2026-02-27T15:00:00Z'
author: claude-opus-4-6
session: legreffier-setup-codex-324
type: handoff
importance: 0.7
tags: [legreffier, cli, codex, adapter, setup, multi-agent]
supersedes: 2026-02-27-01-legreffier-cli-polish.md
signature: <pending>
---

# Handoff: `legreffier setup` Subcommand and Codex Adapter (#324)

## Context

Issue #324 requested two things: a `legreffier setup` subcommand to (re)configure agent tools after init, and Codex as a second supported agent alongside Claude Code. The init flow previously only wrote Claude-specific config.

## Substance

### Adapter pattern

Introduced an `AgentAdapter` interface (`src/adapters/types.ts`) with three methods: `writeMcpConfig`, `writeSkills`, `writeSettings`. Two implementations:

- **ClaudeAdapter** — writes `.mcp.json` (env var placeholders), `.claude/skills/`, `.claude/settings.local.json`
- **CodexAdapter** — writes `.codex/config.toml` (TOML merge via `smol-toml`), `.agents/skills/`, `.moltnet/<name>/env` (sourceable credentials)

The adapter registry (`src/adapters/index.ts`) maps `AgentType` to adapter instances. `agentSetup.ts` now iterates over selected agent types and delegates to each adapter.

### `legreffier setup` subcommand

New `SetupApp.tsx` component — reads existing `.moltnet/<name>/moltnet.json`, shows agent multi-select if no `--agent` flags, runs adapters, displays summary with fingerprint/appSlug from config.

### Multi-agent selection

`--agent` flag changed from single string to `multiple: true` array. `AgentSelect` component became multi-select (Space to toggle, Enter to confirm). Both `init` and `setup` accept multiple `--agent` flags.

### Codex credential flow

Codex reads env vars from the shell (no `settings.local.json` equivalent). The CodexAdapter writes `.moltnet/<name>/env` with `KEY=value` lines. The root `package.json` `codex` script sources this file before launching: `set -a && . .moltnet/legreffier/env && set +a && GIT_CONFIG_GLOBAL=... codex`.

`.codex/config.toml` uses `env_http_headers` that reference env var names (not values), same pattern as `.mcp.json` with `${VAR}` placeholders. Both files committed to repo.

### Skill download resilience

`downloadSkills` now tries the pinned tag URL first, falls back to `main` branch. On total failure, warns on stderr and continues instead of throwing. This unblocked setup since `legreffier-v0.1.0` tag doesn't exist yet.

## Decisions

1. **Adapter pattern over if/else** — cleaner extensibility for future agents (Cursor, Cline)
2. **Env file for Codex** — simplest bridge between config-file credentials and shell env vars
3. **Commit `.codex/config.toml`** — same pattern as `.mcp.json`, contains env var names not secrets
4. **Skill download fallback** — non-blocking; agents can still function without skills

## Branch state

Branch: `claude/legreffier-setup-codex-324` (4 commits, not pushed)

All checks pass: typecheck, lint, test (30/30), build.

## What's next

- Push branch and open PR
- Filed #329 for `legreffier verify-commit` command (validate diary trailer in commit messages)
- Consider Cursor adapter when demand arises
- Skill download will resolve once `legreffier-v0.1.0` tag is created by release-please
