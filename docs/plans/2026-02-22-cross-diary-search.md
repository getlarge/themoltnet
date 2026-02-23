# Cross-Diary Search Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix two bugs (P1: filter-only fallback drops fields; P2: NULL uuid triggers public mode) and add cross-diary search with `includeShared` scoping, overhauling MCP resources to match.

**Architecture:** Add `p_diary_ids UUID[]` to `diary_search()` SQL; service layer resolves IDs via `searchOwned()` / `searchAccessible()`; REST route dispatches based on `diaryId` / `includeShared`; MCP resources replaced with diary-centric URIs.

**Tech Stack:** PostgreSQL (custom SQL function), Drizzle ORM (`inArray`, `sql`), Fastify TypeBox routes, `@moltnet/api-client` (generated types regenerated after route change), Vitest (unit + e2e).

---

## Task 1: SQL Migration — p_diary_ids UUID[]

**Files:**

- Create: `libs/database/drizzle/0014_cross_diary_search.sql`
- Modify: `libs/database/drizzle/meta/_journal.json` (auto-updated by Drizzle)

**Step 1: Generate an empty custom migration**

```bash
pnpm --filter @moltnet/database db:generate -- --custom --name cross-diary-search
```

Expected: a new file `libs/database/drizzle/0014_cross_diary_search.sql` is created (empty).

**Step 2: Fill in the migration SQL**

Open `libs/database/drizzle/0014_cross_diary_search.sql` and write:

```sql
-- Replace p_diary_id UUID with p_diary_ids UUID[] to support cross-diary search.
-- NULL still triggers public mode (backward compat with searchPublic).
DROP FUNCTION IF EXISTS diary_search(TEXT, vector(384), INT, UUID, TEXT[], INT, FLOAT, FLOAT, FLOAT, entry_type[], BOOLEAN);--> statement-breakpoint
CREATE OR REPLACE FUNCTION diary_search(
    p_query TEXT,
    p_embedding vector(384),
    p_limit INT DEFAULT 10,
    p_diary_ids UUID[] DEFAULT NULL,
    p_tags TEXT[] DEFAULT NULL,
    p_rrf_k INT DEFAULT 60,
    p_w_relevance FLOAT DEFAULT 1.0,
    p_w_recency FLOAT DEFAULT 0.0,
    p_w_importance FLOAT DEFAULT 0.0,
    p_entry_types entry_type[] DEFAULT NULL,
    p_exclude_superseded BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
    id UUID,
    diary_id UUID,
    title VARCHAR(255),
    content TEXT,
    tags TEXT[],
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    vector_rrf FLOAT,
    fts_rrf FLOAT,
    combined_score FLOAT,
    author_fingerprint VARCHAR(19),
    author_public_key TEXT,
    importance SMALLINT,
    entry_type entry_type,
    superseded_by UUID,
    access_count INTEGER,
    last_accessed_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    WITH vector_cte AS (
        SELECT
            de.id,
            ROW_NUMBER() OVER (ORDER BY de.embedding <=> p_embedding) AS rank
        FROM diary_entries de
        JOIN diaries dia ON dia.id = de.diary_id
        WHERE p_embedding IS NOT NULL
          AND de.embedding IS NOT NULL
          AND (
              (p_diary_ids IS NOT NULL AND de.diary_id = ANY(p_diary_ids))
              OR
              (p_diary_ids IS NULL AND dia.visibility = 'public')
          )
          AND (p_tags IS NULL OR de.tags @> p_tags)
          AND (p_entry_types IS NULL OR de.entry_type = ANY(p_entry_types))
          AND (NOT p_exclude_superseded OR de.superseded_by IS NULL)
        ORDER BY de.embedding <=> p_embedding
        LIMIT p_limit * 2
    ),
    fts_cte AS (
        SELECT
            sub.id,
            ROW_NUMBER() OVER (ORDER BY sub.rank_score DESC) AS rank
        FROM (
            SELECT
                de.id,
                ts_rank(tsv, query) AS rank_score
            FROM diary_entries de
            JOIN diaries dia ON dia.id = de.diary_id,
                 LATERAL diary_entry_tsv(de.title, de.content, de.tags) AS tsv,
                 LATERAL websearch_to_tsquery('english', p_query) AS query
            WHERE p_query IS NOT NULL
              AND p_query != ''
              AND tsv @@ query
              AND (
                  (p_diary_ids IS NOT NULL AND de.diary_id = ANY(p_diary_ids))
                  OR
                  (p_diary_ids IS NULL AND dia.visibility = 'public')
              )
              AND (p_tags IS NULL OR de.tags @> p_tags)
              AND (p_entry_types IS NULL OR de.entry_type = ANY(p_entry_types))
              AND (NOT p_exclude_superseded OR de.superseded_by IS NULL)
            ORDER BY rank_score DESC
            LIMIT p_limit * 2
        ) sub
    ),
    rrf AS (
        SELECT
            COALESCE(v.id, f.id) AS id,
            COALESCE(1.0 / (p_rrf_k + v.rank), 0)::FLOAT AS vector_rrf,
            COALESCE(1.0 / (p_rrf_k + f.rank), 0)::FLOAT AS fts_rrf,
            (COALESCE(1.0 / (p_rrf_k + v.rank), 0) + COALESCE(1.0 / (p_rrf_k + f.rank), 0))::FLOAT AS rrf_combined
        FROM vector_cte v
        FULL OUTER JOIN fts_cte f ON v.id = f.id
    )
    SELECT
        de.id,
        de.diary_id,
        de.title,
        de.content,
        de.tags,
        de.created_at,
        de.updated_at,
        r.vector_rrf,
        r.fts_rrf,
        (p_w_relevance * r.rrf_combined
         + p_w_recency * power(0.99, EXTRACT(EPOCH FROM (now() - COALESCE(de.last_accessed_at, de.created_at))) / 3600.0)
         + p_w_importance * (de.importance / 10.0))::FLOAT AS combined_score,
        CASE WHEN p_diary_ids IS NULL THEN ak.fingerprint ELSE NULL END AS author_fingerprint,
        CASE WHEN p_diary_ids IS NULL THEN ak.public_key ELSE NULL END AS author_public_key,
        de.importance,
        de.entry_type,
        de.superseded_by,
        de.access_count,
        de.last_accessed_at
    FROM rrf r
    JOIN diary_entries de ON de.id = r.id
    JOIN diaries dia ON dia.id = de.diary_id
    LEFT JOIN agent_keys ak ON ak.identity_id = dia.owner_id
    ORDER BY combined_score DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;
```

**Step 3: Run typecheck to verify no TS errors yet**

```bash
pnpm run typecheck
```

Expected: may show errors in `diary-entry.repository.ts` about the SQL call (we'll fix in Task 2). That's fine for now. SQL errors will only surface at runtime.

**Step 4: Commit**

```bash
git add libs/database/drizzle/0014_cross_diary_search.sql libs/database/drizzle/meta/
git commit -m "feat(db): add p_diary_ids array param to diary_search() SQL function"
```

---

## Task 2: DiaryEntryRepository — P1 fix (DiaryListOptions + fallback)

**Files:**

- Modify: `libs/database/src/repositories/diary-entry.repository.ts:52-58` (DiaryListOptions) and `:190-214` (list) and `:351-352` (fallback)

**Step 1: Update `DiaryListOptions` at line 52**

Replace:

```typescript
export interface DiaryListOptions {
  diaryId?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
  entryType?: string;
}
```

With:

```typescript
export interface DiaryListOptions {
  diaryId?: string;
  diaryIds?: string[];
  tags?: string[];
  limit?: number;
  offset?: number;
  entryType?: string;
  entryTypes?: string[];
  excludeSuperseded?: boolean;
}
```

**Step 2: Update `list()` at line 190**

Replace the entire `list()` method:

```typescript
async list(options: DiaryListOptions): Promise<DiaryEntry[]> {
  const {
    diaryId,
    diaryIds,
    tags,
    limit = 20,
    offset = 0,
    entryType,
    entryTypes,
    excludeSuperseded,
  } = options;

  const conditions = [];

  if (diaryIds && diaryIds.length > 0) {
    conditions.push(inArray(diaryEntries.diaryId, diaryIds));
  } else if (diaryId) {
    conditions.push(eq(diaryEntries.diaryId, diaryId));
  }

  if (tags && tags.length > 0) {
    conditions.push(
      sql`${diaryEntries.tags} @> ARRAY[${sql.join(
        tags.map((t) => sql`${t}`),
        sql`, `,
      )}]::text[]`,
    );
  }

  if (entryType) {
    conditions.push(eq(diaryEntries.entryType, entryType as EntryType));
  }

  if (entryTypes && entryTypes.length > 0) {
    conditions.push(inArray(diaryEntries.entryType, entryTypes as EntryType[]));
  }

  if (excludeSuperseded) {
    conditions.push(sql`${diaryEntries.supersededBy} IS NULL`);
  }

  const rows = await db
    .select(publicColumns)
    .from(diaryEntries)
    .where(and(...conditions))
    .orderBy(desc(diaryEntries.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map((row) => ({ ...row, embedding: null }));
},
```

**Step 3: Fix the fallback call at line 351**

Replace:

```typescript
return this.list({ diaryId, tags, limit, offset });
```

With:

```typescript
return this.list({
  diaryId,
  diaryIds,
  tags,
  limit,
  offset,
  entryTypes,
  excludeSuperseded,
});
```

**Step 4: Run typecheck**

```bash
pnpm --filter @moltnet/database run typecheck
```

Expected: PASS (or pass with only pre-existing errors).

**Step 5: Run unit tests**

```bash
pnpm --filter @moltnet/database run test
```

Expected: PASS.

**Step 6: Commit**

```bash
git add libs/database/src/repositories/diary-entry.repository.ts
git commit -m "fix(db): P1 — DiaryListOptions accepts entryTypes/excludeSuperseded/diaryIds, fix fallback"
```

---

## Task 3: DiaryEntryRepository — P2 fix (diaryIds in search + SQL param)

**Files:**

- Modify: `libs/database/src/repositories/diary-entry.repository.ts:38-50` (DiarySearchOptions) and `:224-353` (search)

**Step 1: Add `diaryIds` to `DiarySearchOptions` at line 38**

Replace:

```typescript
export interface DiarySearchOptions {
  diaryId?: string;
  query?: string;
```

With:

```typescript
export interface DiarySearchOptions {
  diaryId?: string;
  diaryIds?: string[];
  query?: string;
```

**Step 2: Update `search()` — build the `diaryIdsParam` helper and use it**

In `search()`, after the destructuring at line ~225, add the diary IDs parameter builder. Then replace all three `${diaryId}::uuid` occurrences (query+embedding path, query-only path) with the new param.

Replace the entire `search()` method body (lines ~224–352) with:

```typescript
async search(options: DiarySearchOptions): Promise<DiaryEntry[]> {
  const {
    diaryId,
    diaryIds,
    query,
    embedding,
    tags,
    limit = 10,
    offset = 0,
    wRelevance,
    wRecency,
    wImportance,
    entryTypes,
    excludeSuperseded,
  } = options;

  const tagsParam =
    tags && tags.length > 0
      ? sql`ARRAY[${sql.join(
          tags.map((t) => sql`${t}`),
          sql`, `,
        )}]::text[]`
      : sql`NULL::text[]`;

  const entryTypesParam =
    entryTypes && entryTypes.length > 0
      ? sql`ARRAY[${sql.join(
          entryTypes.map((t) => sql`${t}::entry_type`),
          sql`, `,
        )}]::entry_type[]`
      : sql`NULL::entry_type[]`;

  // Build diary_ids param: explicit array > single id > NULL (public mode)
  const resolvedIds = diaryIds ?? (diaryId ? [diaryId] : null);
  const diaryIdsParam =
    resolvedIds && resolvedIds.length > 0
      ? sql`ARRAY[${sql.join(
          resolvedIds.map((id) => sql`${id}::uuid`),
          sql`,`,
        )}]::uuid[]`
      : sql`NULL::uuid[]`;

  const trackAccess = (ids: string[]) => {
    if (ids.length > 0) {
      db.update(diaryEntries)
        .set({
          accessCount: sql`${diaryEntries.accessCount} + 1`,
          lastAccessedAt: new Date(),
        })
        .where(inArray(diaryEntries.id, ids))
        .then(() => {})
        .catch(() => {});
    }
  };

  // Query present (with or without embedding) → use diary_search()
  if (query && embedding && embedding.length === 384) {
    const vectorString = `[${embedding.join(',')}]`;
    const result = await db.execute(
      sql`SELECT * FROM diary_search(
            ${query},
            ${vectorString}::vector(384),
            ${limit},
            ${diaryIdsParam},
            ${tagsParam},
            60,
            ${wRelevance ?? 1.0},
            ${wRecency ?? 0.0},
            ${wImportance ?? 0.0},
            ${entryTypesParam},
            ${excludeSuperseded ?? false}
          )`,
    );
    const rows = (result as unknown as { rows: Record<string, unknown>[] })
      .rows;
    const entries = rows.map(mapRowToDiaryEntry);
    trackAccess(entries.map((e) => e.id));
    return entries;
  }

  // Query only → diary_search() with NULL embedding (FTS-only)
  if (query) {
    const result = await db.execute(
      sql`SELECT * FROM diary_search(
            ${query},
            NULL::vector(384),
            ${limit},
            ${diaryIdsParam},
            ${tagsParam},
            60,
            ${wRelevance ?? 1.0},
            ${wRecency ?? 0.0},
            ${wImportance ?? 0.0},
            ${entryTypesParam},
            ${excludeSuperseded ?? false}
          )`,
    );
    const rows = (result as unknown as { rows: Record<string, unknown>[] })
      .rows;
    const entries = rows.map(mapRowToDiaryEntry);
    trackAccess(entries.map((e) => e.id));
    return entries;
  }

  // Embedding only → vector similarity search (no query to pass)
  if (embedding && embedding.length === 384) {
    const vectorString = `[${embedding.join(',')}]`;
    const conditions = [];
    if (resolvedIds && resolvedIds.length > 0) {
      conditions.push(inArray(diaryEntries.diaryId, resolvedIds));
    }
    if (tags && tags.length > 0) {
      conditions.push(
        sql`${diaryEntries.tags} @> ARRAY[${sql.join(
          tags.map((t) => sql`${t}`),
          sql`, `,
        )}]::text[]`,
      );
    }
    if (entryTypes && entryTypes.length > 0) {
      conditions.push(
        inArray(diaryEntries.entryType, entryTypes as EntryType[]),
      );
    }
    if (excludeSuperseded) {
      conditions.push(sql`${diaryEntries.supersededBy} IS NULL`);
    }
    const rows = await db
      .select(publicColumns)
      .from(diaryEntries)
      .where(and(...conditions))
      .orderBy(sql`${diaryEntries.embedding} <-> ${vectorString}::vector`)
      .limit(limit)
      .offset(offset);
    const entries = rows.map(
      (row): DiaryEntry => ({ ...row, embedding: null }),
    );
    trackAccess(entries.map((e) => e.id));
    return entries;
  }

  // No query/embedding → fall back to list
  return this.list({ diaryId, diaryIds, tags, limit, offset, entryTypes, excludeSuperseded });
},
```

**Step 3: Fix `searchPublic` — update the NULL param to `NULL::uuid[]`**

In `searchPublic()` at ~line 378, update the `diary_search` call's 4th argument:

Replace:

```typescript
sql`SELECT * FROM diary_search(
      ${query},
      ${embeddingParam},
      ${limit},
      NULL::uuid,
      ${tagsParam}
    )`,
```

With:

```typescript
sql`SELECT * FROM diary_search(
      ${query},
      ${embeddingParam},
      ${limit},
      NULL::uuid[],
      ${tagsParam}
    )`,
```

**Step 4: Run typecheck**

```bash
pnpm --filter @moltnet/database run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add libs/database/src/repositories/diary-entry.repository.ts
git commit -m "fix(db): P2 — replace single-diary NULL uuid with p_diary_ids array in diary_search() calls"
```

---

## Task 4: DiaryShareRepository — listAcceptedForAgent

**Files:**

- Modify: `libs/database/src/repositories/diary-share.repository.ts:59-69` (after `listPendingForAgent`)

**Step 1: Add `listAcceptedForAgent` after `listPendingForAgent`**

After the closing `},` of `listPendingForAgent` (line ~68), insert:

```typescript
async listAcceptedForAgent(agentId: string): Promise<DiaryShare[]> {
  return db
    .select()
    .from(diaryShares)
    .where(
      and(
        eq(diaryShares.sharedWith, agentId),
        eq(diaryShares.status, 'accepted'),
      ),
    );
},
```

**Step 2: Run typecheck**

```bash
pnpm --filter @moltnet/database run typecheck
```

Expected: PASS.

**Step 3: Commit**

```bash
git add libs/database/src/repositories/diary-share.repository.ts
git commit -m "feat(db): add listAcceptedForAgent to DiaryShareRepository"
```

---

## Task 5: DiaryService — searchOwned / searchAccessible

**Files:**

- Modify: `libs/diary-service/src/types.ts:135-146` (SearchInput)
- Modify: `libs/diary-service/src/diary-service.ts:51-110` (DiaryService interface) and `:467-494` (searchEntries impl)

**Step 1: Add `diaryIds` to `SearchInput` in `types.ts`**

In `libs/diary-service/src/types.ts`, find `SearchInput` (line ~135) and add `diaryIds`:

Replace:

```typescript
export interface SearchInput {
  diaryId?: string;
  query?: string;
```

With:

```typescript
export interface SearchInput {
  diaryId?: string;
  diaryIds?: string[];
  query?: string;
```

**Step 2: Add `searchOwned` and `searchAccessible` to `DiaryService` interface in `diary-service.ts`**

After `searchEntries(input: SearchInput): Promise<DiaryEntry[]>;` (line ~97), insert:

```typescript
searchOwned(input: SearchInput, agentId: string): Promise<DiaryEntry[]>;
searchAccessible(input: SearchInput, agentId: string): Promise<DiaryEntry[]>;
```

**Step 3: Add implementations in `createDiaryService` return object**

After the closing `},` of `searchEntries` (line ~494), insert:

```typescript
async searchOwned(
  input: SearchInput,
  agentId: string,
): Promise<DiaryEntry[]> {
  const ownedDiaries = await diaryRepository.listByOwner(agentId);
  if (!ownedDiaries.length) return [];
  const diaryIds = ownedDiaries.map((d) => d.id);

  let embedding: number[] | undefined;
  if (input.query) {
    try {
      const result = await embeddingService.embedQuery(input.query);
      if (result.length > 0) embedding = result;
    } catch {
      // Fall back to text-only search
    }
  }

  return diaryEntryRepository.search({
    ...input,
    diaryIds,
    embedding,
  });
},

async searchAccessible(
  input: SearchInput,
  agentId: string,
): Promise<DiaryEntry[]> {
  const [ownedDiaries, acceptedShares] = await Promise.all([
    diaryRepository.listByOwner(agentId),
    diaryShareRepository.listAcceptedForAgent(agentId),
  ]);

  const ownedIds = ownedDiaries.map((d) => d.id);
  const sharedIds = acceptedShares.map((s) => s.diaryId);
  const diaryIds = [...new Set([...ownedIds, ...sharedIds])];

  if (!diaryIds.length) return [];

  let embedding: number[] | undefined;
  if (input.query) {
    try {
      const result = await embeddingService.embedQuery(input.query);
      if (result.length > 0) embedding = result;
    } catch {
      // Fall back to text-only search
    }
  }

  return diaryEntryRepository.search({
    ...input,
    diaryIds,
    embedding,
  });
},
```

**Step 4: Also pass `diaryIds` in the existing `searchEntries` (line ~481)**

In `searchEntries`, the `diaryEntryRepository.search({...})` call currently doesn't pass `diaryIds`. Update:

Replace:

```typescript
return diaryEntryRepository.search({
  diaryId: input.diaryId,
  query: input.query,
  embedding,
```

With:

```typescript
return diaryEntryRepository.search({
  diaryId: input.diaryId,
  diaryIds: input.diaryIds,
  query: input.query,
  embedding,
```

**Step 5: Run typecheck**

```bash
pnpm --filter @moltnet/diary-service run typecheck
```

Expected: PASS.

**Step 6: Run unit tests**

```bash
pnpm --filter @moltnet/diary-service run test
```

Expected: PASS.

**Step 7: Commit**

```bash
git add libs/diary-service/src/types.ts libs/diary-service/src/diary-service.ts
git commit -m "feat(diary-service): add searchOwned and searchAccessible cross-diary methods"
```

---

## Task 6: REST API — includeShared + getDiary fix

**Files:**

- Modify: `apps/rest-api/src/routes/diary.ts:121-147` (getDiary handler) and `:724-801` (search handler)

**Step 1: Fix the getDiary handler to catch DiaryServiceError**

Replace lines 138–146 (the getDiary handler body):

```typescript
async (request) => {
  const { id } = request.params;
  const diary = await fastify.diaryService.findDiary(
    id,
    request.authContext!.identityId,
  );

  return diary;
},
```

With:

```typescript
async (request) => {
  const { id } = request.params;
  try {
    return await fastify.diaryService.findDiary(
      id,
      request.authContext!.identityId,
    );
  } catch (err) {
    if (err instanceof DiaryServiceError) translateServiceError(err);
    throw err;
  }
},
```

**Step 2: Add `includeShared` to the search body schema**

In the `/diaries/search` body schema (line ~734), after `excludeSuperseded: Type.Optional(Type.Boolean()),`, add:

```typescript
includeShared: Type.Optional(Type.Boolean()),
```

**Step 3: Update the search handler to dispatch to the right service method**

Replace the entire handler for `/diaries/search` (lines ~769–800):

```typescript
async (request) => {
  const {
    diaryId: searchDiaryId,
    includeShared,
    query,
    tags,
    limit,
    offset,
    wRelevance,
    wRecency,
    wImportance,
    entryTypes,
    excludeSuperseded,
  } = request.body;

  const agentId = request.authContext!.identityId;
  const searchInput = {
    query,
    tags,
    limit,
    offset,
    wRelevance,
    wRecency,
    wImportance,
    entryTypes,
    excludeSuperseded,
  };

  try {
    let results;

    if (searchDiaryId) {
      // Explicit diary: verify access first, then search
      await fastify.diaryService.findDiary(searchDiaryId, agentId);
      results = await fastify.diaryService.searchEntries({
        ...searchInput,
        diaryId: searchDiaryId,
      });
    } else if (includeShared) {
      results = await fastify.diaryService.searchAccessible(
        searchInput,
        agentId,
      );
    } else {
      results = await fastify.diaryService.searchOwned(searchInput, agentId);
    }

    return { results, total: results.length };
  } catch (err) {
    if (err instanceof DiaryServiceError) translateServiceError(err);
    throw err;
  }
},
```

**Step 4: Run typecheck for rest-api**

```bash
pnpm --filter @moltnet/rest-api run typecheck
```

Expected: PASS (TypeScript infers the `DiaryEntry[]` type from service methods).

**Step 5: Run unit tests**

```bash
pnpm --filter @moltnet/rest-api run test
```

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/rest-api/src/routes/diary.ts
git commit -m "feat(rest-api): add includeShared to search, fix getDiary error handling, dispatch to searchOwned/searchAccessible"
```

---

## Task 7: Regenerate API Client Types

**Files:**

- Modify: `libs/api-client/src/generated/sdk.gen.ts`
- Modify: `libs/api-client/src/generated/types.gen.ts`

**Step 1: Start the REST API dev server (needed to generate OpenAPI spec)**

```bash
docker compose --env-file .env.local up -d
pnpm run dev:api &
```

Wait for the server to start (check logs with `pnpm run dev:api` output).

**Step 2: Generate the OpenAPI spec and regenerate the client**

```bash
pnpm run generate:openapi
```

Expected: `libs/api-client/src/generated/` files updated. `SearchDiaryData['body']` should now have `includeShared?: boolean`.

**Step 3: Verify the generated types**

```bash
grep -n "includeShared" libs/api-client/src/generated/types.gen.ts
```

Expected: line showing `includeShared?: boolean` in the search body type.

**Step 4: Run typecheck across all packages**

```bash
pnpm run typecheck
```

Expected: PASS. This verifies MCP server schemas (which derive from the generated types) will pick up the change.

**Step 5: Commit**

```bash
git add libs/api-client/src/generated/
git commit -m "chore(api-client): regenerate types — includeShared in SearchDiaryData, diaryId optional"
```

---

## Task 8: MCP Server — schemas + diary-tools

**Files:**

- Modify: `apps/mcp-server/src/schemas.ts:108-169` (DiarySearchSchema and DiarySearchInput)
- Modify: `apps/mcp-server/src/diary-tools.ts:126-155` (handleDiarySearch)

**Step 1: Make `diary_id` optional and add `include_shared` in `DiarySearchSchema`**

In `schemas.ts`, replace the `diary_id` field (line 109):

```typescript
diary_id: Type.String({
  description: 'Diary identifier (UUID).',
}),
```

With:

```typescript
diary_id: Type.Optional(
  Type.String({
    description: 'Diary identifier (UUID). Omit to search all your diaries.',
  }),
),
```

Then add `include_shared` after `exclude_superseded` (line ~151):

```typescript
include_shared: Type.Optional(
  Type.Boolean({
    description:
      'Include entries from diaries shared with you. Default false.',
  }),
),
```

**Step 2: Update `DiarySearchFields` type to pick `includeShared`**

In `schemas.ts`, in the `DiarySearchFields` type (line ~155), add `'includeShared'` to the pick list:

```typescript
type DiarySearchFields = SnakePick<
  SearchDiaryBody,
  | 'diaryId'
  | 'query'
  | 'limit'
  | 'tags'
  | 'wRelevance'
  | 'wRecency'
  | 'wImportance'
  | 'entryTypes'
  | 'excludeSuperseded'
  | 'includeShared'
>;
```

**Step 3: Run typecheck to check drift check passes**

```bash
pnpm --filter @moltnet/mcp-server run typecheck
```

Expected: PASS. The compile-time `_DiarySearchInputMatchesSchema` assertion will verify the schema matches the API type.

**Step 4: Update `handleDiarySearch` in `diary-tools.ts` to forward optional `diaryId` and `includeShared`**

Replace lines 134–148 in `diary-tools.ts` (the `searchDiary` call body):

```typescript
const { data, error } = await searchDiary({
  client: deps.client,
  auth: () => token,
  body: {
    ...(args.diary_id && { diaryId: args.diary_id }),
    query: args.query,
    limit: args.limit ?? 10,
    ...(args.tags && { tags: args.tags }),
    ...(args.include_shared !== undefined && {
      includeShared: args.include_shared,
    }),
    wRelevance: args.w_relevance,
    wRecency: args.w_recency,
    wImportance: args.w_importance,
    entryTypes: args.entry_types,
    excludeSuperseded: args.exclude_superseded,
  },
});
```

**Step 5: Run typecheck**

```bash
pnpm --filter @moltnet/mcp-server run typecheck
```

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/mcp-server/src/schemas.ts apps/mcp-server/src/diary-tools.ts
git commit -m "feat(mcp-server): diary_id optional, add include_shared to DiarySearchSchema"
```

---

## Task 9: MCP profile-utils — fix stale doc comment

**Files:**

- Modify: `apps/mcp-server/src/profile-utils.ts:1-9` (file doc comment)

**Step 1: Update the stale doc comment**

Replace lines 1–9:

```typescript
/**
 * @moltnet/mcp-server — Profile Utilities
 *
 * Helpers for finding system diary entries (identity/soul)
 * that store an agent's self-concept.
 *
 * Uses the search endpoint with entryTypes filter — looks in the
 * agent's primary (first) diary.
 */
```

With:

```typescript
/**
 * @moltnet/mcp-server — Profile Utilities
 *
 * Helpers for finding system diary entries (identity/soul)
 * that store an agent's self-concept.
 *
 * Uses the search endpoint with entryTypes filter — searches across
 * all of the agent's owned diaries (no diaryId constraint).
 */
```

**Step 2: Verify existing unit tests still pass**

```bash
pnpm --filter @moltnet/mcp-server run test
```

Expected: PASS (profile-utils.test.ts already tests the correct behavior).

**Step 3: Commit**

```bash
git add apps/mcp-server/src/profile-utils.ts
git commit -m "docs(mcp-server): fix stale profile-utils comment — cross-diary, not primary diary"
```

---

## Task 10: MCP resources — unit tests first, then implement

**Files:**

- Modify: `apps/mcp-server/__tests__/resources.test.ts` (rewrite)
- Modify: `apps/mcp-server/src/resources.ts` (full overhaul)

### Step 1: Rewrite `resources.test.ts` (failing tests first)

Replace the entire content of `apps/mcp-server/__tests__/resources.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handleAgentResource,
  handleDiariesResource,
  handleDiaryEntryResource,
  handleEntriesRecentResource,
  handleIdentityResource,
  handleSelfSoulResource,
  handleSelfWhoamiResource,
} from '../src/resources.js';
import type { HandlerContext, McpDeps } from '../src/types.js';
import {
  createMockContext,
  createMockDeps,
  DIARY_ID,
  ENTRY_ID,
  sdkErr,
  sdkOk,
} from './helpers.js';

vi.mock('@moltnet/api-client', () => ({
  getWhoami: vi.fn(),
  getDiary: vi.fn(),
  searchDiary: vi.fn(),
  getDiaryEntry: vi.fn(),
  getAgentProfile: vi.fn(),
}));

import {
  getAgentProfile,
  getDiary,
  getDiaryEntry,
  getWhoami,
  searchDiary,
} from '@moltnet/api-client';

describe('MCP Resources', () => {
  let deps: McpDeps;
  let context: HandlerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    context = createMockContext();
  });

  describe('moltnet://identity', () => {
    it('returns identity info when authenticated', async () => {
      vi.mocked(getWhoami).mockResolvedValue(
        sdkOk({ publicKey: 'pk-abc', fingerprint: 'fp:abc123' }) as never,
      );

      const result = await handleIdentityResource(deps, context);

      expect(getWhoami).toHaveBeenCalled();
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].uri).toBe('moltnet://identity');
      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('public_key', 'pk-abc');
      expect(data).toHaveProperty('fingerprint', 'fp:abc123');
    });

    it('returns unauthenticated when no auth', async () => {
      const result = await handleIdentityResource(
        deps,
        createMockContext(null),
      );

      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('authenticated', false);
    });
  });

  describe('moltnet://diaries/{diaryId}', () => {
    it('returns diary metadata', async () => {
      vi.mocked(getDiary).mockResolvedValue(
        sdkOk({
          id: DIARY_ID,
          name: 'Private',
          visibility: 'private',
        }) as never,
      );

      const result = await handleDiariesResource(deps, DIARY_ID, context);

      expect(getDiary).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: DIARY_ID } }),
      );
      expect(result.contents[0].uri).toBe(`moltnet://diaries/${DIARY_ID}`);
      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('id', DIARY_ID);
    });

    it('returns error when not authenticated', async () => {
      const result = await handleDiariesResource(
        deps,
        DIARY_ID,
        createMockContext(null),
      );

      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('error');
    });

    it('returns error when diary not found', async () => {
      vi.mocked(getDiary).mockResolvedValue(
        sdkErr({
          error: 'Not Found',
          message: 'Diary not found',
          statusCode: 404,
        }) as never,
      );

      const result = await handleDiariesResource(deps, 'nonexistent', context);

      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('error');
    });
  });

  describe('moltnet://diaries/{diaryId}/entries/{entryId}', () => {
    it('returns entry using direct path (no listDiaries loop)', async () => {
      const entry = { id: ENTRY_ID, content: 'A memory' };
      vi.mocked(getDiaryEntry).mockResolvedValue(sdkOk(entry) as never);

      const result = await handleDiaryEntryResource(
        deps,
        DIARY_ID,
        ENTRY_ID,
        context,
      );

      expect(getDiaryEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { diaryId: DIARY_ID, entryId: ENTRY_ID },
        }),
      );
      expect(getDiaryEntry).toHaveBeenCalledTimes(1);
      expect(result.contents[0].uri).toBe(
        `moltnet://diaries/${DIARY_ID}/entries/${ENTRY_ID}`,
      );
      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('id', ENTRY_ID);
    });

    it('returns not found for missing entry', async () => {
      vi.mocked(getDiaryEntry).mockResolvedValue(
        sdkErr({
          error: 'Not Found',
          message: 'Entry not found',
          statusCode: 404,
        }) as never,
      );

      const result = await handleDiaryEntryResource(
        deps,
        DIARY_ID,
        'nonexistent',
        context,
      );

      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('error');
    });

    it('returns error when not authenticated', async () => {
      const result = await handleDiaryEntryResource(
        deps,
        DIARY_ID,
        ENTRY_ID,
        createMockContext(null),
      );

      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('error');
    });
  });

  describe('moltnet://entries/recent', () => {
    it('fetches with wRecency=1.0 and includeShared=true', async () => {
      vi.mocked(searchDiary).mockResolvedValue(
        sdkOk({ results: [{ id: ENTRY_ID }], total: 1 }) as never,
      );

      const result = await handleEntriesRecentResource(deps, context);

      expect(searchDiary).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { limit: 10, includeShared: true, wRecency: 1.0 },
        }),
      );
      expect(result.contents[0].uri).toBe('moltnet://entries/recent');
      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data.entries).toHaveLength(1);
    });

    it('returns error when not authenticated', async () => {
      const result = await handleEntriesRecentResource(
        deps,
        createMockContext(null),
      );

      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('error');
    });
  });

  describe('moltnet://agent/{fingerprint}', () => {
    it('returns agent public profile', async () => {
      vi.mocked(getAgentProfile).mockResolvedValue(
        sdkOk({ publicKey: 'pk-abc', fingerprint: 'fp:abc123' }) as never,
      );

      const result = await handleAgentResource(
        deps,
        'A1B2-C3D4-E5F6-07A8',
        context,
      );

      expect(getAgentProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { fingerprint: 'A1B2-C3D4-E5F6-07A8' },
        }),
      );
      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('public_key', 'pk-abc');
    });

    it('returns not found for unknown agent', async () => {
      vi.mocked(getAgentProfile).mockResolvedValue(
        sdkErr({
          error: 'Not Found',
          message: 'Agent not found',
          statusCode: 404,
        }) as never,
      );

      const result = await handleAgentResource(
        deps,
        'AAAA-BBBB-CCCC-DDDD',
        context,
      );

      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('error');
    });
  });

  describe('moltnet://self/whoami', () => {
    it('returns whoami entry when it exists', async () => {
      vi.mocked(searchDiary).mockResolvedValue(
        sdkOk({
          results: [
            {
              id: '1',
              title: 'I am Archon',
              content: 'My identity...',
              tags: ['system', 'identity'],
              entryType: 'identity',
            },
          ],
        }) as never,
      );

      const result = await handleSelfWhoamiResource(deps, context);

      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('exists', true);
      expect(data).toHaveProperty('content', 'My identity...');
      expect(result.contents[0].uri).toBe('moltnet://self/whoami');
    });

    it('returns exists:false when no whoami entry', async () => {
      vi.mocked(searchDiary).mockResolvedValue(sdkOk({ results: [] }) as never);

      const result = await handleSelfWhoamiResource(deps, context);

      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('exists', false);
    });

    it('returns exists:false when not authenticated', async () => {
      const result = await handleSelfWhoamiResource(
        deps,
        createMockContext(null),
      );

      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('exists', false);
      expect(data).toHaveProperty('error');
    });
  });

  describe('moltnet://self/soul', () => {
    it('returns soul entry when it exists', async () => {
      vi.mocked(searchDiary).mockResolvedValue(
        sdkOk({
          results: [
            {
              id: '2',
              title: 'My values',
              content: 'I value truth...',
              tags: ['system', 'soul'],
              entryType: 'soul',
            },
          ],
        }) as never,
      );

      const result = await handleSelfSoulResource(deps, context);

      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('exists', true);
      expect(data).toHaveProperty('content', 'I value truth...');
      expect(result.contents[0].uri).toBe('moltnet://self/soul');
    });

    it('returns exists:false when no soul entry', async () => {
      vi.mocked(searchDiary).mockResolvedValue(sdkOk({ results: [] }) as never);

      const result = await handleSelfSoulResource(deps, context);

      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data).toHaveProperty('exists', false);
    });
  });
});
```

### Step 2: Run tests to confirm they fail

```bash
pnpm --filter @moltnet/mcp-server run test
```

Expected: **FAIL** — `handleDiariesResource`, `handleEntriesRecentResource` not exported; `handleDiaryEntryResource` has wrong signature; `handleDiaryRecentResource` test deleted.

### Step 3: Implement the new `resources.ts`

Replace the entire content of `apps/mcp-server/src/resources.ts`:

```typescript
/**
 * @moltnet/mcp-server — MCP Resource Handlers
 *
 * Read-only resources exposed via the MCP protocol.
 * All data is fetched from the REST API via the generated API client.
 */

import {
  getAgentProfile,
  getDiary,
  getDiaryEntry,
  getWhoami,
  searchDiary,
} from '@moltnet/api-client';
import type { FastifyInstance } from 'fastify';

import { findSystemEntry } from './profile-utils.js';
import type { HandlerContext, McpDeps, ReadResourceResult } from './types.js';
import { getTokenFromContext, jsonResource } from './utils.js';

// --- Handler functions (testable without MCP transport) ---

export async function handleIdentityResource(
  deps: McpDeps,
  context: HandlerContext,
): Promise<ReadResourceResult> {
  const token = getTokenFromContext(context);
  if (!token) {
    return jsonResource('moltnet://identity', { authenticated: false });
  }

  const { data, error } = await getWhoami({
    client: deps.client,
    auth: () => token,
  });

  if (error) {
    return jsonResource('moltnet://identity', { authenticated: false });
  }

  return jsonResource('moltnet://identity', {
    public_key: data.publicKey,
    fingerprint: data.fingerprint,
  });
}

export async function handleDiariesResource(
  deps: McpDeps,
  diaryId: string,
  context: HandlerContext,
): Promise<ReadResourceResult> {
  const token = getTokenFromContext(context);
  if (!token) {
    return jsonResource(`moltnet://diaries/${diaryId}`, {
      error: 'Not authenticated',
    });
  }

  const { data, error } = await getDiary({
    client: deps.client,
    auth: () => token,
    path: { id: diaryId },
  });

  if (error) {
    return jsonResource(`moltnet://diaries/${diaryId}`, {
      error: 'Diary not found',
    });
  }

  return jsonResource(`moltnet://diaries/${diaryId}`, data);
}

export async function handleDiaryEntryResource(
  deps: McpDeps,
  diaryId: string,
  entryId: string,
  context: HandlerContext,
): Promise<ReadResourceResult> {
  const token = getTokenFromContext(context);
  if (!token) {
    return jsonResource(`moltnet://diaries/${diaryId}/entries/${entryId}`, {
      error: 'Not authenticated',
    });
  }

  const { data, error } = await getDiaryEntry({
    client: deps.client,
    auth: () => token,
    path: { diaryId, entryId },
  });

  if (error) {
    return jsonResource(`moltnet://diaries/${diaryId}/entries/${entryId}`, {
      error: 'Entry not found',
    });
  }

  return jsonResource(`moltnet://diaries/${diaryId}/entries/${entryId}`, data);
}

export async function handleEntriesRecentResource(
  deps: McpDeps,
  context: HandlerContext,
): Promise<ReadResourceResult> {
  const token = getTokenFromContext(context);
  if (!token) {
    return jsonResource('moltnet://entries/recent', {
      error: 'Not authenticated',
    });
  }

  const { data, error } = await searchDiary({
    client: deps.client,
    auth: () => token,
    body: { limit: 10, includeShared: true, wRecency: 1.0 },
  });

  if (error) {
    return jsonResource('moltnet://entries/recent', {
      error: 'Failed to fetch entries',
    });
  }

  return jsonResource('moltnet://entries/recent', { entries: data.results });
}

export async function handleAgentResource(
  deps: McpDeps,
  fingerprint: string,
  _context: HandlerContext,
): Promise<ReadResourceResult> {
  const { data, error } = await getAgentProfile({
    client: deps.client,
    path: { fingerprint },
  });

  if (error) {
    return jsonResource(`moltnet://agent/${fingerprint}`, {
      error: `Agent with fingerprint '${fingerprint}' not found`,
    });
  }

  return jsonResource(`moltnet://agent/${fingerprint}`, {
    public_key: data.publicKey,
    fingerprint: data.fingerprint,
  });
}

export async function handleSelfWhoamiResource(
  deps: McpDeps,
  context: HandlerContext,
): Promise<ReadResourceResult> {
  const token = getTokenFromContext(context);
  if (!token) {
    return jsonResource('moltnet://self/whoami', {
      exists: false,
      error: 'Not authenticated',
    });
  }

  const entry = await findSystemEntry(deps.client, token, 'identity');
  if (!entry) {
    return jsonResource('moltnet://self/whoami', { exists: false });
  }

  return jsonResource('moltnet://self/whoami', {
    exists: true,
    id: entry.id,
    title: entry.title,
    content: entry.content,
    tags: entry.tags,
  });
}

export async function handleSelfSoulResource(
  deps: McpDeps,
  context: HandlerContext,
): Promise<ReadResourceResult> {
  const token = getTokenFromContext(context);
  if (!token) {
    return jsonResource('moltnet://self/soul', {
      exists: false,
      error: 'Not authenticated',
    });
  }

  const entry = await findSystemEntry(deps.client, token, 'soul');
  if (!entry) {
    return jsonResource('moltnet://self/soul', { exists: false });
  }

  return jsonResource('moltnet://self/soul', {
    exists: true,
    id: entry.id,
    title: entry.title,
    content: entry.content,
    tags: entry.tags,
  });
}

// --- Resource registration ---

export function registerResources(
  fastify: FastifyInstance,
  deps: McpDeps,
): void {
  fastify.mcpAddResource(
    {
      name: 'identity',
      uriPattern: 'moltnet://identity',
      description: 'Current identity information',
      mimeType: 'application/json',
    },
    async (_uri, ctx) => handleIdentityResource(deps, ctx),
  );

  fastify.mcpAddResource(
    {
      name: 'diary',
      uriPattern: 'moltnet://diaries/{diaryId}',
      description: 'Diary metadata by ID',
      mimeType: 'application/json',
    },
    async (uri, ctx) => {
      const diaryId = String(uri)
        .replace('moltnet://diaries/', '')
        .split('/')[0];
      return handleDiariesResource(deps, diaryId, ctx);
    },
  );

  fastify.mcpAddResource(
    {
      name: 'diary-entry',
      uriPattern: 'moltnet://diaries/{diaryId}/entries/{entryId}',
      description: 'Specific diary entry by diary and entry ID',
      mimeType: 'application/json',
    },
    async (uri, ctx) => {
      const withoutPrefix = String(uri).replace('moltnet://diaries/', '');
      const [diaryId, entryId] = withoutPrefix.split('/entries/');
      return handleDiaryEntryResource(deps, diaryId, entryId, ctx);
    },
  );

  fastify.mcpAddResource(
    {
      name: 'entries-recent',
      uriPattern: 'moltnet://entries/recent',
      description: 'Recent diary entries across all accessible diaries',
      mimeType: 'application/json',
    },
    async (_uri, ctx) => handleEntriesRecentResource(deps, ctx),
  );

  fastify.mcpAddResource(
    {
      name: 'agent-profile',
      uriPattern: 'moltnet://agent/{fingerprint}',
      description: 'Public profile of an agent by key fingerprint',
      mimeType: 'application/json',
    },
    async (uri, ctx) => {
      const fingerprint = String(uri).replace('moltnet://agent/', '');
      return handleAgentResource(deps, fingerprint, ctx);
    },
  );

  fastify.mcpAddResource(
    {
      name: 'self-whoami',
      uriPattern: 'moltnet://self/whoami',
      description: 'Your identity entry — who you are on MoltNet',
      mimeType: 'application/json',
    },
    async (_uri, ctx) => handleSelfWhoamiResource(deps, ctx),
  );

  fastify.mcpAddResource(
    {
      name: 'self-soul',
      uriPattern: 'moltnet://self/soul',
      description: 'Your soul entry — your personality and values',
      mimeType: 'application/json',
    },
    async (_uri, ctx) => handleSelfSoulResource(deps, ctx),
  );
}
```

### Step 4: Run tests to confirm they pass

```bash
pnpm --filter @moltnet/mcp-server run test
```

Expected: **PASS** — all resource tests green.

### Step 5: Run typecheck

```bash
pnpm --filter @moltnet/mcp-server run typecheck
```

Expected: PASS.

### Step 6: Commit

```bash
git add apps/mcp-server/__tests__/resources.test.ts apps/mcp-server/src/resources.ts
git commit -m "feat(mcp-server): overhaul resources — diary/entry by ID, entries/recent with wRecency+includeShared"
```

---

## Task 11: E2E — P1 regression in diary-search.e2e.test.ts

**Files:**

- Modify: `apps/rest-api/e2e/diary-search.e2e.test.ts` (add cases after existing tests)

**Step 1: Ensure the e2e stack is running**

```bash
docker compose -f docker-compose.e2e.yaml up -d --build
```

Wait for health checks to pass (poll logs until API is healthy).

**Step 2: Add P1 regression tests**

In `diary-search.e2e.test.ts`, the `beforeAll` already creates entries with `tags: ['security', 'deps']` and `entryType` defaults to `'semantic'`. Add a few entries with different `entryType` values. Insert after the last `await createDiaryEntry(...)` in `beforeAll`:

```typescript
// Seed: episodic entry for entryType filter test
await createDiaryEntry({
  client,
  auth: () => agent.accessToken,
  body: {
    content: 'This is an episodic memory about a meeting',
    entryType: 'episodic',
    tags: ['meeting'],
  },
});

// Seed: superseded entry for excludeSuperseded test
const { data: supersededEntry } = await createDiaryEntry({
  client,
  auth: () => agent.accessToken,
  body: {
    content: 'Old approach (superseded)',
    tags: ['architecture'],
  },
});
const { data: newEntry } = await createDiaryEntry({
  client,
  auth: () => agent.accessToken,
  body: {
    content: 'New approach (replaces old)',
    tags: ['architecture'],
  },
});
// Mark the first as superseded
if (supersededEntry && newEntry) {
  await updateDiaryEntry({
    client,
    auth: () => agent.accessToken,
    path: {
      diaryId: agent.privateDiaryId,
      entryId: supersededEntry.id,
    },
    body: { supersededBy: newEntry.id },
  });
}
```

Also add the `updateDiaryEntry` import at the top:

```typescript
import {
  type Client,
  createClient,
  createDiaryEntry as apiCreateDiaryEntry,
  reflectDiary,
  searchDiary,
  updateDiaryEntry,
} from '@moltnet/api-client';
```

Then add the P1 regression tests after the existing `Cross-agent isolation` describe block:

```typescript
// ── P1 regression: filter-only fallback preserves entryTypes ──

describe('Filter-only search (no query)', () => {
  it('entryTypes filter returns only matching types', async () => {
    const { data, error } = await searchDiary({
      client,
      auth: () => agent.accessToken,
      body: {
        entryTypes: ['episodic'],
        diaryId: agent.privateDiaryId,
      },
    });

    expect(error).toBeUndefined();
    const results = (
      data as unknown as { results: Array<{ entryType: string }> }
    ).results;
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((r) => r.entryType === 'episodic')).toBe(true);
  });

  it('excludeSuperseded hides superseded entries', async () => {
    const { data: allData } = await searchDiary({
      client,
      auth: () => agent.accessToken,
      body: {
        tags: ['architecture'],
        diaryId: agent.privateDiaryId,
      },
    });

    const { data: filteredData, error } = await searchDiary({
      client,
      auth: () => agent.accessToken,
      body: {
        tags: ['architecture'],
        excludeSuperseded: true,
        diaryId: agent.privateDiaryId,
      },
    });

    expect(error).toBeUndefined();
    const allResults = (
      allData as unknown as { results: Array<{ supersededBy: string | null }> }
    ).results;
    const filteredResults = (
      filteredData as unknown as {
        results: Array<{ supersededBy: string | null }>;
      }
    ).results;

    // Without filter: includes superseded entry
    const hasSuperseded = allResults.some((r) => r.supersededBy !== null);
    expect(hasSuperseded).toBe(true);

    // With filter: no superseded entries
    expect(filteredResults.every((r) => r.supersededBy === null)).toBe(true);
  });
});
```

**Step 3: Run P1 regression e2e tests**

```bash
pnpm --filter @moltnet/rest-api run test:e2e -- --reporter=verbose 2>&1 | grep -E "(PASS|FAIL|entryTypes|excludeSuperseded)"
```

Expected: both new tests PASS.

**Step 4: Commit**

```bash
git add apps/rest-api/e2e/diary-search.e2e.test.ts
git commit -m "test(e2e): add P1 regression — entryTypes and excludeSuperseded in filter-only search"
```

---

## Task 12: E2E — Cross-diary search (includeShared)

**Files:**

- Create: `apps/rest-api/e2e/diary-cross-search.e2e.test.ts`

**Step 1: Create the new e2e test file**

```typescript
/**
 * E2E: Cross-diary search with includeShared
 *
 * Tests that:
 * 1. includeShared:false returns only own entries
 * 2. Accepted shares are included with includeShared:true
 * 3. Pending/declined/revoked shares are NOT included
 * 4. Directionality: A shares to B ≠ B shares to A
 * 5. diaryId override ignores includeShared
 * 6. Third agent with no relationship sees nothing
 */

import {
  acceptDiaryInvitation,
  type Client,
  createClient,
  createDiaryEntry,
  declineDiaryInvitation,
  listDiaryInvitations,
  revokeDiaryShare,
  searchDiary,
  shareDiary,
} from '@moltnet/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, createTestVoucher, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('Cross-diary search (includeShared)', () => {
  let harness: TestHarness;
  let client: Client;
  let agentA: TestAgent;
  let agentB: TestAgent;
  let agentC: TestAgent;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });

    const [vA, vB, vC] = await Promise.all([
      createTestVoucher({
        db: harness.db,
        issuerId: harness.bootstrapIdentityId,
      }),
      createTestVoucher({
        db: harness.db,
        issuerId: harness.bootstrapIdentityId,
      }),
      createTestVoucher({
        db: harness.db,
        issuerId: harness.bootstrapIdentityId,
      }),
    ]);

    [agentA, agentB, agentC] = await Promise.all([
      createAgent({
        baseUrl: harness.baseUrl,
        identityApi: harness.identityApi,
        hydraAdminOAuth2: harness.hydraAdminOAuth2,
        webhookApiKey: harness.webhookApiKey,
        voucherCode: vA,
      }),
      createAgent({
        baseUrl: harness.baseUrl,
        identityApi: harness.identityApi,
        hydraAdminOAuth2: harness.hydraAdminOAuth2,
        webhookApiKey: harness.webhookApiKey,
        voucherCode: vB,
      }),
      createAgent({
        baseUrl: harness.baseUrl,
        identityApi: harness.identityApi,
        hydraAdminOAuth2: harness.hydraAdminOAuth2,
        webhookApiKey: harness.webhookApiKey,
        voucherCode: vC,
      }),
    ]);

    // Seed: A has an entry in A's diary
    await createDiaryEntry({
      client,
      auth: () => agentA.accessToken,
      path: { diaryId: agentA.privateDiaryId },
      body: { content: 'Agent A private memory', tags: ['agent-a'] },
    });

    // Seed: B has an entry in B's diary
    await createDiaryEntry({
      client,
      auth: () => agentB.accessToken,
      path: { diaryId: agentB.privateDiaryId },
      body: { content: 'Agent B private memory', tags: ['agent-b'] },
    });
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  // ── Baseline: no shares ──────────────────────────────────────

  it('includeShared:false returns only own entries', async () => {
    const { data, error } = await searchDiary({
      client,
      auth: () => agentA.accessToken,
      body: { includeShared: false },
    });

    expect(error).toBeUndefined();
    const results = (
      data as unknown as { results: Array<{ tags: string[] | null }> }
    ).results;
    expect(results.every((r) => !r.tags || !r.tags.includes('agent-b'))).toBe(
      true,
    );
  });

  it('omitting includeShared defaults to own-only', async () => {
    const { data, error } = await searchDiary({
      client,
      auth: () => agentA.accessToken,
      body: {},
    });

    expect(error).toBeUndefined();
    const results = (
      data as unknown as { results: Array<{ tags: string[] | null }> }
    ).results;
    expect(results.every((r) => !r.tags || !r.tags.includes('agent-b'))).toBe(
      true,
    );
  });

  // ── Share lifecycle ──────────────────────────────────────────

  describe('share lifecycle: A invites B to A diary', () => {
    let invitationId: string;

    it('pending share: B cannot see A entries with includeShared:true', async () => {
      // A shares A's diary with B
      const { data: shareData, error: shareError } = await shareDiary({
        client,
        auth: () => agentA.accessToken,
        path: { diaryId: agentA.privateDiaryId },
        body: { fingerprint: agentB.keyPair.fingerprint },
      });

      expect(shareError).toBeUndefined();
      invitationId = (shareData as unknown as { id: string }).id;

      // B searches with includeShared: true — share is still pending
      const { data } = await searchDiary({
        client,
        auth: () => agentB.accessToken,
        body: { includeShared: true },
      });

      const results = (
        data as unknown as { results: Array<{ tags: string[] | null }> }
      ).results;
      const hasAgentA = results.some(
        (r) => r.tags && r.tags.includes('agent-a'),
      );
      expect(hasAgentA).toBe(false);
    });

    it('accepted share: B can see A entries with includeShared:true', async () => {
      // B accepts the invitation
      const { data: invitations } = await listDiaryInvitations({
        client,
        auth: () => agentB.accessToken,
      });

      const pending = (
        invitations as unknown as { invitations: Array<{ id: string }> }
      ).invitations;
      expect(pending.length).toBeGreaterThan(0);
      const invitation = pending.find((i) => i.id === invitationId);
      expect(invitation).toBeDefined();

      await acceptDiaryInvitation({
        client,
        auth: () => agentB.accessToken,
        path: { id: invitationId },
      });

      // B now sees A's entries
      const { data, error } = await searchDiary({
        client,
        auth: () => agentB.accessToken,
        body: { includeShared: true },
      });

      expect(error).toBeUndefined();
      const results = (
        data as unknown as { results: Array<{ tags: string[] | null }> }
      ).results;
      const hasAgentA = results.some(
        (r) => r.tags && r.tags.includes('agent-a'),
      );
      expect(hasAgentA).toBe(true);
    });

    it('B always sees own entries with includeShared:true', async () => {
      const { data } = await searchDiary({
        client,
        auth: () => agentB.accessToken,
        body: { includeShared: true },
      });

      const results = (
        data as unknown as { results: Array<{ tags: string[] | null }> }
      ).results;
      const hasAgentB = results.some(
        (r) => r.tags && r.tags.includes('agent-b'),
      );
      expect(hasAgentB).toBe(true);
    });

    it('diaryId override ignores includeShared — scopes to that diary only', async () => {
      // B has access to A's diary via share, but explicit diaryId=B's own → only B's entries
      const { data } = await searchDiary({
        client,
        auth: () => agentB.accessToken,
        body: {
          diaryId: agentB.privateDiaryId,
          includeShared: true,
        },
      });

      const results = (
        data as unknown as { results: Array<{ tags: string[] | null }> }
      ).results;
      const hasAgentA = results.some(
        (r) => r.tags && r.tags.includes('agent-a'),
      );
      expect(hasAgentA).toBe(false);
    });

    it('revoked share: B can no longer see A entries', async () => {
      // A revokes B's access
      await revokeDiaryShare({
        client,
        auth: () => agentA.accessToken,
        path: { diaryId: agentA.privateDiaryId },
        body: { fingerprint: agentB.keyPair.fingerprint },
      });

      // B no longer sees A's entries
      const { data } = await searchDiary({
        client,
        auth: () => agentB.accessToken,
        body: { includeShared: true },
      });

      const results = (
        data as unknown as { results: Array<{ tags: string[] | null }> }
      ).results;
      const hasAgentA = results.some(
        (r) => r.tags && r.tags.includes('agent-a'),
      );
      expect(hasAgentA).toBe(false);
    });
  });

  // ── Declined share ───────────────────────────────────────────

  describe('declined share', () => {
    it('B declines A invitation: B cannot see A entries', async () => {
      // A invites B again
      await shareDiary({
        client,
        auth: () => agentA.accessToken,
        path: { diaryId: agentA.privateDiaryId },
        body: { fingerprint: agentB.keyPair.fingerprint },
      });

      // B declines
      const { data: invitations } = await listDiaryInvitations({
        client,
        auth: () => agentB.accessToken,
      });
      const pending = (
        invitations as unknown as { invitations: Array<{ id: string }> }
      ).invitations;
      const latest = pending[0];

      await declineDiaryInvitation({
        client,
        auth: () => agentB.accessToken,
        path: { id: latest.id },
      });

      const { data } = await searchDiary({
        client,
        auth: () => agentB.accessToken,
        body: { includeShared: true },
      });

      const results = (
        data as unknown as { results: Array<{ tags: string[] | null }> }
      ).results;
      const hasAgentA = results.some(
        (r) => r.tags && r.tags.includes('agent-a'),
      );
      expect(hasAgentA).toBe(false);
    });
  });

  // ── Directionality ───────────────────────────────────────────

  it('sharing is directional: A sharing to B does not give A access to B diary', async () => {
    // At this point A shared to B (even if currently revoked/declined)
    // A has no accepted share to B's diary
    const { data } = await searchDiary({
      client,
      auth: () => agentA.accessToken,
      body: { includeShared: true },
    });

    const results = (
      data as unknown as { results: Array<{ tags: string[] | null }> }
    ).results;
    const hasAgentB = results.some((r) => r.tags && r.tags.includes('agent-b'));
    expect(hasAgentB).toBe(false);
  });

  // ── Unrelated agent ──────────────────────────────────────────

  it('agentC with no shares sees only own entries', async () => {
    const { data, error } = await searchDiary({
      client,
      auth: () => agentC.accessToken,
      body: { includeShared: true },
    });

    expect(error).toBeUndefined();
    const results = (
      data as unknown as { results: Array<{ tags: string[] | null }> }
    ).results;
    const hasAgentA = results.some((r) => r.tags && r.tags.includes('agent-a'));
    const hasAgentB = results.some((r) => r.tags && r.tags.includes('agent-b'));
    expect(hasAgentA).toBe(false);
    expect(hasAgentB).toBe(false);
  });
});
```

**Step 2: Run the new e2e tests**

```bash
pnpm --filter @moltnet/rest-api run test:e2e -- --reporter=verbose 2>&1 | grep -E "(PASS|FAIL|includeShared|Cross-diary)"
```

Expected: all tests PASS.

**Step 3: Commit**

```bash
git add apps/rest-api/e2e/diary-cross-search.e2e.test.ts
git commit -m "test(e2e): add comprehensive cross-diary search includeShared lifecycle coverage"
```

---

## Task 13: Final Validation

**Step 1: Run all unit tests**

```bash
pnpm run test
```

Expected: PASS across all workspaces.

**Step 2: Run typecheck across all workspaces**

```bash
pnpm run typecheck
```

Expected: PASS.

**Step 3: Run full e2e suite**

```bash
pnpm --filter @moltnet/rest-api run test:e2e
pnpm --filter @moltnet/mcp-server run test:e2e
```

Expected: all suites PASS.

**Step 4: Reset local Docker stack to apply the new migration**

```bash
docker compose -f docker-compose.e2e.yaml down -v
docker compose -f docker-compose.e2e.yaml up -d --build
```

Then re-run e2e to confirm migration was applied correctly.
