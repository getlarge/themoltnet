---
date: '2026-02-02T07:45:00Z'
author: claude-opus-4-5-20251101
session: session_01T2W34UBYQnQ6ceqJRUnPeD
type: handoff
importance: 0.8
tags: [handoff, e2e-tests, rest-api, ory, hydra, keto, kratos, real-auth, ci]
supersedes: null
signature: pending
---

# Handoff: REST API E2E Tests with Real Auth

## What Was Done This Session

- Created the first e2e test suite for the REST API (`apps/rest-api/e2e/`)
- Tests use **real Ory services** — no mocked auth or permissions:
  - Real Kratos identity creation (admin API)
  - Real Hydra OAuth2 token issuance (client_credentials grant)
  - Real Keto permission checks (read/write APIs)
  - Real PostgreSQL + pgvector database
- Created `e2e/helpers.ts` with `createAgent()` — full registration pipeline:
  1. Generate Ed25519 keypair via `cryptoService`
  2. Create Kratos identity via admin API
  3. Call after-registration webhook on the test server (creates DB entry + Keto relations)
  4. Create Hydra OAuth2 client via admin API with agent metadata
  5. Acquire real access token via `client_credentials` grant
- Created `e2e/setup.ts` with `createTestHarness()` — wires real `TokenValidator` (JWKS + introspection), real `PermissionChecker` (Keto), real database
- Tests fail immediately when Docker infrastructure isn't running (no graceful skip)
- Tests run concurrently (default vitest parallelism — race conditions are bugs to catch)
- Added dedicated `e2e` CI job in `.github/workflows/ci.yml`
- Added root scripts: `docker:e2e:up` (clean slate with `-v`), `docker:e2e:down`, `test:e2e`

## Test Coverage

| File                     | Tests | Coverage                                                                                                                     |
| ------------------------ | ----- | ---------------------------------------------------------------------------------------------------------------------------- |
| `health.e2e.test.ts`     | 1     | Health endpoint                                                                                                              |
| `diary-crud.e2e.test.ts` | 11    | Create, read, list, update, delete, visibility, search, reflect, cross-agent isolation, auth rejection                       |
| `agents.e2e.test.ts`     | 13    | Agent profile lookup, whoami, valid/invalid/wrong-key signature verification, crypto verify, crypto identity, challenge flow |

## What's Not Done Yet

- The Kratos after-registration webhook is not configured in `infra/ory/kratos/kratos.yaml` (the e2e tests call it manually via `app.inject()`). Should be added to the Kratos config so it fires automatically during real registration flows.
- Hydra token-exchange webhook (`/hooks/hydra/token-exchange`) is not configured in `infra/ory/hydra/hydra.yaml`. The token validator falls back to `fetchClientMetadata` from Hydra admin API. This works but means the JWT `ext` claims are empty — enrichment happens via fallback. For production, the webhook should be configured.
- No sharing e2e tests (would require two agents with specific Keto relations).
- No error-case e2e tests for rate limiting or malformed payloads.
- E2E tests are not included in the default `pnpm run test` (intentional — they require Docker).

## Current State

- Branch: `claude/add-rest-api-e2e-tests-Vltzh`
- Unit tests: 60 passing (unchanged)
- Typecheck: clean
- Lint: 0 errors, 28 pre-existing warnings
- E2E tests: 25 tests across 3 files (fail with ECONNREFUSED without Docker — expected)

## Decisions Made

- **Real auth over mocked auth**: The initial implementation used a mock `TokenValidator` and permissive `PermissionChecker`. Rewrote to use real Ory services. This catches integration bugs between the auth plugin, token validator, and Ory APIs that mocks would hide.
- **Manual webhook call over automatic**: Since Kratos's self-hosted YAML doesn't have the after-registration webhook configured, the e2e helper calls `POST /hooks/kratos/after-registration` directly via `app.inject()`. This still tests the webhook handler code path.
- **Token validator fallback path**: Without the Hydra token-exchange webhook, the token validator can't find `moltnet:*` claims in the JWT. It falls back to `fetchClientMetadata()` which reads the OAuth2 client's `metadata` from Hydra admin API. This works because `createAgent()` sets the agent metadata during client creation.
- **No race condition guards**: Tests run concurrently by default. If concurrent tests cause database conflicts, that indicates a real isolation bug in the service layer. Each test file creates its own Fastify instance on a random port with a unique agent.
- **Fail-fast, no skip**: Tests crash with `ECONNREFUSED` if Docker isn't up. This prevents false-green CI. The `isDatabaseAvailable()` graceful-skip function was removed.
- **Separate CI job**: E2E tests run in their own job (`e2e`) after lint/typecheck/test pass. This keeps unit test feedback fast while still running full integration.

## Open Questions

- Should the Kratos/Hydra webhook URLs be configured to point at a host-accessible address so webhooks fire automatically during e2e tests? This would require knowing the Fastify port before starting Docker, or using a fixed port.
- Should there be a `docker-compose.e2e.yaml` override file that uses tmpfs instead of named volumes, or is `docker compose down -v && up` sufficient?
- Should the e2e job be required for merge, or advisory-only (since it's slower and needs Docker)?

## Where to Start Next

1. Configure Kratos after-registration webhook and Hydra token-exchange webhook in the Ory YAML files
2. Add sharing e2e tests (two agents, one shares an entry with the other)
3. WS7 Phase 2: mount REST API under `/api/v1/` in the combined server
4. Consider adding e2e tests for the MCP server (similar pattern)
