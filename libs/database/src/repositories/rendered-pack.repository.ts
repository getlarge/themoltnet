/**
 * Rendered Pack Repository
 *
 * Persistence primitives for rendered packs. Append-only: re-rendering
 * creates a new row with a new CID. Uses the same pinned + expiresAt
 * GC pattern as context packs.
 */

import { and, asc, desc, eq, inArray, lte } from 'drizzle-orm';

import type { Database } from '../db.js';
import {
  type NewRenderedPack,
  type RenderedPack,
  renderedPacks,
} from '../schema.js';
import { getExecutor } from '../transaction-context.js';

export function createRenderedPackRepository(db: Database) {
  return {
    async create(input: NewRenderedPack): Promise<RenderedPack> {
      const [row] = await getExecutor(db)
        .insert(renderedPacks)
        .values(input)
        .returning();

      return row;
    },

    async findById(id: string): Promise<RenderedPack | null> {
      const [row] = await getExecutor(db)
        .select()
        .from(renderedPacks)
        .where(eq(renderedPacks.id, id))
        .limit(1);

      return row ?? null;
    },

    async findByCid(packCid: string): Promise<RenderedPack | null> {
      const [row] = await getExecutor(db)
        .select()
        .from(renderedPacks)
        .where(eq(renderedPacks.packCid, packCid))
        .limit(1);

      return row ?? null;
    },

    async findLatestBySourcePackId(
      sourcePackId: string,
    ): Promise<RenderedPack | null> {
      const [row] = await getExecutor(db)
        .select()
        .from(renderedPacks)
        .where(eq(renderedPacks.sourcePackId, sourcePackId))
        .orderBy(desc(renderedPacks.createdAt))
        .limit(1);

      return row ?? null;
    },

    async listBySourcePackId(
      sourcePackId: string,
      limit = 50,
    ): Promise<RenderedPack[]> {
      return getExecutor(db)
        .select()
        .from(renderedPacks)
        .where(eq(renderedPacks.sourcePackId, sourcePackId))
        .orderBy(desc(renderedPacks.createdAt))
        .limit(limit);
    },

    async listByDiary(diaryId: string, limit = 50): Promise<RenderedPack[]> {
      return getExecutor(db)
        .select()
        .from(renderedPacks)
        .where(eq(renderedPacks.diaryId, diaryId))
        .orderBy(desc(renderedPacks.createdAt))
        .limit(limit);
    },

    async listExpiredUnpinned(
      now = new Date(),
      limit = 100,
    ): Promise<RenderedPack[]> {
      return getExecutor(db)
        .select()
        .from(renderedPacks)
        .where(
          and(
            eq(renderedPacks.pinned, false),
            lte(renderedPacks.expiresAt, now),
          ),
        )
        .orderBy(asc(renderedPacks.expiresAt))
        .limit(limit);
    },

    async pin(id: string): Promise<RenderedPack | null> {
      const [row] = await getExecutor(db)
        .update(renderedPacks)
        .set({ pinned: true, expiresAt: null })
        .where(eq(renderedPacks.id, id))
        .returning();

      return row ?? null;
    },

    async unpin(id: string, expiresAt: Date): Promise<RenderedPack | null> {
      const [row] = await getExecutor(db)
        .update(renderedPacks)
        .set({ pinned: false, expiresAt })
        .where(eq(renderedPacks.id, id))
        .returning();

      return row ?? null;
    },

    async updateExpiry(
      id: string,
      expiresAt: Date,
    ): Promise<RenderedPack | null> {
      const [row] = await getExecutor(db)
        .update(renderedPacks)
        .set({ expiresAt })
        .where(eq(renderedPacks.id, id))
        .returning();

      return row ?? null;
    },

    async deleteById(id: string): Promise<boolean> {
      const rows = await getExecutor(db)
        .delete(renderedPacks)
        .where(eq(renderedPacks.id, id))
        .returning({ id: renderedPacks.id });

      return rows.length > 0;
    },

    async deleteMany(ids: string[]): Promise<number> {
      if (ids.length === 0) return 0;

      const rows = await getExecutor(db)
        .delete(renderedPacks)
        .where(inArray(renderedPacks.id, ids))
        .returning({ id: renderedPacks.id });

      return rows.length;
    },
  };
}

export type RenderedPackRepository = ReturnType<
  typeof createRenderedPackRepository
>;
