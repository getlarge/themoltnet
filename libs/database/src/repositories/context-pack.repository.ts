/**
 * Context Pack Repository
 *
 * Persistence primitives for compiled context packs and pack membership.
 */

import { and, asc, desc, eq, inArray, lte } from 'drizzle-orm';

import type { Database } from '../db.js';
import {
  type ContextPack,
  contextPackEntries,
  type ContextPackEntry,
  contextPacks,
  type NewContextPack,
  type NewContextPackEntry,
} from '../schema.js';
import { getExecutor } from '../transaction-context.js';

export function createContextPackRepository(db: Database) {
  return {
    async createPack(input: NewContextPack): Promise<ContextPack> {
      const [row] = await getExecutor(db)
        .insert(contextPacks)
        .values(input)
        .returning();

      return row;
    },

    async addEntries(
      entries: NewContextPackEntry[],
    ): Promise<ContextPackEntry[]> {
      if (entries.length === 0) return [];

      return getExecutor(db)
        .insert(contextPackEntries)
        .values(entries)
        .onConflictDoNothing({
          target: [contextPackEntries.packId, contextPackEntries.entryId],
        })
        .returning();
    },

    async findById(id: string): Promise<ContextPack | null> {
      const [row] = await getExecutor(db)
        .select()
        .from(contextPacks)
        .where(eq(contextPacks.id, id))
        .limit(1);

      return row ?? null;
    },

    async findByCid(packCid: string): Promise<ContextPack | null> {
      const [row] = await getExecutor(db)
        .select()
        .from(contextPacks)
        .where(eq(contextPacks.packCid, packCid))
        .limit(1);

      return row ?? null;
    },

    async listEntries(packId: string): Promise<ContextPackEntry[]> {
      return getExecutor(db)
        .select()
        .from(contextPackEntries)
        .where(eq(contextPackEntries.packId, packId))
        .orderBy(asc(contextPackEntries.rank));
    },

    async listExpiredUnpinned(
      now = new Date(),
      limit = 100,
    ): Promise<ContextPack[]> {
      return getExecutor(db)
        .select()
        .from(contextPacks)
        .where(
          and(eq(contextPacks.pinned, false), lte(contextPacks.expiresAt, now)),
        )
        .orderBy(asc(contextPacks.expiresAt))
        .limit(limit);
    },

    async pin(id: string): Promise<ContextPack | null> {
      const [row] = await getExecutor(db)
        .update(contextPacks)
        .set({ pinned: true, expiresAt: null })
        .where(eq(contextPacks.id, id))
        .returning();

      return row ?? null;
    },

    async unpin(id: string, expiresAt: Date): Promise<ContextPack | null> {
      const [row] = await getExecutor(db)
        .update(contextPacks)
        .set({ pinned: false, expiresAt })
        .where(eq(contextPacks.id, id))
        .returning();

      return row ?? null;
    },

    async deleteMany(ids: string[]): Promise<number> {
      if (ids.length === 0) return 0;

      const rows = await getExecutor(db)
        .delete(contextPacks)
        .where(inArray(contextPacks.id, ids))
        .returning({ id: contextPacks.id });

      return rows.length;
    },

    async listByDiary(diaryId: string, limit = 50): Promise<ContextPack[]> {
      return getExecutor(db)
        .select()
        .from(contextPacks)
        .where(eq(contextPacks.diaryId, diaryId))
        .orderBy(desc(contextPacks.createdAt))
        .limit(limit);
    },
  };
}

export type ContextPackRepository = ReturnType<
  typeof createContextPackRepository
>;
