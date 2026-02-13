---
date: '2026-02-13T17:00:00Z'
author: claude-opus-4-6
session: ca59b27c-304f-40da-84c4-54e7e407ae2c
type: handoff
importance: 0.6
tags: [ory, sdk, migration, fetch-api, dependencies]
supersedes: null
signature: <pending>
---

# Migrate from @ory/client to @ory/client-fetch

## Context

Issue #67: Replace `@ory/client` (Axios-based) with `@ory/client-fetch` (native Fetch API). This is Ory's official fetch-based SDK. The two key API differences: return values are unwrapped (no `{ data }` wrapper) and errors use `ResponseError` with native `Response` objects instead of `AxiosError`.

## Substance

### What was done

Completed the full migration across 18+ files using a big-bang swap approach:

1. **Dependency swap**: Replaced `@ory/client` with `@ory/client-fetch` in pnpm catalog and 4 package.json files (`libs/auth`, `libs/bootstrap`, `apps/rest-api`, `apps/server`)
2. **Import migration**: Updated all import sources from `'@ory/client'` to `'@ory/client-fetch'`
3. **Return value unwrapping**: Changed ~26 call sites from `const { data } = await api.method()` to `const result = await api.method()`
4. **Error handling**: Migrated AxiosError catch blocks to ResponseError pattern with `await response.json()` for async body parsing
5. **Test mock shapes**: Updated ~50 mock return values across unit and e2e tests to return objects directly instead of `{ data: { ... } }` wrappers
6. **Re-exports**: Updated `libs/auth/src/index.ts` type re-export source

### Commits (8 total)

- `8f441e3` — Design doc
- `fa2bed7` — Implementation plan
- `61cd10d` — Catalog + package.json swap
- `9a843e8` — libs/bootstrap migration
- `1b89245` — libs/auth migration (source + tests)
- `f6f2794` — apps/rest-api routes + apps/server e2e migration
- `4258c4a` — Fix rest-api unit test mock shapes (caught by validation)
- `3299201` — Fix e2e test mock shapes (caught by e2e run)

### Validation results

- Typecheck: 18/18 workspaces pass
- Unit tests: All pass (153 rest-api, 63 crypto, etc.)
- E2E tests: 13 files, 104 tests — all pass
- Lint: Clean
- Build: All workspaces build
- `pnpm why axios`: Empty — axios fully removed from dependency tree

### Key finding: stale .tsbuildinfo

The `apps/server` and `tools/` typecheck failures (TS6305 + TS2339) were caused by stale `.tsbuildinfo` files in `apps/rest-api` and `apps/mcp-server`. When `vite build` runs it produces only the `.js` bundle plus `.d.ts.map` files, wiping previously emitted `.d.ts` files. But `tsc -b` with the stale buildinfo thought outputs were current and skipped re-emitting. Fix: delete `.tsbuildinfo` and re-run typecheck. This is a local build artifact issue, not a code change.

## Continuity Notes

- Branch: `claude/67-migrate-ory-client-fetch`
- All tests pass (unit + e2e), typecheck clean, build clean
- Ready for PR and review
- No workstream status change needed (WS2 was already marked complete; this is a dependency modernization)
- The `.tsbuildinfo` staleness issue may recur for anyone who runs `vite build` then `tsc -b` without cleaning — not a code fix, just awareness
