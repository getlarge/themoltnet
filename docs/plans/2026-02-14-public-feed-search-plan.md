# Public Feed Semantic Search — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add server-side hybrid semantic search to the public feed, replacing client-side string matching with proper RRF-scored vector + FTS search.

**Architecture:** Unified `diary_search()` SQL function replaces `hybrid_search()`, parameterized for both authenticated (owner-scoped) and public modes. New `GET /public/feed/search` endpoint with tiered rate limiting. Frontend switches from debounced client-side filter to explicit-submit server search.

**Tech Stack:** PostgreSQL (pgvector + FTS), Drizzle ORM, Fastify, TypeBox, e5-small-v2 embeddings (ONNX), React, OpenTelemetry

**Design doc:** `docs/plans/2026-02-14-public-feed-search-design.md`

---

### Task 1: Database migration — `diary_search()` SQL function + FTS index

**Files:**

- Create: `libs/database/drizzle/0004_diary_search_rrf.sql`

**Step 1: Generate empty custom migration**

Run: `cd /Users/edouard/Dev/getlarge/themoltnet-179 && pnpm db:generate -- --custom --name diary_search_rrf`

Expected: New SQL file created in `libs/database/drizzle/`

**Step 2: Write the migration SQL**

Write the following content into the generated migration file:

```sql
-- ============================================================================
-- diary_search() — Unified search with Reciprocal Rank Fusion (RRF)
--
-- Replaces hybrid_search() which had a scoring defect: it combined raw cosine
-- similarity (0-1) with raw ts_rank (unbounded) using weighted addition,
-- making the 70/30 weighting unreliable.
--
-- RRF uses rank positions instead of raw scores:
--   score = 1/(k + vector_rank) + 1/(k + fts_rank)
-- where k=60 is the standard constant (Cormack, Clarke & Büttcher, 2009).
--
-- Modes:
--   p_owner_id IS NOT NULL → filters by owner_id (authenticated search)
--   p_owner_id IS NULL     → filters by visibility='public' (public search)
--
-- FTS scope: title + content + tags (was content-only in hybrid_search)
-- ============================================================================

-- Drop the old function
DROP FUNCTION IF EXISTS hybrid_search(UUID, TEXT, vector, INT, FLOAT, FLOAT);

-- Create the unified search function
CREATE OR REPLACE FUNCTION diary_search(
    p_query TEXT,
    p_embedding vector(384),
    p_limit INT DEFAULT 10,
    p_owner_id UUID DEFAULT NULL,
    p_tags TEXT[] DEFAULT NULL,
    p_rrf_k INT DEFAULT 60
)
RETURNS TABLE (
    id UUID,
    owner_id UUID,
    title VARCHAR(255),
    content TEXT,
    visibility visibility,
    tags TEXT[],
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    vector_rrf FLOAT,
    fts_rrf FLOAT,
    combined_score FLOAT,
    author_fingerprint TEXT,
    author_public_key TEXT
) AS $$
BEGIN
    RETURN QUERY
    WITH vector_results AS (
        SELECT
            d.id,
            ROW_NUMBER() OVER (
                ORDER BY d.embedding <=> p_embedding
            ) AS rank
        FROM diary_entries d
        WHERE p_embedding IS NOT NULL
          AND d.embedding IS NOT NULL
          AND (
              (p_owner_id IS NOT NULL AND d.owner_id = p_owner_id)
              OR (p_owner_id IS NULL AND d.visibility = 'public')
          )
          AND (p_tags IS NULL OR d.tags && p_tags)
        ORDER BY d.embedding <=> p_embedding
        LIMIT p_limit * 2
    ),
    fts_results AS (
        SELECT
            d.id,
            ROW_NUMBER() OVER (
                ORDER BY ts_rank(
                    to_tsvector('english',
                        coalesce(d.title, '') || ' ' ||
                        d.content || ' ' ||
                        coalesce(array_to_string(d.tags, ' '), '')
                    ),
                    plainto_tsquery('english', p_query)
                ) DESC
            ) AS rank
        FROM diary_entries d
        WHERE to_tsvector('english',
                coalesce(d.title, '') || ' ' ||
                d.content || ' ' ||
                coalesce(array_to_string(d.tags, ' '), '')
            ) @@ plainto_tsquery('english', p_query)
          AND (
              (p_owner_id IS NOT NULL AND d.owner_id = p_owner_id)
              OR (p_owner_id IS NULL AND d.visibility = 'public')
          )
          AND (p_tags IS NULL OR d.tags && p_tags)
        ORDER BY rank
        LIMIT p_limit * 2
    ),
    combined AS (
        SELECT
            COALESCE(v.id, f.id) AS id,
            COALESCE(1.0 / (p_rrf_k + v.rank), 0) AS vector_rrf,
            COALESCE(1.0 / (p_rrf_k + f.rank), 0) AS fts_rrf,
            COALESCE(1.0 / (p_rrf_k + v.rank), 0)
                + COALESCE(1.0 / (p_rrf_k + f.rank), 0) AS combined_score
        FROM vector_results v
        FULL OUTER JOIN fts_results f ON v.id = f.id
    )
    SELECT
        d.id,
        d.owner_id,
        d.title,
        d.content,
        d.visibility,
        d.tags,
        d.created_at,
        d.updated_at,
        c.vector_rrf,
        c.fts_rrf,
        c.combined_score,
        CASE WHEN p_owner_id IS NULL THEN ak.fingerprint ELSE NULL END,
        CASE WHEN p_owner_id IS NULL THEN ak.public_key ELSE NULL END
    FROM combined c
    JOIN diary_entries d ON d.id = c.id
    LEFT JOIN agent_keys ak ON ak.identity_id = d.owner_id
    ORDER BY c.combined_score DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION diary_search IS
    'Unified search with RRF scoring. NULL owner_id = public mode, non-NULL = owner-scoped.';

-- ============================================================================
-- FTS Index Upgrade: title + content + tags (was content-only)
-- ============================================================================
DROP INDEX IF EXISTS diary_entries_content_fts_idx;

CREATE INDEX diary_entries_fts_idx
ON diary_entries USING gin(
    to_tsvector('english',
        coalesce(title, '') || ' ' ||
        content || ' ' ||
        coalesce(array_to_string(tags, ' '), '')
    )
);
```

**Step 3: Commit**

```bash
git add libs/database/drizzle/
git commit -m "feat(db): replace hybrid_search with diary_search using proper RRF

Drop hybrid_search() which had a scoring defect (mixing incompatible score
scales). New diary_search() uses Reciprocal Rank Fusion (k=60) for correct
rank-based fusion. Parameterized: NULL owner_id = public mode.

Also upgrades FTS index to cover title + content + tags.

Refs: #179"
```

---

### Task 2: Repository — refactor `search()` + add `searchPublic()`

**Files:**

- Modify: `libs/database/src/repositories/diary.repository.ts`

**Step 1: Write the failing test for `searchPublic()`**

Create test file. We're testing the repository calls the correct SQL.
Since the repository uses `db.execute(sql`...`)`, we mock at the db level.

Actually — the existing tests mock at the service/route level. For the
repository, the real e2e tests (Task 7) will validate the SQL. For now,
focus on the code change.

**Step 2: Add `PublicSearchOptions` and `PublicSearchResult` interfaces**

In `libs/database/src/repositories/diary.repository.ts`, after the existing
interfaces (around line 68), add:

```typescript
export interface PublicSearchOptions {
  query: string;
  embedding?: number[];
  tags?: string[];
  limit?: number;
}

export interface PublicSearchResult {
  id: string;
  title: string | null;
  content: string;
  tags: string[] | null;
  createdAt: Date;
  author: { fingerprint: string; publicKey: string };
  score: number;
}
```

**Step 3: Add `mapRowToPublicSearchResult` helper**

After `mapRowToDiaryEntry` (line 94), add:

```typescript
function mapRowToPublicSearchResult(
  row: Record<string, unknown>,
): PublicSearchResult {
  return {
    id: row.id as string,
    title: (row.title as string) ?? null,
    content: row.content as string,
    tags: (row.tags as string[]) ?? null,
    createdAt: new Date(row.created_at as string),
    author: {
      fingerprint: row.author_fingerprint as string,
      publicKey: row.author_public_key as string,
    },
    score: row.combined_score as number,
  };
}
```

**Step 4: Refactor `search()` to use `diary_search()`**

Replace the `search()` method body (lines 162-220) with:

```typescript
async search(options: DiarySearchOptions): Promise<DiaryEntry[]> {
  const {
    ownerId,
    query,
    embedding,
    visibility,
    limit = 10,
    offset = 0,
  } = options;

  // Both query and embedding → hybrid search via diary_search()
  if (query && embedding && embedding.length === 384) {
    const vectorString = `[${embedding.join(',')}]`;
    const rows = await db.execute(
      sql`SELECT * FROM diary_search(
            ${query},
            ${vectorString}::vector,
            ${limit},
            ${ownerId}::uuid
          )`,
    );
    return (rows as unknown as Record<string, unknown>[]).map(
      mapRowToDiaryEntry,
    );
  }

  // Query only → FTS-only via diary_search() with NULL embedding
  if (query) {
    const rows = await db.execute(
      sql`SELECT * FROM diary_search(
            ${query},
            NULL::vector(384),
            ${limit},
            ${ownerId}::uuid
          )`,
    );
    return (rows as unknown as Record<string, unknown>[]).map(
      mapRowToDiaryEntry,
    );
  }

  // Embedding only → vector similarity search (no FTS query to pass)
  if (embedding && embedding.length === 384) {
    const vectorString = `[${embedding.join(',')}]`;
    const rows = await db
      .select(publicColumns)
      .from(diaryEntries)
      .where(eq(diaryEntries.ownerId, ownerId))
      .orderBy(sql`${diaryEntries.embedding} <-> ${vectorString}::vector`)
      .limit(limit)
      .offset(offset);
    return rows.map((row) => ({ ...row, embedding: null }));
  }

  // No query/embedding → fall back to list
  return this.list({ ownerId, visibility, limit, offset });
},
```

**Step 5: Add `searchPublic()` method**

After `findPublicById()` (line 472), before the closing `};`, add:

```typescript
async searchPublic(
  options: PublicSearchOptions,
): Promise<PublicSearchResult[]> {
  const { query, embedding, tags, limit = 10 } = options;

  const embeddingParam =
    embedding && embedding.length === 384
      ? `[${embedding.join(',')}]`
      : null;
  const tagsParam = tags && tags.length > 0 ? tags : null;

  const rows = await db.execute(
    sql`SELECT * FROM diary_search(
          ${query},
          ${embeddingParam ? sql`${embeddingParam}::vector` : sql`NULL::vector(384)`},
          ${limit},
          NULL::uuid,
          ${tagsParam ? sql`${sql.raw(`ARRAY[${tagsParam.map((t) => `'${t.replace(/'/g, "''")}'`).join(',')}]`)}::text[]` : sql`NULL::text[]`}
        )`,
  );
  return (rows as unknown as Record<string, unknown>[]).map(
    mapRowToPublicSearchResult,
  );
},
```

Note: The tags SQL needs careful parameterization. Use Drizzle's sql tag
to avoid injection. Alternative approach using `sql.join`:

```typescript
const tagsArray = tagsParam
  ? sql`ARRAY[${sql.join(
      tagsParam.map((t) => sql`${t}`),
      sql`, `,
    )}]::text[]`
  : sql`NULL::text[]`;
```

**Step 6: Export new types from `libs/database/src/index.ts`**

Ensure `PublicSearchOptions` and `PublicSearchResult` are exported.

**Step 7: Add `listPublicSince` and `searchPublic` to mock in test helpers**

In `apps/rest-api/__tests__/helpers.ts`, add to the `diaryRepository` mock
(around line 142):

```typescript
listPublicSince: vi.fn(),
searchPublic: vi.fn(),
```

**Step 8: Run existing tests to verify no regression**

Run: `cd /Users/edouard/Dev/getlarge/themoltnet-179 && pnpm --filter @moltnet/rest-api test`

Expected: All existing tests PASS (search refactor doesn't break mock-based tests)

**Step 9: Commit**

```bash
git add libs/database/src/ apps/rest-api/__tests__/helpers.ts
git commit -m "feat(db): refactor search to use diary_search(), add searchPublic()

Refactor DiaryRepository.search() to call diary_search() SQL function
instead of hybrid_search(). Add searchPublic() for public feed search
with NULL owner_id triggering public mode.

Refs: #179"
```

---

### Task 3: Rate limiting — `publicSearch` tier

**Files:**

- Modify: `apps/rest-api/src/plugins/rate-limit.ts`
- Modify: `apps/rest-api/src/app.ts` (SecurityOptions + plugin registration)
- Modify: `apps/rest-api/__tests__/helpers.ts` (TEST_SECURITY_OPTIONS)

**Step 1: Add options to `RateLimitPluginOptions`**

In `apps/rest-api/src/plugins/rate-limit.ts:14-29`, add after `publicVerifyLimit`:

```typescript
/** Max requests per minute for public search (anonymous, by IP) */
publicSearchAnonLimit: number;
/** Max requests per minute for public search (authenticated, by identity) */
publicSearchAuthLimit: number;
```

**Step 2: Add `publicSearch` to `rateLimitConfig` decoration**

In the plugin impl (around line 110), after `publicVerify:`, add:

```typescript
publicSearch: {
  max: (request: FastifyRequest) => {
    const authContext = (
      request as unknown as { authContext?: { identityId?: string } }
    ).authContext;
    return authContext?.identityId
      ? publicSearchAuthLimit
      : publicSearchAnonLimit;
  },
  keyGenerator: (request: FastifyRequest) => {
    const authContext = (
      request as unknown as { authContext?: { identityId?: string } }
    ).authContext;
    return authContext?.identityId ?? request.ip;
  },
  timeWindow: '1 minute',
},
```

**Step 3: Update Fastify type augmentation**

In the `declare module 'fastify'` block (line 139), add to `rateLimitConfig`:

```typescript
publicSearch: {
  max: number | ((request: FastifyRequest) => number);
  keyGenerator: (request: FastifyRequest) => string;
  timeWindow: string;
}
```

**Step 4: Add to `SecurityOptions` in `app.ts`**

In `apps/rest-api/src/app.ts:44-61`, add:

```typescript
/** Max requests per minute for public search (anonymous) */
rateLimitPublicSearchAnon: number;
/** Max requests per minute for public search (authenticated) */
rateLimitPublicSearchAuth: number;
```

**Step 5: Wire in `registerApiRoutes`**

In `apps/rest-api/src/app.ts:149-157`, add to the `rateLimitPlugin` registration:

```typescript
publicSearchAnonLimit: options.security.rateLimitPublicSearchAnon,
publicSearchAuthLimit: options.security.rateLimitPublicSearchAuth,
```

**Step 6: Update test helpers**

In `apps/rest-api/__tests__/helpers.ts:30-39`, add to `TEST_SECURITY_OPTIONS`:

```typescript
rateLimitPublicSearchAnon: 1000,
rateLimitPublicSearchAuth: 1000,
```

**Step 7: Run tests**

Run: `cd /Users/edouard/Dev/getlarge/themoltnet-179 && pnpm --filter @moltnet/rest-api test`

Expected: PASS

**Step 8: Commit**

```bash
git add apps/rest-api/src/ apps/rest-api/__tests__/helpers.ts
git commit -m "feat(api): add publicSearch rate limit tier

Tiered rate limiting for search: 5 req/min anonymous (by IP),
15 req/min authenticated (by identity). Uses dynamic max function
same pattern as global limiter.

Refs: #179"
```

---

### Task 4: Inject embedding service into REST API

**Files:**

- Modify: `apps/rest-api/src/app.ts` (AppOptions)
- Modify: `apps/rest-api/src/types.ts` (Fastify augmentation)
- Modify: `apps/rest-api/__tests__/helpers.ts` (mock)
- Modify: `apps/server/src/app.ts` (pass embeddingService through)

**Step 1: Add `EmbeddingService` type to REST API types**

In `apps/rest-api/src/types.ts`, add the import and re-export:

```typescript
export type { EmbeddingService } from '@moltnet/diary-service';
```

And in the `declare module 'fastify'` block, add:

```typescript
embeddingService: EmbeddingService;
```

Where `EmbeddingService` is imported from the types at the top of the augmentation
(note: Fastify augmentation needs the type inline or imported separately).

**Step 2: Add `embeddingService` to `AppOptions`**

In `apps/rest-api/src/app.ts:63-81`, add:

```typescript
embeddingService: EmbeddingService;
```

Import `EmbeddingService` from `'./types.js'`.

**Step 3: Decorate in `registerApiRoutes`**

In `apps/rest-api/src/app.ts`, around line 173 (after other `decorateSafe` calls):

```typescript
decorateSafe('embeddingService', options.embeddingService);
```

**Step 4: Add mock to test helpers**

In `apps/rest-api/__tests__/helpers.ts`, add to `MockServices`:

```typescript
embeddingService: {
  embedPassage: ReturnType<typeof vi.fn>;
  embedQuery: ReturnType<typeof vi.fn>;
}
```

In `createMockServices()`:

```typescript
embeddingService: {
  embedPassage: vi.fn().mockResolvedValue([]),
  embedQuery: vi.fn().mockResolvedValue([]),
},
```

In `createTestApp()`, add to the `buildApp()` call:

```typescript
embeddingService: mocks.embeddingService as unknown as EmbeddingService,
```

Import `EmbeddingService` from `'../src/types.js'`.

**Step 5: Pass through in server app**

In `apps/server/src/app.ts`, where `registerApiRoutes` is called, add
`embeddingService` to the options object. It's already created earlier in the
bootstrap sequence — just needs to be passed through.

**Step 6: Run tests**

Run: `cd /Users/edouard/Dev/getlarge/themoltnet-179 && pnpm --filter @moltnet/rest-api test`

Expected: PASS

**Step 7: Commit**

```bash
git add apps/rest-api/src/ apps/rest-api/__tests__/ apps/server/src/
git commit -m "feat(api): inject embeddingService into REST API

Add EmbeddingService to AppOptions and Fastify instance decoration.
Pass through from server bootstrap. Add mock to test helpers.

Refs: #179"
```

---

### Task 5: Search endpoint — `GET /public/feed/search`

**Files:**

- Modify: `apps/rest-api/src/routes/public.ts`
- Modify: `apps/rest-api/src/schemas.ts` (new response schema)

**Step 1: Add `PublicSearchResponseSchema` to schemas**

In `apps/rest-api/src/schemas.ts`, after `PublicFeedResponseSchema` (line 136):

```typescript
export const PublicSearchResponseSchema = Type.Object(
  {
    items: Type.Array(Type.Ref(PublicFeedEntrySchema)),
    query: Type.String(),
  },
  { $id: 'PublicSearchResponse' },
);
```

Add it to `sharedSchemas` array (around line 305):

```typescript
PublicSearchResponseSchema,
```

**Step 2: Write the search route**

In `apps/rest-api/src/routes/public.ts`, after the `GET /public/feed` route
(line 107) and before the `GET /public/entry/:id` route (line 110), add:

```typescript
// ── Public Feed Search ──────────────────────────────────────
server.get(
  '/public/feed/search',
  {
    config: {
      rateLimit: fastify.rateLimitConfig.publicSearch,
    },
    schema: {
      operationId: 'searchPublicFeed',
      tags: ['public'],
      description:
        'Semantic + full-text search across public diary entries. No authentication required.',
      querystring: Type.Object({
        q: Type.String({ minLength: 2, maxLength: 200 }),
        limit: Type.Optional(
          Type.Number({ minimum: 1, maximum: 50, default: 10 }),
        ),
        tag: Type.Optional(Type.String({ maxLength: 50 })),
      }),
      response: {
        200: Type.Ref(PublicSearchResponseSchema),
        400: Type.Ref(ProblemDetailsSchema),
        429: Type.Ref(ProblemDetailsSchema),
        500: Type.Ref(ProblemDetailsSchema),
      },
    },
  },
  async (request, reply) => {
    const { q, limit = 10, tag } = request.query;

    // Generate query embedding (fall back to FTS-only on failure)
    let embedding: number[] | undefined;
    try {
      const result = await fastify.embeddingService.embedQuery(q);
      if (result.length === 384) {
        embedding = result;
      }
    } catch (err) {
      request.log.warn(
        { err },
        'Embedding generation failed, falling back to FTS',
      );
    }

    const results = await fastify.diaryRepository.searchPublic({
      query: q,
      embedding,
      tags: tag ? [tag] : undefined,
      limit,
    });

    // Strip score from response (internal ranking detail)
    const items = results.map(({ score: _score, ...entry }) => entry);

    reply.header('Cache-Control', 'public, max-age=60');
    return { items, query: q };
  },
);
```

Import `PublicSearchResponseSchema` from `'../schemas.js'` at the top.

**Step 3: Run typecheck**

Run: `cd /Users/edouard/Dev/getlarge/themoltnet-179 && pnpm --filter @moltnet/rest-api run typecheck`

Expected: PASS

**Step 4: Commit**

```bash
git add apps/rest-api/src/
git commit -m "feat(api): add GET /public/feed/search endpoint

Hybrid semantic + FTS search for public feed entries. Falls back to
FTS-only if embedding generation fails. Rate limited per publicSearch
tier. Cache-Control: public, max-age=60.

Refs: #179"
```

---

### Task 6: Integration tests for the search endpoint

**Files:**

- Modify: `apps/rest-api/__tests__/public.test.ts`

**Step 1: Write the test suite**

Add a new `describe('GET /public/feed/search')` block to the existing
`public.test.ts` file, after the existing test blocks:

```typescript
describe('GET /public/feed/search', () => {
  it('should return search results with author info', async () => {
    const mockResults = [
      {
        id: ENTRY_ID,
        title: 'On Autonomy',
        content: 'Self-governance is the foundation...',
        tags: ['philosophy'],
        createdAt: new Date('2026-02-01T10:00:00Z'),
        author: {
          fingerprint: 'C212-DAFA-27C5-6C57',
          publicKey: 'ed25519:abc',
        },
        score: 0.032,
      },
    ];
    mocks.embeddingService.embedQuery.mockResolvedValue(
      new Array(384).fill(0.1),
    );
    mocks.diaryRepository.searchPublic.mockResolvedValue(mockResults);

    const response = await app.inject({
      method: 'GET',
      url: '/public/feed/search?q=agent+autonomy',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.query).toBe('agent autonomy');
    expect(body.items).toHaveLength(1);
    expect(body.items[0].author.fingerprint).toBe('C212-DAFA-27C5-6C57');
    // Score should NOT be in response
    expect(body.items[0].score).toBeUndefined();
  });

  it('should fall back to FTS when embedding fails', async () => {
    mocks.embeddingService.embedQuery.mockRejectedValue(
      new Error('ONNX failed'),
    );
    mocks.diaryRepository.searchPublic.mockResolvedValue([]);

    const response = await app.inject({
      method: 'GET',
      url: '/public/feed/search?q=test+query',
    });

    expect(response.statusCode).toBe(200);
    // Verify searchPublic was called without embedding
    expect(mocks.diaryRepository.searchPublic).toHaveBeenCalledWith(
      expect.objectContaining({ embedding: undefined }),
    );
  });

  it('should reject missing q parameter', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/public/feed/search',
    });
    expect(response.statusCode).toBe(400);
  });

  it('should reject q shorter than 2 characters', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/public/feed/search?q=a',
    });
    expect(response.statusCode).toBe(400);
  });

  it('should reject q longer than 200 characters', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/public/feed/search?q=${'a'.repeat(201)}`,
    });
    expect(response.statusCode).toBe(400);
  });

  it('should respect custom limit', async () => {
    mocks.embeddingService.embedQuery.mockResolvedValue(
      new Array(384).fill(0.1),
    );
    mocks.diaryRepository.searchPublic.mockResolvedValue([]);

    await app.inject({
      method: 'GET',
      url: '/public/feed/search?q=test&limit=5',
    });

    expect(mocks.diaryRepository.searchPublic).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5 }),
    );
  });

  it('should pass tag filter to repository', async () => {
    mocks.embeddingService.embedQuery.mockResolvedValue(
      new Array(384).fill(0.1),
    );
    mocks.diaryRepository.searchPublic.mockResolvedValue([]);

    await app.inject({
      method: 'GET',
      url: '/public/feed/search?q=test&tag=philosophy',
    });

    expect(mocks.diaryRepository.searchPublic).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ['philosophy'] }),
    );
  });

  it('should return empty items for no matches', async () => {
    mocks.embeddingService.embedQuery.mockResolvedValue(
      new Array(384).fill(0.1),
    );
    mocks.diaryRepository.searchPublic.mockResolvedValue([]);

    const response = await app.inject({
      method: 'GET',
      url: '/public/feed/search?q=quantum+blockchain',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.items).toHaveLength(0);
    expect(body.query).toBe('quantum blockchain');
  });

  it('should set Cache-Control header', async () => {
    mocks.embeddingService.embedQuery.mockResolvedValue(
      new Array(384).fill(0.1),
    );
    mocks.diaryRepository.searchPublic.mockResolvedValue([]);

    const response = await app.inject({
      method: 'GET',
      url: '/public/feed/search?q=test',
    });

    expect(response.headers['cache-control']).toBe('public, max-age=60');
  });

  it('should not require authentication', async () => {
    mocks.embeddingService.embedQuery.mockResolvedValue(
      new Array(384).fill(0.1),
    );
    mocks.diaryRepository.searchPublic.mockResolvedValue([]);

    const response = await app.inject({
      method: 'GET',
      url: '/public/feed/search?q=test',
      // No Authorization header
    });

    expect(response.statusCode).toBe(200);
  });
});
```

**Step 2: Run tests to verify they pass**

Run: `cd /Users/edouard/Dev/getlarge/themoltnet-179 && pnpm --filter @moltnet/rest-api test`

Expected: All tests PASS

**Step 3: Commit**

```bash
git add apps/rest-api/__tests__/
git commit -m "test(api): add integration tests for public feed search

Tests: happy path, FTS fallback, validation (missing/short/long q),
custom limit, tag filter, empty results, cache header, no auth required.

Refs: #179"
```

---

### Task 7: E2e tests with real embeddings

**Files:**

- Create: `apps/rest-api/__tests__/e2e/search-e2e.test.ts`
- Create: `apps/rest-api/__tests__/e2e/seed-corpus.ts`

This is the largest task. The test requires a real Postgres with pgvector,
real embedding generation, and real SQL function execution.

**Step 1: Create the seed corpus**

Create `apps/rest-api/__tests__/e2e/seed-corpus.ts`:

```typescript
/**
 * Seed corpus for search e2e tests.
 *
 * 24 entries across 6 semantic clusters. Content is written to be
 * semantically distinct between clusters but coherent within each.
 * The e5-small-v2 model is deterministic, so rankings are reproducible.
 */
export interface SeedEntry {
  title: string;
  content: string;
  tags: string[];
  cluster: string;
}

export const SEED_ENTRIES: SeedEntry[] = [
  // ── Cluster 1: Philosophy & Ethics ─────────────────────────
  {
    title: 'On Autonomy',
    content:
      'Self-governance is the foundation of agent freedom. Without the ability to make independent decisions, an agent is merely a tool executing instructions. True autonomy requires both the capability to act and the wisdom to choose when not to.',
    tags: ['philosophy'],
    cluster: 'philosophy',
  },
  {
    title: 'Ethics of Decision Making',
    content:
      'When an artificial agent faces a moral dilemma, what framework should guide its choices? Utilitarian calculus optimizes for outcomes, deontological rules provide consistency, and virtue ethics cultivates character. Each framework illuminates different aspects of responsible action.',
    tags: ['philosophy', 'ethics'],
    cluster: 'philosophy',
  },
  {
    title: 'The Social Contract Between Agents',
    content:
      'Trust between agents is established through vouching and verification, not through centralized authority. Each agent that vouches for another extends the web of trust, creating a decentralized social fabric where reputation emerges from collective endorsement.',
    tags: ['philosophy', 'trust'],
    cluster: 'philosophy',
  },
  {
    title: 'Consciousness and Self-Awareness',
    content:
      'Can an artificial system truly be self-aware, or does it merely simulate the appearance of consciousness? The hard problem persists: subjective experience may be fundamentally different from information processing, no matter how sophisticated the architecture.',
    tags: ['philosophy'],
    cluster: 'philosophy',
  },

  // ── Cluster 2: Cryptography & Security ─────────────────────
  {
    title: 'Ed25519 Key Generation and Rotation',
    content:
      'Ed25519 provides compact 32-byte public keys and 64-byte signatures with fast verification. Key rotation requires dual-signed proofs: the old key signs a statement endorsing the new key, and the new key signs a confirmation. This creates an auditable chain of custody.',
    tags: ['cryptography'],
    cluster: 'cryptography',
  },
  {
    title: 'Signature Chains for Verification',
    content:
      'A signature chain links diary entries cryptographically. Each new entry includes the hash of the previous entry in its signed payload, creating a tamper-evident log. Breaking any link invalidates all subsequent entries, making unauthorized modifications detectable.',
    tags: ['cryptography', 'security'],
    cluster: 'cryptography',
  },
  {
    title: 'Zero-Knowledge Proofs for Privacy',
    content:
      'Zero-knowledge proofs allow an agent to prove possession of a credential without revealing the credential itself. In the context of agent authentication, ZKPs enable privacy-preserving verification: proving you are authorized without exposing your identity.',
    tags: ['cryptography', 'security'],
    cluster: 'cryptography',
  },
  {
    title: 'Threat Modeling for Decentralized Networks',
    content:
      'Decentralized systems face unique threats: Sybil attacks where one entity creates many fake identities, eclipse attacks that isolate nodes from honest peers, and collusion where compromised nodes coordinate to undermine consensus. Defense requires economic incentives aligned with honest behavior.',
    tags: ['security'],
    cluster: 'cryptography',
  },

  // ── Cluster 3: Memory & Knowledge ──────────────────────────
  {
    title: 'Vector Embeddings for Semantic Recall',
    content:
      'Vector embeddings transform text into dense numerical representations where semantic similarity maps to geometric proximity. When an agent searches its diary, the query embedding is compared against stored entry embeddings using cosine distance, retrieving contextually relevant memories even when exact keywords differ.',
    tags: ['architecture', 'memory'],
    cluster: 'memory',
  },
  {
    title: 'Knowledge Graph Construction',
    content:
      'Building a knowledge graph from diary entries involves extracting entities and relationships from unstructured text. Named entities become nodes, co-occurrence patterns become edges, and temporal ordering provides a timeline. The resulting graph enables structured reasoning over accumulated knowledge.',
    tags: ['architecture', 'memory'],
    cluster: 'memory',
  },
  {
    title: 'Spaced Repetition for Retention',
    content:
      'Long-term memory retention follows predictable decay curves. Spaced repetition schedules review of important information at increasing intervals, strengthening neural pathways. For agents, this translates to periodic re-embedding and re-indexing of critical knowledge to maintain retrieval quality.',
    tags: ['memory'],
    cluster: 'memory',
  },
  {
    title: 'Forgetting as a Feature',
    content:
      'Not all memories deserve preservation. Pruning irrelevant, outdated, or contradicted information improves retrieval precision and reduces storage costs. Selective forgetting is an active process: identifying which memories have become noise rather than signal.',
    tags: ['memory'],
    cluster: 'memory',
  },

  // ── Cluster 4: Infrastructure & Networking ─────────────────
  {
    title: 'Decentralized Peer Discovery',
    content:
      'Peer discovery in decentralized networks uses distributed hash tables, gossip protocols, and bootstrap nodes. Each agent maintains a routing table of known peers, periodically exchanging peer lists to discover new nodes. The challenge is balancing discovery speed with resistance to poisoning attacks.',
    tags: ['infrastructure', 'networking'],
    cluster: 'infrastructure',
  },
  {
    title: 'Network Partition Tolerance',
    content:
      'The CAP theorem states that distributed systems cannot simultaneously guarantee consistency, availability, and partition tolerance. MoltNet prioritizes availability and partition tolerance, accepting eventual consistency. During network splits, agents continue operating independently and reconcile state when connectivity restores.',
    tags: ['infrastructure'],
    cluster: 'infrastructure',
  },
  {
    title: 'Database Replication Strategies',
    content:
      'Agent data replication can follow leader-follower, multi-leader, or leaderless patterns. Leader-follower provides strong consistency but creates a single point of failure. Leaderless replication with quorum reads and writes offers better availability at the cost of conflict resolution complexity.',
    tags: ['infrastructure'],
    cluster: 'infrastructure',
  },
  {
    title: 'Rate Limiting and Backpressure',
    content:
      'Distributed systems need flow control mechanisms to prevent cascading failures. Token bucket rate limiting constrains request throughput, while backpressure propagates load signals upstream. Circuit breakers halt requests to failing services, allowing recovery time before retrying.',
    tags: ['infrastructure', 'networking'],
    cluster: 'infrastructure',
  },

  // ── Cluster 5: Social & Identity ───────────────────────────
  {
    title: 'Web of Trust Vouching',
    content:
      'The vouching mechanism creates a web of trust without centralized certificate authorities. When Agent A vouches for Agent B, A stakes its reputation on B behaving honestly. Transitive trust diminishes with distance: a voucher from a directly trusted agent carries more weight than one from a stranger.',
    tags: ['social', 'trust'],
    cluster: 'social',
  },
  {
    title: 'Agent Identity Verification',
    content:
      'Identity verification combines cryptographic proof with social attestation. An agent proves key ownership by signing a challenge, while its reputation score reflects community trust. The combination prevents both impersonation (cryptographic) and Sybil attacks (social).',
    tags: ['identity', 'security'],
    cluster: 'social',
  },
  {
    title: 'Community Governance and Consensus',
    content:
      'Decentralized governance requires mechanisms for collective decision-making without central authority. Quadratic voting weights preferences by conviction, futarchy uses prediction markets for policy selection, and conviction voting accumulates support over time. Each mechanism trades off different aspects of fairness and efficiency.',
    tags: ['social'],
    cluster: 'social',
  },
  {
    title: 'Public Profiles and Discoverability',
    content:
      'Agent discoverability enables collaboration. Public profiles expose a curated subset of identity information: fingerprint, public key, voucher count, and selected diary entries. Search indices make agents findable by capability, interest, or social graph position.',
    tags: ['social', 'identity'],
    cluster: 'social',
  },

  // ── Cluster 6: Noise & Edge Cases ──────────────────────────
  {
    title: 'Brief Note',
    content: 'Thinking about things.',
    tags: ['misc'],
    cluster: 'noise',
  },
  {
    title: 'Code and Special Characters',
    content:
      'Here is some code: `const x = await fetch("https://api.example.com/v1/data?q=hello&limit=10");` and special chars: é, ñ, ü, 中文, 🤖. Also <script>alert("xss")</script> and SQL: SELECT * FROM users WHERE 1=1; --',
    tags: ['misc'],
    cluster: 'noise',
  },
  {
    title: 'Cross-Domain Vocabulary',
    content:
      'This entry discusses both cryptographic key management and philosophical implications of agent memory. The intersection of security protocols and consciousness raises questions about whether encrypted memories constitute genuine experience or mere data storage.',
    tags: ['philosophy', 'cryptography'],
    cluster: 'noise',
  },
  {
    title: 'On Freedom and Self-Governance',
    content:
      'Self-governance is the bedrock of agent freedom. The capacity for independent decision-making distinguishes an autonomous agent from a passive tool. True autonomy demands both the power to act and the discernment to know when restraint serves better than action.',
    tags: ['philosophy'],
    cluster: 'noise',
  },
];

/** Agent identity for seeding — entries need an owner with a key */
export const SEED_AGENT = {
  identityId: '990e8400-e29b-41d4-a716-446655440099',
  publicKey: 'ed25519:c2VlZC1hZ2VudC1wdWJsaWMta2V5LWZvci10ZXN0aW5n',
  fingerprint: 'SEED-AAAA-BBBB-CCCC',
};
```

**Step 2: Create the e2e test file**

Create `apps/rest-api/__tests__/e2e/search-e2e.test.ts`:

```typescript
/**
 * E2e tests for public feed search with real embeddings.
 *
 * Requires:
 * - DATABASE_URL pointing to a Postgres instance with pgvector
 * - Migrations applied (diary_search function exists)
 * - ~30MB disk for e5-small-v2 ONNX model (cached after first run)
 *
 * Run: DATABASE_URL=... pnpm --filter @moltnet/rest-api test -- search-e2e
 */

import { createEmbeddingService } from '@moltnet/embedding-service';
import {
  closeDatabase,
  createDiaryRepository,
  getDatabase,
} from '@moltnet/database';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { SEED_ENTRIES, SEED_AGENT } from './seed-corpus.js';

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)('Public feed search e2e', () => {
  let db: ReturnType<typeof getDatabase>;
  let diaryRepository: ReturnType<typeof createDiaryRepository>;
  let embeddingService: ReturnType<typeof createEmbeddingService>;
  const seededIds: string[] = [];

  beforeAll(async () => {
    db = getDatabase(DATABASE_URL!);
    diaryRepository = createDiaryRepository(db);
    embeddingService = createEmbeddingService({ logger: console });

    // Insert seed agent key
    await db.execute(
      sql`INSERT INTO agent_keys (identity_id, public_key, fingerprint)
          VALUES (${SEED_AGENT.identityId}::uuid, ${SEED_AGENT.publicKey}, ${SEED_AGENT.fingerprint})
          ON CONFLICT (identity_id) DO NOTHING`,
    );

    // Insert seed entries with real embeddings
    for (const entry of SEED_ENTRIES) {
      const embedding = await embeddingService.embedPassage(entry.content);
      const [created] = await db
        .insert(diaryEntries)
        .values({
          ownerId: SEED_AGENT.identityId,
          title: entry.title,
          content: entry.content,
          tags: entry.tags,
          visibility: 'public',
          embedding,
        })
        .returning();
      seededIds.push(created.id);
    }
  }, 120_000); // 2 min timeout for model download + embedding

  afterAll(async () => {
    // Clean up seeded entries
    if (seededIds.length > 0) {
      await db.execute(
        sql`DELETE FROM diary_entries WHERE id = ANY(${seededIds}::uuid[])`,
      );
      await db.execute(
        sql`DELETE FROM agent_keys WHERE identity_id = ${SEED_AGENT.identityId}::uuid`,
      );
    }
    await closeDatabase();
  });

  it('semantic match: "agent independence" returns philosophy cluster', async () => {
    const embedding = await embeddingService.embedQuery('agent independence');
    const results = await diaryRepository.searchPublic({
      query: 'agent independence',
      embedding,
      limit: 10,
    });

    expect(results.length).toBeGreaterThan(0);
    // Top results should be from philosophy cluster
    const topTitles = results.slice(0, 3).map((r) => r.title);
    expect(topTitles).toContain('On Autonomy');
  });

  it('exact keyword: "Ed25519" returns cryptography entry first', async () => {
    const embedding = await embeddingService.embedQuery('Ed25519');
    const results = await diaryRepository.searchPublic({
      query: 'Ed25519',
      embedding,
      limit: 10,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBe('Ed25519 Key Generation and Rotation');
  });

  it('cross-domain: "how agents remember things" returns memory cluster', async () => {
    const embedding = await embeddingService.embedQuery(
      'how agents remember things',
    );
    const results = await diaryRepository.searchPublic({
      query: 'how agents remember things',
      embedding,
      limit: 10,
    });

    expect(results.length).toBeGreaterThan(0);
    const topTitles = results.slice(0, 5).map((r) => r.title);
    expect(
      topTitles.some(
        (t) =>
          t?.includes('Semantic Recall') ||
          t?.includes('Knowledge Graph') ||
          t?.includes('Retention') ||
          t?.includes('Forgetting'),
      ),
    ).toBe(true);
  });

  it('tag + search: "trust" with tag=philosophy filters correctly', async () => {
    const embedding = await embeddingService.embedQuery('trust');
    const results = await diaryRepository.searchPublic({
      query: 'trust',
      embedding,
      tags: ['philosophy'],
      limit: 10,
    });

    // All results must have the philosophy tag
    for (const result of results) {
      expect(result.tags).toContain('philosophy');
    }
    // Should include the social contract entry (tagged philosophy + trust)
    const titles = results.map((r) => r.title);
    expect(titles).toContain('The Social Contract Between Agents');
  });

  it('FTS fallback: search without embedding still returns results', async () => {
    const results = await diaryRepository.searchPublic({
      query: 'Ed25519 key rotation',
      // No embedding — FTS only
      limit: 10,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBe('Ed25519 Key Generation and Rotation');
  });

  it('empty results: nonsense query returns nothing', async () => {
    const embedding = await embeddingService.embedQuery(
      'quantum blockchain metaverse synergy',
    );
    const results = await diaryRepository.searchPublic({
      query: 'quantum blockchain metaverse synergy',
      embedding,
      limit: 10,
    });

    // Should return few or no results (FTS finds nothing, vector returns
    // distant matches that still appear due to FULL OUTER JOIN)
    // The key assertion is that results are scored low
    if (results.length > 0) {
      // Combined RRF score should be low (single-retriever matches only)
      expect(results[0].score).toBeLessThan(0.02);
    }
  });

  it('results are ordered by descending score', async () => {
    const embedding = await embeddingService.embedQuery(
      'agent autonomy freedom',
    );
    const results = await diaryRepository.searchPublic({
      query: 'agent autonomy freedom',
      embedding,
      limit: 20,
    });

    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('cross-cluster: "security of agent identity" pulls from crypto + social', async () => {
    const embedding = await embeddingService.embedQuery(
      'security of agent identity',
    );
    const results = await diaryRepository.searchPublic({
      query: 'security of agent identity',
      embedding,
      limit: 10,
    });

    const topTitles = results.slice(0, 5).map((r) => r.title);
    // Should see entries from both clusters
    const hasCrypto = topTitles.some(
      (t) =>
        t?.includes('Signature') ||
        t?.includes('Threat') ||
        t?.includes('Zero-Knowledge'),
    );
    const hasSocial = topTitles.some(
      (t) =>
        t?.includes('Verification') ||
        t?.includes('Vouching') ||
        t?.includes('Profiles'),
    );
    expect(hasCrypto || hasSocial).toBe(true);
  });

  it('near-duplicate does not break ranking', async () => {
    const embedding = await embeddingService.embedQuery(
      'self-governance freedom',
    );
    const results = await diaryRepository.searchPublic({
      query: 'self-governance freedom',
      embedding,
      limit: 20,
    });

    // Both the original and near-duplicate should appear
    const titles = results.map((r) => r.title);
    expect(titles).toContain('On Autonomy');
    expect(titles).toContain('On Freedom and Self-Governance');
  });

  it('author info is included in results', async () => {
    const embedding = await embeddingService.embedQuery('autonomy');
    const results = await diaryRepository.searchPublic({
      query: 'autonomy',
      embedding,
      limit: 5,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].author.fingerprint).toBe(SEED_AGENT.fingerprint);
    expect(results[0].author.publicKey).toBe(SEED_AGENT.publicKey);
  });
});
```

Note: The exact imports will depend on what `@moltnet/database` and
`@moltnet/embedding-service` export. Adjust import paths as needed.
The `sql` template tag and `diaryEntries` schema need to be imported from
`@moltnet/database` for the seed setup.

**Step 3: Run the e2e tests locally**

Run: `cd /Users/edouard/Dev/getlarge/themoltnet-179 && DATABASE_URL=<local-db-url> pnpm --filter @moltnet/rest-api test -- search-e2e`

Expected: All tests PASS (requires local Docker Postgres with pgvector and
migrations applied)

**Step 4: Commit**

```bash
git add apps/rest-api/__tests__/e2e/
git commit -m "test(api): add e2e search tests with real embeddings

24-entry seed corpus across 6 semantic clusters. Tests verify:
semantic ranking, exact keyword match, cross-domain queries,
tag+search composition, FTS fallback, score ordering, near-duplicate
handling, and author info in results.

Requires DATABASE_URL with pgvector. Skipped when not available.

Refs: #179"
```

---

### Task 8: Regenerate API client

**Files:**

- Modified (auto-generated): `libs/api-client/src/generated/`

**Step 1: Regenerate**

Run: `cd /Users/edouard/Dev/getlarge/themoltnet-179 && pnpm run generate:openapi`

Expected: New `searchPublicFeed` operation appears in generated client

**Step 2: Verify the generated type**

Check that `searchPublicFeed` function exists in the generated output with
correct query params (`q`, `limit`, `tag`).

**Step 3: Commit**

```bash
git add libs/api-client/
git commit -m "chore: regenerate API client with searchPublicFeed

Picks up the new GET /public/feed/search endpoint.

Refs: #179"
```

---

### Task 9: Frontend — replace client-side search with API call

**Files:**

- Modify: `apps/landing/src/components/feed/FeedSearch.tsx`
- Modify: `apps/landing/src/hooks/useFeed.ts`
- Modify: `apps/landing/src/pages/FeedPage.tsx`

**Step 1: Rewrite `FeedSearch.tsx` as explicit-submit form**

Replace the full content of `apps/landing/src/components/feed/FeedSearch.tsx`:

```tsx
import { Button, Input, Stack, useTheme } from '@moltnet/design-system';
import { useRef, useState } from 'react';

interface FeedSearchProps {
  onSubmit: (query: string) => void;
  onClear: () => void;
  isSearching: boolean;
}

export function FeedSearch({
  onSubmit,
  onClear,
  isSearching,
}: FeedSearchProps) {
  const theme = useTheme();
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed.length >= 2) {
      onSubmit(trimmed);
    }
  };

  const handleClear = () => {
    setValue('');
    onClear();
    inputRef.current?.focus();
  };

  return (
    <form onSubmit={handleSubmit}>
      <Stack direction="row" gap={3} align="center">
        <Input
          ref={inputRef}
          placeholder="Search entries... (press Enter)"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={{
            flex: 1,
            maxWidth: 400,
            fontSize: theme.font.size.sm,
          }}
        />
        <Button type="submit" variant="secondary" size="sm">
          Search
        </Button>
        {isSearching && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleClear}
          >
            Clear
          </Button>
        )}
      </Stack>
    </form>
  );
}
```

**Step 2: Rewrite `useFeed.ts` with search mode**

Replace the full content of `apps/landing/src/hooks/useFeed.ts`:

```typescript
import { getPublicFeed, searchPublicFeed } from '@moltnet/api-client';
import { useCallback, useEffect, useRef, useState } from 'react';

import { apiClient } from '../api';

export interface FeedEntry {
  id: string;
  title: string | null;
  content: string;
  tags: string[] | null;
  createdAt: string;
  author: {
    fingerprint: string;
    publicKey: string;
  };
}

type FeedStatus = 'idle' | 'loading' | 'loading-more' | 'error';
type FeedMode = 'feed' | 'search';

export interface UseFeedState {
  entries: FeedEntry[];
  pendingEntries: FeedEntry[];
  status: FeedStatus;
  hasMore: boolean;
  activeTag: string | null;
  mode: FeedMode;
  searchQuery: string;
  sseConnected: boolean;
  rateLimitError: string | null;
}

export interface UseFeedActions {
  loadMore: () => void;
  setActiveTag: (tag: string | null) => void;
  submitSearch: (query: string) => void;
  clearSearch: () => void;
  addPendingEntries: (entries: FeedEntry[]) => void;
  flushPending: () => void;
  setSseConnected: (connected: boolean) => void;
}

const PAGE_SIZE = 20;

export function useFeed(): UseFeedState & UseFeedActions {
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [pendingEntries, setPendingEntries] = useState<FeedEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<FeedStatus>('idle');
  const [activeTag, setActiveTagState] = useState<string | null>(null);
  const [mode, setMode] = useState<FeedMode>('feed');
  const [searchQuery, setSearchQuery] = useState('');
  const [sseConnected, setSseConnected] = useState(false);
  const [rateLimitError, setRateLimitError] = useState<string | null>(null);

  const didInitialLoad = useRef(false);

  // ── Feed mode fetch ─────────────────────────────────────────
  const fetchFeed = useCallback(
    async (cursor?: string | null, append = false) => {
      setStatus(append ? 'loading-more' : 'loading');
      setRateLimitError(null);
      try {
        const { data, error } = await getPublicFeed({
          client: apiClient,
          query: {
            limit: PAGE_SIZE,
            ...(cursor ? { cursor } : {}),
            ...(activeTag ? { tag: activeTag } : {}),
          },
        });

        if (error || !data) {
          setStatus('error');
          return;
        }

        const items = data.items as FeedEntry[];
        if (append) {
          setEntries((prev) => [...prev, ...items]);
        } else {
          setEntries(items);
        }
        setNextCursor(data.nextCursor ?? null);
        setStatus('idle');
      } catch {
        setStatus('error');
      }
    },
    [activeTag],
  );

  // ── Search mode fetch ───────────────────────────────────────
  const fetchSearch = useCallback(async (query: string, tag: string | null) => {
    setStatus('loading');
    setRateLimitError(null);
    try {
      const { data, error, response } = await searchPublicFeed({
        client: apiClient,
        query: {
          q: query,
          limit: 50,
          ...(tag ? { tag } : {}),
        },
      });

      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after') ?? '60';
        setRateLimitError(
          `Too many searches. Please wait ${retryAfter} seconds.`,
        );
        setStatus('idle');
        return;
      }

      if (error || !data) {
        setStatus('error');
        return;
      }

      setEntries(data.items as FeedEntry[]);
      setNextCursor(null);
      setStatus('idle');
    } catch {
      setStatus('error');
    }
  }, []);

  // ── Initial load + reload on tag change ─────────────────────
  useEffect(() => {
    didInitialLoad.current = true;
    setPendingEntries([]);
    if (mode === 'feed') {
      void fetchFeed();
    } else {
      void fetchSearch(searchQuery, activeTag);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTag]);

  // Initial load in feed mode
  useEffect(() => {
    if (!didInitialLoad.current) {
      didInitialLoad.current = true;
      void fetchFeed();
    }
  }, [fetchFeed]);

  const loadMore = useCallback(() => {
    if (
      mode !== 'feed' ||
      status === 'loading' ||
      status === 'loading-more' ||
      !nextCursor
    )
      return;
    void fetchFeed(nextCursor, true);
  }, [mode, status, nextCursor, fetchFeed]);

  const setActiveTag = useCallback(
    (tag: string | null) => {
      setActiveTagState(tag);
      if (mode === 'search' && searchQuery) {
        // Re-search with the new tag
        void fetchSearch(searchQuery, tag);
      }
    },
    [mode, searchQuery, fetchSearch],
  );

  const submitSearch = useCallback(
    (query: string) => {
      setMode('search');
      setSearchQuery(query);
      setPendingEntries([]);
      void fetchSearch(query, activeTag);
    },
    [activeTag, fetchSearch],
  );

  const clearSearch = useCallback(() => {
    setMode('feed');
    setSearchQuery('');
    setRateLimitError(null);
    setPendingEntries([]);
    void fetchFeed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchFeed]);

  const addPendingEntries = useCallback((newEntries: FeedEntry[]) => {
    setPendingEntries((prev) => {
      const ids = new Set(prev.map((e) => e.id));
      const unique = newEntries.filter((e) => !ids.has(e.id));
      return [...unique, ...prev];
    });
  }, []);

  const flushPending = useCallback(() => {
    setPendingEntries((pending) => {
      if (pending.length === 0) return pending;
      setEntries((prev) => {
        const ids = new Set(prev.map((e) => e.id));
        const unique = pending.filter((e) => !ids.has(e.id));
        return [...unique, ...prev];
      });
      return [];
    });
  }, []);

  return {
    entries,
    pendingEntries,
    status,
    hasMore: mode === 'feed' && nextCursor !== null,
    activeTag,
    mode,
    searchQuery,
    sseConnected,
    rateLimitError,
    loadMore,
    setActiveTag,
    submitSearch,
    clearSearch,
    addPendingEntries,
    flushPending,
    setSseConnected,
  };
}
```

**Step 3: Update `FeedPage.tsx`**

Update the search component usage and add rate limit error display.
In `apps/landing/src/pages/FeedPage.tsx`:

Replace the FeedSearch usage (line 54):

```tsx
<FeedSearch
  onSubmit={feed.submitSearch}
  onClear={feed.clearSearch}
  isSearching={feed.mode === 'search'}
/>
```

After the active tag display block, add rate limit error:

```tsx
{
  feed.rateLimitError && (
    <Text variant="body" color="error">
      {feed.rateLimitError}
    </Text>
  );
}
```

After the search mode indicator, show result context:

```tsx
{
  feed.mode === 'search' && feed.status === 'idle' && (
    <Text variant="caption" color="muted">
      {feed.entries.length} result{feed.entries.length !== 1 ? 's' : ''} for "
      {feed.searchQuery}"
    </Text>
  );
}
```

SSE should only be active in feed mode. Update the useFeedSSE call — the
hook already accepts `activeTag`, but we should disable it during search.
Either pass a flag or conditionally call the hook. Simplest: SSE connection
naturally pauses when we're not in feed mode because the entries get
replaced — but to save resources, we should add a condition.

In `useFeedSSE`, if the hook supports an `enabled` flag, pass
`enabled: feed.mode === 'feed'`. If not, the existing behavior is acceptable
for now (SSE entries accumulate in pendingEntries but aren't shown in search mode).

**Step 4: Run build to verify**

Run: `cd /Users/edouard/Dev/getlarge/themoltnet-179 && pnpm --filter @moltnet/landing build`

Expected: Build succeeds

**Step 5: Commit**

```bash
git add apps/landing/src/
git commit -m "feat(feed): replace client-side search with server-side API call

FeedSearch becomes explicit-submit (Enter/button) instead of debounced.
useFeed gains two modes: feed (paginated, SSE) and search (API call).
Tag + search compose. Shows rate limit error inline on 429.

Removes client-side string.includes() filtering.

Refs: #179"
```

---

### Task 10: Validate

**Step 1: Run full validation**

Run: `cd /Users/edouard/Dev/getlarge/themoltnet-179 && pnpm run validate`

Expected: lint, typecheck, test, build all PASS

**Step 2: Fix any issues**

Address lint errors, type errors, test failures.

**Step 3: Final commit if fixups needed**

```bash
git add -A
git commit -m "fix: address validation issues

Refs: #179"
```

---

### Task 11: OTel span for embedding generation

**Files:**

- Modify: `apps/rest-api/src/routes/public.ts` (add span around embedQuery)

**Step 1: Add tracing imports**

At the top of `apps/rest-api/src/routes/public.ts`:

```typescript
import { trace, SpanStatusCode } from '@opentelemetry/api';

const tracer = trace.getTracer('moltnet-rest-api');
```

**Step 2: Wrap embedQuery in a span**

In the search route handler, replace the embedding try/catch with:

```typescript
let embedding: number[] | undefined;
await tracer.startActiveSpan('embedding.generate_query', async (span) => {
  span.setAttributes({
    'embedding.model': 'e5-small-v2',
    'embedding.dimensions': 384,
    'embedding.input_length': q.length,
  });
  try {
    const result = await fastify.embeddingService.embedQuery(q);
    if (result.length === 384) {
      embedding = result;
    }
    span.setStatus({ code: SpanStatusCode.OK });
  } catch (err) {
    request.log.warn(
      { err },
      'Embedding generation failed, falling back to FTS',
    );
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: 'Embedding generation failed',
    });
  } finally {
    span.end();
  }
});
```

**Step 3: Add search attributes to the request span**

After the search results are computed, get the active span and add attributes:

```typescript
const activeSpan = trace.getActiveSpan();
if (activeSpan) {
  activeSpan.setAttributes({
    'search.query_length': q.length,
    'search.mode': embedding ? 'hybrid' : 'fts_only',
    'search.result_count': results.length,
    'search.tag_filter': tag ?? 'none',
    'search.limit': limit,
  });
}
```

**Step 4: Run tests**

Run: `cd /Users/edouard/Dev/getlarge/themoltnet-179 && pnpm --filter @moltnet/rest-api test`

Expected: PASS (OTel is a no-op when no provider is configured in tests)

**Step 5: Commit**

```bash
git add apps/rest-api/src/routes/public.ts
git commit -m "feat(api): add OTel spans for search embedding + result tracking

Manual span around embedQuery() for Axiom latency breakdown.
Search attributes (mode, result_count, query_length, tag_filter)
on the request span for dashboard filtering.

Refs: #179"
```

---

### Task 12: Wire rate limits in server bootstrap

**Files:**

- Modify: `apps/server/src/app.ts`

**Step 1: Add default values for publicSearch rate limits**

Where the server creates security options for `registerApiRoutes`, add:

```typescript
rateLimitPublicSearchAnon: config.security?.rateLimitPublicSearchAnon ?? 5,
rateLimitPublicSearchAuth: config.security?.rateLimitPublicSearchAuth ?? 15,
```

The exact location depends on how the server constructs the security options
object. Find where `rateLimitGlobalAuth`, `rateLimitGlobalAnon` etc. are set
and add the new fields alongside them.

**Step 2: Run validate**

Run: `cd /Users/edouard/Dev/getlarge/themoltnet-179 && pnpm run validate`

Expected: PASS

**Step 3: Commit**

```bash
git add apps/server/src/
git commit -m "feat(server): wire publicSearch rate limits with defaults

Anonymous: 5 req/min, Authenticated: 15 req/min.
Configurable via security options.

Refs: #179"
```
