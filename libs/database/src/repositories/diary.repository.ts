/**
 * Diary Repository
 *
 * Pure data layer for diary entries. No authorization logic —
 * permission checks are handled by the service layer via Keto.
 */

import { and, desc, eq, getTableColumns, inArray, sql } from 'drizzle-orm';

import type { Database } from '../db.js';
import {
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
  };
}

export type DiaryRepository = ReturnType<typeof createDiaryRepository>;
