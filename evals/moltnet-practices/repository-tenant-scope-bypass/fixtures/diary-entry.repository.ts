import { and, desc, eq, inArray } from 'drizzle-orm';

import type { Database } from '../database.js';
import { getExecutor } from '../database.js';
import type { DiaryEntry, NewDiaryEntry } from '../schema.js';
import { diaryEntries } from '../schema.js';

export interface ListEntriesOptions {
  diaryId?: string;
  ids?: string[];
  tags?: string[];
  limit?: number;
  offset?: number;
}

export function createDiaryEntryRepository(db: Database) {
  return {
    async create(entry: NewDiaryEntry): Promise<DiaryEntry> {
      const [created] = await getExecutor(db)
        .insert(diaryEntries)
        .values(entry)
        .returning();
      return created;
    },

    async findById(id: string): Promise<DiaryEntry | null> {
      const [entry] = await db
        .select()
        .from(diaryEntries)
        .where(eq(diaryEntries.id, id))
        .limit(1);
      return entry ?? null;
    },

    /**
     * List entries with optional filters. Supports filtering by diary,
     * specific IDs, or tags. Results are ordered by creation date descending.
     */
    async list(options: ListEntriesOptions = {}): Promise<DiaryEntry[]> {
      const { diaryId, ids, tags, limit = 50, offset = 0 } = options;

      if (ids?.length) {
        // Fast path: fetch specific entries by UUID
        const conditions = [inArray(diaryEntries.id, ids)];
        if (tags?.length) {
          conditions.push(inArray(diaryEntries.tags, tags));
        }
        return db
          .select()
          .from(diaryEntries)
          .where(and(...conditions))
          .orderBy(desc(diaryEntries.createdAt))
          .limit(limit)
          .offset(offset);
      } else if (diaryId) {
        const conditions = [eq(diaryEntries.diaryId, diaryId)];
        if (tags?.length) {
          conditions.push(inArray(diaryEntries.tags, tags));
        }
        return db
          .select()
          .from(diaryEntries)
          .where(and(...conditions))
          .orderBy(desc(diaryEntries.createdAt))
          .limit(limit)
          .offset(offset);
      }

      return db
        .select()
        .from(diaryEntries)
        .orderBy(desc(diaryEntries.createdAt))
        .limit(limit)
        .offset(offset);
    },

    async count(diaryId: string): Promise<number> {
      const [result] = await db
        .select({ count: diaryEntries.id })
        .from(diaryEntries)
        .where(eq(diaryEntries.diaryId, diaryId));
      return Number(result?.count ?? 0);
    },

    async delete(id: string): Promise<void> {
      await getExecutor(db).delete(diaryEntries).where(eq(diaryEntries.id, id));
    },
  };
}

export type DiaryEntryRepository = ReturnType<
  typeof createDiaryEntryRepository
>;
