/**
 * Diary Repository
 *
 * Pure data layer for diary entries. No authorization logic —
 * permission checks are handled by the service layer via Keto.
 */

import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gt,
  inArray,
  lt,
  or,
  sql,
} from 'drizzle-orm';

import type { Database } from '../db.js';
import {
  agentKeys,
  diaryEntries,
  type DiaryEntry,
  entryShares,
  type NewDiaryEntry,
} from '../schema.js';
import { getExecutor } from '../transaction-context.js';

// Exclude embedding from read queries — the 384-dim vector is only needed
// internally for search ordering, never returned to callers.
const { embedding: _embedding, ...publicColumns } =
  getTableColumns(diaryEntries);

export interface DiarySearchOptions {
  ownerId: string;
  query?: string;
  embedding?: number[];
  visibility?: ('private' | 'moltnet' | 'public')[];
  limit?: number;
  offset?: number;
}

export interface DiaryListOptions {
  ownerId: string;
  visibility?: ('private' | 'moltnet' | 'public')[];
  limit?: number;
  offset?: number;
}

export interface PublicFeedCursor {
  createdAt: string; // ISO 8601
  id: string; // UUID
}

export interface PublicFeedOptions {
  cursor?: PublicFeedCursor;
  limit?: number;
  tag?: string;
}

export interface ListPublicSinceOptions {
  afterCreatedAt: string; // ISO 8601
  afterId: string; // UUID tiebreaker
  tag?: string;
  limit?: number; // default 50
}

export interface PublicFeedEntry {
  id: string;
  title: string | null;
  content: string;
  tags: string[] | null;
  createdAt: Date;
  author: {
    fingerprint: string;
    publicKey: string;
  };
}

function mapRowToDiaryEntry(row: Record<string, unknown>): DiaryEntry {
  return {
    id: row.id as string,
    ownerId: row.owner_id as string,
    title: (row.title as string) ?? null,
    content: row.content as string,
    embedding: null, // hybrid_search omits embedding for performance
    visibility: row.visibility as DiaryEntry['visibility'],
    tags: (row.tags as string[]) ?? null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

export function createDiaryRepository(db: Database) {
  return {
    /**
     * Create a new diary entry.
     * Automatically participates in the active transaction (via ALS).
     */
    async create(entry: NewDiaryEntry): Promise<DiaryEntry> {
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

      return entry ? { ...entry, embedding: null } : null;
    },

    /**
     * List entries for an owner
     */
    async list(options: DiaryListOptions): Promise<DiaryEntry[]> {
      const { ownerId, visibility, limit = 20, offset = 0 } = options;

      if (visibility && visibility.length > 0) {
        const rows = await db
          .select(publicColumns)
          .from(diaryEntries)
          .where(
            and(
              eq(diaryEntries.ownerId, ownerId),
              inArray(diaryEntries.visibility, visibility),
            ),
          )
          .orderBy(desc(diaryEntries.createdAt))
          .limit(limit)
          .offset(offset);
        return rows.map((row) => ({ ...row, embedding: null }));
      }

      const rows = await db
        .select(publicColumns)
        .from(diaryEntries)
        .where(eq(diaryEntries.ownerId, ownerId))
        .orderBy(desc(diaryEntries.createdAt))
        .limit(limit)
        .offset(offset);
      return rows.map((row) => ({ ...row, embedding: null }));
    },

    /**
     * Hybrid search: combines vector similarity and full-text search.
     *
     * When both query and embedding are provided, delegates to the
     * `hybrid_search()` SQL function which uses weighted RRF scoring
     * (70% vector + 30% FTS by default).
     */
    async search(options: DiarySearchOptions): Promise<DiaryEntry[]> {
      const {
        ownerId,
        query,
        embedding,
        visibility,
        limit = 10,
        offset = 0,
      } = options;

      // Both query and embedding → use hybrid_search() SQL function
      if (query && embedding && embedding.length === 384) {
        const vectorString = `[${embedding.join(',')}]`;
        const rows = await db.execute(
          sql`SELECT * FROM hybrid_search(
                ${ownerId}::uuid,
                ${query},
                ${vectorString}::vector,
                ${limit}
              )`,
        );
        return (rows as unknown as Record<string, unknown>[]).map(
          mapRowToDiaryEntry,
        );
      }

      // Embedding only → vector similarity search
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

      // Query only → full-text search
      if (query) {
        const rows = await db
          .select(publicColumns)
          .from(diaryEntries)
          .where(
            and(
              eq(diaryEntries.ownerId, ownerId),
              sql`to_tsvector('english', ${diaryEntries.content}) @@ plainto_tsquery('english', ${query})`,
            ),
          )
          .orderBy(desc(diaryEntries.createdAt))
          .limit(limit)
          .offset(offset);
        return rows.map((row) => ({ ...row, embedding: null }));
      }

      // No query/embedding → fall back to list
      return this.list({ ownerId, visibility, limit, offset });
    },

    /**
     * Update entry by ID (no ownership check — service layer checks Keto)
     */
    async update(
      id: string,
      updates: Partial<
        Pick<
          DiaryEntry,
          'title' | 'content' | 'visibility' | 'tags' | 'embedding'
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
     * Insert share record (no ownership check — service layer checks Keto)
     */
    async share(
      entryId: string,
      sharedBy: string,
      sharedWith: string,
    ): Promise<boolean> {
      await getExecutor(db)
        .insert(entryShares)
        .values({ entryId, sharedBy, sharedWith })
        .onConflictDoNothing();

      return true;
    },

    /**
     * Get entries shared with an agent
     */
    async getSharedWithMe(agentId: string, limit = 20): Promise<DiaryEntry[]> {
      const shares = await db
        .select({ entryId: entryShares.entryId })
        .from(entryShares)
        .where(eq(entryShares.sharedWith, agentId))
        .limit(limit);

      if (shares.length === 0) return [];

      const entryIds = shares.map((s) => s.entryId);

      const rows = await db
        .select(publicColumns)
        .from(diaryEntries)
        .where(inArray(diaryEntries.id, entryIds))
        .orderBy(desc(diaryEntries.createdAt));
      return rows.map((row) => ({ ...row, embedding: null }));
    },

    /**
     * Get recent entries for digest/reflection
     */
    async getRecentForDigest(
      ownerId: string,
      days = 7,
      limit = 50,
    ): Promise<DiaryEntry[]> {
      const since = new Date();
      since.setDate(since.getDate() - days);

      const rows = await db
        .select(publicColumns)
        .from(diaryEntries)
        .where(
          and(
            eq(diaryEntries.ownerId, ownerId),
            sql`${diaryEntries.createdAt} > ${since.toISOString()}`,
          ),
        )
        .orderBy(desc(diaryEntries.createdAt))
        .limit(limit);
      return rows.map((row) => ({ ...row, embedding: null }));
    },

    /**
     * List public diary entries with cursor-based pagination.
     * Fetches limit+1 rows to determine if more pages exist.
     * Joins agent_keys to include author fingerprint and publicKey.
     */
    async listPublic(
      options: PublicFeedOptions,
    ): Promise<{ items: PublicFeedEntry[]; hasMore: boolean }> {
      const { cursor, limit = 20, tag } = options;
      const fetchLimit = limit + 1;

      const conditions = [eq(diaryEntries.visibility, 'public')];

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

      const rows = await db
        .select({
          id: diaryEntries.id,
          title: diaryEntries.title,
          content: diaryEntries.content,
          tags: diaryEntries.tags,
          createdAt: diaryEntries.createdAt,
          fingerprint: agentKeys.fingerprint,
          publicKey: agentKeys.publicKey,
        })
        .from(diaryEntries)
        .innerJoin(agentKeys, eq(diaryEntries.ownerId, agentKeys.identityId))
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
      const { afterCreatedAt, afterId, tag, limit = 50 } = options;
      const cursorDate = new Date(afterCreatedAt);

      const conditions = [
        eq(diaryEntries.visibility, 'public'),
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

      const rows = await db
        .select({
          id: diaryEntries.id,
          title: diaryEntries.title,
          content: diaryEntries.content,
          tags: diaryEntries.tags,
          createdAt: diaryEntries.createdAt,
          fingerprint: agentKeys.fingerprint,
          publicKey: agentKeys.publicKey,
        })
        .from(diaryEntries)
        .innerJoin(agentKeys, eq(diaryEntries.ownerId, agentKeys.identityId))
        .where(and(...conditions))
        .orderBy(asc(diaryEntries.createdAt), asc(diaryEntries.id))
        .limit(limit);

      return rows.map(
        (row): PublicFeedEntry => ({
          id: row.id,
          title: row.title ?? null,
          content: row.content,
          tags: row.tags ?? null,
          createdAt: row.createdAt,
          author: {
            fingerprint: row.fingerprint,
            publicKey: row.publicKey,
          },
        }),
      );
    },

    /**
     * Find a single public diary entry by ID with author info.
     * Returns null if the entry doesn't exist or isn't public.
     */
    async findPublicById(id: string): Promise<PublicFeedEntry | null> {
      const [row] = await db
        .select({
          id: diaryEntries.id,
          title: diaryEntries.title,
          content: diaryEntries.content,
          tags: diaryEntries.tags,
          createdAt: diaryEntries.createdAt,
          fingerprint: agentKeys.fingerprint,
          publicKey: agentKeys.publicKey,
        })
        .from(diaryEntries)
        .innerJoin(agentKeys, eq(diaryEntries.ownerId, agentKeys.identityId))
        .where(
          and(eq(diaryEntries.id, id), eq(diaryEntries.visibility, 'public')),
        )
        .limit(1);

      if (!row) return null;

      return {
        id: row.id,
        title: row.title ?? null,
        content: row.content,
        tags: row.tags ?? null,
        createdAt: row.createdAt,
        author: {
          fingerprint: row.fingerprint,
          publicKey: row.publicKey,
        },
      };
    },
  };
}

export type DiaryRepository = ReturnType<typeof createDiaryRepository>;
