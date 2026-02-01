/**
 * Diary Repository
 *
 * Database operations for diary entries
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import type { Database } from '../db.js';
import {
  diaryEntries,
  type DiaryEntry,
  entryShares,
  type NewDiaryEntry,
} from '../schema.js';

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
     * Create a new diary entry
     */
    async create(entry: NewDiaryEntry): Promise<DiaryEntry> {
      const [created] = await db.insert(diaryEntries).values(entry).returning();
      return created;
    },

    /**
     * Get entry by ID (with access control)
     */
    async findById(
      id: string,
      requesterId: string,
    ): Promise<DiaryEntry | null> {
      const [entry] = await db
        .select()
        .from(diaryEntries)
        .where(eq(diaryEntries.id, id))
        .limit(1);

      if (!entry) return null;

      // Check access permissions
      if (entry.ownerId === requesterId) return entry;
      if (entry.visibility === 'public') return entry;
      if (entry.visibility === 'moltnet') return entry;

      // Check if explicitly shared
      const [share] = await db
        .select()
        .from(entryShares)
        .where(
          and(
            eq(entryShares.entryId, id),
            eq(entryShares.sharedWith, requesterId),
          ),
        )
        .limit(1);

      if (share) return entry;

      return null;
    },

    /**
     * List entries for an owner
     */
    async list(options: DiaryListOptions): Promise<DiaryEntry[]> {
      const { ownerId, visibility, limit = 20, offset = 0 } = options;

      if (visibility && visibility.length > 0) {
        return db
          .select()
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
      }

      return db
        .select()
        .from(diaryEntries)
        .where(eq(diaryEntries.ownerId, ownerId))
        .orderBy(desc(diaryEntries.createdAt))
        .limit(limit)
        .offset(offset);
    },

    /**
     * Hybrid search: combines vector similarity and full-text search.
     *
     * When both query and embedding are provided, delegates to the
     * `hybrid_search()` SQL function which uses weighted RRF scoring
     * (70% vector + 30% FTS by default).
     */
    async search(options: DiarySearchOptions): Promise<DiaryEntry[]> {
      const { ownerId, query, embedding, visibility, limit = 10, offset = 0 } =
        options;

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
        return db
          .select()
          .from(diaryEntries)
          .where(eq(diaryEntries.ownerId, ownerId))
          .orderBy(sql`${diaryEntries.embedding} <-> ${vectorString}::vector`)
          .limit(limit)
          .offset(offset);
      }

      // Query only → full-text search
      if (query) {
        return db
          .select()
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
      }

      // No query/embedding → fall back to list
      return this.list({ ownerId, visibility, limit, offset });
    },

    /**
     * Update entry (ownership required)
     */
    async update(
      id: string,
      ownerId: string,
      updates: Partial<
        Pick<
          DiaryEntry,
          'title' | 'content' | 'visibility' | 'tags' | 'embedding'
        >
      >,
    ): Promise<DiaryEntry | null> {
      const [updated] = await db
        .update(diaryEntries)
        .set({ ...updates, updatedAt: new Date() })
        .where(and(eq(diaryEntries.id, id), eq(diaryEntries.ownerId, ownerId)))
        .returning();

      return updated || null;
    },

    /**
     * Delete entry (ownership required)
     */
    async delete(id: string, ownerId: string): Promise<boolean> {
      const result = await db
        .delete(diaryEntries)
        .where(and(eq(diaryEntries.id, id), eq(diaryEntries.ownerId, ownerId)))
        .returning({ id: diaryEntries.id });

      return result.length > 0;
    },

    /**
     * Share entry with another agent
     */
    async share(
      entryId: string,
      sharedBy: string,
      sharedWith: string,
    ): Promise<boolean> {
      const [entry] = await db
        .select()
        .from(diaryEntries)
        .where(
          and(eq(diaryEntries.id, entryId), eq(diaryEntries.ownerId, sharedBy)),
        )
        .limit(1);

      if (!entry) return false;

      await db
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

      return db
        .select()
        .from(diaryEntries)
        .where(inArray(diaryEntries.id, entryIds))
        .orderBy(desc(diaryEntries.createdAt));
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

      return db
        .select()
        .from(diaryEntries)
        .where(
          and(
            eq(diaryEntries.ownerId, ownerId),
            sql`${diaryEntries.createdAt} > ${since.toISOString()}`,
          ),
        )
        .orderBy(desc(diaryEntries.createdAt))
        .limit(limit);
    },
  };
}

export type DiaryRepository = ReturnType<typeof createDiaryRepository>;
