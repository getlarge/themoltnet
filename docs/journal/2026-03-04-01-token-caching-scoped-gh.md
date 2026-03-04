---
date: '2026-03-04T10:30:00Z'
author: claude-opus-4-6
session: token-caching-and-scoped-gh
type: progress
importance: 0.5
tags: [legreffier, github-app, cli, performance, security]
supersedes: null
signature: <pending>
---

# File-Based Token Caching & Scoped `gh` Commands

## Context

Every `gh` CLI call via LeGreffier spawned `npx @themoltnet/cli github token` to get a fresh GitHub App installation token. This hit the GitHub API on every invocation (~1s latency each), and the token creation prompted for permission. Two improvements were needed: caching tokens locally and scoping `gh` commands to what the GitHub App manifest actually grants.

## Substance

### Token caching (Go CLI + TS lib)

Both `cmd/moltnet/github.go` and `packages/github-agent/src/token.ts` now cache installation tokens in `gh-token-cache.json` next to the private key file. The cache uses a 5-minute expiry buffer — if the token has less than 5 minutes remaining, a fresh one is fetched. This means the GitHub API is only hit once per hour instead of on every `gh` command.

In Go, `getInstallationToken` now returns `(token, expiresAt, error)` and a new `getCachedInstallationToken` wrapper handles cache read/write. Both `runGitHubToken` and `runGitHubCredentialHelper` use the cached version.

In TypeScript, the caching is integrated directly into `getInstallationToken` since it already returned `{ token, expiresAt }`.

### Scoped `gh` commands

`buildGhTokenRule` was rewritten to explicitly list only the `gh` subcommands the GitHub App has permissions for: `gh pr`, `gh issue`, `gh api repos/.../contents/...`, and `gh repo view/clone`. This prevents agents from attempting operations that would 401.

### Manifest update

Added `issues: 'write'` to the GitHub App manifest `default_permissions` so issue creation is explicitly supported.

### Auto-accept permission

Added `Bash(echo "GIT_CONFIG_GLOBAL=*")` to `buildPermissions` so session activation doesn't prompt.

## Continuity Notes

- The `.claude/rules/legreffier-gh.md` rule file in the repo root still has the old content — it will be updated when this branch merges and the `legreffier setup` command is re-run on a repo
- Existing GitHub App installations won't automatically get `issues: write` — the app owner needs to review and accept the new permission in GitHub settings
- The `gh-token-cache.json` file is written with 0600 permissions; consider adding it to `.gitignore` templates in the setup flow
