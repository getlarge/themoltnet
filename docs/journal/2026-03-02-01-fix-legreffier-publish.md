---
date: '2026-03-02T21:00:00Z'
author: claude-opus-4-6
session: unknown
type: problem
importance: 0.7
tags: [publish, npm, legreffier, workspace-deps, check-pack]
supersedes: null
signature: pending
---

# Problem: @themoltnet/legreffier Published with Unpublished Workspace Dependencies

## Context

Running `npm i -g @themoltnet/legreffier` failed with E404 for `@moltnet/api-client@0.1.0`. The published package.json listed three private workspace packages (`@moltnet/api-client`, `@moltnet/crypto-service`, `@moltnet/design-system`) in `dependencies` instead of `devDependencies`.

## Substance

**Root cause**: Vite SSR correctly bundled all workspace code into `dist/index.js`, but the `package.json` still listed `@moltnet/*` packages in `dependencies`. When pnpm publish ran, it rewrote `workspace:*` to concrete version numbers and shipped references to packages that don't exist on npm.

**Why it wasn't caught**: The `check:pack` script validated tarball contents (dist files, source leaks, `.d.ts` workspace imports) but never inspected the `dependencies` field for private workspace packages.

**The SDK did it correctly**: `@themoltnet/sdk` has workspace deps in `devDependencies` and uses explicit `ssr.noExternal: [/@moltnet\//]` in its Vite config.

**Fix applied**:

1. Moved `@moltnet/api-client`, `@moltnet/crypto-service`, `@moltnet/design-system`, `@themoltnet/sdk` from `dependencies` to `devDependencies` in `packages/legreffier-cli/package.json`
2. Extended `scripts/check-pack.ts` to detect `@moltnet/*` packages in `dependencies`
3. Created `.claude/skills/pre-publish/SKILL.md` — mandatory pre-publish validation skill
4. Updated `.claude/skills/legreffier/SKILL.md` — added episodic entry trigger table and updated description to catch frustration/breakage signals

**Verification**: Build passes, `check:pack` passes, bundle contains zero `@moltnet/` imports.

## Continuity Notes

- A new legreffier release is needed to fix this on npm — the current published v0.5.0 is broken
- The `pre-publish` skill should be invoked by any agent before publishing
- The `check:pack` workspace dep check only catches `@moltnet/*` (private scope); `@themoltnet/*` with `workspace:*` is fine because pnpm rewrites it to concrete versions
- The `packages/cli/bin/CHANGELOG.md` change from pnpm install is unrelated — exclude from this PR
