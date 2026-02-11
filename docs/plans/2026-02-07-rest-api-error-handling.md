# REST API Error Handling Improvements — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ensure every error response from the REST API is a deliberate, structured RFC 9457 problem detail — no accidental 500s. Fix the voucher serialization retry exhaustion, add a defensive `onError` hook for observability, and harden all tests.

**Architecture:** Extract serialization retry into a reusable helper with jitter. Add a new `serialization-exhausted` problem type. Refactor the vouch route to return 429 on exhaustion. Add a Fastify `onError` hook that tags unhandled errors so they're observable (the error handler already converts them to RFC 9457, but the hook ensures they're logged with a "this was unexpected" marker). Update all test expectations.

**Tech Stack:** Fastify, Drizzle ORM (serializable transactions), Vitest, TypeBox, RFC 9457 Problem Details

**Principle:** A 500 must be an intent, not an accident. Every unhandled error that reaches the error handler should be logged with an "unexpected" marker so it's visible in observability.

---

## Task 1: Add `SERIALIZATION_EXHAUSTED` to the ProblemCode model type and registry

**Files:**

- Modify: `libs/models/src/` — wherever `ProblemCode` is defined
- Modify: `apps/rest-api/src/problems/registry.ts:98` (insert new type after `voucher-limit`)
- Modify: `apps/rest-api/__tests__/problems.test.ts`

**Step 1: Find the ProblemCode type definition**

Run: `grep -rn "ProblemCode" libs/models/src/`

**Step 2: Add `SERIALIZATION_EXHAUSTED` to the ProblemCode union**

Add `'SERIALIZATION_EXHAUSTED'` to the union type. The exact file and line depend on step 1.

**Step 3: Write the failing test**

Add to `apps/rest-api/__tests__/problems.test.ts`:

```typescript
it('includes serialization-exhausted problem type', () => {
  expect(problemTypes['serialization-exhausted']).toEqual({
    slug: 'serialization-exhausted',
    code: 'SERIALIZATION_EXHAUSTED',
    status: 429,
    title: 'Serialization Retry Exhausted',
    description:
      'Concurrent request conflict could not be resolved after retries.',
    commonCauses: [
      'Too many concurrent writes to the same resource',
      'Try again after a short delay',
    ],
  });
});
```

**Step 4: Run test to verify it fails**

Run: `pnpm --filter @moltnet/rest-api test -- --run --reporter=verbose problems.test`
Expected: FAIL — `problemTypes['serialization-exhausted']` is `undefined`

**Step 5: Add the problem type to the registry**

In `apps/rest-api/src/problems/registry.ts`, add after the `voucher-limit` entry (line 98):

```typescript
  'serialization-exhausted': {
    slug: 'serialization-exhausted',
    code: 'SERIALIZATION_EXHAUSTED',
    status: 429,
    title: 'Serialization Retry Exhausted',
    description:
      'Concurrent request conflict could not be resolved after retries.',
    commonCauses: [
      'Too many concurrent writes to the same resource',
      'Try again after a short delay',
    ],
  },
```

**Step 6: Run test to verify it passes**

Run: `pnpm --filter @moltnet/rest-api test -- --run --reporter=verbose problems.test`
Expected: PASS

**Step 7: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS

**Step 8: Commit**

```bash
git add libs/models/src/ apps/rest-api/src/problems/registry.ts apps/rest-api/__tests__/problems.test.ts
git commit -m "feat: add SERIALIZATION_EXHAUSTED problem type to models and registry"
```

---

## Task 2: Extract serialization retry helper with jitter

**Files:**

- Create: `apps/rest-api/src/utils/serialization-retry.ts`
- Create: `apps/rest-api/__tests__/serialization-retry.test.ts`

**Step 1: Write the failing tests**

Create `apps/rest-api/__tests__/serialization-retry.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';

import { withSerializationRetry } from '../src/utils/serialization-retry.js';

function makeSerializationError(): Error & { code: string } {
  return Object.assign(new Error('could not serialize access'), {
    code: '40001',
  });
}

describe('withSerializationRetry', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withSerializationRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on serialization failure and returns on success', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(makeSerializationError())
      .mockResolvedValueOnce('ok');

    const result = await withSerializationRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws ProblemError with 429 after max retries exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(makeSerializationError());

    try {
      await withSerializationRetry(fn, { maxRetries: 3 });
      expect.unreachable('should have thrown');
    } catch (error: unknown) {
      const err = error as Error & { statusCode: number; code: string };
      expect(err.statusCode).toBe(429);
      expect(err.code).toBe('SERIALIZATION_EXHAUSTED');
      expect(fn).toHaveBeenCalledTimes(3);
    }
  });

  it('does not retry non-serialization errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('connection refused'));

    await expect(withSerializationRetry(fn)).rejects.toThrow(
      'connection refused',
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('calls onRetry callback with attempt number', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(makeSerializationError())
      .mockRejectedValueOnce(makeSerializationError())
      .mockResolvedValueOnce('ok');

    const onRetry = vi.fn();
    await withSerializationRetry(fn, { maxRetries: 5, onRetry });

    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(1, 5);
    expect(onRetry).toHaveBeenCalledWith(2, 5);
  });

  it('applies jitter delay between retries', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(makeSerializationError())
      .mockResolvedValueOnce('ok');

    const start = Date.now();
    await withSerializationRetry(fn, {
      maxRetries: 3,
      baseDelayMs: 10,
    });
    const elapsed = Date.now() - start;

    // Should have waited at least ~5ms (baseDelayMs * 0.5 jitter floor)
    expect(elapsed).toBeGreaterThanOrEqual(5);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('respects custom maxRetries', async () => {
    const fn = vi.fn().mockRejectedValue(makeSerializationError());

    await expect(
      withSerializationRetry(fn, { maxRetries: 7 }),
    ).rejects.toMatchObject({ code: 'SERIALIZATION_EXHAUSTED' });
    expect(fn).toHaveBeenCalledTimes(7);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @moltnet/rest-api test -- --run --reporter=verbose serialization-retry.test`
Expected: FAIL — module not found

**Step 3: Implement the helper**

Create `apps/rest-api/src/utils/serialization-retry.ts`:

```typescript
import { createProblem } from '../problems/index.js';

const SERIALIZATION_FAILURE = '40001';

function isSerializationFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as Error & { code: string }).code === SERIALIZATION_FAILURE
  );
}

export interface SerializationRetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  onRetry?: (attempt: number, maxRetries: number) => void;
}

export async function withSerializationRetry<T>(
  fn: () => Promise<T>,
  options: SerializationRetryOptions = {},
): Promise<T> {
  const { maxRetries = 5, baseDelayMs = 50, onRetry } = options;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isSerializationFailure(error)) {
        throw error;
      }
      if (attempt + 1 < maxRetries) {
        onRetry?.(attempt + 1, maxRetries);
        // Jittered exponential backoff: base * 2^attempt * random(0.5, 1.5)
        const delay =
          baseDelayMs * Math.pow(2, attempt) * (0.5 + Math.random());
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw createProblem(
    'serialization-exhausted',
    `Operation failed after ${maxRetries} attempts due to concurrent ` +
      'request conflicts. Please retry after a short delay.',
  );
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @moltnet/rest-api test -- --run --reporter=verbose serialization-retry.test`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/rest-api/src/utils/serialization-retry.ts apps/rest-api/__tests__/serialization-retry.test.ts
git commit -m "feat(rest-api): add withSerializationRetry helper with jitter and 429 on exhaustion"
```

---

## Task 3: Refactor vouch route to use the new helper

**Files:**

- Modify: `apps/rest-api/src/routes/vouch.ts`
- Modify: `apps/rest-api/__tests__/vouch.test.ts`

**Step 1: Update the unit test expectations**

In `apps/rest-api/__tests__/vouch.test.ts`:

1. Change test name `'rethrows after max serialization retries exhausted'` to `'returns 429 after max serialization retries exhausted'`
2. Change `expect(response.statusCode).toBe(500)` to `expect(response.statusCode).toBe(429)` (line 92)
3. Add assertions for problem detail format:
   ```typescript
   expect(response.headers['content-type']).toContain(
     'application/problem+json',
   );
   expect(response.json().code).toBe('SERIALIZATION_EXHAUSTED');
   ```
4. Change `expect(mocks.voucherRepository.issue).toHaveBeenCalledTimes(3)` to `.toHaveBeenCalledTimes(5)` (line 93) — the new default is 5 retries

**Step 2: Run tests to verify the updated test fails**

Run: `pnpm --filter @moltnet/rest-api test -- --run --reporter=verbose vouch.test`
Expected: FAIL — still returns 500, called 3 times

**Step 3: Refactor the vouch route**

In `apps/rest-api/src/routes/vouch.ts`:

1. Remove the `SERIALIZATION_FAILURE`, `MAX_SERIALIZATION_RETRIES` constants (lines 17-19)
2. Remove the `isSerializationFailure` function (lines 21-27)
3. Add import: `import { withSerializationRetry } from '../utils/serialization-retry.js';`
4. Replace the handler body (lines 53-92) with:

```typescript
    async (request, reply) => {
      const voucher = await withSerializationRetry(
        () =>
          fastify.voucherRepository.issue(request.authContext!.identityId),
        {
          onRetry: (attempt, max) => {
            request.log.warn(
              { attempt, max },
              'Serialization failure in voucher issuance, retrying',
            );
          },
        },
      );

      if (!voucher) {
        throw createProblem(
          'voucher-limit',
          'You have reached the maximum number of active vouchers (5). ' +
            'Wait for existing vouchers to expire or be redeemed.',
        );
      }

      return reply.status(201).send({
        code: voucher.code,
        expiresAt: voucher.expiresAt.toISOString(),
        issuedBy: request.authContext!.fingerprint,
      });
    },
```

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @moltnet/rest-api test -- --run --reporter=verbose vouch.test`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/rest-api/src/routes/vouch.ts apps/rest-api/__tests__/vouch.test.ts
git commit -m "refactor(rest-api): use withSerializationRetry in vouch route, return 429 on exhaustion"
```

---

## Task 4: Add `onError` hook for unexpected error observability

The global `setErrorHandler` already converts all errors to RFC 9457. But when an error reaches the handler without a `statusCode` (i.e., it's an unexpected/unhandled error that will become a 500), we should tag it for observability. This makes accidental 500s visible in logs/metrics.

**Files:**

- Modify: `apps/rest-api/src/plugins/error-handler.ts`
- Modify: `apps/rest-api/__tests__/error-handler.test.ts`

**Step 1: Write the failing test**

Add to `apps/rest-api/__tests__/error-handler.test.ts`:

```typescript
it('tags unexpected errors (no statusCode) as unhandled in the response', async () => {
  const app = await buildTestApp();
  const response = await app.inject({
    method: 'GET',
    url: '/test-crash',
  });

  expect(response.statusCode).toBe(500);
  const body = response.json();
  expect(body.code).toBe('INTERNAL_SERVER_ERROR');
  // The detail should be sanitized — no leak of "Something broke"
  expect(body.detail).toBe('An unexpected error occurred');
});

it('preserves statusCode and code for known problem errors', async () => {
  const app = await buildTestApp();
  const response = await app.inject({
    method: 'GET',
    url: '/test-not-found',
  });

  expect(response.statusCode).toBe(404);
  expect(response.json().code).toBe('NOT_FOUND');
  expect(response.json().detail).toBe('Test resource not found');
});
```

(These tests should already pass — they verify existing behavior. The real goal is the next step.)

**Step 2: Add an `onError` hook that marks unexpected errors**

In `apps/rest-api/src/plugins/error-handler.ts`, inside the `errorHandler` function, before `setErrorHandler`, add:

```typescript
// Tag errors without a statusCode as unexpected — these become 500s and
// should be visible in observability dashboards as "unintentional".
fastify.addHook('onError', (request, _reply, error, done) => {
  const status = (error as { statusCode?: number }).statusCode;
  if (!status || status >= 500) {
    request.log.error(
      {
        err: error,
        unexpected: !status,
        requestId: request.id,
        method: request.method,
        url: request.url,
      },
      status
        ? 'Intentional server error'
        : 'UNEXPECTED ERROR — no statusCode set, this should be investigated',
    );
  }
  done();
});
```

This ensures:

- Errors with no `statusCode` (raw throws from libraries/DB) are logged with `unexpected: true`
- Errors with explicit `statusCode >= 500` (intentional `createProblem('internal-server-error')`) are logged as intentional
- 4xx errors are not double-logged (already logged in the error handler)

**Step 3: Run tests**

Run: `pnpm --filter @moltnet/rest-api test -- --run --reporter=verbose error-handler.test`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/rest-api/src/plugins/error-handler.ts apps/rest-api/__tests__/error-handler.test.ts
git commit -m "feat(rest-api): add onError hook to tag unexpected 500s for observability"
```

---

## Task 5: Update the E2E concurrency test to reject 500s

**Files:**

- Modify: `apps/rest-api/e2e/concurrency.e2e.test.ts:176-193`

**Step 1: Update the test**

Replace lines 176-193 in `concurrency.e2e.test.ts`. Remove the `serverErrors` variable and the comment about 500s:

```typescript
const succeeded = responses.filter((r) => r.response.status === 201);
const rateLimited = responses.filter((r) => r.response.status === 429);

// The total active count should never exceed 5
const { data: activeList } = await listActiveVouchers({
  client,
  auth: () => freshAgent.accessToken,
});
expect(activeList!.vouchers.length).toBeLessThanOrEqual(5);

// At most 1 of the concurrent batch should have succeeded
expect(succeeded.length).toBeLessThanOrEqual(1);
// All non-success responses must be 429 (rate-limited or serialization exhausted)
// No 500s allowed — serialization exhaustion is now handled gracefully
expect(succeeded.length + rateLimited.length).toBe(responses.length);
```

**Step 2: Verify the change compiles**

Run: `pnpm --filter @moltnet/rest-api typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/rest-api/e2e/concurrency.e2e.test.ts
git commit -m "test(rest-api): remove 500 allowance from concurrency test, all errors must be 429"
```

---

## Task 6: Document 500 responses in OpenAPI schemas and update problem count

All routes can produce a 500 if something unexpected happens (DB down, etc.). The error handler converts these to RFC 9457, but the OpenAPI spec doesn't document them. Add `500: Type.Ref(ProblemDetailsSchema)` to every route schema so the generated Swagger spec tells API consumers "yes, you might get a structured 500."

Also, the `/problems` endpoint automatically includes the new `serialization-exhausted` type (it iterates the registry), but the unit test asserts a minimum count that needs bumping.

**Files:**

- Modify: `apps/rest-api/src/routes/vouch.ts` — add `500` to all three route schemas
- Modify: `apps/rest-api/src/routes/diary.ts` — add `500` to all route schemas
- Modify: `apps/rest-api/src/routes/agents.ts` — add `500` to all route schemas
- Modify: `apps/rest-api/src/routes/crypto.ts` — add `500` to all route schemas
- Modify: `apps/rest-api/src/routes/recovery.ts` — add `500` to all route schemas
- Modify: `apps/rest-api/__tests__/problems.test.ts` — bump `toBeGreaterThanOrEqual(9)` to `10`

**Step 1: Add `500: Type.Ref(ProblemDetailsSchema)` to every route's response schema**

In each route file, for every route handler that has a `schema.response` object, add:

```typescript
500: Type.Ref(ProblemDetailsSchema),
```

This means importing `ProblemDetailsSchema` in files that don't already import it. Check each file:

- `vouch.ts`: already imports `ProblemDetailsSchema` — add `500` to all three routes
- `diary.ts`: already imports `ProblemDetailsSchema` — add `500` to all route schemas
- `agents.ts`: already imports `ProblemDetailsSchema` — add `500` to all route schemas
- `crypto.ts`: already imports `ProblemDetailsSchema` — add `500` to `/crypto/verify` and `/crypto/identity`
- `recovery.ts`: already imports `ProblemDetailsSchema` — add `500` to both routes

Do NOT modify hook routes — those are internal Ory webhooks with their own error format.

**Step 2: Bump the problem count in the unit test**

In `apps/rest-api/__tests__/problems.test.ts`, change:

```typescript
expect(body.length).toBeGreaterThanOrEqual(9);
```

to:

```typescript
expect(body.length).toBeGreaterThanOrEqual(10);
```

**Step 3: Run tests**

Run: `pnpm --filter @moltnet/rest-api test -- --run --reporter=verbose`
Expected: PASS

**Step 4: Regenerate OpenAPI spec**

Run: `pnpm run generate:openapi`

Verify the generated spec includes `500` responses on all public routes.

**Step 5: Commit**

```bash
git add apps/rest-api/src/routes/ apps/rest-api/__tests__/problems.test.ts
git commit -m "docs(rest-api): add 500 response to all OpenAPI route schemas and bump problem count"
```

---

## Task 7: Run full validation

**Step 1: Run validate**

Run: `pnpm run validate`
Expected: PASS (runs lint, typecheck, test, build in sequence)

**Step 2: If any failures, fix and re-run**

Fix any issues found, then re-run `pnpm run validate`.

**Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix(rest-api): address lint/typecheck/test issues from error handling changes"
```

---

## Audit Results: Error Handling Coverage

Complete audit of every route and error path in the REST API. The goal: every error that reaches a client must be a structured RFC 9457 problem detail, and every 500 must be intentional.

### Routes that already handle errors correctly

| Route                                   | Error paths                                                                             | Status                                |
| --------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------- |
| `POST /vouch`                           | voucher-limit (429), serialization retry (429 after this plan), auth (401)              | **Fixed by this plan**                |
| `GET /vouch/active`                     | auth (401)                                                                              | OK — no business errors possible      |
| `GET /vouch/graph`                      | none — public endpoint                                                                  | OK                                    |
| `POST /diary/entries`                   | auth (401), schema validation (400)                                                     | OK — DB errors become 500 via handler |
| `GET /diary/entries`                    | auth (401)                                                                              | OK                                    |
| `GET /diary/entries/:id`                | auth (401), not-found (404)                                                             | OK                                    |
| `PATCH /diary/entries/:id`              | auth (401), not-found (404)                                                             | OK — no serializable isolation        |
| `DELETE /diary/entries/:id`             | auth (401), not-found (404)                                                             | OK — no serializable isolation        |
| `POST /diary/search`                    | auth (401), schema validation (400)                                                     | OK                                    |
| `GET /diary/reflect`                    | auth (401)                                                                              | OK                                    |
| `POST /diary/entries/:id/share`         | auth (401), not-found (404), forbidden (403)                                            | OK                                    |
| `GET /diary/shared-with-me`             | auth (401)                                                                              | OK                                    |
| `PATCH /diary/entries/:id/visibility`   | auth (401), not-found (404)                                                             | OK                                    |
| `GET /agents/:fingerprint`              | not-found (404)                                                                         | OK                                    |
| `POST /agents/:fingerprint/verify`      | not-found (404)                                                                         | OK — crypto.verify catches internally |
| `GET /agents/whoami`                    | auth (401), not-found (404)                                                             | OK                                    |
| `POST /crypto/verify`                   | schema validation (400)                                                                 | OK — crypto.verify catches internally |
| `GET /crypto/identity`                  | auth (401)                                                                              | OK                                    |
| `POST /recovery/challenge`              | not-found (404)                                                                         | OK                                    |
| `POST /recovery/verify`                 | invalid-challenge (400), not-found (404), invalid-signature (400), upstream-error (502) | OK — all errors use createProblem()   |
| `POST /hooks/kratos/after-registration` | unauthorized (401), Ory validation errors (400/403)                                     | OK — uses Ory error format (required) |
| `POST /hooks/kratos/after-settings`     | unauthorized (401), Ory validation errors (400)                                         | OK                                    |
| `POST /hooks/hydra/token-exchange`      | unauthorized (401), fallback to minimal claims on error (200)                           | OK — webhook must not fail            |

### What could still produce accidental 500s

1. **Database connection failures** — any route can fail if Postgres is unreachable. The error handler sanitizes these to `INTERNAL_SERVER_ERROR` with no stack trace leak. The `onError` hook (Task 4) now tags these as `unexpected: true`.
2. **OOM / process crashes** — not catchable at the HTTP layer. Outside scope.

### Items from issue #112 NOT included in this plan (with rationale)

1. **Diary routes serialization audit** — Diary service does NOT use serializable isolation (confirmed: `grep -r "serializable\|isolationLevel" libs/diary-service/src/` returns no matches). Diary operations use default `READ COMMITTED`. No serialization retry needed.

2. **Auth middleware rate limiting per IP** — The `@fastify/rate-limit` plugin already rate-limits by IP for anonymous users and by identity ID for authenticated users (see `apps/rest-api/src/plugins/rate-limit.ts:51-62`). Auth failures still consume the global rate limit budget. Adding a separate per-IP rate limit specifically for auth failures is a new feature that should be its own issue.

3. **Keto permission failures returning structured errors** — Keto isn't called directly in routes. The diary service calls Keto internally and returns `null` for permission failures, which routes map to `createProblem('not-found')` (intentional — prevents entry enumeration). The sharing route maps to `createProblem('forbidden')`. All covered.

4. **Auth middleware 401 problem details** — Already implemented: `createAuthError()` in `libs/auth/src/plugin.ts:61-75` sets `statusCode: 401`, `code: 'UNAUTHORIZED'`, `detail: message`. The error handler maps this to RFC 9457 with content-type `application/problem+json`. Confirmed by test in `vouch.test.ts:111-124`.
