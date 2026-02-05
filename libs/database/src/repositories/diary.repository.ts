/**
 * Diary Repository
 *
 * Pure data layer for diary entries. No authorization logic —
 * permission checks are handled by the service layer via Keto.
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
     * Run a callback inside a database transaction.
     * If the callback throws, the transaction is rolled back.
     */
    async transaction<T>(fn: (tx: Database) => Promise<T>): Promise<T> {
      // PgTransaction extends the same query API as PgDatabase, so the
      // cast is safe — callers only use insert/update/delete/select.
      return db.transaction((tx) => fn(tx as unknown as Database));
    },

    /**
     * Create a new diary entry
     */
    async create(entry: NewDiaryEntry, tx?: Database): Promise<DiaryEntry> {
      const executor = tx ?? db;
      const [created] = await executor
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
        .select()
        .from(diaryEntries)
        .where(eq(diaryEntries.id, id))
        .limit(1);

      return entry ?? null;
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
      tx?: Database,
    ): Promise<DiaryEntry | null> {
      const executor = tx ?? db;
      const [updated] = await executor
        .update(diaryEntries)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(diaryEntries.id, id))
        .returning();

      return updated || null;
    },

    /**
     * Delete entry by ID (no ownership check — service layer checks Keto)
     */
    async delete(id: string, tx?: Database): Promise<boolean> {
      const executor = tx ?? db;
      const result = await executor
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
      tx?: Database,
    ): Promise<boolean> {
      const executor = tx ?? db;
      await executor
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
