import { eq, inArray } from 'drizzle-orm';

import type { Database } from '../db.js';
import { type Human, humans } from '../schema.js';
import { getExecutor } from '../transaction-context.js';

export function createHumanRepository(db: Database) {
  return {
    async create(): Promise<Human> {
      const [result] = await getExecutor(db)
        .insert(humans)
        .values({})
        .returning();
      return result;
    },

    async findById(id: string): Promise<Human | null> {
      const [row] = await getExecutor(db)
        .select()
        .from(humans)
        .where(eq(humans.id, id))
        .limit(1);
      return row ?? null;
    },

    /**
     * Batch lookup humans by `humans.id`. Returns a Map keyed by `id`.
     * Mirrors `agentRepository.findByIdentityIds` for the human side of
     * principal-row inflation.
     */
    async findByIds(ids: readonly string[]): Promise<Map<string, Human>> {
      const unique = Array.from(new Set(ids.filter(Boolean)));
      if (unique.length === 0) return new Map();
      const rows = await getExecutor(db)
        .select()
        .from(humans)
        .where(inArray(humans.id, unique));
      return new Map(rows.map((h) => [h.id, h]));
    },

    async findByIdentityId(identityId: string): Promise<Human | null> {
      const [row] = await getExecutor(db)
        .select()
        .from(humans)
        .where(eq(humans.identityId, identityId))
        .limit(1);
      return row ?? null;
    },

    async setIdentityId(id: string, identityId: string): Promise<Human | null> {
      const [updated] = await getExecutor(db)
        .update(humans)
        .set({ identityId, updatedAt: new Date() })
        .where(eq(humans.id, id))
        .returning();
      return updated ?? null;
    },

    async clearIdentityId(id: string): Promise<void> {
      await getExecutor(db)
        .update(humans)
        .set({ identityId: null, updatedAt: new Date() })
        .where(eq(humans.id, id));
    },
  };
}

export type HumanRepository = ReturnType<typeof createHumanRepository>;
