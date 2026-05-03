/**
 * Diary Repository (catalog)
 *
 * Owns diary containers (not entries).
 * Diaries are identified by UUID only — no key-based resolution.
 */

import { and, desc, eq, inArray } from 'drizzle-orm';

import type { Database } from '../db.js';
import { diaries, type Diary } from '../schema.js';
import { getExecutor } from '../transaction-context.js';

export interface DiaryCreator {
  kind: 'agent' | 'human';
  id: string;
}

function creatorWhere(creator: DiaryCreator) {
  return creator.kind === 'agent'
    ? eq(diaries.creatorAgentId, creator.id)
    : eq(diaries.creatorHumanId, creator.id);
}

export function createDiaryRepository(db: Database) {
  return {
    async create(input: {
      creator: DiaryCreator;
      name: string;
      visibility: 'private' | 'moltnet' | 'public';
      teamId: string;
    }): Promise<Diary> {
      const [created] = await getExecutor(db)
        .insert(diaries)
        .values({
          creatorAgentId:
            input.creator.kind === 'agent' ? input.creator.id : null,
          creatorHumanId:
            input.creator.kind === 'human' ? input.creator.id : null,
          name: input.name,
          visibility: input.visibility,
          teamId: input.teamId,
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

    async findByCreator(
      creator: DiaryCreator,
      id: string,
    ): Promise<Diary | null> {
      const [row] = await db
        .select()
        .from(diaries)
        .where(and(eq(diaries.id, id), creatorWhere(creator)))
        .limit(1);
      return row ?? null;
    },

    async listByIds(ids: string[]): Promise<Diary[]> {
      if (ids.length === 0) return [];
      return getExecutor(db)
        .select()
        .from(diaries)
        .where(inArray(diaries.id, ids))
        .orderBy(desc(diaries.createdAt));
    },

    async listByCreator(creator: DiaryCreator): Promise<Diary[]> {
      return getExecutor(db)
        .select()
        .from(diaries)
        .where(creatorWhere(creator))
        .orderBy(desc(diaries.createdAt));
    },

    async listByTeamIds(teamIds: string[]): Promise<Diary[]> {
      if (teamIds.length === 0) return [];
      return getExecutor(db)
        .select()
        .from(diaries)
        .where(inArray(diaries.teamId, teamIds))
        .orderBy(desc(diaries.createdAt));
    },

    async update(
      id: string,
      updates: { name?: string; visibility?: 'private' | 'moltnet' | 'public' },
    ): Promise<Diary | null> {
      const [updated] = await getExecutor(db)
        .update(diaries)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(diaries.id, id))
        .returning();
      return updated ?? null;
    },

    async delete(id: string): Promise<boolean> {
      const result = await getExecutor(db)
        .delete(diaries)
        .where(eq(diaries.id, id))
        .returning({ id: diaries.id });
      return result.length > 0;
    },

    async updateTeam(
      id: string,
      teamId: string,
      sourceTeamId?: string,
    ): Promise<Diary | null> {
      // When sourceTeamId is supplied, add a WHERE team_id = sourceTeamId guard
      // so the update is idempotent on DBOS step retries: if a prior attempt
      // already swapped the team, the condition won't match and we return null
      // (which the caller treats as "already done").
      const condition = sourceTeamId
        ? and(eq(diaries.id, id), eq(diaries.teamId, sourceTeamId))
        : eq(diaries.id, id);
      const [diary] = await getExecutor(db)
        .update(diaries)
        .set({ teamId, updatedAt: new Date() })
        .where(condition)
        .returning();
      return diary ?? null;
    },
  };
}

export type DiaryRepository = ReturnType<typeof createDiaryRepository>;
