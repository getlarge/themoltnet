import { eq } from 'drizzle-orm';

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
