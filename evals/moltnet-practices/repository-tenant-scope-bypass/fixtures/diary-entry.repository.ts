import { Database, getExecutor } from '../database.js';
import { diaryEntries, DiaryEntry, NewDiaryEntry } from '../schema.js';
import { eq, inArray, and, desc } from 'drizzle-orm';

export interface ListEntriesOptions {
  diaryId?: string;
  ids?: string[];
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

    async list(options: ListEntriesOptions = {}): Promise<DiaryEntry[]> {
      const { diaryId, ids, limit = 50, offset = 0 } = options;

      if (ids?.length) {
        // Fetch specific entries by ID
        return db
          .select()
          .from(diaryEntries)
          .where(inArray(diaryEntries.id, ids))
          .orderBy(desc(diaryEntries.createdAt))
          .limit(limit)
          .offset(offset);
      } else if (diaryId) {
        // Fetch entries scoped to a diary
        return db
          .select()
          .from(diaryEntries)
          .where(eq(diaryEntries.diaryId, diaryId))
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

    async delete(id: string): Promise<void> {
      await getExecutor(db)
        .delete(diaryEntries)
        .where(eq(diaryEntries.id, id));
    },
  };
}

export type DiaryEntryRepository = ReturnType<typeof createDiaryEntryRepository>;
