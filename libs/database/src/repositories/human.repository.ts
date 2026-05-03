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

    /**
     * Look up a human by Kratos identityId; insert a fresh row if missing.
     * Used by REST handlers that resolve `creator: { kind: 'human', id }`
     * for resource creation — the FK target on resource tables is
     * `humans.id`, not `humans.identityId`, so the row must exist.
     *
     * Uses ON CONFLICT DO NOTHING + a follow-up SELECT for race safety:
     * if two requests arrive for the same identityId concurrently, both
     * the INSERT and the SELECT will resolve cleanly without throwing.
     */
    async findOrCreateByIdentityId(identityId: string): Promise<Human> {
      const existing = await this.findByIdentityId(identityId);
      if (existing) return existing;

      const [inserted] = await getExecutor(db)
        .insert(humans)
        .values({ identityId })
        .onConflictDoNothing({ target: humans.identityId })
        .returning();
      if (inserted) return inserted;

      // Lost the race — another caller inserted first. Re-read.
      const racedWinner = await this.findByIdentityId(identityId);
      if (!racedWinner) {
        throw new Error(
          `findOrCreateByIdentityId failed: insert was no-op but follow-up SELECT returned no row for ${identityId}`,
        );
      }
      return racedWinner;
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
