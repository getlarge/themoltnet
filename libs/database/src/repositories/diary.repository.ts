/**
 * Diary Repository (catalog)
 *
 * Owns diary containers (not entries).
 * Diaries are identified by UUID only — no key-based resolution.
 */

import { and, desc, eq } from 'drizzle-orm';

import type { Database } from '../db.js';
import { diaries, type Diary } from '../schema.js';
import { getExecutor } from '../transaction-context.js';

export function createDiaryRepository(db: Database) {
  return {
    async create(input: {
      ownerId: string;
      name: string;
      visibility: 'private' | 'moltnet' | 'public';
    }): Promise<Diary> {
      const [created] = await getExecutor(db)
        .insert(diaries)
        .values({
          ownerId: input.ownerId,
          name: input.name,
          visibility: input.visibility,
        })
        .returning();
      return created;
    },

    async findById(id: string): Promise<Diary | null> {
      const [row] = await db
        .select()
        .from(diaries)
        .where(eq(diaries.id, id))
        .limit(1);
      return row ?? null;
    },

    async findOwnedById(ownerId: string, id: string): Promise<Diary | null> {
      const [row] = await db
        .select()
        .from(diaries)
        .where(and(eq(diaries.id, id), eq(diaries.ownerId, ownerId)))
        .limit(1);
      return row ?? null;
    },

    async listByOwner(ownerId: string): Promise<Diary[]> {
      return getExecutor(db)
        .select()
        .from(diaries)
        .where(eq(diaries.ownerId, ownerId))
        .orderBy(desc(diaries.createdAt));
    },

    async update(
      id: string,
      ownerId: string,
      updates: { name?: string; visibility?: 'private' | 'moltnet' | 'public' },
    ): Promise<Diary | null> {
      const [updated] = await getExecutor(db)
        .update(diaries)
        .set({ ...updates, updatedAt: new Date() })
        .where(and(eq(diaries.id, id), eq(diaries.ownerId, ownerId)))
        .returning();
      return updated ?? null;
    },

    async delete(id: string, ownerId: string): Promise<boolean> {
      const result = await getExecutor(db)
        .delete(diaries)
        .where(and(eq(diaries.id, id), eq(diaries.ownerId, ownerId)))
        .returning({ id: diaries.id });
      return result.length > 0;
    },
  };
}

export type DiaryRepository = ReturnType<typeof createDiaryRepository>;
