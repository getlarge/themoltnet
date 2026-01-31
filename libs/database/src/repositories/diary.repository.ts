/**
 * Diary Repository
 *
 * Database operations for diary entries
 */

import { eq, and, or, desc, sql, inArray } from 'drizzle-orm';
import {
  diaryEntries,
  entryShares,
  type DiaryEntry,
  type NewDiaryEntry,
} from '../schema.js';
import type { Database } from '../db.js';

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
     * Hybrid search: combines vector similarity and full-text search
     */
    async search(options: DiarySearchOptions): Promise<DiaryEntry[]> {
      const { ownerId, query, embedding, limit = 10 } = options;

      if (embedding && embedding.length === 384) {
        const vectorString = `[${embedding.join(',')}]`;

        if (query) {
          return db
            .select()
            .from(diaryEntries)
            .where(
              and(
                eq(diaryEntries.ownerId, ownerId),
                or(
                  sql`${diaryEntries.embedding} <-> ${vectorString}::vector < 0.5`,
                  sql`to_tsvector('english', ${diaryEntries.content}) @@ plainto_tsquery('english', ${query})`,
                ),
              ),
            )
            .orderBy(sql`${diaryEntries.embedding} <-> ${vectorString}::vector`)
            .limit(limit);
        }

        return db
          .select()
          .from(diaryEntries)
          .where(eq(diaryEntries.ownerId, ownerId))
          .orderBy(sql`${diaryEntries.embedding} <-> ${vectorString}::vector`)
          .limit(limit);
      }

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
          .limit(limit);
      }

      return this.list({ ownerId, limit });
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
