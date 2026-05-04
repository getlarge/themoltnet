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

    /**
     * Look up a human by Kratos identityId; insert a fresh row if missing.
     * Used by REST handlers that resolve `creator: { kind: 'human', id }`
     * for resource creation — the FK target on resource tables is
     * `humans.id`, not `humans.identityId`, so the row must exist.
     *
     * Uses ON CONFLICT DO NOTHING + a follow-up SELECT for race safety:
     * if two requests arrive for the same identityId concurrently, both
     * the INSERT and the SELECT will resolve cleanly without throwing.
     *
     * Refuses null/empty identityId — the underlying `eq(humans.identityId,
     * null)` would compile to `identity_id = NULL` (never matches) and a
     * subsequent insert would create a pre-onboarding row attached to no
     * Kratos identity. Callers MUST resolve identity before calling.
     */
    async findOrCreateByIdentityId(identityId: string): Promise<Human> {
      if (!identityId) {
        throw new Error(
          'findOrCreateByIdentityId: identityId is required (received null/empty); resolve identity before calling',
        );
      }
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
