---
date: 2026-02-04
session: 01
type: handoff
tags: [rest-api, error-handling, rfc9457, problem-details]
---

# Session 01: RFC 9457 Error Responses

## Context

Issue #60 — standardize all REST API error responses to [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html) Problem Details format with a `code` extension field, structured logging, and dereferenceable problem type documentation.

## What Was Built

### Problem Details Schemas (`libs/models`)

- `ProblemDetailsSchema` and `ValidationProblemDetailsSchema` in `libs/models/src/problem-details.ts`
- `ProblemCodeSchema` as union of 9 known codes: `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_FAILED`, `INVALID_CHALLENGE`, `INVALID_SIGNATURE`, `VOUCHER_LIMIT`, `UPSTREAM_ERROR`, `INTERNAL_SERVER_ERROR`
- Schemas have `$id` for Fastify shared schema registration via `fastify.addSchema()`

### Problem Type Registry (`apps/rest-api/src/problems/`)

- `registry.ts` — single source of truth for all 9 problem types with slug, code, status, title, description, and commonCauses
- `helpers.ts` — `createProblem(slug, detail?)` and `createValidationProblem(errors, detail?)` for routes to throw errors
- Error objects carry `statusCode` and `code` properties so Fastify's error handler can pick them up

### Global Error Handler Plugin

- `apps/rest-api/src/plugins/error-handler.ts` — Fastify plugin using `setErrorHandler`
- Logs full error context before sanitizing (5xx at `log.error` with stack, 4xx at `log.warn`)
- Maps errors to problem types via registry lookup (by `code`, then by `statusCode`)
- Handles Fastify schema validation errors → `VALIDATION_FAILED` with per-field `errors` array
- Sanitizes 5xx detail to generic message (no internal leaks)
- Sets `content-type: application/problem+json` on all error responses

### Problem Type Documentation Endpoints

- `GET /problems` — returns full registry as JSON array (LLM-friendly)
- `GET /problems/:type` — returns single problem type or 404 in RFC 9457 format
- Public, unauthenticated routes

### Route Migrations

All route error responses migrated from `reply.status().send({ error, message })` to `throw createProblem()`:

- `agents.ts` — 3 error responses
- `diary.ts` — 6 error responses
- `recovery.ts` — 5 error responses
- `vouch.ts` — 1 error response
- `hooks.ts` — 2 API key errors (Ory `oryValidationError()` left unchanged)
- `libs/auth/src/plugin.ts` — `requireAuth` and `requireScopes` updated to throw with proper `statusCode`/`code`

### OpenAPI Integration

- Old `ErrorSchema` removed from `apps/rest-api/src/schemas.ts` and `libs/models`
- `ProblemDetailsSchema` and `ValidationProblemDetailsSchema` registered as shared schemas
- All route error responses reference the new schemas

## Design Decisions

- **Ory webhook responses excluded** — Ory requires `messages[].instance_ptr` format; only API key validation errors in webhook routes were migrated
- **`code` extension field** — short machine-readable code for programmatic `switch`/matching alongside the `type` URI
- **JSON-only docs** — no HTML, no content negotiation; agents can cache `GET /problems`
- **Registry as single source of truth** — drives error handler, docs endpoint, and OpenAPI spec

## Verification

- 60+ unit tests pass (rest-api + auth)
- Full validation suite passes (lint, typecheck, test, build)
- 8 new tests: 4 for error handler plugin, 4 for problem docs routes

## Files Changed

**New:**

- `libs/models/src/problem-details.ts`
- `apps/rest-api/src/problems/registry.ts`
- `apps/rest-api/src/problems/helpers.ts`
- `apps/rest-api/src/problems/index.ts`
- `apps/rest-api/src/plugins/error-handler.ts`
- `apps/rest-api/src/routes/problems.ts`
- `apps/rest-api/__tests__/error-handler.test.ts`
- `apps/rest-api/__tests__/problems.test.ts`

**Modified:**

- `libs/models/src/schemas.ts` — removed `ErrorResponseSchema`
- `libs/models/src/index.ts` — re-export problem-details
- `libs/auth/src/plugin.ts` — throw with statusCode/code instead of reply.send
- `apps/rest-api/src/app.ts` — register error handler + problems routes
- `apps/rest-api/src/schemas.ts` — replace ErrorSchema with ProblemDetails imports
- `apps/rest-api/src/routes/agents.ts` — createProblem throws
- `apps/rest-api/src/routes/diary.ts` — createProblem throws
- `apps/rest-api/src/routes/recovery.ts` — createProblem throws
- `apps/rest-api/src/routes/vouch.ts` — createProblem throws
- `apps/rest-api/src/routes/hooks.ts` — API key errors only
- All corresponding test files updated for RFC 9457 assertions

## What's Next

- E2E tests extended to assert RFC 9457 error shape
- Re-enable diary CRUD e2e tests (currently skipped due to Keto namespace fix timing)
- Update `@moltnet/api-client` to type error responses as `ProblemDetails`

## Resources

- Issue: #60
- RFC 9457: https://www.rfc-editor.org/rfc/rfc9457.html
- Design: `docs/plans/2026-02-03-rfc9457-error-responses-design.md`
- Plan: `docs/plans/2026-02-03-rfc9457-implementation-plan.md`
