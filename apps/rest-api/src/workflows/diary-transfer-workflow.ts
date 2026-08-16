/**
 * Diary Transfer Workflow
 *
 * DBOS workflow for transferring a diary between teams with destination consent.
 *
 * Steps:
 * 1. Mark transfer record as pending in DB (already created by route before workflow)
 * 2. Wait for accept/reject event — 7-day timeout
 * 3a. On accept: update diary.teamId + swap Keto Diary#team tuple
 * 3b. On reject/timeout: mark transfer expired/rejected (no DB changes to diary)
 */

import { type RelationshipWriter } from '@moltnet/auth';
import {
  DBOS,
  type DiaryRepository,
  type DiaryTransferRepository,
  type TransactionRunner,
} from '@moltnet/database';

import type { Logger } from './logger.js';

// ── Constants ─────────────────────────────────────────────────

export const TRANSFER_DECISION_EVENT = 'diary.transfer.decision';
const TRANSFER_TIMEOUT_S = 7 * 24 * 3600; // 7 days

// ── Types ──────────────────────────────────────────────────────

export type TransferDecision = 'accepted' | 'rejected';

export interface DiaryTransferDeps {
  diaryRepository: DiaryRepository;
  diaryTransferRepository: DiaryTransferRepository;
  transactionRunner: TransactionRunner;
  relationshipWriter: RelationshipWriter;
  logger: Logger;
}

export interface DiaryTransferResult {
  transferId: string;
  status: 'accepted' | 'rejected' | 'expired';
}

// ── Dependency Injection ───────────────────────────────────────

let deps: DiaryTransferDeps | null = null;

export function setDiaryTransferDeps(d: DiaryTransferDeps): void {
  deps = d;
}

function getDeps(): DiaryTransferDeps {
  if (!deps) {
    throw new Error(
      'Diary transfer deps not set. Call setDiaryTransferDeps() before using.',
    );
  }
  return deps;
}

// ── Lazy Registration ──────────────────────────────────────────

type TransferDiaryFn = (
  transferId: string,
  diaryId: string,
  sourceTeamId: string,
  destinationTeamId: string,
) => Promise<DiaryTransferResult>;

let _workflow: TransferDiaryFn | null = null;

export function initDiaryTransferWorkflow(): void {
  if (_workflow) return;

  // ── Steps ──────────────────────────────────────────────────

  const removeDiaryTeamStep = DBOS.registerStep(
    async (diaryId: string): Promise<void> => {
      await getDeps().relationshipWriter.removeDiaryTeam(diaryId);
    },
    {
      name: 'diary.transfer.step.removeOldTeam',
      retriesAllowed: true,
      maxAttempts: 5,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );

  const grantDiaryTeamStep = DBOS.registerStep(
    async (diaryId: string, destinationTeamId: string): Promise<void> => {
      await getDeps().relationshipWriter.grantDiaryTeam(
        diaryId,
        destinationTeamId,
      );
    },
    {
      name: 'diary.transfer.step.grantNewTeam',
      retriesAllowed: true,
      maxAttempts: 5,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );

  // ── Workflow ─────────────────────────────────────────────────

  _workflow = DBOS.registerWorkflow(
    async (
      transferId: string,
      diaryId: string,
      sourceTeamId: string,
      destinationTeamId: string,
    ): Promise<DiaryTransferResult> => {
      // Wait for destination owner decision — 7-day timeout
      const decision = await DBOS.recv<TransferDecision>(
        TRANSFER_DECISION_EVENT,
        TRANSFER_TIMEOUT_S,
      );

      if (!decision) {
        // Timeout
        const { logger } = getDeps();
        logger.warn(
          { transferId, diaryId },
          'diary.transfer.timeout — expiring transfer',
        );
        await getDeps().transactionRunner.runInTransaction(
          async () => {
            await getDeps().diaryTransferRepository.updateStatus(
              transferId,
              'expired',
            );
          },
          { name: 'diary.transfer.tx.expire' },
        );
        return { transferId, status: 'expired' };
      }

      if (decision === 'rejected') {
        await getDeps().transactionRunner.runInTransaction(
          async () => {
            await getDeps().diaryTransferRepository.updateStatus(
              transferId,
              'rejected',
            );
          },
          { name: 'diary.transfer.tx.reject' },
        );
        return { transferId, status: 'rejected' };
      }

      // Commit the diary CAS and transfer resolution together. A replayed CAS
      // is accepted only when the diary is already at this destination.
      await getDeps().transactionRunner.runInTransaction(
        async () => {
          const { diaryRepository, diaryTransferRepository } = getDeps();
          const updatedDiary = await diaryRepository.updateTeam(
            diaryId,
            destinationTeamId,
            sourceTeamId,
          );
          if (!updatedDiary) {
            const currentDiary = await diaryRepository.findById(diaryId);
            if (currentDiary?.teamId !== destinationTeamId) {
              throw new Error(
                `Diary ${diaryId} is no longer owned by source team ${sourceTeamId}`,
              );
            }
          }

          const resolved = await diaryTransferRepository.updateStatus(
            transferId,
            'accepted',
          );
          if (!resolved) {
            const currentTransfer =
              await diaryTransferRepository.findById(transferId);
            if (currentTransfer?.status !== 'accepted') {
              throw new Error(
                `Diary transfer ${transferId} is no longer pending`,
              );
            }
          }
        },
        { name: 'diary.transfer.tx.accept' },
      );

      // Keto is external to Postgres. Reconcile it durably and idempotently
      // after the database state is committed.
      await removeDiaryTeamStep(diaryId);
      await grantDiaryTeamStep(diaryId, destinationTeamId);
      return { transferId, status: 'accepted' };
    },
    { name: 'diary.transfer.transferDiary' },
  );
}

// ── Exported Collection ────────────────────────────────────────

export const diaryTransferWorkflow = {
  get transferDiary() {
    if (!_workflow) {
      throw new Error(
        'Diary transfer workflow not initialized. Call initDiaryTransferWorkflow().',
      );
    }
    return _workflow;
  },
};
