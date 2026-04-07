/**
 * DiaryTransfer Repository
 *
 * Tracks resource transfer requests between teams.
 */

import { and, eq } from 'drizzle-orm';

import type { Database } from '../db.js';
import { type DiaryTransfer, diaryTransfers } from '../schema.js';
import { getExecutor } from '../transaction-context.js';

export interface CreateDiaryTransferInput {
  diaryId: string;
  sourceTeamId: string;
  destinationTeamId: string;
  workflowId: string;
  initiatedBy: string;
  expiresAt: Date;
}

export interface DiaryTransferRepository {
  create(input: CreateDiaryTransferInput): Promise<DiaryTransfer>;
  findById(id: string): Promise<DiaryTransfer | null>;
  findByWorkflowId(workflowId: string): Promise<DiaryTransfer | null>;
  findPendingByDiary(diaryId: string): Promise<DiaryTransfer | null>;
  updateStatus(
    id: string,
    status: 'accepted' | 'rejected' | 'expired',
  ): Promise<DiaryTransfer | null>;
  listPendingByDestinationTeam(
    destinationTeamId: string,
  ): Promise<DiaryTransfer[]>;
}

export function createDiaryTransferRepository(
  db: Database,
): DiaryTransferRepository {
  return {
    async create(input) {
      const [row] = await getExecutor(db)
        .insert(diaryTransfers)
        .values({
          diaryId: input.diaryId,
          sourceTeamId: input.sourceTeamId,
          destinationTeamId: input.destinationTeamId,
          workflowId: input.workflowId,
          initiatedBy: input.initiatedBy,
          expiresAt: input.expiresAt,
        })
        .returning();
      if (!row) throw new Error('diaryTransfers insert returned no row');
      return row;
    },

    async findById(id) {
      const [row] = await db
        .select()
        .from(diaryTransfers)
        .where(eq(diaryTransfers.id, id))
        .limit(1);
      return row ?? null;
    },

    async findByWorkflowId(workflowId) {
      const [row] = await db
        .select()
        .from(diaryTransfers)
        .where(eq(diaryTransfers.workflowId, workflowId))
        .limit(1);
      return row ?? null;
    },

    async findPendingByDiary(diaryId) {
      const [row] = await db
        .select()
        .from(diaryTransfers)
        .where(
          and(
            eq(diaryTransfers.diaryId, diaryId),
            eq(diaryTransfers.status, 'pending'),
          ),
        )
        .limit(1);
      return row ?? null;
    },

    async updateStatus(id, status) {
      const now = new Date();
      const [row] = await getExecutor(db)
        .update(diaryTransfers)
        .set({ status, updatedAt: now, resolvedAt: now })
        .where(
          and(eq(diaryTransfers.id, id), eq(diaryTransfers.status, 'pending')),
        )
        .returning();
      return row ?? null;
    },

    async listPendingByDestinationTeam(destinationTeamId) {
      return db
        .select()
        .from(diaryTransfers)
        .where(
          and(
            eq(diaryTransfers.destinationTeamId, destinationTeamId),
            eq(diaryTransfers.status, 'pending'),
          ),
        );
    },
  };
}
