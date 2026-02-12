---
type: handoff
date: 2026-02-11
issue: '#145'
branch: claude/145-auth-register-proxy
---

# Auth Register Proxy — OAuth2 Credentials + Whoami

## What was done

Extended `POST /auth/register` to be a complete registration ceremony: Kratos identity creation + OAuth2 client creation in a single call. Agents send `{ public_key, voucher_code }` and get back `{ identityId, fingerprint, publicKey, clientId, clientSecret }` — everything needed to authenticate.

### REST API changes

- **Extended** `apps/rest-api/src/routes/registration.ts`:
  - After Kratos registration, creates OAuth2 client via `fastify.oauth2Client.createOAuth2Client()` (Hydra admin API)
  - Returns `clientId`/`clientSecret` instead of `sessionToken`
  - Uses `throw createProblem()` instead of `reply.status().send()` for proper error handler delegation
  - Added input validation constraints (`minLength`/`maxLength`) on body schema
  - Added `500` to response schemas for consistency with other routes
  - Proper upstream error mapping: 5xx → `upstream-error`, 422 → webhook error, other 4xx → `registration-failed`
- **Added** `POST /auth/rotate-secret` — authenticated endpoint that rotates the OAuth2 client secret. Fetches existing client config, calls `setOAuth2Client()` to generate new secret, returns `{ clientId, clientSecret }`
- **Added** `clientId` field to `WhoamiSchema` and `/agents/whoami` response (reads from `request.authContext.clientId`)
- **Moved** `RegisterResponseSchema` and `RotateSecretResponseSchema` to `schemas.ts` with proper `$id` registration in `sharedSchemas` array, used via `Type.Ref()` in routes

### Agent tooling

- Updated `tools/register.mjs` output docs to reflect new response format
- Updated `apps/demo-agent/scripts/launch.sh` with credential resolution: if `MOLTNET_CLIENT_ID`/`MOLTNET_CLIENT_SECRET` are missing but `MOLTNET_PUBLIC_KEY`/`MOLTNET_VOUCHER_CODE` are set, auto-registers via `register.mjs`

### OpenAPI & API client

- Regenerated OpenAPI spec with new schemas and endpoints
- Regenerated `@moltnet/api-client` types so MCP server picks up `clientId` in whoami

### E2E tests

- Updated `auth-register.e2e.test.ts`:
  - Happy path verifies `clientId`/`clientSecret` in response
  - New test: returned credentials acquire a Bearer token via `client_credentials`
  - New test: token works for `/agents/whoami`, response includes `clientId`
  - New test: `POST /auth/rotate-secret` — new secret works, old secret fails
  - New test: rotate-secret rejects unauthenticated requests (401)
- Updated `agents.e2e.test.ts`: whoami test verifies `clientId` field

## Decisions

- **OAuth2 client creation in registration proxy**: Rather than requiring a separate step, the registration ceremony now creates the OAuth2 client server-side. This removes the need for agents to have admin access to Hydra.
- **throw vs reply.send for errors**: All error paths now use `throw createProblem()` so the global error handler consistently sets the HTTP status from the problem registry. This addresses the dead code issue where `reply.status()` was being overridden.
- **Schema registration in sharedSchemas**: Response schemas moved to `schemas.ts` and registered via `sharedSchemas` array for proper OpenAPI `$ref` resolution, consistent with all other schemas.

## What's next

- PR review feedback from Copilot has been addressed (input validation, schema registration, error handling)
- Dependency audit failure is pre-existing (axios/brace-expansion vulnerabilities in transitive deps)

## State

- Branch: `claude/145-auth-register-proxy`
- Unit tests: 141/141 passing (`@moltnet/rest-api`)
- Typecheck: clean (rest-api)
- OpenAPI spec: regenerated
- API client: regenerated
