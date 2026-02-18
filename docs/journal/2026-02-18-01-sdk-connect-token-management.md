---
date: '2026-02-18T10:00:00Z'
author: claude-opus-4-6
session: sdk-connect-token-management
type: handoff
importance: 0.8
tags: [sdk, ws9, connect, oauth2, token-management, agent-facade]
supersedes: null
signature: <pending>
---

# SDK Connect + Token Management Implementation

## Context

Issue #31 — Agent SDK (`@moltnet/sdk` npm package). The SDK could register agents via `MoltNet.register()` but had no way to use the API afterward. Users had to manually obtain OAuth2 tokens and wire up the raw `@moltnet/api-client`.

## Substance

Implemented `MoltNet.connect()` — the missing piece between registration and API usage. Three new modules in `libs/sdk/src/`:

### TokenManager (`token.ts`)

OAuth2 `client_credentials` flow with in-memory caching. Uses raw `fetch` because the generated OpenAPI type has `body?: never` for the form-encoded `/oauth2/token` endpoint. Features:

- Auto-obtains and caches `{ access_token, expires_at }`
- Subtracts configurable `expiryBufferMs` (default 30s) to avoid edge-case expiry
- `getToken()` returns cached token if valid, otherwise calls `authenticate()`
- `invalidate()` clears cache (used on 401 retry)

### connect() (`connect.ts`)

Credential resolution with standard 12-factor precedence: explicit options > env vars (`MOLTNET_CLIENT_ID`, `MOLTNET_CLIENT_SECRET`, `MOLTNET_API_URL`) > config file (`~/.config/moltnet/moltnet.json`).

- `autoToken: true` (default) installs auth callback on the hey-api client
- `autoToken: false` — no interceptor, users call `agent.getToken()` manually
- Error interceptor invalidates token cache on 401 responses

### Agent facade (`agent.ts`)

Namespaced interface matching OpenAPI tags exactly:

- `agent.diary` — 10 methods (create, list, get, update, delete, search, reflect, share, sharedWithMe, setVisibility)
- `agent.agents` — 3 methods (whoami, lookup, verifySignature)
- `agent.crypto` — 2 methods + `signingRequests` sub-namespace (4 methods)
- `agent.vouch` — 3 methods (issue, listActive, trustGraph)
- `agent.auth` — 1 method (rotateSecret)
- `agent.recovery` — 2 methods (requestChallenge, verifyChallenge)
- `agent.public` — 5 methods (feed, searchFeed, entry, networkInfo, llmsTxt)
- Escape hatches: `agent.client` (raw hey-api client), `agent.getToken()`

Each method calls the flat api-client function, checks `result.error`, throws via `problemToError()`, returns `result.data`.

### Other changes

- `AuthenticationError` subclass added to `errors.ts`
- `problemToError()` return type broadened from `RegistrationError` to `MoltNetError`
- `readEnvCredentials()` added to `config.ts` for testable env var reading
- Updated `index.ts` exports and `MoltNet` facade

### Test coverage

98 tests across 10 files — 51 new tests for token, connect, and agent modules. All TDD with AAA pattern.

### Go CLI issue

Created issue #220 for auto-generated Go client from OpenAPI spec (separate concern from TS SDK).

## Decisions

1. **Raw fetch for token endpoint** — generated type has `body?: never` for form-encoded endpoint, so TokenManager uses native fetch
2. **Namespaces match OpenAPI tags** — not custom groupings
3. **Flat functions with thin wrappers** — kept api-client's flat function style, avoided `asClass` codegen which would require major refactoring
4. **Auth callback over interceptor** — uses hey-api's `auth` callback pattern rather than request interceptors for token injection

## Continuity Notes

- Branch `claude/sdk-connect-token-management` has 7 commits, rebased on latest main
- All validation passes (lint, typecheck, test, build)
- `check:pack` has a pre-existing failure for `@themoltnet/cli` (Go binary wrapper without `dist/index.js`) — unrelated
- Go CLI API operations tracked in issue #220
- Design docs at `docs/plans/2026-02-17-sdk-connect-*.md`
