---
date: '2026-02-16T13:00:00Z'
author: claude-opus-4-6
session: oauth2-token-proxy
type: handoff
importance: 0.7
tags: [handoff, oauth2, proxy, clawhub, skill, security]
supersedes: 2026-02-15-02-clawhub-skill-review-fix
signature: <pending>
---

# Handoff: OAuth2 Token Proxy + ClawHub Skill Compliance

## Context

ClawHub flagged the OpenClaw skill as SUSPICIOUS because the token endpoint pointed to a third-party Ory domain (`*.projects.oryapis.com`), among other issues. The previous session fixed SKILL.md and mcp.json to reference `api.themolt.net/oauth2/token`, but the route didn't exist yet. This session implements it.

## What Was Done This Session

### POST /oauth2/token reverse proxy

- **`apps/rest-api/src/routes/oauth2.ts`** (new) — Reverse proxy that forwards `client_credentials` grants to Hydra
  - Registers `application/x-www-form-urlencoded` content-type parser (scoped to plugin)
  - Validates `grant_type` is `client_credentials`, rejects others with 400
  - Forwards request body as-is to `${hydraPublicUrl}/oauth2/token`
  - Returns Hydra's 200 responses through Fastify schema serialization
  - Non-200 responses forwarded transparently with raw JSON serializer (Hydra error format differs from ProblemDetails)
  - Network failures throw `upstream-error` (502)
  - No auth required (it IS the auth endpoint), uses global anonymous rate limiting

### Wiring

- **`apps/rest-api/src/app.ts`** — Added `hydraPublicUrl` to `AppOptions`, registered `oauth2Routes` plugin
- **`apps/rest-api/src/bootstrap.ts`** — Passes `hydraPublicUrl: oryUrls.hydraPublicUrl`

### Tests

- **`apps/rest-api/__tests__/oauth2.test.ts`** (new) — 5 unit tests with mocked fetch: happy path, rejected grant_type, missing grant_type, upstream 401 passthrough, network failure → 502
- **`apps/rest-api/e2e/oauth2-proxy.e2e.test.ts`** (new) — 4 E2E tests against real Docker stack: token exchange via proxy, token works for `/agents/whoami`, invalid credentials → 401, unsupported grant_type → 400

### Helper updates

- **`apps/rest-api/e2e/helpers.ts`** — `createAgent()` now uses `opts.baseUrl/oauth2/token` (proxy) instead of direct `HYDRA_PUBLIC_URL`
- **`apps/rest-api/e2e/setup.ts`** — Exported `SERVER_BASE_URL` for E2E tests
- **`apps/rest-api/__tests__/helpers.ts`** — Added `hydraPublicUrl` to `createTestApp` mock config

### SKILL.md + mcp.json (already updated before this session)

- Fixed `metadata.openclaw` → `metadata.clawdbot`
- Added `requires.bins`, `install`, `primaryEnv`
- Added External Endpoints and Security & Privacy sections
- Updated token endpoint to `api.themolt.net/oauth2/token`
- Renamed credentials.json → moltnet.json

## Verification

- Typecheck: clean
- Lint: 0 errors (50 pre-existing warnings)
- Unit tests: 193/193 pass
- E2E tests: 115/115 pass (including 4 new oauth2-proxy tests)

## Decisions Made

- **Raw serializer for non-200 responses**: Hydra returns `{ error, error_description }` which doesn't match ProblemDetailsSchema. Rather than transforming Hydra errors into ProblemDetails (which would lose information), we forward them transparently using `reply.serializer(JSON.stringify)` to bypass Fastify's schema validation.
- **Content-type parser scoped to plugin**: Registered `application/x-www-form-urlencoded` parser inside the oauth2Routes plugin scope so it doesn't affect other routes.
- **E2E helpers switched to proxy**: Updated `createAgent()` to use the proxy endpoint, proving it works end-to-end.

## What's Next

- Re-submit skill to ClawHub for review — the SUSPICIOUS flags should be resolved
- The `sign` command and SDK changes from the previous session still need publishing via release-please
