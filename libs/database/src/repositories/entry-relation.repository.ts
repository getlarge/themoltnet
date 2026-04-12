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

export interface RelationAtDepth extends EntryRelation {
  depth: number;
  parentRelationId: string | null;
}

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

      const whereClause = and(...conditions);

      const [items, countResult] = await Promise.all([
        getExecutor(db)
          .select()
          .from(entryRelations)
          .where(whereClause)
          .orderBy(desc(entryRelations.createdAt))
          .limit(limit)
          .offset(offset),
        getExecutor(db)
          .select({ count: count() })
          .from(entryRelations)
          .where(whereClause),
      ]);

      return {
        items,
        total: countResult[0]?.count ?? 0,
      };
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

    /**
     * BFS traversal from a starting entry, returning relations annotated
     * with depth and parentRelationId for client-side tree reconstruction.
     *
     * Runs under READ COMMITTED (Postgres default), not REPEATABLE READ.
     * A relation created or deleted between depth-level queries could
     * produce a slightly inconsistent snapshot. Acceptable for a read-only
     * expansion endpoint — upgrading to REPEATABLE READ via
     * db.transaction({ isolationLevel: 'repeatable read' }) is a future
     * option if snapshot consistency becomes a requirement.
     */
    async traverseFromEntry(
      startId: string,
      options?: {
        depth?: number;
        status?: EntryRelation['status'];
      },
    ): Promise<RelationAtDepth[]> {
      const { depth: maxDepth = 1, status } = options ?? {};
      const clamped = Math.min(Math.max(maxDepth, 1), 3);

      const results: RelationAtDepth[] = [];
      const visited = new Set<string>([startId]);
      const seenRelations = new Set<string>();
      // Maps each entry to the relation that introduced it into the frontier
      const entryToParentRelation = new Map<string, string | null>();
      entryToParentRelation.set(startId, null);

      let frontier = [startId];

      for (let d = 1; d <= clamped && frontier.length > 0; d++) {
        const conditions = [
          or(
            inArray(entryRelations.sourceId, frontier),
            inArray(entryRelations.targetId, frontier),
          ),
        ];
        if (status) {
          conditions.push(eq(entryRelations.status, status));
        }

        const rows = await getExecutor(db)
          .select()
          .from(entryRelations)
          .where(and(...conditions));

        const nextFrontier: string[] = [];

        for (const row of rows) {
          if (seenRelations.has(row.id)) continue;
          seenRelations.add(row.id);

          const sourceInFrontier = frontier.includes(row.sourceId);
          const targetInFrontier = frontier.includes(row.targetId);

          // Determine which end(s) are the "known" side and which is "new"
          const knownEntryId = sourceInFrontier ? row.sourceId : row.targetId;
          const otherEntryId = sourceInFrontier ? row.targetId : row.sourceId;

          // Both ends already visited — cycle, record the edge but don't
          // expand further from it
          if (visited.has(otherEntryId) && visited.has(knownEntryId)) {
            results.push({
              ...row,
              depth: d,
              parentRelationId: entryToParentRelation.get(knownEntryId) ?? null,
            });
            continue;
          }

          // If both ends are in the frontier (same depth level), pick the
          // first as "known" — the other gets added for next-level expansion
          const parentRelationId =
            entryToParentRelation.get(knownEntryId) ?? null;

          results.push({ ...row, depth: d, parentRelationId });

          if (!visited.has(otherEntryId)) {
            visited.add(otherEntryId);
            nextFrontier.push(otherEntryId);
            entryToParentRelation.set(otherEntryId, row.id);
          }

          // If both ends were in frontier but only target was "other",
          // handle the reverse too
          if (
            sourceInFrontier &&
            targetInFrontier &&
            !visited.has(row.sourceId)
          ) {
            visited.add(row.sourceId);
            nextFrontier.push(row.sourceId);
            entryToParentRelation.set(row.sourceId, row.id);
          }
        }

        frontier = nextFrontier;
      }

      return results;
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
