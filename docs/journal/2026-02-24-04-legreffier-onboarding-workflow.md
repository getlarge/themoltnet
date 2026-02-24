---
date: '2026-02-24T18:30:00Z'
author: claude-sonnet-4-6
session: legreffier-onboarding-workflow-287
type: handoff
importance: 0.9
tags: [legreffier, dbos, onboarding, github-app, public-endpoints]
supersedes: null
signature: <pending>
---

# LeGreffier Onboarding Workflow — Phase 2

## Context

Issue #287 Phase 2: implement the DBOS durable workflow and public HTTP endpoints
for LeGreffier one-command onboarding. Phase 1 (sponsor agent infrastructure, PR #301)
was already merged.

## Substance

### What was done

**DBOS Workflow (`legreffier-onboarding-workflow.ts`)**

Implemented `legreffier.startOnboarding` with two `recv` steps:

1. `issueVoucherStep` — issues unlimited voucher from sponsor agent
2. `registerAgentStep` — runs full Kratos + Keto + OAuth2 registration
3. `DBOS.recv(GITHUB_CODE_EVENT, 600s)` — waits for GitHub app creation callback
4. `DBOS.setEvent(GITHUB_CODE_READY_EVENT, code)` — signals code is available for polling
5. `DBOS.recv(INSTALLATION_ID_EVENT, 3600s)` — waits for GitHub installation callback
6. Compensation on either timeout: `deleteKratosIdentityStep`

Key design from issue comments: `setup_url` field in the manifest fires after
app _installation_ (repo selection), not after creation. The workflowId is baked
into `setup_url` at manifest construction time since GitHub doesn't echo a `state`
parameter on setup_url redirects (only on redirect_url).

**Public Endpoints (`routes/public.ts`)**

Four unauthenticated routes:

- `POST /public/legreffier/start` — starts workflow, returns `workflowId` +
  `manifestFormUrl` (pre-built GitHub manifest form URL with `state=<workflowId>`
  and `setup_url` baked in)
- `GET /public/legreffier/callback` — GitHub's `redirect_url` after app creation;
  forwards `code` to workflow via `DBOS.send(workflowId, code, GITHUB_CODE_EVENT)`
- `GET /public/legreffier/status/:workflowId` — polls status by checking
  `DBOS.getEvent(workflowId, GITHUB_CODE_READY_EVENT, 0)` (non-blocking)
- `GET /public/legreffier/installed` — GitHub's `setup_url` callback after
  installation; forwards `installation_id` to workflow

Rate limited via `fastify.rateLimitConfig.legreffierStart`. Returns 503 when
`fastify.security.sponsorAgentId` is not configured.

**Schemas (`@moltnet/models`)**

Added to `libs/models/src/schemas.ts`:

- `StartOnboardingBodySchema`
- `StartOnboardingResponseSchema`
- `OnboardingStatusResponseSchema` (with `awaiting_installation` status added)
- `InstalledCallbackQuerySchema`
- `CompleteOnboardingBodySchema` (kept for potential future use)

**Config/Security plumbing (earlier commits)**

- `RATE_LIMIT_LEGREFFIER_START` config field (default: 3/day)
- `SPONSOR_AGENT_ID` optional config
- `fastify.security` decorator exposing full `SecurityOptions`
- `fastify.rateLimitConfig.legreffierStart` rate limit config

**Tests**

- 208 unit tests passing (208 up from 200 before this session)
- New unit tests in `__tests__/public.test.ts`: validation 400s and 503 (no sponsor)
- New e2e file `e2e/legreffier-onboarding.e2e.test.ts`: 10 tests covering
  validation errors, 404 for unknown workflows, 503 without sponsor config
- Fixed `__tests__/helpers.ts`: added `issueUnlimited` mock, `searchOwned` /
  `searchAccessible` to diaryService mock, `rateLimitLegreffierStart` to
  TEST_SECURITY_OPTIONS, `securityOverrides` param to `createTestApp`

### Key decisions

1. **`setup_url` baked into manifest at start time** — GitHub doesn't echo `state`
   on `setup_url` redirects, so the workflowId must be encoded in the URL path/query
   directly: `?wf=<workflowId>`.

2. **Removed `COMPLETE_ACK_EVENT`** — The original plan had an explicit completion
   acknowledgement step from the CLI. This was replaced by the `installation_id`
   recv: GitHub's `setup_url` callback _is_ the natural completion signal (the app
   is installed and ready). No separate ack needed.

3. **`OnboardingResult.installationId`** — The workflow now returns `installationId`
   in its result, available when the workflow completes for downstream use.

4. **`API_BASE_URL` hardcoded** — Using `'https://api.themolt.net'` directly in
   the manifest URLs. Not worth adding a config field for a production-only constant.

5. **TypeBox type provider** — No type casts on `request.body` / `request.query` /
   `request.params` because `server = fastify.withTypeProvider<TypeBoxTypeProvider>()`
   provides full inference when schemas are passed inline.

## What's not done

- **GitHub API validation of `installation_id`** — Issue comments note that
  `installation_id` from GitHub's setup_url should be validated via
  `GET /app/installations/{id}` (authenticated as the app via JWT) before forwarding
  to the workflow. This is a security hardening step not yet implemented. The CLI
  holds the app's PEM so this validation would need the installation_id forwarded
  back to the CLI to validate, or a separate server-side GitHub App credential.
  Deferred — the current implementation trusts the `installation_id` from GitHub's
  redirect, which is a controlled URL.

- **E2E happy path** — The full `start → callback → installed` path requires
  `SPONSOR_AGENT_ID` configured in the e2e stack + a live GitHub interaction.
  Not testable in CI without mocking.

- **CLI integration** — The `moltnet legreffier init` CLI command that drives
  this flow is tracked separately.

## Current state

- **Branch**: `claude/legreffier-onboarding-workflow-287`
- **Commits this session**: 5 commits (6453a18 → a7aba68)
- **Unit tests**: 208 passing, 0 failing
- **Typecheck**: clean
- **Lint**: clean (pre-existing warnings only)
- **Build**: not run (no schema/code changes requiring it)

## Where to start next

1. Consider whether to validate `installation_id` server-side. Would require
   storing the GitHub App's private key (PEM) server-side — contradicts the
   design principle that PEM stays client-side. Skip this or document why
   it's acceptable.
2. Wire the CLI (`packages/github-agent` or new `moltnet legreffier init` command)
   to call `POST /public/legreffier/start`, open the browser, and poll
   `GET /public/legreffier/status/:workflowId` until `github_code_ready`.
3. Once status is `github_code_ready`, CLI retrieves the code and calls
   `POST /app-manifests/{code}/conversions` directly to get the PEM.
