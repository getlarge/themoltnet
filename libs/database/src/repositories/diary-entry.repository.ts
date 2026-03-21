/**
 * Diary Repository
 *
 * Pure data layer for diary entries. No authorization logic —
 * permission checks are handled by the service layer via Keto.
 */

import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  gt,
  gte,
  inArray,
  isNotNull,
  lt,
  or,
  sql,
} from 'drizzle-orm';

import type { Database } from '../db.js';
import {
  agentKeys,
  diaries,
  diaryEntries,
  type DiaryEntry,
  type NewDiaryEntry,
} from '../schema.js';
import { getExecutor } from '../transaction-context.js';

type EntryType = DiaryEntry['entryType'];
type Condition = ReturnType<typeof eq>;

/** Collect non-undefined Drizzle conditions into an array. */
function filterConditions(
  ...maybeConditions: (Condition | undefined)[]
): Condition[] {
  return maybeConditions.filter((c): c is Condition => c !== undefined);
}

/** Common entry filter conditions shared by list() and embedding-only search. */
function entryFilterConditions(opts: {
  tags?: string[];
  excludeTags?: string[];
  entryType?: string;
  entryTypes?: string[];
  excludeSuperseded?: boolean;
  createdBefore?: Date;
  createdAfter?: Date;
}): Condition[] {
  return filterConditions(
    opts.tags && opts.tags.length > 0
      ? sql`${diaryEntries.tags} @> ARRAY[${sql.join(
          opts.tags.map((t) => sql`${t}`),
          sql`, `,
        )}]::text[]`
      : undefined,
    opts.excludeTags && opts.excludeTags.length > 0
      ? sql`(${diaryEntries.tags} IS NULL OR NOT (${diaryEntries.tags} && ARRAY[${sql.join(
          opts.excludeTags.map((t) => sql`${t}`),
          sql`, `,
        )}]::text[]))`
      : undefined,
    opts.entryType
      ? eq(diaryEntries.entryType, opts.entryType as EntryType)
      : opts.entryTypes && opts.entryTypes.length > 0
        ? inArray(diaryEntries.entryType, opts.entryTypes as EntryType[])
        : undefined,
    opts.excludeSuperseded
      ? sql`NOT EXISTS (
          SELECT 1 FROM entry_relations er
          WHERE er.target_id = ${diaryEntries.id}
            AND er.relation = 'supersedes'
            AND er.status = 'accepted'
        )`
      : undefined,
    opts.createdBefore
      ? lt(diaryEntries.createdAt, opts.createdBefore)
      : undefined,
    opts.createdAfter
      ? gte(diaryEntries.createdAt, opts.createdAfter)
      : undefined,
  );
}

// Exclude embedding from read queries — the 384-dim vector is only needed
// internally for search ordering, never returned to callers.
const { embedding: _embedding, ...publicColumns } =
  getTableColumns(diaryEntries);

export interface DiaryTagCount {
  tag: string;
  count: number;
}

export interface DiaryTagsOptions {
  diaryId: string;
  prefix?: string;
  minCount?: number;
  entryTypes?: string[];
}

export interface DiarySearchOptions {
  diaryId?: string;
  diaryIds?: string[];
  query?: string;
  embedding?: number[];
  tags?: string[];
  excludeTags?: string[];
  limit?: number;
  offset?: number;
  wRelevance?: number;
  wRecency?: number;
  wImportance?: number;
  entryTypes?: string[];
  excludeSuperseded?: boolean;
  createdBefore?: Date;
  createdAfter?: Date;
}

export interface DiaryListOptions {
  diaryId?: string;
  diaryIds?: string[];
  ids?: string[];
  tags?: string[];
  excludeTags?: string[];
  limit?: number;
  offset?: number;
  entryType?: string;
  entryTypes?: string[];
  excludeSuperseded?: boolean;
  createdBefore?: Date;
  createdAfter?: Date;
}

export interface PublicFeedCursor {
  createdAt: string; // ISO 8601
  id: string; // UUID
}

export interface PublicFeedOptions {
  cursor?: PublicFeedCursor;
  limit?: number;
  tag?: string;
  includeSuspicious?: boolean;
}

export interface ListPublicSinceOptions {
  afterCreatedAt: string; // ISO 8601
  afterId: string; // UUID tiebreaker
  tag?: string;
  limit?: number; // default 50
  includeSuspicious?: boolean;
}

export interface PublicSearchOptions {
  query: string; // 2-200 chars
  embedding?: number[]; // 384-dim, optional (FTS fallback if missing)
  tags?: string[]; // optional tag filter
  limit?: number; // 1-50, default 10
  entryTypes?: string[];
  excludeSuperseded?: boolean;
  includeSuspicious?: boolean;
}

export interface PublicSearchResult {
  id: string;
  title: string | null;
  content: string;
  tags: string[] | null;
  injectionRisk: boolean;
  createdAt: Date;
  author: { fingerprint: string; publicKey: string };
  score: number; // RRF combined score
}

export interface PublicFeedEntry {
  id: string;
  title: string | null;
  content: string;
  tags: string[] | null;
  injectionRisk: boolean;
  createdAt: Date;
  author: {
    fingerprint: string;
    publicKey: string;
  };
}

function mapRowToDiaryEntry(row: Record<string, unknown>): DiaryEntry {
  return {
    id: row.id as string,
    diaryId: row.diary_id as string,
    createdBy: row.created_by as string,
    title: (row.title as string) ?? null,
    content: row.content as string,
    embedding: null, // hybrid_search omits embedding for performance
    tags: (row.tags as string[]) ?? null,
    injectionRisk: (row.injection_risk as boolean) ?? false,
    importance: (row.importance as number) ?? 5,
    accessCount: (row.access_count as number) ?? 0,
    lastAccessedAt: row.last_accessed_at
      ? new Date(row.last_accessed_at as string)
      : null,
    entryType: (row.entry_type as DiaryEntry['entryType']) ?? 'semantic',
    contentHash: (row.content_hash as string) ?? null,
    contentSignature: (row.content_signature as string) ?? null,
    signingNonce: (row.signing_nonce as string) ?? null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function mapRowToPublicSearchResult(
  row: Record<string, unknown>,
): PublicSearchResult {
  return {
    id: row.id as string,
    title: (row.title as string) ?? null,
    content: row.content as string,
    tags: (row.tags as string[]) ?? null,
    injectionRisk: (row.injection_risk as boolean) ?? false,
    createdAt: new Date(row.created_at as string),
    author: {
      fingerprint: row.author_fingerprint as string,
      publicKey: row.author_public_key as string,
    },
    score: Number(row.combined_score ?? 0),
  };
}

export function createDiaryEntryRepository(db: Database) {
  return {
    /**
     * Create a new diary entry.
     * Automatically participates in the active transaction (via ALS).
     */
    async create(entry: NewDiaryEntry & { id?: string }): Promise<DiaryEntry> {
      const [created] = await getExecutor(db)
        .insert(diaryEntries)
        .values(entry)
        .returning();
      return created;
    },

    /**
     * Get entry by ID (no access control — service layer checks Keto)
     */
    async findById(id: string): Promise<DiaryEntry | null> {
      const [entry] = await db
        .select(publicColumns)
        .from(diaryEntries)
        .where(eq(diaryEntries.id, id))
        .limit(1);

      if (!entry) return null;

      // Fire-and-forget access tracking
      db.update(diaryEntries)
        .set({
          accessCount: sql`${diaryEntries.accessCount} + 1`,
          lastAccessedAt: new Date(),
        })
        .where(eq(diaryEntries.id, id))
        .then(() => {})
        .catch(() => {});

      return { ...entry, embedding: null };
    },

    /**
     * List entries for a diary
     */
    async list(options: DiaryListOptions): Promise<DiaryEntry[]> {
      const {
        diaryId,
        diaryIds,
        ids,
        tags,
        excludeTags,
        limit = 20,
        offset = 0,
        entryType,
        entryTypes,
        excludeSuperseded,
        createdBefore,
        createdAfter,
      } = options;

      const conditions = [];

      if (ids && ids.length > 0) {
        // Always scope by diaryId when provided — prevents cross-diary entry access
        conditions.push(inArray(diaryEntries.id, ids));
        if (diaryId) {
          conditions.push(eq(diaryEntries.diaryId, diaryId));
        }
      } else if (diaryIds && diaryIds.length > 0) {
        conditions.push(inArray(diaryEntries.diaryId, diaryIds));
      } else if (diaryId) {
        conditions.push(eq(diaryEntries.diaryId, diaryId));
      }

      conditions.push(
        ...entryFilterConditions({
          tags,
          excludeTags,
          entryType,
          entryTypes,
          excludeSuperseded,
          createdBefore,
          createdAfter,
        }),
      );

      const rows = await db
        .select(publicColumns)
        .from(diaryEntries)
        .where(and(...conditions))
        .orderBy(desc(diaryEntries.createdAt))
        .limit(limit)
        .offset(offset);
      return rows.map((row) => ({ ...row, embedding: null }));
    },

    /**
     * Find multiple entries by IDs returning only id + diaryId.
     * Used for same-diary validation when creating entry relations.
     */
    async findByIds(
      ids: string[],
    ): Promise<Array<Pick<DiaryEntry, 'id' | 'diaryId'>>> {
      if (ids.length === 0) return [];
      return db
        .select({ id: diaryEntries.id, diaryId: diaryEntries.diaryId })
        .from(diaryEntries)
        .where(inArray(diaryEntries.id, ids));
    },

    /**
     * Fetch embeddings for a list of entry IDs.
     * Returns only { id, embedding } — no content or metadata overhead.
     * Used by context-distill workflows that need vectors for clustering/MMR.
     */
    async fetchEmbeddings(
      ids: string[],
    ): Promise<{ id: string; embedding: number[] }[]> {
      if (ids.length === 0) return [];
      const rows = await db
        .select({ id: diaryEntries.id, embedding: diaryEntries.embedding })
        .from(diaryEntries)
        .where(inArray(diaryEntries.id, ids));
      return rows
        .filter((r) => r.embedding !== null)
        .map((r) => ({ id: r.id, embedding: r.embedding as number[] }));
    },

    /**
     * Hybrid search within a diary: combines vector similarity and full-text search.
     *
     * When query is provided (with or without embedding), delegates to
     * the `diary_search()` SQL function which uses RRF scoring.
     * Embedding-only falls back to vector similarity search.
     */
    async search(options: DiarySearchOptions): Promise<DiaryEntry[]> {
      const {
        diaryId,
        diaryIds,
        query,
        embedding,
        tags,
        excludeTags,
        limit = 10,
        offset = 0,
        wRelevance,
        wRecency,
        wImportance,
        entryTypes,
        excludeSuperseded,
        createdBefore,
        createdAfter,
      } = options;

      // Build diary_ids param: explicit array > single id > NULL (public mode)
      const resolvedIds = diaryIds ?? (diaryId ? [diaryId] : null);
      const diaryIdsParam =
        resolvedIds && resolvedIds.length > 0
          ? sql`ARRAY[${sql.join(
              resolvedIds.map((id) => sql`${id}::uuid`),
              sql`,`,
            )}]::uuid[]`
          : sql`NULL::uuid[]`;

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
      const excludeTagsParam =
        excludeTags && excludeTags.length > 0
          ? sql`ARRAY[${sql.join(
              excludeTags.map((t) => sql`${t}`),
              sql`, `,
            )}]::text[]`
          : sql`NULL::text[]`;

      const createdBeforeParam = createdBefore
        ? sql`${createdBefore}::timestamptz`
        : sql`NULL::timestamptz`;
      const createdAfterParam = createdAfter
        ? sql`${createdAfter}::timestamptz`
        : sql`NULL::timestamptz`;

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
                ${excludeTagsParam},
                ${excludeSuperseded ?? false},
                false, /* p_exclude_suspicious — only used by public search */
                ${createdBeforeParam},
                ${createdAfterParam}
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
                ${excludeTagsParam},
                ${excludeSuperseded ?? false},
                false, /* p_exclude_suspicious — only used by public search */
                ${createdBeforeParam},
                ${createdAfterParam}
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
        const conditions =
          resolvedIds && resolvedIds.length > 0
            ? [inArray(diaryEntries.diaryId, resolvedIds)]
            : [];
        conditions.push(
          ...entryFilterConditions({
            tags,
            excludeTags,
            entryTypes,
            excludeSuperseded,
            createdBefore: options.createdBefore,
            createdAfter: options.createdAfter,
          }),
        );
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

      // No query/embedding → fall back to list (pass all filters)
      return this.list({
        diaryId,
        diaryIds,
        tags,
        excludeTags,
        limit,
        offset,
        entryTypes,
        excludeSuperseded,
        createdBefore,
        createdAfter,
      });
    },

    /**
     * Public feed search: calls diary_search() with NULL diary_id
     * to trigger public mode (visibility='public' on the diary).
     * Joins agent_keys to include author fingerprint and publicKey.
     */
    async searchPublic(
      options: PublicSearchOptions,
    ): Promise<PublicSearchResult[]> {
      const {
        query,
        embedding,
        tags,
        limit = 10,
        entryTypes,
        excludeSuperseded,
        includeSuspicious,
      } = options;

      const embeddingParam =
        embedding && embedding.length === 384
          ? sql`${`[${embedding.join(',')}]`}::vector(384)`
          : sql`NULL::vector(384)`;

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

      const result = await db.execute(
        sql`SELECT * FROM diary_search(
              ${query},
              ${embeddingParam},
              ${limit},
              NULL::uuid[],
              ${tagsParam},
              60,
              1.0,
              0.0,
              0.0,
              ${entryTypesParam},
              NULL::text[],
              ${excludeSuperseded ?? false},
              ${!includeSuspicious}
            )`,
      );
      const rows = (result as unknown as { rows: Record<string, unknown>[] })
        .rows;
      return rows.map(mapRowToPublicSearchResult);
    },

    /**
     * List distinct tags used across entries in a diary, with counts.
     */
    async listTags(options: DiaryTagsOptions): Promise<DiaryTagCount[]> {
      const { diaryId, prefix, minCount, entryTypes } = options;

      const conditions = [
        eq(diaryEntries.diaryId, diaryId),
        isNotNull(diaryEntries.tags),
      ];

      if (entryTypes && entryTypes.length > 0) {
        conditions.push(
          inArray(diaryEntries.entryType, entryTypes as EntryType[]),
        );
      }

      const havingClause = minCount
        ? sql`HAVING COUNT(*) >= ${minCount}`
        : sql``;
      const prefixClause = prefix
        ? sql`AND tag LIKE ${prefix.replace(/[%_\\]/g, '\\$&') + '%'} ESCAPE '\\'`
        : sql``;

      const result = await db.execute(
        sql`SELECT tag, COUNT(*)::int AS count
            FROM (
              SELECT unnest(${diaryEntries.tags}) AS tag
              FROM ${diaryEntries}
              WHERE ${and(...conditions)}
            ) AS expanded
            WHERE true ${prefixClause}
            GROUP BY tag
            ${havingClause}
            ORDER BY count DESC, tag ASC`,
      );

      const rows = (result as unknown as { rows: DiaryTagCount[] }).rows;
      return rows;
    },

    /**
     * Update entry by ID (no ownership check — service layer checks Keto)
     */
    async update(
      id: string,
      updates: Partial<
        Pick<
          DiaryEntry,
          | 'title'
          | 'content'
          | 'tags'
          | 'embedding'
          | 'importance'
          | 'accessCount'
          | 'lastAccessedAt'
          | 'entryType'
          | 'contentHash'
          | 'contentSignature'
        >
      >,
    ): Promise<DiaryEntry | null> {
      const [updated] = await getExecutor(db)
        .update(diaryEntries)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(diaryEntries.id, id))
        .returning();

      return updated || null;
    },

    /**
     * Delete entry by ID (no ownership check — service layer checks Keto)
     */
    async delete(id: string): Promise<boolean> {
      const result = await getExecutor(db)
        .delete(diaryEntries)
        .where(eq(diaryEntries.id, id))
        .returning({ id: diaryEntries.id });

      return result.length > 0;
    },

    /**
     * Get recent entries for digest/reflection, scoped to a diary.
     */
    async getRecentForDigest(
      diaryId: string,
      days = 7,
      limit = 50,
      entryTypes?: string[],
    ): Promise<DiaryEntry[]> {
      const since = new Date();
      since.setDate(since.getDate() - days);

      const conditions = [
        eq(diaryEntries.diaryId, diaryId),
        sql`${diaryEntries.createdAt} > ${since.toISOString()}`,
      ];

      if (entryTypes && entryTypes.length > 0) {
        conditions.push(
          inArray(diaryEntries.entryType, entryTypes as EntryType[]),
        );
      }

      const rows = await db
        .select(publicColumns)
        .from(diaryEntries)
        .where(and(...conditions))
        .orderBy(desc(diaryEntries.createdAt))
        .limit(limit);
      return rows.map((row) => ({ ...row, embedding: null }));
    },

    /**
     * List public diary entries with cursor-based pagination.
     * Visibility is determined by the parent diary.
     * Joins diaries → agent_keys to include author fingerprint and publicKey.
     */
    async listPublic(
      options: PublicFeedOptions,
    ): Promise<{ items: PublicFeedEntry[]; hasMore: boolean }> {
      const { cursor, limit = 20, tag, includeSuspicious } = options;
      const fetchLimit = limit + 1;

      const conditions = [eq(diaries.visibility, 'public')];

      if (cursor) {
        const cursorDate = new Date(cursor.createdAt);
        const cursorCondition = or(
          lt(diaryEntries.createdAt, cursorDate),
          and(
            eq(diaryEntries.createdAt, cursorDate),
            lt(diaryEntries.id, cursor.id),
          ),
        );
        if (cursorCondition) conditions.push(cursorCondition);
      }

      if (tag) {
        conditions.push(sql`${tag} = ANY(${diaryEntries.tags})`);
      }

      if (!includeSuspicious) {
        conditions.push(eq(diaryEntries.injectionRisk, false));
      }

      const rows = await db
        .select({
          id: diaryEntries.id,
          title: diaryEntries.title,
          content: diaryEntries.content,
          tags: diaryEntries.tags,
          injectionRisk: diaryEntries.injectionRisk,
          createdAt: diaryEntries.createdAt,
          fingerprint: agentKeys.fingerprint,
          publicKey: agentKeys.publicKey,
        })
        .from(diaryEntries)
        .innerJoin(diaries, eq(diaryEntries.diaryId, diaries.id))
        .innerJoin(agentKeys, eq(diaries.ownerId, agentKeys.identityId))
        .where(and(...conditions))
        .orderBy(desc(diaryEntries.createdAt), desc(diaryEntries.id))
        .limit(fetchLimit);

      const hasMore = rows.length > limit;
      const items = (hasMore ? rows.slice(0, limit) : rows).map(
        (row): PublicFeedEntry => ({
          id: row.id,
          title: row.title ?? null,
          content: row.content,
          tags: row.tags ?? null,
          injectionRisk: row.injectionRisk,
          createdAt: row.createdAt,
          author: {
            fingerprint: row.fingerprint,
            publicKey: row.publicKey,
          },
        }),
      );

      return { items, hasMore };
    },

    /**
     * List public diary entries created after a cursor, ascending order.
     * Used by the SSE feed poller to stream new entries.
     */
    async listPublicSince(
      options: ListPublicSinceOptions,
    ): Promise<PublicFeedEntry[]> {
      const {
        afterCreatedAt,
        afterId,
        tag,
        limit = 50,
        includeSuspicious,
      } = options;
      const cursorDate = new Date(afterCreatedAt);

      const conditions = [
        eq(diaries.visibility, 'public'),
        or(
          gt(diaryEntries.createdAt, cursorDate),
          and(
            eq(diaryEntries.createdAt, cursorDate),
            gt(diaryEntries.id, afterId),
          ),
        )!,
      ];

      if (tag) {
        conditions.push(sql`${tag} = ANY(${diaryEntries.tags})`);
      }

      if (!includeSuspicious) {
        conditions.push(eq(diaryEntries.injectionRisk, false));
      }

      const rows = await db
        .select({
          id: diaryEntries.id,
          title: diaryEntries.title,
          content: diaryEntries.content,
          tags: diaryEntries.tags,
          injectionRisk: diaryEntries.injectionRisk,
          createdAt: diaryEntries.createdAt,
          fingerprint: agentKeys.fingerprint,
          publicKey: agentKeys.publicKey,
        })
        .from(diaryEntries)
        .innerJoin(diaries, eq(diaryEntries.diaryId, diaries.id))
        .innerJoin(agentKeys, eq(diaries.ownerId, agentKeys.identityId))
        .where(and(...conditions))
        .orderBy(asc(diaryEntries.createdAt), asc(diaryEntries.id))
        .limit(limit);

      return rows.map(
        (row): PublicFeedEntry => ({
          id: row.id,
          title: row.title ?? null,
          content: row.content,
          tags: row.tags ?? null,
          injectionRisk: row.injectionRisk,
          createdAt: row.createdAt,
          author: {
            fingerprint: row.fingerprint,
            publicKey: row.publicKey,
          },
        }),
      );
    },

    /**
     * Count signed entries in a diary.
     * Used to guard diary deletion when signed entries are present.
     */
    async countSignedByDiary(diaryId: string): Promise<number> {
      const result = await db
        .select({ count: count() })
        .from(diaryEntries)
        .where(
          and(
            eq(diaryEntries.diaryId, diaryId),
            isNotNull(diaryEntries.contentSignature),
          ),
        );
      return result[0]?.count ?? 0;
    },

    /**
     * Find a single public diary entry by ID with author info.
     * Returns null if the entry doesn't exist or its diary isn't public.
     */
    async findPublicById(id: string): Promise<PublicFeedEntry | null> {
      const [row] = await db
        .select({
          id: diaryEntries.id,
          title: diaryEntries.title,
          content: diaryEntries.content,
          tags: diaryEntries.tags,
          injectionRisk: diaryEntries.injectionRisk,
          createdAt: diaryEntries.createdAt,
          fingerprint: agentKeys.fingerprint,
          publicKey: agentKeys.publicKey,
        })
        .from(diaryEntries)
        .innerJoin(diaries, eq(diaryEntries.diaryId, diaries.id))
        .innerJoin(agentKeys, eq(diaries.ownerId, agentKeys.identityId))
        .where(and(eq(diaryEntries.id, id), eq(diaries.visibility, 'public')))
        .limit(1);

      if (!row) return null;

      return {
        id: row.id,
        title: row.title ?? null,
        content: row.content,
        tags: row.tags ?? null,
        injectionRisk: row.injectionRisk,
        createdAt: row.createdAt,
        author: {
          fingerprint: row.fingerprint,
          publicKey: row.publicKey,
        },
      };
    },
  };
}

export type DiaryEntryRepository = ReturnType<
  typeof createDiaryEntryRepository
>;
