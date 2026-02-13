# Migrate from @ory/client to @ory/client-fetch

**Issue**: #67
**Date**: 2026-02-13
**Approach**: Big-bang swap (Approach A)

## Summary

Replace `@ory/client` (Axios-based) with `@ory/client-fetch` (native Fetch API). This is Ory's official fetch-based SDK and a drop-in replacement with two key API differences: return values are unwrapped (no `{ data }` wrapper) and errors use `ResponseError` with native `Response` objects instead of `AxiosError`.

## API Differences

| Aspect       | `@ory/client` (axios)                                  | `@ory/client-fetch` (fetch)                           |
| ------------ | ------------------------------------------------------ | ----------------------------------------------------- |
| Return shape | `{ data: T, status, headers }`                         | `T` directly                                          |
| Error type   | `AxiosError` with `.response.status`, `.response.data` | `ResponseError` with `.response` (native `Response`)  |
| Error body   | `err.response.data` (pre-parsed)                       | `await err.response.json()` (async parse)             |
| Config       | `new Configuration({ basePath, accessToken })`         | `new Configuration({ basePath, accessToken })` (same) |

## Section 1: Dependency & Configuration Changes

- Replace `'@ory/client': ^1.22.0` with `'@ory/client-fetch': ^1.22.0` in `pnpm-workspace.yaml` catalog
- Update 4 `package.json` files: `libs/auth`, `libs/bootstrap`, `apps/rest-api`, `apps/server`
- `Configuration` constructor calls remain the same (same `basePath` + `accessToken` params)
- All imports change source from `'@ory/client'` to `'@ory/client-fetch'`

## Section 2: Return Value Destructuring

Every Ory SDK call using `const { data } = await api.method()` must change to `const result = await api.method()`.

Affected files and call count:

- `libs/auth/src/token-validator.ts` — 2 sites
- `libs/auth/src/permission-checker.ts` — 6 sites
- `libs/bootstrap/src/bootstrap.ts` — 3 sites
- `apps/rest-api/src/routes/registration.ts` — 5 sites
- `apps/server/e2e/helpers.ts` — 2 sites
- `apps/server/e2e/registration.e2e.test.ts` — ~8 sites

## Section 3: Error Handling Migration

`@ory/client-fetch` throws `ResponseError` on non-2xx. Error body requires async parsing.

Pattern change:

```ts
// Before
const axiosError = err as { response?: { status: number; data: unknown } };
const status = axiosError.response?.status;
const data = axiosError.response?.data;

// After
const response = (err as { response?: Response })?.response;
const status = response?.status;
const data = response ? await response.json() : undefined;
```

Affected error handling sites:

1. `apps/rest-api/src/routes/registration.ts` — registration flow error (lines 160-179)
2. `apps/server/e2e/registration.e2e.test.ts` — 3 catch blocks
3. `apps/server/e2e/recovery.e2e.test.ts` — 1 catch block
4. `libs/auth/src/token-validator.ts` and `permission-checker.ts` — no changes (bare catch, no error inspection)

Decision: parse directly in catch blocks (no wrapper utility).

## Section 4: Test Changes

Unit tests (`libs/auth/__tests__/token-validator.test.ts`):

- ~15 mock return values must unwrap from `{ data: { ... } }` to direct `{ ... }`

E2E tests:

- Destructuring changes on happy-path SDK calls
- AxiosError catch blocks become ResponseError patterns
- `RegistrationFlow` type import source changes

Re-export in `libs/auth/src/index.ts`:

- `export type { OAuth2Client } from '@ory/client'` → `'@ory/client-fetch'`

## Files Changed (12 total)

1. `pnpm-workspace.yaml` — catalog entry
2. `libs/auth/package.json` — dependency
3. `libs/bootstrap/package.json` — dependency
4. `apps/rest-api/package.json` — dependency
5. `apps/server/package.json` — dependency
6. `libs/auth/src/ory-client.ts` — imports
7. `libs/auth/src/token-validator.ts` — imports + destructuring
8. `libs/auth/src/permission-checker.ts` — imports + destructuring
9. `libs/auth/src/index.ts` — re-export source
10. `libs/bootstrap/src/bootstrap.ts` — imports + destructuring
11. `apps/rest-api/src/routes/registration.ts` — imports + destructuring + error handling
12. `apps/server/e2e/setup.ts` — imports
13. `apps/server/e2e/helpers.ts` — imports + destructuring
14. `apps/server/e2e/registration.e2e.test.ts` — imports + destructuring + error handling
15. `apps/server/e2e/recovery.e2e.test.ts` — error handling
16. `libs/auth/__tests__/token-validator.test.ts` — mock shapes
