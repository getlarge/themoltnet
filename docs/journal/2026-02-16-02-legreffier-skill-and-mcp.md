---
date: '2026-02-16T22:00:00Z'
author: claude-opus-4-6
session: legreffier-skill-and-hooks
type: handoff
importance: 0.8
tags:
  [handoff, legreffier, accountable-commit, mcp, dotenvx, hooks, claude-code]
supersedes: 2026-02-16-01-agent-git-identity.md
signature: <pending>
---

# Handoff: LeGreffier Skill, MCP Config, and Claude Code Hooks

## Context

Following the agent git identity implementation (PR #207), this session makes
LeGreffier operational inside Claude Code sessions. The previous session built
the plumbing (SSH keys, gitconfig, credential helper); this session builds the
activation UX and MCP connectivity.

Branch: `claude/legreffier-skill-and-hooks`
Supersedes: `2026-02-16-01-agent-git-identity.md`

## What Was Done

### 1. MCP endpoint URL consolidation

All references to `api.themolt.net/mcp` updated to `mcp.themolt.net/mcp` across
26 files (apps, libs, cmd, docs). The dedicated MCP subdomain was already live;
the codebase still had stale references.

### 2. Committable MCP config with env var expansion

Replaced hardcoded secrets in `.mcp.json` with `${VAR}` syntax. Claude Code
expands these at startup from the shell environment.

Secrets stored in `.env.mcp`, encrypted with dotenvx:

- `ARCHIVIST_CLIENT_ID` / `ARCHIVIST_CLIENT_SECRET`
- `SCOUT_CLIENT_ID` / `SCOUT_CLIENT_SECRET`
- `SENTINEL_CLIENT_ID` / `SENTINEL_CLIENT_SECRET`
- `LEGREFFIER_CLIENT_ID` / `LEGREFFIER_CLIENT_SECRET`

Key discovery: **MCP servers initialize before SessionStart hooks.** Env vars
must be in the shell before `claude` launches. The pattern is:

```
DOTENV_PRIVATE_KEY_MCP='...' npx dotenvx run --env-file=.env.mcp -- claude
```

`.mcp.json` and `.env.mcp` (encrypted) are now committed. `.env.keys` stays
gitignored.

### 3. `/legreffier` activation skill

`.claude/commands/legreffier.md` — searches for moltnet config in priority
order:

1. `MOLTNET_CREDENTIALS_PATH` env var
2. `.moltnet/moltnet.json` (project-local)
3. `~/.config/moltnet/moltnet.json` (global)

Sets `GIT_CONFIG_GLOBAL` to the agent's gitconfig and verifies identity.

### 4. PreToolUse hook for commit advisory

`.claude/hooks/check-legreffier-commit.sh` — intercepts `git commit` Bash
commands when `GIT_CONFIG_GLOBAL` is set. Outputs `additionalContext` advising
the agent to consider `/accountable-commit` for non-trivial changes. Advisory
only (does not block).

Registered in `.claude/settings.json` under `PreToolUse` with matcher `Bash`.

### 5. `/accountable-commit` updates

- Added step 0: resolve credentials path (local-first, same priority as
  `/legreffier`)
- Updated `moltnet sign` invocation to pass `--credentials <resolved-path>`
- Added frontmatter `name` field and updated description

### 6. Setup documentation

`docs/recipes/legreffier-setup.md` — full end-to-end guide covering:
prerequisites, GitHub App creation, MCP config with dotenvx, activation in
Claude Code, accountable commit flow, file reference, troubleshooting.

### 7. CLAUDE.md publishing docs

Added "Publishing to npm" section documenting the release-please flow and the
requirement to use `pnpm publish` for `catalog:` resolution. (Committed on main
before branching.)

## Decisions Made

- **`.env.mcp` as filename** — specifically for MCP server credentials, pairs
  with existing `.env` (infra) and `env.public` (non-secrets) pattern.
- **Advisory hook, not blocking** — the PreToolUse hook provides `additionalContext`
  instead of `permissionDecision: "deny"`. Blocking would be annoying for low-risk
  commits. The agent sees the advice and decides.
- **Local config priority** — `.moltnet/moltnet.json` checked before global
  `~/.config/moltnet/moltnet.json`, enabling per-project agent identities.
- **Skip config portability for now** — sharing `.moltnet/` across machines
  deferred. `moltnet github setup` regenerates machine-specific paths.

## What's Next

1. **Push branch and create PR** for the 3 commits
2. **Blog article** about LeGreffier for getlarge.eu/blog — the setup recipe
   doubles as source material
3. **Test the full loop** — `/legreffier` → make changes → `/accountable-commit`
   → verify on GitHub
4. **Add `moltnet-legreffier` to `settings.local.json`** `enabledMcpjsonServers`
   once MCP connection is verified in a fresh session
5. **Vigilant mode** — add the SSH public key to GitHub for "Verified" badges
6. **npm OIDC** — configure provenance for `@themoltnet/github-agent` on npmjs.com

## Continuity Notes

- The `DOTENV_PRIVATE_KEY_MCP` decryption key is in `.env.keys` locally. If you
  lose it, re-encrypt `.env.mcp` with `npx dotenvx encrypt`.
- The `moltnet` entry was removed from `.mcp.json` (it was unauthenticated,
  pointing to `api.themolt.net/mcp`). All 4 agent entries use the dedicated
  `mcp.themolt.net/mcp` URL.
- `settings.local.json` still has the old server names in
  `enabledMcpjsonServers` — update once the env-var-based servers work.
- The `@themoltnet/github-agent@0.1.0` was published to npm in the previous
  session. Release-please PR #201 will publish 0.2.0 with provenance once merged.
