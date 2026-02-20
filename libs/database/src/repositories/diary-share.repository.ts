/**
 * Diary Share Repository
 *
 * Manages diary-level sharing and invitation lifecycle.
 */

import { and, eq } from 'drizzle-orm';

import type { Database } from '../db.js';
import { type DiaryShare, diaryShares } from '../schema.js';
import { getExecutor } from '../transaction-context.js';

export function createDiaryShareRepository(db: Database) {
  return {
    async create(input: {
      diaryId: string;
      sharedWith: string;
      role: 'reader' | 'writer';
    }): Promise<DiaryShare> {
      const [created] = await getExecutor(db)
        .insert(diaryShares)
        .values({
          diaryId: input.diaryId,
          sharedWith: input.sharedWith,
          role: input.role,
          status: 'pending',
        })
        .returning();
      return created;
    },

    async findById(id: string): Promise<DiaryShare | null> {
      const [row] = await db
        .select()
        .from(diaryShares)
        .where(eq(diaryShares.id, id))
        .limit(1);
      return row ?? null;
    },

    async findByDiaryAndAgent(
      diaryId: string,
      sharedWith: string,
    ): Promise<DiaryShare | null> {
      const [row] = await db
        .select()
        .from(diaryShares)
        .where(
          and(
            eq(diaryShares.diaryId, diaryId),
            eq(diaryShares.sharedWith, sharedWith),
          ),
        )
        .limit(1);
      return row ?? null;
    },

    async listPendingForAgent(agentId: string): Promise<DiaryShare[]> {
      return db
        .select()
        .from(diaryShares)
        .where(
          and(
            eq(diaryShares.sharedWith, agentId),
            eq(diaryShares.status, 'pending'),
          ),
        );
    },

    async listByDiary(diaryId: string): Promise<DiaryShare[]> {
      return db
        .select()
        .from(diaryShares)
        .where(eq(diaryShares.diaryId, diaryId));
    },

    async updateStatus(
      id: string,
      status: 'pending' | 'accepted' | 'declined' | 'revoked',
      updates?: {
        respondedAt?: Date | null;
        role?: 'reader' | 'writer';
      },
    ): Promise<DiaryShare | null> {
      const set: Record<string, unknown> = { status };
      if (updates && 'respondedAt' in updates) {
        set.respondedAt = updates.respondedAt;
      } else {
        set.respondedAt = new Date();
      }
      if (updates?.role) {
        set.role = updates.role;
      }
      const [updated] = await getExecutor(db)
        .update(diaryShares)
        .set(set)
        .where(eq(diaryShares.id, id))
        .returning();
      return updated ?? null;
    },
  };
}

export type DiaryShareRepository = ReturnType<
  typeof createDiaryShareRepository
>;
