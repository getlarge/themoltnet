/**
 * Entry Relation Repository
 *
 * CRUD and traversal primitives for associative entry graph edges.
 */

import { and, count, desc, eq, inArray, or } from 'drizzle-orm';

import type { Database } from '../db.js';
import {
  type EntryRelation,
  entryRelations,
  type NewEntryRelation,
} from '../schema.js';
import { getExecutor } from '../transaction-context.js';

export function createEntryRelationRepository(db: Database) {
  function relationKey(
    input: Pick<EntryRelation, 'sourceId' | 'targetId' | 'relation'>,
  ) {
    return `${input.sourceId}:${input.targetId}:${input.relation}`;
  }

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

      const insertedKeys = new Set(inserted.map((row) => relationKey(row)));
      const missingInputs = inputs.filter(
        (input) => !insertedKeys.has(relationKey(input)),
      );

      // Consolidation currently produces small batches, so a single OR query
      // is cheaper than N follow-up selects. This keeps the same race window
      // as createOne: if a conflicting row is deleted after the insert and
      // before this read, we still fail loudly instead of silently masking it.
      const existing =
        missingInputs.length === 0
          ? []
          : await getExecutor(db)
              .select()
              .from(entryRelations)
              .where(
                or(
                  ...missingInputs.map((input) =>
                    and(
                      eq(entryRelations.sourceId, input.sourceId),
                      eq(entryRelations.targetId, input.targetId),
                      eq(entryRelations.relation, input.relation),
                    ),
                  ),
                ),
              );

      const byKey = new Map<string, EntryRelation>();
      for (const row of inserted) {
        byKey.set(relationKey(row), row);
      }
      for (const row of existing) {
        byKey.set(relationKey(row), row);
      }

      return inputs.map((input) => {
        const row = byKey.get(relationKey(input));
        if (!row) {
          throw new Error('entry relation bulk upsert failed unexpectedly');
        }
        return row;
      });
    },

    async findById(id: string): Promise<EntryRelation | null> {
      const [row] = await getExecutor(db)
        .select()
        .from(entryRelations)
        .where(eq(entryRelations.id, id))
        .limit(1);
      return row ?? null;
    },

    async listByEntry(
      entryId: string,
      options?: {
        relation?: EntryRelation['relation'];
        status?: EntryRelation['status'];
        limit?: number;
        offset?: number;
        direction?: 'as_source' | 'as_target' | 'both';
      },
    ): Promise<{ items: EntryRelation[]; total: number }> {
      const {
        relation,
        status,
        limit = 100,
        offset = 0,
        direction = 'both',
      } = options ?? {};

      const directionCondition =
        direction === 'as_source'
          ? eq(entryRelations.sourceId, entryId)
          : direction === 'as_target'
            ? eq(entryRelations.targetId, entryId)
            : or(
                eq(entryRelations.sourceId, entryId),
                eq(entryRelations.targetId, entryId),
              );

      const conditions = [directionCondition];

      if (relation) {
        conditions.push(eq(entryRelations.relation, relation));
      }

      if (status) {
        conditions.push(eq(entryRelations.status, status));
      }

      const where = and(...conditions);

      const [items, [{ value: total }]] = await Promise.all([
        getExecutor(db)
          .select()
          .from(entryRelations)
          .where(where)
          .orderBy(desc(entryRelations.createdAt))
          .limit(limit)
          .offset(offset),
        getExecutor(db)
          .select({ value: count() })
          .from(entryRelations)
          .where(where),
      ]);

      return { items, total };
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

    async listSupersededTargetIds(entryIds: string[]): Promise<string[]> {
      if (entryIds.length === 0) return [];
      const rows = await getExecutor(db)
        .select({ targetId: entryRelations.targetId })
        .from(entryRelations)
        .where(
          and(
            inArray(entryRelations.targetId, entryIds),
            eq(entryRelations.relation, 'supersedes'),
            eq(entryRelations.status, 'accepted'),
          ),
        );
      return [...new Set(rows.map((r) => r.targetId))];
    },
  };
}

export type EntryRelationRepository = ReturnType<
  typeof createEntryRelationRepository
>;
