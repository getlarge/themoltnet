---
date: '2026-02-26T13:00:00Z'
author: claude-sonnet-4-6
session: continuation
type: handoff
importance: 0.8
tags: [legreffier, e2e, testing, ci, rest-api]
supersedes: null
signature: <pending>
---

# LeGreffier E2E Tests + CLI Test Fixes

## Context

Continuation of the legreffier-init-cli branch (issue #287). Previous session completed the full CLI UX. This session focused on: fixing two CI failures in the CLI package, and adding a full e2e happy path test for the LeGreffier onboarding workflow.

## Substance

### CLI Test Fixes (CI was failing)

Two failures fixed:

1. **`github.test.ts` error message mismatch** — `lookupBotUser` was rewritten to try multiple username formats (`<slug>[bot]` then `<slug>`); error message changed from `'GitHub user lookup failed (404)'` to `'GitHub user lookup failed for app "no-such-app"'`. Updated assertion.

2. **`api.test.ts` Vite SDK resolution** — `@themoltnet/sdk` only exports from `dist/` (not source-direct), which doesn't exist in CI before build. Fixed by adding `resolve.alias` in `packages/legreffier-cli/vitest.config.ts` pointing `@themoltnet/sdk` → `../../libs/sdk/src/index.ts`.

Also regenerated the Go API client (`go generate`) to pick up `clientId`/`clientSecret`/`identityId` fields added to the onboarding status response schema.

### E2E Happy Path for LeGreffier Onboarding

**Key insight**: the server makes NO outbound GitHub API calls. `/callback` and `/installed` just relay data to the DBOS workflow via `DBOS.send`. No mocking needed.

**Architecture**:

- `e2e/globalSetup.ts` extended to bootstrap a sponsor genesis agent using `bootstrapGenesisAgents`, then restart the `rest-api` container with `SPONSOR_AGENT_ID` injected via `docker compose --env-file /dev/null up --force-recreate rest-api`
- `docker-compose.e2e.yaml` — added `SPONSOR_AGENT_ID: '${SPONSOR_AGENT_ID:-}'` to rest-api environment
- `--env-file /dev/null` is essential — prevents the host dotenvx `.env` from leaking encrypted `SPONSOR_AGENT_ID` into the container (which fails uuid format validation)
- `SPONSOR_AGENT_ID` env var skip: if already set (CI override), bootstrap is skipped

**Test (`legreffier-onboarding.e2e.test.ts`)**:

- Rewritten to use `@moltnet/api-client` (`createClient` once in `beforeAll`, `startLegreffierOnboarding`, `getLegreffierOnboardingStatus`)
- Raw `fetch` for hidden endpoints (`/callback`, `/installed`)
- Typed `pollStatus` helper using `GetLegreffierOnboardingStatusResponse`
- Happy path: start → callback (fake code) → installed (fake installation_id) → poll to `completed` — verifies `identityId`, `clientId`, `clientSecret` in response
- Graceful degradation: if `SPONSOR_AGENT_ID` not injected, asserts 503 and returns

**E2E results**: 17 test files, 229 passed, 1 skipped (pre-existing `it.skip` in diary-search for negation search). Legreffier happy path: ✓ 2062ms.

## Decisions

- **Restart approach over Docker service**: a separate `sponsor-seed` Docker service would slow down CI significantly. Bootstrapping in globalSetup and restarting is fast (~5s) and reuses existing `bootstrapGenesisAgents` logic.
- **`--env-file /dev/null`**: the only clean way to prevent host dotenvx secrets from leaking into docker compose. Not needed for the initial `up` (which predates our change) but essential for the `--force-recreate` call.
- **No mocking for e2e**: the workflow event model (DBOS recv/send) means we can drive the full happy path with plain HTTP calls — no nock/msw needed.

## What's Not Done

- CLI phase-level integration tests (mock `fetch` + `open` per phase) — discussed but not implemented; lower priority since e2e covers the contract
- GitHub issue #321 (docs for legreffier onboarding) — created but content not written
- Tasks 6, 7, 8, 10, 11 from the original plan (settings.local.json writer, API helpers, main InitApp, Go CLI subcommand, CI/release-please)

## Current State

- Branch: `claude/legreffier-init-cli-287`
- CLI tests: 24/24 ✓
- REST API unit tests: 246/246 ✓
- REST API e2e tests: 229/230 ✓ (1 pre-existing skip)
- Build: not re-run this session (no source changes beyond test/config files)

## Where to Start Next

1. Run `pnpm run validate` to confirm clean state
2. Check remaining tasks from plan `docs/plans/2026-02-24-legreffier-init-cli.md`
3. Next meaningful task: **Task 11** — CI config + release-please + PR. The branch has all the substantive work done; needs a proper PR with the mission integrity checklist.

## Continuity Notes

- The `.agent-claim.json` is stale (points to issue #204/PR #317 from a previous session). Update it to issue #287 before signalling `ready_for_pr`.
- `MOLTNET_PROJECT_NUMBER` is not set in this environment — project board updates must be done manually or via a properly configured session.
