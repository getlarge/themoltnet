# RFC 9457 Error Responses — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Standardize all REST API error responses to RFC 9457 format with structured logging, a problem type registry, and LLM-friendly documentation endpoints.

**Architecture:** A problem type registry drives a global Fastify error handler plugin, documentation routes, and OpenAPI schemas. Routes throw typed errors via helpers; the handler logs full context then sends sanitized RFC 9457 responses. Ory webhook errors are excluded.

**Tech Stack:** TypeBox (schemas), Fastify (error handler plugin), Pino (structured logging), Vitest (TDD)

**Worktree:** `.worktrees/rfc9457-errors` (branch `feature/rfc9457-error-responses`)

**Design doc:** `docs/plans/2026-02-03-rfc9457-error-responses-design.md`

---

### Task 1: ProblemDetails schemas in libs/models

**Files:**

- Create: `libs/models/src/problem-details.ts`
- Modify: `libs/models/src/index.ts`

**Step 1: Create the schema file**

```typescript
// libs/models/src/problem-details.ts
import type { Static } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';

export const ProblemCodeSchema = Type.Union([
  Type.Literal('UNAUTHORIZED'),
  Type.Literal('FORBIDDEN'),
  Type.Literal('NOT_FOUND'),
  Type.Literal('VALIDATION_FAILED'),
  Type.Literal('INVALID_CHALLENGE'),
  Type.Literal('INVALID_SIGNATURE'),
  Type.Literal('VOUCHER_LIMIT'),
  Type.Literal('UPSTREAM_ERROR'),
  Type.Literal('INTERNAL_SERVER_ERROR'),
]);

export type ProblemCode = Static<typeof ProblemCodeSchema>;

export const ProblemDetailsSchema = Type.Object({
  type: Type.String({ format: 'uri' }),
  title: Type.String(),
  status: Type.Integer({ minimum: 100, maximum: 599 }),
  code: ProblemCodeSchema,
  detail: Type.Optional(Type.String()),
  instance: Type.Optional(Type.String()),
});

export type ProblemDetails = Static<typeof ProblemDetailsSchema>;

export const ValidationErrorSchema = Type.Object({
  field: Type.String(),
  message: Type.String(),
});

export type ValidationError = Static<typeof ValidationErrorSchema>;

export const ValidationProblemDetailsSchema = Type.Intersect([
  ProblemDetailsSchema,
  Type.Object({
    errors: Type.Array(ValidationErrorSchema),
  }),
]);

export type ValidationProblemDetails = Static<
  typeof ValidationProblemDetailsSchema
>;
```

**Step 2: Re-export from index**

In `libs/models/src/index.ts`, add:

```typescript
export * from './problem-details.js';
```

**Step 3: Remove old ErrorResponseSchema from libs/models/src/schemas.ts**

Delete `ErrorResponseSchema` (lines 153-157) and its type export `ErrorResponse` (line 190). These are replaced by ProblemDetails.

**Step 4: Run typecheck**

```bash
cd /Users/edouard/Dev/getlarge/themoltnet/.worktrees/rfc9457-errors && pnpm run typecheck
```

Expected: May fail because `apps/rest-api` still imports `ErrorSchema`. That's fine — we fix it in Task 2.

**Step 5: Commit**

```bash
git add libs/models/src/problem-details.ts libs/models/src/index.ts libs/models/src/schemas.ts
git commit -m "feat(models): add RFC 9457 ProblemDetails schemas

Add ProblemDetailsSchema, ValidationProblemDetailsSchema, and
ProblemCodeSchema. Remove old ErrorResponseSchema.

Ref: #60"
```

---

### Task 2: Problem type registry and helpers

**Files:**

- Create: `apps/rest-api/src/problems/registry.ts`
- Create: `apps/rest-api/src/problems/helpers.ts`
- Create: `apps/rest-api/src/problems/index.ts`

**Step 1: Create the registry**

```typescript
// apps/rest-api/src/problems/registry.ts
import type { ProblemCode } from '@moltnet/models';

export interface ProblemType {
  slug: string;
  code: ProblemCode;
  status: number;
  title: string;
  description: string;
  commonCauses: string[];
}

const BASE_URI = 'https://themolt.net/problems';

export const problemTypes: Record<string, ProblemType> = {
  unauthorized: {
    slug: 'unauthorized',
    code: 'UNAUTHORIZED',
    status: 401,
    title: 'Unauthorized',
    description:
      'Authentication is required or the provided credentials are invalid.',
    commonCauses: [
      'Missing Authorization header',
      'Expired JWT token',
      'Invalid API key',
    ],
  },
  forbidden: {
    slug: 'forbidden',
    code: 'FORBIDDEN',
    status: 403,
    title: 'Forbidden',
    description: 'Insufficient permissions for this action.',
    commonCauses: [
      'Agent does not own the requested resource',
      'Missing required scope in access token',
    ],
  },
  'not-found': {
    slug: 'not-found',
    code: 'NOT_FOUND',
    status: 404,
    title: 'Not Found',
    description: 'The requested resource does not exist.',
    commonCauses: [
      'Invalid resource ID or fingerprint',
      'Resource was deleted',
      'Typo in the URL path',
    ],
  },
  'validation-failed': {
    slug: 'validation-failed',
    code: 'VALIDATION_FAILED',
    status: 400,
    title: 'Validation Failed',
    description:
      'Input validation failed. Check the errors array for per-field details.',
    commonCauses: [
      'Missing required field',
      'Field value out of range or wrong format',
      'Request body does not match expected schema',
    ],
  },
  'invalid-challenge': {
    slug: 'invalid-challenge',
    code: 'INVALID_CHALLENGE',
    status: 400,
    title: 'Invalid Challenge',
    description: 'Cryptographic challenge verification failed.',
    commonCauses: [
      'Challenge HMAC was tampered with',
      'Challenge has expired (5-minute TTL)',
      'Challenge was signed with a different server secret',
    ],
  },
  'invalid-signature': {
    slug: 'invalid-signature',
    code: 'INVALID_SIGNATURE',
    status: 400,
    title: 'Invalid Signature',
    description: 'Ed25519 signature verification failed.',
    commonCauses: [
      'Signature does not match the provided message',
      'Wrong private key used to sign',
      'Message was modified after signing',
    ],
  },
  'voucher-limit': {
    slug: 'voucher-limit',
    code: 'VOUCHER_LIMIT',
    status: 429,
    title: 'Voucher Limit Reached',
    description: 'Voucher creation rate limit exceeded.',
    commonCauses: [
      'Maximum active vouchers (5) already exist',
      'Wait for existing vouchers to expire or be redeemed',
    ],
  },
  'upstream-error': {
    slug: 'upstream-error',
    code: 'UPSTREAM_ERROR',
    status: 502,
    title: 'Upstream Error',
    description: 'An upstream service request failed.',
    commonCauses: [
      'Identity provider (Kratos) is unavailable',
      'Upstream service returned an unexpected error',
    ],
  },
  'internal-server-error': {
    slug: 'internal-server-error',
    code: 'INTERNAL_SERVER_ERROR',
    status: 500,
    title: 'Internal Server Error',
    description: 'An unexpected server error occurred.',
    commonCauses: [
      'Unhandled exception in a route handler',
      'Database connection failure',
    ],
  },
};

export function getTypeUri(slug: string): string {
  return `${BASE_URI}/${slug}`;
}

export function findProblemTypeByCode(code: string): ProblemType | undefined {
  return Object.values(problemTypes).find((pt) => pt.code === code);
}

export function findProblemTypeByStatus(status: number): ProblemType {
  const match = Object.values(problemTypes).find((pt) => pt.status === status);
  return match ?? problemTypes['internal-server-error'];
}
```

**Step 2: Create the helpers**

```typescript
// apps/rest-api/src/problems/helpers.ts
import { problemTypes, getTypeUri } from './registry.js';
import type { ValidationError } from '@moltnet/models';

interface ProblemError extends Error {
  statusCode: number;
  code: string;
  detail?: string;
  validationErrors?: ValidationError[];
}

export function createProblem(slug: string, detail?: string): ProblemError {
  const problemType = problemTypes[slug];
  if (!problemType) {
    throw new Error(`Unknown problem type slug: ${slug}`);
  }

  const error = new Error(detail ?? problemType.title) as ProblemError;
  error.statusCode = problemType.status;
  error.code = problemType.code;
  error.detail = detail;
  return error;
}

export function createValidationProblem(
  errors: ValidationError[],
  detail?: string,
): ProblemError {
  const problemType = problemTypes['validation-failed'];
  const error = new Error(detail ?? problemType.title) as ProblemError;
  error.statusCode = problemType.status;
  error.code = problemType.code;
  error.detail = detail ?? 'Input validation failed';
  error.validationErrors = errors;
  return error;
}
```

**Step 3: Create barrel export**

```typescript
// apps/rest-api/src/problems/index.ts
export { createProblem, createValidationProblem } from './helpers.js';
export {
  findProblemTypeByCode,
  findProblemTypeByStatus,
  getTypeUri,
  problemTypes,
  type ProblemType,
} from './registry.js';
```

**Step 4: Commit**

```bash
git add apps/rest-api/src/problems/
git commit -m "feat(rest-api): add problem type registry and error helpers

Registry defines all problem types with descriptions and common causes.
Helpers create Fastify-compatible errors from registry entries.

Ref: #60"
```

---

### Task 3: Error handler plugin

**Files:**

- Create: `apps/rest-api/src/plugins/error-handler.ts`
- Create: `apps/rest-api/__tests__/error-handler.test.ts`

**Step 1: Write the failing tests**

```typescript
// apps/rest-api/__tests__/error-handler.test.ts
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { errorHandlerPlugin } from '../src/plugins/error-handler.js';
import {
  createProblem,
  createValidationProblem,
} from '../src/problems/index.js';

async function buildTestApp() {
  const app = Fastify({ logger: false });
  await app.register(errorHandlerPlugin);

  // Route that throws a problem error
  app.get('/test-not-found', async () => {
    throw createProblem('not-found', 'Test resource not found');
  });

  // Route that throws a validation problem
  app.get('/test-validation', async () => {
    throw createValidationProblem([{ field: 'name', message: 'Required' }]);
  });

  // Route that throws an unexpected error (5xx)
  app.get('/test-crash', async () => {
    throw new Error('Something broke');
  });

  // Route with Fastify schema validation that will fail
  app.post(
    '/test-schema',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string' } },
        },
      },
    },
    async () => ({ ok: true }),
  );

  return app;
}

describe('Error handler plugin', () => {
  it('returns RFC 9457 for problem errors', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/test-not-found',
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain(
      'application/problem+json',
    );
    const body = response.json();
    expect(body).toMatchObject({
      type: 'https://themolt.net/problems/not-found',
      title: 'Not Found',
      status: 404,
      code: 'NOT_FOUND',
      detail: 'Test resource not found',
      instance: '/test-not-found',
    });
  });

  it('returns RFC 9457 with errors array for validation problems', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/test-validation',
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain(
      'application/problem+json',
    );
    const body = response.json();
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.errors).toEqual([{ field: 'name', message: 'Required' }]);
  });

  it('returns RFC 9457 for unexpected errors (5xx)', async () => {
    const app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/test-crash' });

    expect(response.statusCode).toBe(500);
    expect(response.headers['content-type']).toContain(
      'application/problem+json',
    );
    const body = response.json();
    expect(body.code).toBe('INTERNAL_SERVER_ERROR');
    expect(body.type).toBe(
      'https://themolt.net/problems/internal-server-error',
    );
    // Should NOT leak the original error message in production-like mode
    expect(body.detail).not.toBe('Something broke');
  });

  it('maps Fastify schema validation errors to VALIDATION_FAILED', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/test-schema',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain(
      'application/problem+json',
    );
    const body = response.json();
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.errors).toBeDefined();
    expect(body.errors.length).toBeGreaterThan(0);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd /Users/edouard/Dev/getlarge/themoltnet/.worktrees/rfc9457-errors && pnpm --filter @moltnet/rest-api test -- --reporter=verbose __tests__/error-handler.test.ts
```

Expected: FAIL (module not found)

**Step 3: Write the error handler plugin**

```typescript
// apps/rest-api/src/plugins/error-handler.ts
import fp from 'fastify-plugin';
import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from 'fastify';

import {
  findProblemTypeByCode,
  findProblemTypeByStatus,
  getTypeUri,
} from '../problems/registry.js';

interface ProblemError extends FastifyError {
  detail?: string;
  validationErrors?: { field: string; message: string }[];
}

async function errorHandler(fastify: FastifyInstance) {
  fastify.setErrorHandler(
    (error: ProblemError, request: FastifyRequest, reply: FastifyReply) => {
      const status = error.statusCode ?? 500;
      const isServerError = status >= 500;

      // 1. Log full error before sanitizing
      const logContext = {
        err: error,
        requestId: request.id,
        method: request.method,
        url: request.url,
        userId: (request as any).authContext?.identityId ?? null,
      };

      if (isServerError) {
        request.log.error(logContext, error.message);
      } else {
        request.log.warn(logContext, error.message);
      }

      // 2. Map to problem type
      const problemType =
        findProblemTypeByCode(error.code) ?? findProblemTypeByStatus(status);

      // 3. Handle Fastify schema validation errors
      const validationErrors =
        error.validationErrors ??
        (error.validation
          ? error.validation.map((v) => ({
              field: v.instancePath || v.params?.missingProperty || 'unknown',
              message: v.message ?? 'Validation failed',
            }))
          : undefined);

      const isValidationError = validationErrors !== undefined;
      const resolvedProblem = isValidationError
        ? {
            slug: 'validation-failed',
            code: 'VALIDATION_FAILED',
            title: 'Validation Failed',
            status: 400,
          }
        : problemType;

      // 4. Build response
      const detail = isServerError
        ? 'An unexpected error occurred'
        : (error.detail ?? error.message);

      const body: Record<string, unknown> = {
        type: getTypeUri(
          isValidationError ? 'validation-failed' : problemType.slug,
        ),
        title: resolvedProblem.title,
        status: isValidationError ? 400 : status,
        code: resolvedProblem.code,
        detail,
        instance: request.url,
      };

      if (validationErrors) {
        body.errors = validationErrors;
      }

      return reply
        .status(isValidationError ? 400 : status)
        .header('content-type', 'application/problem+json')
        .send(body);
    },
  );
}

export const errorHandlerPlugin = fp(errorHandler, {
  name: 'problem-details-error-handler',
});
```

**Step 4: Run tests to verify they pass**

```bash
cd /Users/edouard/Dev/getlarge/themoltnet/.worktrees/rfc9457-errors && pnpm --filter @moltnet/rest-api test -- --reporter=verbose __tests__/error-handler.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add apps/rest-api/src/plugins/error-handler.ts apps/rest-api/__tests__/error-handler.test.ts
git commit -m "feat(rest-api): add global error handler plugin with structured logging

Catches all errors, logs full context via Pino, returns sanitized
RFC 9457 responses. Maps Fastify validation errors to VALIDATION_FAILED.

Ref: #60"
```

---

### Task 4: Problem type documentation routes

**Files:**

- Create: `apps/rest-api/src/routes/problems.ts`
- Create: `apps/rest-api/__tests__/problems.test.ts`

**Step 1: Write the failing tests**

```typescript
// apps/rest-api/__tests__/problems.test.ts
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createMockServices,
  createTestApp,
  type MockServices,
} from './helpers.js';

describe('Problem type documentation routes', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks);
  });

  describe('GET /problems', () => {
    it('returns all problem types as JSON array', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/problems',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(9);

      // Check structure of first entry
      const first = body[0];
      expect(first).toHaveProperty('type');
      expect(first).toHaveProperty('title');
      expect(first).toHaveProperty('status');
      expect(first).toHaveProperty('code');
      expect(first).toHaveProperty('description');
      expect(first).toHaveProperty('commonCauses');
      expect(first.type).toMatch(/^https:\/\/themolt\.net\/problems\//);
    });

    it('does not require authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/problems',
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('GET /problems/:type', () => {
    it('returns a single problem type', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/problems/unauthorized',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.code).toBe('UNAUTHORIZED');
      expect(body.status).toBe(401);
      expect(body.type).toBe('https://themolt.net/problems/unauthorized');
    });

    it('returns 404 for unknown problem type', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/problems/nonexistent',
      });

      expect(response.statusCode).toBe(404);
      expect(response.headers['content-type']).toContain(
        'application/problem+json',
      );
      const body = response.json();
      expect(body.code).toBe('NOT_FOUND');
    });
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd /Users/edouard/Dev/getlarge/themoltnet/.worktrees/rfc9457-errors && pnpm --filter @moltnet/rest-api test -- --reporter=verbose __tests__/problems.test.ts
```

Expected: FAIL (routes not registered yet)

**Step 3: Write the routes**

```typescript
// apps/rest-api/src/routes/problems.ts
import type { FastifyInstance } from 'fastify';

import {
  getTypeUri,
  problemTypes,
  type ProblemType,
} from '../problems/registry.js';

function toResponseEntry(pt: ProblemType) {
  return {
    type: getTypeUri(pt.slug),
    title: pt.title,
    status: pt.status,
    code: pt.code,
    description: pt.description,
    commonCauses: pt.commonCauses,
  };
}

export async function problemRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/problems',
    {
      schema: {
        operationId: 'listProblemTypes',
        tags: ['problems'],
        description:
          'List all problem types used in API error responses (RFC 9457).',
        response: {
          200: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', format: 'uri' },
                title: { type: 'string' },
                status: { type: 'integer' },
                code: { type: 'string' },
                description: { type: 'string' },
                commonCauses: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async () => {
      return Object.values(problemTypes).map(toResponseEntry);
    },
  );

  fastify.get(
    '/problems/:type',
    {
      schema: {
        operationId: 'getProblemType',
        tags: ['problems'],
        description: 'Get details about a specific problem type (RFC 9457).',
        params: {
          type: 'object',
          properties: {
            type: { type: 'string' },
          },
          required: ['type'],
        },
      },
    },
    async (request, reply) => {
      const { type } = request.params as { type: string };
      const problemType = problemTypes[type];

      if (!problemType) {
        return reply
          .status(404)
          .header('content-type', 'application/problem+json')
          .send({
            type: getTypeUri('not-found'),
            title: 'Not Found',
            status: 404,
            code: 'NOT_FOUND',
            detail: `Problem type "${type}" does not exist`,
            instance: request.url,
          });
      }

      return toResponseEntry(problemType);
    },
  );
}
```

**Step 4: Register in app.ts**

In `apps/rest-api/src/app.ts`, add the import and registration:

```typescript
import { problemRoutes } from './routes/problems.js';
```

Add after the vouch routes registration:

```typescript
await app.register(problemRoutes);
```

**Step 5: Run tests to verify they pass**

```bash
cd /Users/edouard/Dev/getlarge/themoltnet/.worktrees/rfc9457-errors && pnpm --filter @moltnet/rest-api test -- --reporter=verbose __tests__/problems.test.ts
```

Expected: PASS

**Step 6: Commit**

```bash
git add apps/rest-api/src/routes/problems.ts apps/rest-api/__tests__/problems.test.ts apps/rest-api/src/app.ts
git commit -m "feat(rest-api): add problem type documentation endpoints

GET /problems returns all problem types as LLM-friendly JSON.
GET /problems/:type returns a single type. No auth required.

Ref: #60"
```

---

### Task 5: Register error handler and update schemas in app.ts

**Files:**

- Modify: `apps/rest-api/src/app.ts`
- Modify: `apps/rest-api/src/schemas.ts`

**Step 1: Register the error handler plugin in app.ts**

Add import at the top of `apps/rest-api/src/app.ts`:

```typescript
import { errorHandlerPlugin } from './plugins/error-handler.js';
```

Register it right after the shared schemas loop (after `app.addSchema(schema)` block, before auth plugin):

```typescript
// Register global error handler (RFC 9457 Problem Details)
await app.register(errorHandlerPlugin);
```

**Step 2: Update schemas.ts — replace ErrorSchema with ProblemDetailsSchema**

In `apps/rest-api/src/schemas.ts`:

1. Add imports from `@moltnet/models`:

   ```typescript
   import {
     ProblemDetailsSchema as ProblemDetailsBase,
     ValidationProblemDetailsSchema as ValidationProblemDetailsBase,
   } from '@moltnet/models';
   ```

2. Remove the old `ErrorSchema` (lines 18-25).

3. Add the new schemas with `$id` for OpenAPI:

   ```typescript
   export const ProblemDetailsSchema = Type.Object(
     { ...ProblemDetailsBase.properties },
     { $id: 'ProblemDetails' },
   );

   export const ValidationProblemDetailsSchema = Type.Object(
     { ...ValidationProblemDetailsBase.properties },
     { $id: 'ValidationProblemDetails' },
   );
   ```

   Actually, since TypeBox `Type.Object` with `$id` needs to be a fresh schema, the cleaner approach is to just define them directly with `$id`:

   ```typescript
   import { ProblemCodeSchema, ValidationErrorSchema } from '@moltnet/models';

   export const ProblemDetailsSchema = Type.Object(
     {
       type: Type.String({ format: 'uri' }),
       title: Type.String(),
       status: Type.Integer({ minimum: 100, maximum: 599 }),
       code: ProblemCodeSchema,
       detail: Type.Optional(Type.String()),
       instance: Type.Optional(Type.String()),
     },
     { $id: 'ProblemDetails' },
   );

   export const ValidationProblemDetailsSchema = Type.Object(
     {
       type: Type.String({ format: 'uri' }),
       title: Type.String(),
       status: Type.Integer({ minimum: 100, maximum: 599 }),
       code: ProblemCodeSchema,
       detail: Type.Optional(Type.String()),
       instance: Type.Optional(Type.String()),
       errors: Type.Array(ValidationErrorSchema),
     },
     { $id: 'ValidationProblemDetails' },
   );
   ```

4. Update the `sharedSchemas` array: replace `ErrorSchema` with `ProblemDetailsSchema` and add `ValidationProblemDetailsSchema`.

**Step 3: Run typecheck**

```bash
cd /Users/edouard/Dev/getlarge/themoltnet/.worktrees/rfc9457-errors && pnpm run typecheck
```

Expected: Failures in route files that still import `ErrorSchema`. We fix those next.

**Step 4: Commit**

```bash
git add apps/rest-api/src/app.ts apps/rest-api/src/schemas.ts
git commit -m "feat(rest-api): register error handler plugin and update OpenAPI schemas

Replace ErrorSchema with ProblemDetailsSchema and
ValidationProblemDetailsSchema in shared schemas.

Ref: #60"
```

---

### Task 6: Migrate agent routes

**Files:**

- Modify: `apps/rest-api/src/routes/agents.ts`
- Modify: `apps/rest-api/__tests__/agents.test.ts`

**Step 1: Update tests first**

In `agents.test.ts`, update the error assertions:

- Line 52-53 (`returns 404 when agent not found`): Add assertions:

  ```typescript
  expect(response.statusCode).toBe(404);
  expect(response.headers['content-type']).toContain(
    'application/problem+json',
  );
  const body = response.json();
  expect(body.code).toBe('NOT_FOUND');
  expect(body.type).toBe('https://themolt.net/problems/not-found');
  expect(body.status).toBe(404);
  ```

- Line 109 (`returns 404 when agent not found` in verify): Same pattern.

- Line 137-138 (`returns 401 without auth`): Add:
  ```typescript
  expect(response.statusCode).toBe(401);
  expect(response.headers['content-type']).toContain(
    'application/problem+json',
  );
  const body = response.json();
  expect(body.code).toBe('UNAUTHORIZED');
  ```

**Step 2: Run tests to verify they fail**

```bash
cd /Users/edouard/Dev/getlarge/themoltnet/.worktrees/rfc9457-errors && pnpm --filter @moltnet/rest-api test -- --reporter=verbose __tests__/agents.test.ts
```

Expected: FAIL (still returning old format)

**Step 3: Update agents.ts**

1. Replace `ErrorSchema` import with `ProblemDetailsSchema`:

   ```typescript
   import { ProblemDetailsSchema } from '../schemas.js';
   ```

2. Replace all `Type.Ref(ErrorSchema)` with `Type.Ref(ProblemDetailsSchema)` in response schemas.

3. Replace all inline `reply.status(N).send({ error: ..., message: ..., statusCode: ... })` with `throw createProblem(...)`:

   ```typescript
   import { createProblem } from '../problems/index.js';
   ```

   - Line 40-44: `throw createProblem('not-found', \`Agent with fingerprint "${fingerprint}" not found\`);`
   - Line 84-88: Same pattern.
   - Line 132-136: `throw createProblem('not-found', 'Agent profile not found');`

**Step 4: Run tests to verify they pass**

```bash
cd /Users/edouard/Dev/getlarge/themoltnet/.worktrees/rfc9457-errors && pnpm --filter @moltnet/rest-api test -- --reporter=verbose __tests__/agents.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add apps/rest-api/src/routes/agents.ts apps/rest-api/__tests__/agents.test.ts
git commit -m "refactor(rest-api): migrate agent routes to RFC 9457 errors

Replace inline error responses with createProblem() throws.
Update tests to assert RFC 9457 shape.

Ref: #60"
```

---

### Task 7: Migrate diary routes

**Files:**

- Modify: `apps/rest-api/src/routes/diary.ts`
- Modify: `apps/rest-api/__tests__/diary.test.ts`

**Step 1: Update tests**

Update all error assertions in `diary.test.ts` to check RFC 9457 shape:

- `returns 404 when not found` tests → assert `code: 'NOT_FOUND'`, `content-type: application/problem+json`
- `returns 401 without auth` → assert `code: 'UNAUTHORIZED'`
- `returns 403 when share is not allowed` → assert `code: 'FORBIDDEN'`
- `rejects empty content` (400) → assert `code: 'VALIDATION_FAILED'`
- `rejects invalid visibility` (400) → assert `code: 'VALIDATION_FAILED'`

**Step 2: Run tests to verify they fail**

```bash
cd /Users/edouard/Dev/getlarge/themoltnet/.worktrees/rfc9457-errors && pnpm --filter @moltnet/rest-api test -- --reporter=verbose __tests__/diary.test.ts
```

**Step 3: Update diary.ts**

1. Replace `ErrorSchema` import with `ProblemDetailsSchema`.
2. Replace all `Type.Ref(ErrorSchema)` with `Type.Ref(ProblemDetailsSchema)`.
3. Import `createProblem` from `'../problems/index.js'`.
4. Replace all 6 inline error responses:
   - Line 146-150: `throw createProblem('not-found', 'Entry not found');`
   - Line 206-210: `throw createProblem('not-found', 'Entry not found or not owned by you');`
   - Line 242-246: Same.
   - Line 367-371: `throw createProblem('not-found', \`Agent with fingerprint "${sharedWith}" not found\`);`
   - Line 381-385: `throw createProblem('forbidden', 'Cannot share this entry');`
   - Line 459-463: `throw createProblem('not-found', 'Entry not found or not owned by you');`

**Step 4: Run tests to verify they pass**

```bash
cd /Users/edouard/Dev/getlarge/themoltnet/.worktrees/rfc9457-errors && pnpm --filter @moltnet/rest-api test -- --reporter=verbose __tests__/diary.test.ts
```

**Step 5: Commit**

```bash
git add apps/rest-api/src/routes/diary.ts apps/rest-api/__tests__/diary.test.ts
git commit -m "refactor(rest-api): migrate diary routes to RFC 9457 errors

Replace inline error responses with createProblem() throws.
Update tests to assert RFC 9457 shape.

Ref: #60"
```

---

### Task 8: Migrate recovery routes

**Files:**

- Modify: `apps/rest-api/src/routes/recovery.ts`
- Modify: `apps/rest-api/__tests__/recovery.test.ts`

**Step 1: Update tests**

Update error assertions in `recovery.test.ts`:

- Line 66: `response.json().error` → `response.json().code` (all occurrences)
- Line 169: Same — `expect(response.json().code).toBe('INVALID_CHALLENGE');`
- Line 189: `expect(response.json().code).toBe('INVALID_CHALLENGE');`
- Line 190: `expect(response.json().detail).toBe('Challenge expired');` (was `.message`)
- Line 204: `expect(response.json().code).toBe('NOT_FOUND');`
- Line 220: `expect(response.json().code).toBe('INVALID_SIGNATURE');`
- Line 266: `expect(response.json().code).toBe('UPSTREAM_ERROR');`
- Add `content-type` assertion for all error tests.

**Step 2: Run tests to verify they fail**

```bash
cd /Users/edouard/Dev/getlarge/themoltnet/.worktrees/rfc9457-errors && pnpm --filter @moltnet/rest-api test -- --reporter=verbose __tests__/recovery.test.ts
```

**Step 3: Update recovery.ts**

1. Replace `ErrorSchema` import with `ProblemDetailsSchema`.
2. Replace `Type.Ref(ErrorSchema)` → `Type.Ref(ProblemDetailsSchema)`.
3. Import `createProblem`.
4. Replace inline errors:
   - Line 66-70: `throw createProblem('not-found', 'No agent found for this public key');`
   - Line 134-138: `throw createProblem('invalid-challenge', hmacResult.reason);`
   - Line 144-148: `throw createProblem('not-found', 'No agent found for this public key');`
   - Line 162-166: `throw createProblem('invalid-signature', 'Ed25519 signature verification failed');`
   - Line 192-196 (in catch): `throw createProblem('upstream-error', 'Failed to create recovery code via identity provider');`

**Step 4: Run tests to verify they pass**

```bash
cd /Users/edouard/Dev/getlarge/themoltnet/.worktrees/rfc9457-errors && pnpm --filter @moltnet/rest-api test -- --reporter=verbose __tests__/recovery.test.ts
```

**Step 5: Commit**

```bash
git add apps/rest-api/src/routes/recovery.ts apps/rest-api/__tests__/recovery.test.ts
git commit -m "refactor(rest-api): migrate recovery routes to RFC 9457 errors

Ref: #60"
```

---

### Task 9: Migrate vouch routes

**Files:**

- Modify: `apps/rest-api/src/routes/vouch.ts`
- Modify: `apps/rest-api/__tests__/vouch.test.ts`

**Step 1: Update tests**

- Line 51: `response.json().error` → `response.json().code` (`'VOUCHER_LIMIT'`)
- Add content-type assertion for 429 test.
- Add content-type and code assertion for 401 test.

**Step 2: Run tests to verify they fail**

```bash
cd /Users/edouard/Dev/getlarge/themoltnet/.worktrees/rfc9457-errors && pnpm --filter @moltnet/rest-api test -- --reporter=verbose __tests__/vouch.test.ts
```

**Step 3: Update vouch.ts**

1. Replace `ErrorSchema` import with `ProblemDetailsSchema`.
2. Replace `Type.Ref(ErrorSchema)` → `Type.Ref(ProblemDetailsSchema)`.
3. Import `createProblem`.
4. Replace line 41-47:
   ```typescript
   throw createProblem(
     'voucher-limit',
     'You have reached the maximum number of active vouchers (5). ' +
       'Wait for existing vouchers to expire or be redeemed.',
   );
   ```

**Step 4: Run tests to verify they pass**

```bash
cd /Users/edouard/Dev/getlarge/themoltnet/.worktrees/rfc9457-errors && pnpm --filter @moltnet/rest-api test -- --reporter=verbose __tests__/vouch.test.ts
```

**Step 5: Commit**

```bash
git add apps/rest-api/src/routes/vouch.ts apps/rest-api/__tests__/vouch.test.ts
git commit -m "refactor(rest-api): migrate vouch routes to RFC 9457 errors

Ref: #60"
```

---

### Task 10: Migrate webhook API key errors in hooks.ts

**Files:**

- Modify: `apps/rest-api/src/routes/hooks.ts`
- Modify: `apps/rest-api/__tests__/hooks.test.ts`

**Important:** Only the API key validation errors (lines 60-74) are migrated. All `oryValidationError()` calls and their test assertions remain untouched.

**Step 1: Update tests**

Update only the webhook API key validation tests (lines 199-244):

- Line 216-219: Change `expect(response.json()).toEqual(...)` to:

  ```typescript
  expect(response.headers['content-type']).toContain(
    'application/problem+json',
  );
  const body = response.json();
  expect(body.code).toBe('UNAUTHORIZED');
  expect(body.detail).toBe('Missing webhook API key');
  ```

- Line 240-243: Same pattern for invalid key.

**Step 2: Run tests to verify they fail**

```bash
cd /Users/edouard/Dev/getlarge/themoltnet/.worktrees/rfc9457-errors && pnpm --filter @moltnet/rest-api test -- --reporter=verbose __tests__/hooks.test.ts
```

**Step 3: Update hooks.ts**

Import `createProblem`:

```typescript
import { createProblem } from '../problems/index.js';
```

Replace the `validateWebhookApiKey` middleware errors (lines 60-74):

```typescript
if (typeof provided !== 'string') {
  throw createProblem('unauthorized', 'Missing webhook API key');
}
// ...
if (
  expected.length !== actual.length ||
  !crypto.timingSafeEqual(expected, actual)
) {
  throw createProblem('unauthorized', 'Invalid webhook API key');
}
```

Remove the `return reply.status(401).send(...)` calls. The `throw` will be caught by the global error handler.

**Step 4: Run tests to verify they pass**

```bash
cd /Users/edouard/Dev/getlarge/themoltnet/.worktrees/rfc9457-errors && pnpm --filter @moltnet/rest-api test -- --reporter=verbose __tests__/hooks.test.ts
```

Expected: All 9 tests pass. Ory-format tests unchanged.

**Step 5: Commit**

```bash
git add apps/rest-api/src/routes/hooks.ts apps/rest-api/__tests__/hooks.test.ts
git commit -m "refactor(rest-api): migrate webhook API key errors to RFC 9457

Only API key validation errors are migrated. Ory webhook format
responses (oryValidationError) are intentionally unchanged.

Ref: #60"
```

---

### Task 11: Full test suite + typecheck + lint

**Step 1: Run full test suite**

```bash
cd /Users/edouard/Dev/getlarge/themoltnet/.worktrees/rfc9457-errors && pnpm run test
```

Expected: All tests pass across all workspaces.

**Step 2: Run typecheck**

```bash
cd /Users/edouard/Dev/getlarge/themoltnet/.worktrees/rfc9457-errors && pnpm run typecheck
```

Expected: No errors.

**Step 3: Run lint**

```bash
cd /Users/edouard/Dev/getlarge/themoltnet/.worktrees/rfc9457-errors && pnpm run lint
```

Expected: No errors.

**Step 4: Run build**

```bash
cd /Users/edouard/Dev/getlarge/themoltnet/.worktrees/rfc9457-errors && pnpm run build
```

Expected: Builds successfully.

**Step 5: Fix any issues found, commit fixes**

If any step fails, fix the issue and commit with a descriptive message.

---

### Task 12: Check for `ErrorResponseSchema` / `ErrorSchema` references

**Step 1: Search for remaining references**

```bash
grep -r "ErrorResponseSchema\|ErrorSchema\|error: 'NOT_FOUND'\|error: 'UNAUTHORIZED'" --include="*.ts" apps/ libs/
```

Expected: No matches except Ory webhook `oryValidationError` calls.

**Step 2: Run knip to check for unused exports**

```bash
cd /Users/edouard/Dev/getlarge/themoltnet/.worktrees/rfc9457-errors && pnpm run knip
```

**Step 3: Fix any unused exports or dangling references, commit**
