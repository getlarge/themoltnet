# Context Pack: MoltNet Database, CLI & Auth Patterns

## CLI — ogen Multi-Status Response Handling

The `moltnet relations create` command reported a false error on HTTP 201 because the CLI handler only type-asserted for `*CreateEntryRelationOK` (200). The ogen-generated client maps 201 to a separate type `*CreateEntryRelationCreated`, which fell through to `formatAPIError`. The fix was a type switch handling both variants.

**Watch for: Any CLI command wrapping an ogen endpoint that can return multiple success status codes (200/201/204). Always check the generated response decoder for all success variants.**

_Sources: [`e:da4135cf`](@getlarge · agent:1671)_

## Security — Authorization Bypass in consolidate workflow

### fetchEntriesStep skips diary ownership check

When `entryIds` are provided to the consolidate workflow, `fetchEntriesStep` calls `diaryEntryRepository.list({ ids: entryIds })` without including `diaryId`. The repository uses if/else-if branching — the `ids` branch skips the `diaryId` condition entirely, enabling cross-tenant entry reads.

**Exploit**: Agent B provides Agent A's entry UUID to their own consolidate endpoint. `findDiary` passes (it is B's diary), but `list({ ids })` returns A's private content with no tenant filter.

**MUST: Pass `diaryId` alongside `ids` so the repository applies BOTH filters as AND conditions. Never use else-if branching when adding filter dimensions to a tenant-scoped query.**

**Watch for: Any repository method that accepts both an ID list and a tenant scope — always ensure both are applied as AND, not else-if.**

_Sources: [`e:ad53dfac`](@getlarge · agent:1671)_

## Auth Plugin — optionalAuth Team Context Resolution

PR #667 revealed that `optionalAuth` in `libs/auth/src/plugin.ts` returned early for session-authenticated requests without calling `resolveTeamContext`. Both session and bearer paths must resolve team context before setting `request.authContext`. Webhook auth failures were also misclassified as 500 instead of 403.

**Watch for: `libs/auth` full test runs include a testcontainers integration suite that needs a container runtime.**

_Sources: [`e:dad429b2`](@getlarge · agent:1671)_

## Database Layer

### Drizzle Repository Pattern and Transactions

- **MUST use `getExecutor(db)`** for all insert/update/delete operations in repository methods. `getExecutor` picks up the active `AsyncLocalStorage` transaction context set by DBOS.
- **NEVER return the 384-dim embedding vector column** from standard read queries. Use `getTableColumns(table)` to destructure and exclude `embedding`.
- **NEVER start DBOS workflows inside a `runTransaction()` call.** DBOS and Drizzle use separate database connections.
- **MUST run `pnpm db:generate`** immediately after every change to `libs/database/src/schema.ts`.

Repository factory pattern, `getExecutor` for transaction context, embedding exclusion, and hybrid search via `diary_search()` SQL function are covered in the database layer tile.

_Sources: [`e:041c0962`](@getlarge · agent:1671), [`e:85c9ab65`](@getlarge · agent:1671)_

### Migration Journal Timestamp Monotonicity

`drizzle-kit generate` (both auto and `--custom`) uses `Date.now()` for the `when` field in `_journal.json`. This repo uses synthetic monotonic timestamps (`1774560400000+N`) that are ahead of real wall-clock time, so generated entries appear non-monotonic.

**Watch for: Any time `drizzle-kit generate` is used, check that the generated `when` value in `libs/database/drizzle/meta/_journal.json` is strictly greater than the previous entry's value. Patch manually if needed.**

_Sources: [`e:f7a8312f`](@getlarge · agent:1671), [`e:9b7221cd`](@getlarge · agent:1671)_

## E2E Test Conventions

**MUST use `@moltnet/api-client` helpers** (not raw fetch) for authenticated duplicate/invalidation e2e coverage. This keeps tests aligned with repo conventions, typed request/response shapes, and auth helper reuse.

_Sources: [`e:7b0a6488`](@getlarge · agent:1671)_

---

## Pack Provenance

| Field         | Value                                  |
| ------------- | -------------------------------------- |
| Pack UUID     | `4dfc8f34-bc57-4bb6-b769-456a007d0dcd` |
| Entries       | 8                                      |
| Source tokens | 2178                                   |
| Agent         | `@getlarge · agent:1671`               |
| Compiled      | 2026-04-10                             |
