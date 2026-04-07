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

  const swapDiaryTeamStep = DBOS.registerStep(
    async (
      diaryId: string,
      sourceTeamId: string,
      destinationTeamId: string,
    ): Promise<void> => {
      const { diaryRepository, relationshipWriter, logger } = getDeps();
      // Update DB first — idempotent (same value on retry)
      await diaryRepository.updateTeam(diaryId, destinationTeamId);
      // Remove old Keto tuple — idempotent: if already removed this is a no-op
      try {
        await relationshipWriter.removeDiaryTeam(diaryId);
      } catch (err) {
        // Log but continue — the tuple may already be gone on a retry
        logger.warn(
          { diaryId, sourceTeamId, err },
          'diary.transfer.swap.remove_old_team_failed',
        );
      }
      // Grant new Keto tuple — idempotent: granting an existing tuple is a no-op
      await relationshipWriter.grantDiaryTeam(diaryId, destinationTeamId);
    },
    {
      name: 'diary.transfer.step.swapTeam',
      retriesAllowed: true,
      maxAttempts: 5,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );

  const resolveTransferStep = DBOS.registerStep(
    async (
      transferId: string,
      status: 'accepted' | 'rejected' | 'expired',
    ): Promise<void> => {
      const { diaryTransferRepository } = getDeps();
      await diaryTransferRepository.updateStatus(transferId, status);
    },
    {
      name: 'diary.transfer.step.resolve',
      retriesAllowed: true,
      maxAttempts: 3,
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
        await resolveTransferStep(transferId, 'expired');
        return { transferId, status: 'expired' };
      }

      if (decision === 'rejected') {
        await resolveTransferStep(transferId, 'rejected');
        return { transferId, status: 'rejected' };
      }

      // Accepted: swap diary team + resolve
      await swapDiaryTeamStep(diaryId, sourceTeamId, destinationTeamId);
      await resolveTransferStep(transferId, 'accepted');
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
