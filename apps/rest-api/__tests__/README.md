# rest-api unit/route tests

These are **in-process** tests: they build a Fastify app with mocked services
and exercise routes via `app.inject()` (light-my-request). They do **not** boot
Postgres, pgvector, or Ory — that is what the `e2e/` suites are for. If you find
yourself reaching for a real database or a real Ory client here, you are writing
an e2e test in the wrong directory.

## Performance contract: build the app once, reset mocks per test

`createTestApp()` → `buildApp()` → `app.ready()` compiles every route's
TypeBox/ajv schema across ~25 route modules. That `ready()` call costs **~1.3s**
— it dominates the entire per-test runtime. (Building the Fastify instance is
~30ms; `app.close()` is ~0ms; the mocks are ~1ms. The cost is `ready()`, and it
is paid once per `createTestApp` call.)

So the rule is:

> **Build the app once per `describe` block in `beforeAll`. Reset the mocks in
> `beforeEach` with `resetMockServices(mocks)`. Never rebuild the app per test.**

`app.inject()` is stateless across calls — the same app instance can serve every
test in a block. The only per-test state lives in the mocks, and
`resetMockServices` restores them to factory defaults in place (it mutates each
sub-service object's methods so the app's decorated references stay valid; see
its JSDoc in `helpers.ts`).

### Canonical shape

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createMockServices,
  createTestApp,
  resetMockServices,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

describe('GET /things', () => {
  let app: FastifyInstance;
  let mocks: ReturnType<typeof createMockServices>;

  beforeAll(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetMockServices(mocks);
    // re-apply this block's default mock behavior here:
    mocks.permissionChecker.canAccessTeam.mockResolvedValue(true);
  });

  it('...', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/things',
      headers: {},
    });
    expect(res.statusCode).toBe(200);
  });
});
```

`#1512` migrated `tasks.test.ts` to this shape and cut it from **43s → 19s**;
the shared-app tests dropped from ~1.3s each to single-digit milliseconds.

### When a test legitimately needs its own app

Some tests cannot share the block-level app and **should** build their own
(remember to `close()` it, ideally in a `try/finally`):

- **Different baked-in `AuthContext`** — `createTestApp` injects the auth context
  at build time, so a "human caller" or "401 without auth" test needs its own
  instance (see `tasks.test.ts`).
- **Stateful plugin behavior under test** — e.g. the `rate-limit-*.test.ts`
  files assert per-identity budgets. The rate limiter keeps in-memory counters on
  the app instance, so each test must start from a fresh app. **Do not** convert
  these to a shared `beforeAll` app — it would leak the counter across tests.

If you're unsure whether sharing is safe, ask: "does any test in this block
mutate state that lives on the app instance (not the mocks)?" If yes, build per
test. If the only per-test difference is mock behavior, share the app.

### Verifying isolation

After converting a file, run it shuffled to prove no cross-test state bleed:

```bash
NX_LOAD_DOT_ENV_FILES=false pnpm exec vitest run __tests__/<file>.test.ts --sequence.shuffle=true
```
