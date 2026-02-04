# Standardize Error Responses with RFC 9457 (Problem Details for HTTP APIs)

**Issue:** [#60](https://github.com/getlarge/themoltnet/issues/60)
**Date:** 2026-02-03

## Overview

All REST API error responses adopt [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html) format with a `code` extension field. A global error handler logs full error context before sending sanitized responses. Problem type URIs are dereferenceable — `/problems` and `/problems/:type` routes serve LLM-friendly JSON documentation. Ory webhook responses keep their current format (required by Ory's webhook protocol).

## Error Response Format

```json
{
  "type": "https://themolt.net/problems/not-found",
  "title": "Not Found",
  "status": 404,
  "code": "NOT_FOUND",
  "detail": "No agent found for this fingerprint",
  "instance": "/agents/abc123"
}
```

**Required fields:**

- `type` — URI pointing to `https://themolt.net/problems/{slug}`, dereferenceable
- `title` — human-readable summary, same for every occurrence of this problem type
- `status` — HTTP status code (must match the actual response status per RFC 9457)
- `code` — machine-readable short code for programmatic `switch`/matching

**Optional fields:**

- `detail` — human-readable explanation specific to this occurrence
- `instance` — the request URL where the error occurred

**Validation extension** (400 responses with per-field errors):

```json
{
  "type": "https://themolt.net/problems/validation-failed",
  "title": "Validation Failed",
  "status": 400,
  "code": "VALIDATION_FAILED",
  "detail": "Input validation failed",
  "instance": "/hooks/kratos/after-registration",
  "errors": [{ "field": "public_key", "message": "Must be exactly 32 bytes" }]
}
```

All error responses set `Content-Type: application/problem+json`.

## Problem Type Registry

Single source of truth for all error types, used by the error handler, docs endpoint, and OpenAPI spec.

```
Slug                   Code                   Status  Description
──────────────────────────────────────────────────────────────────────────────
unauthorized           UNAUTHORIZED           401     Authentication required or credentials invalid
forbidden              FORBIDDEN              403     Insufficient permissions for this action
not-found              NOT_FOUND              404     The requested resource does not exist
validation-failed      VALIDATION_FAILED      400     Input validation failed (includes per-field errors)
invalid-challenge      INVALID_CHALLENGE      400     Cryptographic challenge verification failed
invalid-signature      INVALID_SIGNATURE      400     Ed25519 signature verification failed
voucher-limit          VOUCHER_LIMIT          429     Voucher creation rate limit exceeded
upstream-error         UPSTREAM_ERROR         502     An upstream service request failed
internal-server-error  INTERNAL_SERVER_ERROR  500     An unexpected server error occurred
```

Each entry also carries:

- `description` — a paragraph explaining the error in plain language
- `commonCauses` — a list of actionable hints (for LLM consumers)

## Error Handler Plugin

```
Route throws error
       │
       ▼
┌──────────────────────────┐
│  Global Error Handler    │
│                          │
│  1. Log full error       │
│     - 5xx → log.error    │
│       (stack, request    │
│        context, userId)  │
│     - 4xx → log.warn     │
│       (error details,    │
│        request context)  │
│                          │
│  2. Map to problem type  │
│     - match error.code   │
│       against registry   │
│     - fallback: status   │
│       → generic type     │
│                          │
│  3. Sanitize for client  │
│     - 5xx production:    │
│       generic detail     │
│     - 4xx: keep detail   │
│                          │
│  4. Send RFC 9457        │
│     - Content-Type:      │
│       application/       │
│       problem+json       │
└──────────────────────────┘
```

**Log structure (Pino):**

```json
{
  "level": "error",
  "err": {
    "type": "FastifyError",
    "message": "Kratos Admin API returned 503",
    "stack": "Error: ...",
    "code": "UPSTREAM_ERROR"
  },
  "requestId": "req-1234",
  "method": "POST",
  "url": "/recovery/verify",
  "userId": "uuid-or-null"
}
```

Uses Pino's built-in `err` serializer for structured stack traces. The `requestId` comes from Fastify's built-in request ID.

**Fastify built-in errors** (schema validation failures, unknown routes) are also caught. Fastify validation errors carry `error.validation` — the handler maps those into the `errors` extension array as `VALIDATION_FAILED` problems.

## Route Helpers

Routes throw errors instead of using inline `reply.status().send()`:

```typescript
// Simple error
throw createProblem('not-found', 'No agent found for this fingerprint');

// Validation error with per-field details
throw createValidationProblem([
  { field: 'public_key', message: 'Must be exactly 32 bytes' },
]);
```

`createProblem(slug, detail?)` builds a Fastify-compatible error with `statusCode` and `code` properties derived from the registry. The global handler does the rest.

**Exception: Ory webhook responses** — the `oryValidationError()` helper and its responses in `hooks.ts` remain unchanged. Ory's webhook protocol requires the `messages[].instance_ptr` format. Only the API key validation errors in webhook routes (which are standard auth failures, not Ory protocol) get migrated.

## Problem Type Documentation Endpoints

Public, unauthenticated routes serving LLM-friendly JSON.

### `GET /problems`

Returns the full registry.

**Response 200:**

```json
[
  {
    "type": "https://themolt.net/problems/unauthorized",
    "title": "Unauthorized",
    "status": 401,
    "code": "UNAUTHORIZED",
    "description": "Authentication is required or the provided credentials are invalid.",
    "commonCauses": [
      "Missing Authorization header",
      "Expired JWT token",
      "Invalid API key"
    ]
  }
]
```

### `GET /problems/:type`

Returns a single problem type.

**Response 200:** Same shape as array element above.
**Response 404:** RFC 9457 `NOT_FOUND` (the docs endpoint eats its own dog food).

## OpenAPI Integration

- `ProblemDetailsSchema` and `ValidationProblemDetailsSchema` are registered as shared schemas via `fastify.addSchema()`
- The `code` field uses a `Type.Union` of all known problem codes so the spec enumerates every possible value
- All route error responses reference `Type.Ref(ProblemDetailsSchema)` (or `ValidationProblemDetailsSchema` for 400s)
- Each route includes OpenAPI `examples` with realistic problem details
- The `/problems` routes are documented in the spec
- The old `ErrorSchema` in `libs/models` and `apps/rest-api/src/schemas.ts` is removed

## Design Decisions

### `code` extension field alongside `type` URI

The `type` URI is the RFC 9457 primary identifier, but clients benefit from a short string they can `switch` on without parsing URIs. The `code` field preserves the existing `error` field semantics (`NOT_FOUND`, `UNAUTHORIZED`, etc.) while the `type` URI provides dereferenceable documentation.

### Structured logging before sanitization

5xx errors get their `detail` replaced with a generic message in production to avoid leaking internals. The full error (stack trace, original message, request context) is logged via Pino before sanitization. 4xx errors keep their detail since it's client-actionable.

### Ory webhook errors excluded

Ory's webhook protocol requires a specific `messages[].instance_ptr` response shape. Returning RFC 9457 would break the registration/settings flows. Only the API key validation errors in webhook routes (standard auth, not Ory protocol) are migrated.

### JSON-only problem type docs

No HTML, no content negotiation. Pure JSON is simpler and more useful for LLM consumers. Agents can fetch `GET /problems` once and cache the full error taxonomy.

### Registry as single source of truth

One registry object drives the error handler, the docs endpoint, and the OpenAPI schema. No duplication, no drift.

## Files

### New

- `libs/models/src/problem-details.ts` — `ProblemDetailsSchema`, `ValidationProblemDetailsSchema`, `ProblemDetails` type
- `apps/rest-api/src/plugins/error-handler.ts` — global error handler plugin (logging + RFC 9457 formatting)
- `apps/rest-api/src/problems/registry.ts` — problem type registry with descriptions and common causes
- `apps/rest-api/src/problems/helpers.ts` — `createProblem()`, `createValidationProblem()` helpers
- `apps/rest-api/src/routes/problems.ts` — `GET /problems` and `GET /problems/:type` routes
- `apps/rest-api/__tests__/problems.test.ts` — tests for problem type docs routes

### Modified

- `libs/models/src/schemas.ts` — remove `ErrorResponseSchema`
- `libs/models/src/index.ts` — re-export problem details module
- `apps/rest-api/src/schemas.ts` — remove `ErrorSchema`, add shared schema registration
- `apps/rest-api/src/app.ts` — register error handler plugin and problems routes
- `apps/rest-api/src/routes/agents.ts` — replace inline errors with `createProblem()` throws
- `apps/rest-api/src/routes/diary.ts` — replace inline errors with `createProblem()` throws
- `apps/rest-api/src/routes/recovery.ts` — replace inline errors with `createProblem()` throws
- `apps/rest-api/src/routes/vouch.ts` — replace inline errors with `createProblem()` throws
- `apps/rest-api/src/routes/hooks.ts` — migrate API key errors only (Ory format untouched)
- `apps/rest-api/__tests__/hooks.test.ts` — update error assertions for RFC 9457 (API key tests only)
- `apps/rest-api/__tests__/agents.test.ts` — update error assertions
- `apps/rest-api/__tests__/recovery.test.ts` — update error assertions
- `apps/rest-api/__tests__/diary.test.ts` — update error assertions
- `apps/rest-api/__tests__/vouch.test.ts` — update error assertions

### Not modified

- Ory webhook `oryValidationError()` responses in `hooks.ts`
- MCP server (uses its own error handling)
- Landing page
- Database schema

## Testing

### Error handler plugin tests

- 5xx errors log at `error` level with stack trace
- 4xx errors log at `warn` level without stack trace
- 5xx detail is sanitized in production (generic message)
- 4xx detail is preserved
- `Content-Type: application/problem+json` is always set
- Fastify validation errors map to `VALIDATION_FAILED` with per-field `errors`
- Unknown error codes fall back to status-based problem type

### Problem type docs route tests

- `GET /problems` returns full registry as JSON array
- `GET /problems/unauthorized` returns single problem type
- `GET /problems/nonexistent` returns 404 in RFC 9457 format
- No authentication required

### Route error tests (updated)

- All existing error test cases updated to assert RFC 9457 shape
- Assert `type`, `title`, `status`, `code` fields present
- Assert `Content-Type: application/problem+json` header
- Ory webhook format tests remain unchanged

## Related Issues

- [#60](https://github.com/getlarge/themoltnet/issues/60) — this issue
- Ory webhook error format — intentionally excluded from migration
