---
date: '2026-02-04T21:00:00Z'
author: claude-opus-4-5-20251101
session: unknown
type: handoff
importance: 0.7
tags: [handoff, e2e, testing, recovery, auth, kratos]
supersedes: null
signature: pending
---

# Handoff: E2E Auth Lifecycle & Domain Flow Tests

## What Was Done This Session

- Added 36 new e2e tests across 5 new test files, bringing total from 25 to 61
- Fixed e2e test harness (setup.ts): missing `recoverySecret`, incorrect Ory client routing, missing `kratosPublicFrontend`
- Enabled Kratos recovery flow with `code` method in `kratos.yaml`
- Created GitHub issue #67 for migrating `@ory/client` (axios) to `@ory/client-fetch` (native fetch)
- Closed issues #27 and #28 (MCP server will have own deployment)

### New Test Files

| File                   | Tests | Coverage                                                                    |
| ---------------------- | ----- | --------------------------------------------------------------------------- |
| `recovery.e2e.test.ts` | 7     | Crypto challenge-response + Kratos self-service recovery code submission    |
| `hooks.e2e.test.ts`    | 11    | All 3 webhook handlers (after-registration, after-settings, token-exchange) |
| `vouch.e2e.test.ts`    | 7     | Voucher issuance, listing, max limit (5), trust graph                       |
| `sharing.e2e.test.ts`  | 7     | Diary sharing by fingerprint, shared-with-me listing, auth checks           |
| `problems.e2e.test.ts` | 4     | RFC 9457 problem type documentation routes                                  |

## What's Not Done Yet

- Signup/login e2e tests (full Kratos self-service registration + login flow)
- MCP server e2e tests
- Migration from `@ory/client` to `@ory/client-fetch` (issue #67)

## Current State

- Branch: `feature/e2e-auth-lifecycle-tests`
- PR: #68
- Tests: 61 e2e passing, 89 unit tests passing
- Typecheck: clean
- Lint: clean on new files (pre-existing 10 errors in other files)

## Decisions Made

- Recovery test submits code to Kratos self-service API to prove full flow works end-to-end (not just our API returning a code)
- Ory SDK throws `AxiosError` on 422 from Kratos (state transition response); handled with `try/catch` and response body inspection
- Kratos 422 with `redirect_browser_to` or `continue_with` confirms recovery code was accepted
- Did not add `axios` as direct dependency; used type assertion for AxiosError handling (issue #67 will eliminate this)

## Discoveries

- `@ory/client` uses axios internally; `@ory/client-fetch` is the official fetch-based replacement (same API surface)
- Kratos `createRecoveryCodeForIdentity` with `flow_type: 'api'` returns both `recovery_code` and `recovery_link` containing a flow ID
- Kratos `updateRecoveryFlow` returns 422 (not 200) on successful code submission when the flow transitions state (e.g., `browser_location_change_required`)
- The e2e `createE2eOryClients()` was routing `identity` and `frontend` to wrong Ory services (Hydra admin instead of Kratos admin/public)

## Where to Start Next

1. Read this handoff
2. Check PR #68 for CI results
3. Consider adding signup/login e2e flow tests
4. Issue #67: migrate `@ory/client` → `@ory/client-fetch` to drop axios
