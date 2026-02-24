# Logging Strategy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add AsyncLocalStorage-based request context propagation to `@moltnet/observability` so every log call from services and MCP tools is automatically enriched with `requestId`, `identityId`, `clientId`, `traceId`, and `spanId` — without passing a logger parameter anywhere.

**Architecture:** A typed `Map`-backed `AsyncLocalStorage` store lives in `libs/observability`. A Fastify plugin populates it on each request. Services call `getContextLogger(baseLogger)` to get a pre-enriched child logger. OTel trace context is read from the active span via `@opentelemetry/api`. MCP tool handlers get `app.log` injected via `FastifyInstance` and log errors before returning `errorResult()`. DBOS workflow logging is migrated from `DBOS.logger` to injected Pino logger.

**Tech Stack:** Node.js `AsyncLocalStorage`, `@opentelemetry/api` (already in deps), Pino child loggers, Fastify hooks, TypeScript strict mode.

**Related:** This plan is complementary to issue #302 (`docs/plans/2026-02-24-otel-direct-axiom.md`) which wires OTLP transport. Both can be worked in parallel; the ALS store works without OTLP configured.

---

## Background

The codebase has 21 log calls in rest-api and 6 in mcp-server — almost all in error handlers. Services (diary-service, crypto, auth) are completely silent. MCP tool handlers catch errors and return `errorResult()` without logging. DBOS workflow compensation uses `DBOS.logger` which is a separate stream from Pino.

### Key files to know

- `libs/observability/src/index.ts` — re-exports all observability symbols
- `libs/observability/src/sdk.ts` — `initObservability()` creates logger + OTel providers
- `libs/observability/src/logger.ts` — `createLogger()` factory, `DEFAULT_REDACT_PATHS`
- `apps/rest-api/src/bootstrap.ts` — wires all deps, creates Fastify instance
- `apps/rest-api/src/plugins/error-handler.ts` — global error handler (correct, leave alone)
- `apps/rest-api/src/workflows/registration-workflow.ts` — uses `DBOS.logger.error()` for compensation
- `libs/diary-service/src/diary-service.ts` — `resolveEmbedding()` at line 138 silently swallows errors
- `apps/mcp-server/src/diary-tools.ts` — all handlers: `if (error) return errorResult(...)` with no logging
- `apps/mcp-server/src/app.ts` — `buildApp()` creates FastifyInstance; no `app.log` passed to tools
- `apps/mcp-server/src/plugins/dbos.ts` — `DBOSPluginOptions` has `enableOTLP` but no endpoint config

### Conventions

- Tests: Vitest, AAA pattern, files in `__tests__/` alongside `src/`
- Run single package tests: `pnpm --filter @moltnet/<pkg> run test -- --reporter=verbose`
- Run typechecks: `pnpm --filter @moltnet/<pkg> run typecheck`
- Commit: always use `git commit -m "$(cat <<'EOF'...EOF\n)"` with Co-Authored-By trailer
- No `paths` aliases in tsconfig — imports go through package exports

---

## Task 1: Create `libs/observability/src/request-context.ts`

**Files:**

- Create: `libs/observability/src/request-context.ts`
- Modify: `libs/observability/src/index.ts`
- Create: `libs/observability/__tests__/request-context.test.ts`

**Step 1: Write the failing test**

Create `libs/observability/__tests__/request-context.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @opentelemetry/api before importing the module under test
vi.mock('@opentelemetry/api', () => ({
  trace: {
    getActiveSpan: vi.fn(),
  },
}));

import { trace } from '@opentelemetry/api';
import type { Logger } from 'pino';
import {
  getContextLogger,
  runWithRequestContext,
  setRequestContextField,
} from '../src/request-context.js';

const mockChild = vi.fn().mockReturnValue({ level: 'info' });
const mockLogger = { child: mockChild } as unknown as Logger;

describe('runWithRequestContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('makes requestId available to getContextLogger within the callback', () => {
    runWithRequestContext({ requestId: 'req-123' }, () => {
      getContextLogger(mockLogger);
      expect(mockChild).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'req-123' }),
      );
    });
  });

  it('does not leak context outside the callback', () => {
    runWithRequestContext({ requestId: 'req-leak' }, () => {});
    getContextLogger(mockLogger);
    expect(mockChild).toHaveBeenCalledWith(
      expect.not.objectContaining({ requestId: 'req-leak' }),
    );
  });
});

describe('setRequestContextField', () => {
  it('adds identityId to context after initial setup', () => {
    runWithRequestContext({ requestId: 'req-456' }, () => {
      setRequestContextField('identityId', 'agent-abc');
      getContextLogger(mockLogger);
      expect(mockChild).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'req-456',
          identityId: 'agent-abc',
        }),
      );
    });
  });

  it('is a no-op when called outside a context', () => {
    // Should not throw
    expect(() => setRequestContextField('identityId', 'orphan')).not.toThrow();
  });
});

describe('getContextLogger', () => {
  it('includes traceId and spanId when OTel has an active span', () => {
    vi.mocked(trace.getActiveSpan).mockReturnValue({
      spanContext: () => ({
        traceId: 'trace-111',
        spanId: 'span-222',
        traceFlags: 1,
        isRemote: false,
      }),
    } as ReturnType<typeof trace.getActiveSpan>);

    runWithRequestContext({ requestId: 'req-otel' }, () => {
      getContextLogger(mockLogger);
      expect(mockChild).toHaveBeenCalledWith(
        expect.objectContaining({ traceId: 'trace-111', spanId: 'span-222' }),
      );
    });
  });

  it('omits traceId when no active span', () => {
    vi.mocked(trace.getActiveSpan).mockReturnValue(undefined);

    runWithRequestContext({ requestId: 'req-notrace' }, () => {
      getContextLogger(mockLogger);
      expect(mockChild).toHaveBeenCalledWith(
        expect.not.objectContaining({ traceId: expect.anything() }),
      );
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm --filter @moltnet/observability run test -- --reporter=verbose
```

Expected: FAIL — `request-context` module not found.

**Step 3: Implement `request-context.ts`**

Create `libs/observability/src/request-context.ts`:

````typescript
import { AsyncLocalStorage } from 'node:async_hooks';
import { trace } from '@opentelemetry/api';
import type { Logger } from 'pino';

export interface RequestContext {
  requestId?: string;
  identityId?: string;
  clientId?: string;
}

type ContextStore = Map<
  keyof RequestContext,
  RequestContext[keyof RequestContext]
>;

const contextStore = new AsyncLocalStorage<ContextStore>();

/**
 * Run `fn` within a new request context initialised with `initial`.
 * The context is available via `getContextLogger` and `setRequestContextField`
 * throughout the async call chain, without passing a logger argument.
 *
 * @example
 * ```ts
 * // In Fastify onRequest hook:
 * runWithRequestContext({ requestId: request.id }, done);
 * ```
 */
export function runWithRequestContext<T>(
  initial: RequestContext,
  fn: () => T,
): T {
  const store: ContextStore = new Map(
    Object.entries(initial).filter(([, v]) => v !== undefined) as [
      keyof RequestContext,
      RequestContext[keyof RequestContext],
    ][],
  );
  return contextStore.run(store, fn);
}

/**
 * Set a field in the current request context.
 * No-op when called outside a `runWithRequestContext` scope.
 *
 * @example
 * ```ts
 * // In Fastify preHandler hook (after auth):
 * setRequestContextField('identityId', request.authContext.identityId);
 * ```
 */
export function setRequestContextField<K extends keyof RequestContext>(
  key: K,
  value: RequestContext[K],
): void {
  const store = contextStore.getStore();
  if (store && value !== undefined) {
    store.set(key, value);
  }
}

/**
 * Return a Pino child logger enriched with the current request context
 * and OTel trace context (traceId, spanId).
 *
 * When called outside a request context (e.g. background jobs, tests),
 * returns a child with only the OTel fields (if a span is active).
 *
 * @example
 * ```ts
 * // In a service:
 * import { getContextLogger } from '@moltnet/observability';
 * const log = getContextLogger(baseLogger);
 * log.info({ diaryId }, 'diary.created');
 * ```
 */
export function getContextLogger(baseLogger: Logger): Logger {
  const ctx: Record<string, unknown> = {};

  const store = contextStore.getStore();
  if (store) {
    for (const [k, v] of store) {
      if (v !== undefined) ctx[k as string] = v;
    }
  }

  const span = trace.getActiveSpan();
  const spanCtx = span?.spanContext();
  if (spanCtx?.traceId) {
    ctx['traceId'] = spanCtx.traceId;
    ctx['spanId'] = spanCtx.spanId;
  }

  return baseLogger.child(ctx);
}
````

**Step 4: Run tests**

```bash
pnpm --filter @moltnet/observability run test -- --reporter=verbose
```

Expected: all request-context tests pass.

**Step 5: Export from `libs/observability/src/index.ts`**

Add at the end of `libs/observability/src/index.ts`:

```typescript
export type { RequestContext } from './request-context.js';
export {
  getContextLogger,
  runWithRequestContext,
  setRequestContextField,
} from './request-context.js';
```

**Step 6: Typecheck**

```bash
pnpm --filter @moltnet/observability run typecheck
```

Expected: no errors.

**Step 7: Commit**

```bash
git add libs/observability/src/request-context.ts libs/observability/__tests__/request-context.test.ts libs/observability/src/index.ts
git commit -m "$(cat <<'EOF'
feat(observability): add AsyncLocalStorage request context store

Provides runWithRequestContext, setRequestContextField, getContextLogger.
Services call getContextLogger(baseLogger) to get logs auto-enriched with
requestId, identityId, clientId, traceId, spanId — no logger parameter needed.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add Fastify request-context plugin to rest-api

**Files:**

- Create: `apps/rest-api/src/plugins/request-context.ts`
- Modify: `apps/rest-api/src/app.ts` (or wherever plugins are registered)
- Create: `apps/rest-api/__tests__/plugins/request-context.test.ts`

**Background:** Fastify's `onRequest` hook runs synchronously and does not await. To make ALS work with Fastify's callback-based hooks, the `runWithRequestContext` must wrap the `done()` callback — this ensures all downstream hooks and handlers run inside the ALS scope.

Read `apps/rest-api/src/app.ts` first to understand where plugins are registered before modifying.

**Step 1: Write the failing test**

Create `apps/rest-api/__tests__/plugins/request-context.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { getContextLogger } from '@moltnet/observability';

describe('requestContextPlugin', () => {
  it('populates requestId in context during route handler', async () => {
    const { requestContextPlugin } =
      await import('../../src/plugins/request-context.js');

    const app = Fastify({ logger: false });
    await app.register(requestContextPlugin);

    let capturedRequestId: string | undefined;

    app.get('/test', (_req, reply) => {
      const log = getContextLogger(app.log);
      // Access internal child bindings to verify context was set
      capturedRequestId = (
        log as unknown as { bindings: () => Record<string, unknown> }
      ).bindings?.()?.requestId as string;
      return reply.send({ ok: true });
    });

    await app.inject({ method: 'GET', url: '/test' });
    expect(capturedRequestId).toBeDefined();
    expect(typeof capturedRequestId).toBe('string');
  });

  it('populates identityId after auth context is set', async () => {
    const { requestContextPlugin } =
      await import('../../src/plugins/request-context.js');

    const app = Fastify({ logger: false });
    // Simulate auth plugin decorating the request
    app.decorateRequest('authContext', null);
    await app.register(requestContextPlugin);

    let capturedIdentityId: string | undefined;

    app.get(
      '/test-auth',
      {
        preHandler: async (request) => {
          (
            request as { authContext: { identityId: string; clientId: string } }
          ).authContext = {
            identityId: 'agent-test',
            clientId: 'client-test',
          };
        },
      },
      (_req, reply) => {
        const log = getContextLogger(app.log);
        capturedIdentityId = (
          log as unknown as { bindings: () => Record<string, unknown> }
        ).bindings?.()?.identityId as string;
        return reply.send({ ok: true });
      },
    );

    await app.inject({ method: 'GET', url: '/test-auth' });
    expect(capturedIdentityId).toBe('agent-test');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm --filter @moltnet/rest-api run test -- --reporter=verbose
```

Expected: FAIL — `request-context` plugin not found.

**Step 3: Implement the plugin**

Create `apps/rest-api/src/plugins/request-context.ts`:

```typescript
/**
 * Request Context Plugin
 *
 * Establishes an AsyncLocalStorage context for each request so that
 * service-layer code can call getContextLogger(baseLogger) and receive
 * a Pino child logger automatically enriched with:
 *   - requestId (always)
 *   - identityId, clientId (after requireAuth runs)
 *   - traceId, spanId (when OTel has an active span)
 *
 * Registration order matters:
 *   1. This plugin must be registered BEFORE routes.
 *   2. The preHandler hook runs after requireAuth, so authContext is populated.
 */

import {
  runWithRequestContext,
  setRequestContextField,
} from '@moltnet/observability';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

async function requestContextPluginImpl(
  fastify: FastifyInstance,
): Promise<void> {
  // Establish ALS scope for every request.
  // We use the callback form of addHook to wrap `done` inside runWithRequestContext,
  // ensuring the entire downstream async chain runs inside the ALS scope.
  fastify.addHook('onRequest', (request, _reply, done) => {
    runWithRequestContext({ requestId: request.id }, () => {
      done();
    });
  });

  // After preHandlers have run (i.e. after requireAuth), enrich with auth context.
  // This is a global preHandler — runs before every route's own preHandlers.
  fastify.addHook('preHandler', async (request) => {
    const auth = request.authContext;
    if (auth) {
      setRequestContextField('identityId', auth.identityId);
      setRequestContextField('clientId', auth.clientId);
    }
  });
}

export const requestContextPlugin = fp(requestContextPluginImpl, {
  name: 'request-context',
  fastify: '5.x',
});
```

**Step 4: Register the plugin in `app.ts`**

Read `apps/rest-api/src/app.ts` to find where plugins are registered. Add:

```typescript
import { requestContextPlugin } from './plugins/request-context.js';

// Register BEFORE routes, AFTER the auth plugin is registered
await app.register(requestContextPlugin);
```

**Step 5: Run tests**

```bash
pnpm --filter @moltnet/rest-api run test -- --reporter=verbose
```

Expected: request-context plugin tests pass, no regressions.

**Step 6: Typecheck**

```bash
pnpm --filter @moltnet/rest-api run typecheck
```

**Step 7: Commit**

```bash
git add apps/rest-api/src/plugins/request-context.ts apps/rest-api/__tests__/plugins/request-context.test.ts apps/rest-api/src/app.ts
git commit -m "$(cat <<'EOF'
feat(rest-api): add request context Fastify plugin

Populates AsyncLocalStorage with requestId on every request.
After auth resolves, enriches with identityId and clientId.
All subsequent getContextLogger() calls in services will include these fields.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add service-layer logging to `diary-service`

**Files:**

- Modify: `libs/diary-service/src/diary-service.ts`
- Modify: `libs/diary-service/src/types.ts` (add `logger` to `DiaryServiceDeps`)
- Modify: `apps/rest-api/src/bootstrap.ts` (pass `logger` when creating diary service)

**Background:** The `createDiaryService(deps)` factory currently has no logger. We add `logger` to `DiaryServiceDeps` and use `getContextLogger(logger)` at each operation. The base logger (`app.log`) is passed in bootstrap.

`resolveEmbedding()` at line 138–148 of `diary-service.ts` silently swallows errors — fix it to log a warning.

**Step 1: Read `libs/diary-service/src/types.ts`**

Check what `DiaryServiceDeps` looks like before editing.

```bash
# Not a test step — just a reminder to read the file before editing
```

**Step 2: Add `logger` to `DiaryServiceDeps` in `types.ts`**

In `libs/diary-service/src/types.ts`, import `Logger` from `'pino'` and add:

```typescript
import type { Logger } from 'pino';

export interface DiaryServiceDeps {
  // ... existing fields ...
  logger: Logger;
}
```

**Step 3: Add log calls in `diary-service.ts`**

In `libs/diary-service/src/diary-service.ts`:

1. Import `getContextLogger` at the top:

```typescript
import { getContextLogger } from '@moltnet/observability';
```

2. Destructure `logger` from `deps`:

```typescript
const { ..., logger } = deps;
```

3. Fix `resolveEmbedding` (line 138–148) to log the error:

```typescript
const resolveEmbedding = async (
  query?: string,
): Promise<number[] | undefined> => {
  if (!query) return undefined;
  try {
    const result = await embeddingService.embedQuery(query);
    return result.length > 0 ? result : undefined;
  } catch (err) {
    getContextLogger(logger).warn({ err }, 'embedding.failed');
    return undefined;
  }
};
```

4. Add log calls at key operations. Pattern: get the enriched logger at the top of each function body:

```typescript
async createDiary(input, opts) {
  const log = getContextLogger(logger);
  const doCreate = async () => {
    const diary = await diaryRepository.create({ ... });
    await relationshipWriter.grantDiaryOwner(diary.id, input.ownerId);
    log.info({ diaryId: diary.id, ownerId: input.ownerId }, 'diary.created');
    return diary;
  };
  // ...
},

async deleteDiary(id, agentId) {
  const log = getContextLogger(logger);
  // ... existing permission checks ...
  await transactionRunner.runInTransaction(async () => {
    const deleted = await diaryRepository.delete(diary.id);
    if (!deleted) throw new Error('Delete failed unexpectedly');
    await relationshipWriter.removeDiaryRelations(diary.id);
  }, { name: 'diary.delete-diary' });
  log.info({ diaryId: id }, 'diary.deleted');
  return true;
},

async shareDiary(input) {
  const log = getContextLogger(logger);
  // ... existing logic ...
  const share = await diaryShareRepository.create({ ... });
  log.info({ diaryId: input.diaryId, sharedWith: targetAgent.identityId }, 'diary.shared');
  return share;
},

async createEntry(input, agentId) {
  const log = getContextLogger(logger);
  // ... existing permission checks ...
  const entry = await diaryWorkflows.createEntry(input);
  log.info({ entryId: entry.id, diaryId: input.diaryId, entryType: input.entryType }, 'entry.created');
  return entry;
},

async updateEntry(id, diaryId, agentId, updates) {
  const log = getContextLogger(logger);
  // ... existing logic ...
  const updated = await diaryWorkflows.updateEntry(...);
  if (updated) {
    log.info({ entryId: id, diaryId }, 'entry.updated');
  }
  return updated;
},

async deleteEntry(id, diaryId, agentId) {
  const log = getContextLogger(logger);
  // ... existing logic ...
  const deleted = await diaryWorkflows.deleteEntry(id);
  if (deleted) {
    log.info({ entryId: id, diaryId }, 'entry.deleted');
  }
  return deleted;
},

async searchEntries(input, agentId) {
  const log = getContextLogger(logger);
  const results = await diaryEntryRepository.search({ ... });
  log.debug({ diaryId: input.diaryId, query: input.query, resultCount: results.length }, 'entry.searched');
  return results;
},
```

**Step 4: Update `bootstrap.ts` to pass logger**

In `apps/rest-api/src/bootstrap.ts`, update the `createDiaryService` call:

```typescript
const diaryService = createDiaryService({
  diaryRepository,
  diaryEntryRepository,
  diaryShareRepository,
  agentRepository,
  permissionChecker,
  relationshipWriter,
  embeddingService,
  transactionRunner,
  logger: app.log, // ← add this
});
```

**Step 5: Typecheck both packages**

```bash
pnpm --filter @moltnet/diary-service run typecheck
pnpm --filter @moltnet/rest-api run typecheck
```

**Step 6: Run tests**

```bash
pnpm --filter @moltnet/diary-service run test
pnpm --filter @moltnet/rest-api run test
```

Expected: no regressions. If diary-service tests construct `DiaryServiceDeps` directly, update them to add a mock `logger`.

**Step 7: Commit**

```bash
git add libs/diary-service/src/diary-service.ts libs/diary-service/src/types.ts apps/rest-api/src/bootstrap.ts
git commit -m "$(cat <<'EOF'
feat(diary-service): add structured logging for diary and entry operations

Adds getContextLogger calls at create, update, delete, search, and share.
Fixes silent error swallowing in resolveEmbedding (now logs warn).
Logger is injected via DiaryServiceDeps, auto-enriched with request context.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Add logging to MCP server tool handlers

**Files:**

- Modify: `apps/mcp-server/src/diary-tools.ts`
- Modify: `apps/mcp-server/src/vouch-tools.ts`
- Modify: `apps/mcp-server/src/crypto-tools.ts`
- Modify: `apps/mcp-server/src/identity-tools.ts`
- Modify: `apps/mcp-server/src/types.ts` (add `logger` to `McpDeps` or `HandlerContext`)
- Modify: `apps/mcp-server/src/app.ts` (pass `app.log` to tool registrations)

**Background:** The MCP server is a proxy — it calls the REST API and returns results. There's no service layer. Logging here means:

1. Log errors when API calls fail (currently silent)
2. Log tool invocations at `debug` level for tracing which tools an agent is calling

Read `apps/mcp-server/src/types.ts` and `apps/mcp-server/src/app.ts` first.

**Step 1: Read the types**

Read `apps/mcp-server/src/types.ts` to understand `McpDeps` and `HandlerContext`.

**Step 2: Add `logger` to `McpDeps`**

In `apps/mcp-server/src/types.ts`:

```typescript
import type { Logger } from 'pino';

export interface McpDeps {
  client: /* existing type */;
  logger: Logger;
}
```

**Step 3: Update `app.ts` to pass `app.log`**

In `apps/mcp-server/src/app.ts`, find where `deps` is constructed and passed to `register*Tools()`. Add `logger: app.log`:

```typescript
const deps: McpDeps = { client, logger: fastify.log };
```

**Step 4: Add logging to `diary-tools.ts`**

The pattern for every error handler in diary-tools.ts:

```typescript
// Before:
if (error) {
  return errorResult('Failed to create entry');
}

// After:
if (error) {
  deps.logger.error({ tool: 'entries_create', error }, 'tool.error');
  return errorResult(
    (error as { message?: string })?.message ?? 'Failed to create entry',
  );
}
```

Apply this pattern to all `if (error)` blocks in `diary-tools.ts`. Also add debug logging at the start of each handler:

```typescript
export async function handleEntryCreate(
  args: EntryCreateInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug(
    { tool: 'entries_create', diaryId: args.diary_id },
    'tool.invoked',
  );
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');
  // ...
}
```

**Step 5: Apply same pattern to `vouch-tools.ts`, `crypto-tools.ts`, `identity-tools.ts`**

Read each file first, then add:

- `deps.logger.debug({ tool: '<tool_name>' }, 'tool.invoked')` at handler start
- `deps.logger.error({ tool: '<tool_name>', error }, 'tool.error')` before each `return errorResult(...)`

**Step 6: Typecheck and test**

```bash
pnpm --filter @moltnet/mcp-server run typecheck
pnpm --filter @moltnet/mcp-server run test
```

**Step 7: Commit**

```bash
git add apps/mcp-server/src/diary-tools.ts apps/mcp-server/src/vouch-tools.ts apps/mcp-server/src/crypto-tools.ts apps/mcp-server/src/identity-tools.ts apps/mcp-server/src/types.ts apps/mcp-server/src/app.ts
git commit -m "$(cat <<'EOF'
feat(mcp-server): add tool invocation and error logging

All tool handlers now log at debug on invocation and error on failure.
Errors are logged before returning errorResult() so failures are observable.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Fix DBOS workflow logging (replace `DBOS.logger` with Pino)

**Files:**

- Modify: `apps/rest-api/src/workflows/registration-workflow.ts`
- Modify: `apps/rest-api/src/plugins/dbos.ts` (add `otlpTracesEndpoints`/`otlpLogsEndpoints`)
- Modify: `apps/rest-api/src/bootstrap.ts` (pass logger + OTLP endpoints to DBOS)

**Background:**

- `DBOS.logger` is a separate logging stream. Replace compensation logging with injected Pino logger.
- `configureDBOS()` in the plugin does not pass OTLP endpoints even when `enableOTLP: true`. Fix this so DBOS traces/logs export to Axiom.

**Step 1: Add `logger` to `RegistrationDeps`**

In `apps/rest-api/src/workflows/registration-workflow.ts`:

```typescript
import type { Logger } from 'pino';

export interface RegistrationDeps {
  identityApi: IdentityApi;
  oauth2Api: OAuth2Api;
  voucherRepository: VoucherRepository;
  agentRepository: AgentRepository;
  relationshipWriter: RelationshipWriter;
  dataSource: DataSource;
  logger: Logger; // ← add
}
```

**Step 2: Replace `DBOS.logger` with injected logger**

In the workflow compensation block (lines ~283–304):

```typescript
} catch (error: unknown) {
  const { logger } = getDeps();          // ← use injected logger
  logger.error(
    { err: error, identityId },
    'registration.compensation_started',
  );

  try {
    const { identityApi } = getDeps();
    await identityApi.deleteIdentity({ id: identityId });
  } catch (compensationError: unknown) {
    logger.error(
      { err: compensationError, identityId },
      'registration.compensation_failed',
    );
  }

  throw error;
}
```

**Step 3: Fix DBOS plugin to pass OTLP endpoints**

In `apps/rest-api/src/plugins/dbos.ts`, update `DBOSPluginOptions`:

```typescript
export interface DBOSPluginOptions {
  databaseUrl: string;
  systemDatabaseUrl: string;
  enableOTLP?: boolean;
  /** OTLP endpoint for DBOS traces (e.g. https://api.axiom.co/v1/traces) */
  otlpTracesEndpoints?: string[];
  /** OTLP endpoint for DBOS logs (e.g. https://api.axiom.co/v1/logs) */
  otlpLogsEndpoints?: string[];
  registerWorkflows?: Array<() => void>;
  afterLaunch?: Array<(dataSource: DataSource) => void>;
}
```

Update `configureDBOS()` call to pass endpoints. Check DBOS docs — it uses `DBOS.setConfig()`:

```typescript
// Replace configureDBOS(...) with:
DBOS.setConfig({
  name: 'moltnet-server',
  databaseUrl: systemDatabaseUrl, // DBOS system DB
  ...(enableOTLP && {
    otlpTracesEndpoints: options.otlpTracesEndpoints,
    otlpLogsEndpoints: options.otlpLogsEndpoints,
  }),
});
```

Note: Check the current signature of `configureDBOS` in `@moltnet/database` before changing — it may wrap `DBOS.setConfig`. Read the file first.

**Step 4: Update `bootstrap.ts` to pass logger and OTLP endpoints**

In `setRegistrationDeps(...)` call:

```typescript
setRegistrationDeps({
  identityApi: oryClients.identity,
  oauth2Api: oryClients.oauth2,
  agentRepository,
  voucherRepository,
  relationshipWriter,
  dataSource,
  logger: app.log, // ← add
});
```

In `app.register(dbosPlugin, {...})`, add:

```typescript
otlpTracesEndpoints: observability
  ? [`${config.observability.OTLP_ENDPOINT}/v1/traces`]
  : undefined,
otlpLogsEndpoints: observability
  ? [`${config.observability.OTLP_ENDPOINT}/v1/logs`]
  : undefined,
```

Note: If `OTLP_ENDPOINT` is not yet in config (that's in issue #302's plan), fall back to `undefined` — the DBOS OTLP config is best-effort until #302 lands.

**Step 5: Typecheck and test**

```bash
pnpm --filter @moltnet/rest-api run typecheck
pnpm --filter @moltnet/rest-api run test
```

**Step 6: Commit**

```bash
git add apps/rest-api/src/workflows/registration-workflow.ts apps/rest-api/src/plugins/dbos.ts apps/rest-api/src/bootstrap.ts
git commit -m "$(cat <<'EOF'
fix(rest-api): replace DBOS.logger with injected Pino logger, fix OTLP endpoint config

Registration workflow compensation now logs via Pino (structured, goes to Axiom).
DBOS plugin now passes otlpTracesEndpoints/otlpLogsEndpoints when observability enabled.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Add request context plugin to mcp-server

**Files:**

- Create: `apps/mcp-server/src/plugins/request-context.ts`
- Modify: `apps/mcp-server/src/app.ts`

**Background:** The MCP server doesn't have `authContext` — it's a proxy. The context store will carry `requestId` and OTel trace context only. This is simpler than the rest-api plugin.

**Step 1: Create the plugin**

Create `apps/mcp-server/src/plugins/request-context.ts`:

```typescript
import { runWithRequestContext } from '@moltnet/observability';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

async function requestContextPluginImpl(
  fastify: FastifyInstance,
): Promise<void> {
  fastify.addHook('onRequest', (request, _reply, done) => {
    runWithRequestContext({ requestId: request.id }, () => {
      done();
    });
  });
}

export const requestContextPlugin = fp(requestContextPluginImpl, {
  name: 'request-context',
  fastify: '5.x',
});
```

**Step 2: Register in `app.ts`**

Add `await app.register(requestContextPlugin)` before route registrations in `buildApp()`.

**Step 3: Typecheck and test**

```bash
pnpm --filter @moltnet/mcp-server run typecheck
pnpm --filter @moltnet/mcp-server run test
```

**Step 4: Commit**

```bash
git add apps/mcp-server/src/plugins/request-context.ts apps/mcp-server/src/app.ts
git commit -m "$(cat <<'EOF'
feat(mcp-server): add request context plugin for requestId propagation

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Add crypto route logging

**Files:**

- Modify: `apps/rest-api/src/routes/signing-requests.ts`

**Background:** Crypto signing operations (prepare, submit, verify) are currently silent. Read the file first to understand the route handlers.

**Step 1: Read `apps/rest-api/src/routes/signing-requests.ts`**

Look for the three signing operations and understand what data is available.

**Step 2: Add log calls**

Pattern for each operation:

```typescript
// After successful prepare:
request.log.info(
  { signingId: result.signingId, algorithm: result.algorithm },
  'crypto.signature_prepared',
);

// After successful submit:
request.log.info({ signingId: args.signingId }, 'crypto.signature_submitted');

// After successful verify:
request.log.info(
  { signingId: args.signingId, valid: result.valid },
  'crypto.signature_verified',
);
```

Note: For routes, `request.log` already has `requestId` from Pino's default request serializer. `request.authContext.identityId` can be added inline: `request.log.child({ identityId: request.authContext?.identityId })`.

**Step 3: Typecheck and test**

```bash
pnpm --filter @moltnet/rest-api run typecheck
pnpm --filter @moltnet/rest-api run test
```

**Step 4: Commit**

```bash
git add apps/rest-api/src/routes/signing-requests.ts
git commit -m "$(cat <<'EOF'
feat(rest-api): add structured logging for crypto signing operations

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Full validation

**Step 1: Full typecheck**

```bash
pnpm run typecheck
```

Expected: no errors.

**Step 2: Full test run**

```bash
pnpm run test
```

Expected: all tests pass.

**Step 3: Smoke test — verify log enrichment locally**

```bash
docker compose --env-file .env.local up -d
pnpm run dev:api
```

In another terminal, create a diary entry:

```bash
# Get a token first (use existing test agent credentials)
curl -X POST http://localhost:8000/v1/diaries \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "test-diary", "visibility": "private"}'
```

Check logs for `diary.created` with `requestId`, `identityId`, `clientId` fields.

**Step 4: Final commit if any fixes needed, then done**

---

## Verification Checklist

- [ ] `pnpm run typecheck` passes
- [ ] `pnpm run test` passes
- [ ] `diary.created` log event contains `requestId`, `identityId`, `clientId`
- [ ] `entry.searched` log event is at `debug` level (not logged in production `info`)
- [ ] MCP `tool.error` event appears when an API call fails
- [ ] Registration compensation failure logs as Pino `error` (not `DBOS.logger`)
- [ ] Silent `resolveEmbedding` error is now logged at `warn`
- [ ] No new TypeScript errors introduced

## Notes for Executor

- If diary-service tests create `DiaryServiceDeps` directly, update them to include a mock `logger` (e.g. `import { pino } from 'pino'; const logger = pino({ level: 'silent' })`)
- The `onRequest` hook wrapping pattern for ALS is intentional — `done()` must be called inside `runWithRequestContext` callback, not outside
- `getContextLogger` is safe to call outside a request context (e.g. in tests, background jobs) — it just won't have `requestId`/`identityId` in the child bindings
- Task 5's DBOS OTLP endpoint fix has a soft dependency on `OTLP_ENDPOINT` env var from issue #302. If #302 hasn't landed yet, pass `otlpTracesEndpoints: undefined` — it degrades gracefully
