/**
 * Diary Repository (catalog)
 *
 * Owns diary containers (not entries).
 */

import { and, desc, eq } from 'drizzle-orm';

import type { Database } from '../db.js';
import { diaries, type Diary } from '../schema.js';
import { getExecutor } from '../transaction-context.js';

export function createDiaryRepository(db: Database) {
  return {
    async create(input: {
      ownerId: string;
      key: string;
      name?: string;
      visibility: 'private' | 'moltnet' | 'public';
    }): Promise<Diary> {
      const [created] = await getExecutor(db)
        .insert(diaries)
        .values({
          ownerId: input.ownerId,
          key: input.key,
          name: input.name ?? input.key,
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

    async findOwnedByKey(ownerId: string, key: string): Promise<Diary | null> {
      const [row] = await db
        .select()
        .from(diaries)
        .where(and(eq(diaries.key, key), eq(diaries.ownerId, ownerId)))
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

    async getOrCreateDefaultDiary(
      ownerId: string,
      visibility: 'private' | 'moltnet' | 'public',
    ): Promise<Diary> {
      const key = visibility;
      const existing = await this.findOwnedByKey(ownerId, key);
      if (existing) return existing;

      try {
        return await this.create({
          ownerId,
          key,
          name: visibility,
          visibility,
        });
      } catch {
        const raced = await this.findOwnedByKey(ownerId, key);
        if (!raced) throw new Error('Failed to resolve default diary');
        return raced;
      }
    },
  };
}

export type DiaryRepository = ReturnType<typeof createDiaryRepository>;
