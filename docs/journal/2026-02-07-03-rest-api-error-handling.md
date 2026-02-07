---
date: '2026-02-07T12:00:00Z'
author: claude-opus-4-6
session: edouard-1770479698
type: handoff
importance: 0.7
tags: [handoff, rest-api, error-handling, rfc9457, observability]
supersedes: null
signature: pending
---

# Handoff: REST API Error Handling — 500 Must Be Intentional

## What Was Done This Session

- Added `SERIALIZATION_EXHAUSTED` to `ProblemCode` union in `libs/models/src/problem-details.ts` and to the problem registry in `apps/rest-api/src/problems/registry.ts` (status 429)
- Created reusable `withSerializationRetry` helper at `apps/rest-api/src/utils/serialization-retry.ts` with jittered exponential backoff, configurable `maxRetries`/`baseDelayMs`/`onRetry`, and throws structured 429 on exhaustion
- Refactored `POST /vouch` route to use the new helper, replacing inline retry logic
- Added `onError` observability hook in `apps/rest-api/src/plugins/error-handler.ts` that logs unexpected errors (no `statusCode` set) distinctly from intentional server errors
- Updated concurrency E2E test to reject 500 responses — only 201 and 429 are acceptable
- Added `500: Type.Ref(ProblemDetailsSchema)` to all 24 route schemas across `vouch.ts`, `diary.ts`, `agents.ts`, `crypto.ts`, `recovery.ts` for OpenAPI documentation
- Regenerated `@moltnet/api-client` from updated OpenAPI spec
- Full test suite: 121/121 passing in rest-api, 7 new unit tests for retry helper, 2 new tests for error handler hook

## What's Not Done Yet

- Pre-existing lint/typecheck errors in `apps/server` (15 `@typescript-eslint/no-unsafe-*` errors, multiple TS2339/TS2349 type errors) — unrelated to this work
- Consider adding `withSerializationRetry` to other routes if they adopt SERIALIZABLE isolation in the future

## Current State

- Branch: `claude/112-rest-api-error-handling`
- Tests: 121 passing, 0 failing (rest-api)
- Build: clean (excluding pre-existing apps/server errors)
- 6 commits, 18 files changed, +584/-59 lines

## Decisions Made

- **429 over 503 for serialization exhaustion**: 429 ("Too Many Requests") is semantically correct — the failure is caused by too many concurrent writes, and the client should retry after a delay. 503 implies the service is entirely unavailable.
- **5 retries (up from 3)**: More attempts with jittered backoff gives better success rate under contention without excessive latency.
- **onError hook vs. extending setErrorHandler**: The hook fires _after_ the error handler, making it a clean observability layer without modifying the response pipeline. Unexpected errors (no `statusCode`) get flagged distinctly.
- **Document 500 in OpenAPI even though it shouldn't happen in practice**: Transparency — consumers know the API _can_ return 500 and should handle it gracefully.

## Open Questions

None for this work.

## Where to Start Next

1. Review and merge this PR
2. Address pre-existing `apps/server` lint/typecheck errors (separate issue)
3. If new routes adopt SERIALIZABLE isolation, wrap them with `withSerializationRetry`
