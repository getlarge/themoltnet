/**
 * Entry Relation Repository
 *
 * CRUD and traversal primitives for associative entry graph edges.
 */

import { and, desc, eq, or } from 'drizzle-orm';

import type { Database } from '../db.js';
import {
  type EntryRelation,
  entryRelations,
  type NewEntryRelation,
} from '../schema.js';
import { getExecutor } from '../transaction-context.js';

export function createEntryRelationRepository(db: Database) {
  async function createOne(input: NewEntryRelation): Promise<EntryRelation> {
    const [row] = await getExecutor(db)
      .insert(entryRelations)
      .values(input)
      .onConflictDoNothing({
        target: [
          entryRelations.sourceId,
          entryRelations.targetId,
          entryRelations.relation,
        ],
      })
      .returning();

    if (row) return row;

    const [existing] = await getExecutor(db)
      .select()
      .from(entryRelations)
      .where(
        and(
          eq(entryRelations.sourceId, input.sourceId),
          eq(entryRelations.targetId, input.targetId),
          eq(entryRelations.relation, input.relation),
        ),
      )
      .limit(1);

    if (!existing) {
      throw new Error('entry relation upsert failed unexpectedly');
    }

    return existing;
  }

  return {
    async create(input: NewEntryRelation): Promise<EntryRelation> {
      return createOne(input);
    },

    async createMany(inputs: NewEntryRelation[]): Promise<EntryRelation[]> {
      if (inputs.length === 0) return [];

      const inserted = await getExecutor(db)
        .insert(entryRelations)
        .values(inputs)
        .onConflictDoNothing({
          target: [
            entryRelations.sourceId,
            entryRelations.targetId,
            entryRelations.relation,
          ],
        })
        .returning();

      if (inserted.length === inputs.length) {
        return inserted;
      }

      const existing = await Promise.all(
        inputs.map((input) => createOne(input)),
      );
      return existing;
    },

    async listByEntry(
      entryId: string,
      options?: {
        relation?: EntryRelation['relation'];
        status?: EntryRelation['status'];
        limit?: number;
      },
    ): Promise<EntryRelation[]> {
      const { relation, status, limit = 100 } = options ?? {};

      const conditions = [
        or(
          eq(entryRelations.sourceId, entryId),
          eq(entryRelations.targetId, entryId),
        ),
      ];

      if (relation) {
        conditions.push(eq(entryRelations.relation, relation));
      }

      if (status) {
        conditions.push(eq(entryRelations.status, status));
      }

      return getExecutor(db)
        .select()
        .from(entryRelations)
        .where(and(...conditions))
        .orderBy(desc(entryRelations.createdAt))
        .limit(limit);
    },

    async updateStatus(
      id: string,
      status: EntryRelation['status'],
    ): Promise<EntryRelation | null> {
      const [row] = await getExecutor(db)
        .update(entryRelations)
        .set({ status, updatedAt: new Date() })
        .where(eq(entryRelations.id, id))
        .returning();

      return row ?? null;
    },

    async delete(id: string): Promise<boolean> {
      const rows = await getExecutor(db)
        .delete(entryRelations)
        .where(eq(entryRelations.id, id))
        .returning({ id: entryRelations.id });

      return rows.length > 0;
    },
  };
}

export type EntryRelationRepository = ReturnType<
  typeof createEntryRelationRepository
>;
