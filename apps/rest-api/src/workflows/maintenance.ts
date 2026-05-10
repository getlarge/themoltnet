/**
 * Maintenance Workflows
 *
 * Scheduled DBOS workflows for routine housekeeping tasks.
 *
 * ## Initialization Order
 *
 * 1. Call `initMaintenanceWorkflows()` in `registerWorkflows` (after configureDBOS).
 * 2. Call `setMaintenanceDeps()` in `afterLaunch` (once repositories are available).
 */

import type { RelationshipWriter } from '@moltnet/auth';
import {
  type ContextPackRepository,
  type DataSource,
  DBOS,
  DBOSErrors,
  type NonceRepository,
  type RenderedPackRepository,
  type TaskRepository,
} from '@moltnet/database';
import type { FastifyBaseLogger } from 'fastify';

import type { PackGcConfig, TaskOrphanSweeperConfig } from '../config.js';

// ── Types ──────────────────────────────────────────────────────

export interface MaintenanceDeps {
  nonceRepository: NonceRepository;
  contextPackRepository: ContextPackRepository;
  renderedPackRepository: RenderedPackRepository;
  taskRepository: TaskRepository;
  dataSource: DataSource;
  relationshipWriter: RelationshipWriter;
  logger: FastifyBaseLogger;
}

// ── Dependency Injection ───────────────────────────────────────

let _deps: MaintenanceDeps | null = null;

function getDeps(): MaintenanceDeps {
  if (!_deps) throw new Error('Maintenance deps not set');
  return _deps;
}

export function setMaintenanceDeps(deps: MaintenanceDeps): void {
  _deps = deps;
}

// ── Lazy Registration ──────────────────────────────────────────

let _initialized = false;

/**
 * Register all maintenance workflows with DBOS.
 *
 * Must be called after configureDBOS() and before launchDBOS().
 * Idempotent — safe to call multiple times.
 */
export function initMaintenanceWorkflows(
  packGcConfig: PackGcConfig,
  orphanSweeperConfig: TaskOrphanSweeperConfig,
): void {
  if (_initialized) return;
  _initialized = true;

  // ── Nonce Cleanup ────────────────────────────────────────────
  const nonceCleanupWorkflow = DBOS.registerWorkflow(
    async (_scheduledTime: Date, _actualTime: Date): Promise<void> => {
      const { nonceRepository, logger } = getDeps();
      await nonceRepository.cleanup();
      logger.info('maintenance: nonce cleanup complete');
    },
    { name: 'maintenance.nonceCleanup' },
  );

  DBOS.registerScheduled(nonceCleanupWorkflow, {
    name: 'maintenance.nonceCleanup',
    crontab: '0 0 * * *',
  });

  // ── Pack GC ──────────────────────────────────────────────────

  const listExpiredStep = DBOS.registerStep(
    async (now: Date, batchSize: number) => {
      const { contextPackRepository } = getDeps();
      return contextPackRepository.listExpiredUnpinned(now, batchSize);
    },
    { name: 'maintenance.packGc.listExpired' },
  );

  const ketoCleanupStep = DBOS.registerStep(
    async (packs: Array<{ id: string; diaryId: string }>) => {
      const { relationshipWriter } = getDeps();
      await relationshipWriter.removePackRelationsBatch(packs);
    },
    {
      name: 'maintenance.packGc.ketoCleanup',
      retriesAllowed: true,
      maxAttempts: 3,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );

  const packGcWorkflow = DBOS.registerWorkflow(
    async (input: { batchSize: number }) => {
      const { logger } = getDeps();
      const expiredPacks = await listExpiredStep(new Date(), input.batchSize);

      if (expiredPacks.length === 0) {
        logger.info('maintenance: pack GC — no expired packs');
        return { deleted: 0, batchFull: false };
      }

      const ids = expiredPacks.map((p) => p.id);
      const packRefs = expiredPacks.map((p) => ({
        id: p.id,
        diaryId: p.diaryId,
      }));

      // Atomic deletion — FK cascade removes context_pack_entries
      const { dataSource, contextPackRepository } = getDeps();
      const deleted = await dataSource.runTransaction(
        async () => contextPackRepository.deleteMany(ids),
        { name: 'maintenance.packGc.tx.delete' },
      );

      // Best-effort Keto cleanup — orphaned tuples are harmless
      try {
        await ketoCleanupStep(packRefs);
      } catch (error) {
        logger.warn(
          { err: error, packIds: ids },
          'maintenance: pack GC — Keto cleanup failed (orphaned tuples are harmless)',
        );
      }

      const batchFull = expiredPacks.length >= input.batchSize;
      logger.info({ deleted, batchFull }, 'maintenance: pack GC complete');

      return { deleted, batchFull };
    },
    { name: 'maintenance.packGc' },
  );

  const cron = packGcConfig.PACK_GC_CRON;
  const batchSize = packGcConfig.PACK_GC_BATCH_SIZE;

  const packGcSchedulerWorkflow = DBOS.registerWorkflow(
    async (_scheduledTime: Date, _actualTime: Date): Promise<void> => {
      // Fire-and-forget: don't await getResult() to avoid blocking
      // the next cron tick if GC takes longer than expected.
      await DBOS.startWorkflow(packGcWorkflow)({ batchSize });
    },
    { name: 'maintenance.packGcScheduler' },
  );

  DBOS.registerScheduled(packGcSchedulerWorkflow, {
    name: 'maintenance.packGcScheduler',
    crontab: cron,
  });

  // ── Rendered Pack GC ────────────────────────────────────────
  // Rendered packs with pinned source packs won't be cleaned by
  // ON DELETE CASCADE. This GC pass handles their own expiresAt.

  const listExpiredRenderedStep = DBOS.registerStep(
    async (now: Date, limit: number) => {
      const { renderedPackRepository } = getDeps();
      return renderedPackRepository.listExpiredUnpinned(now, limit);
    },
    { name: 'maintenance.renderedPackGc.listExpired' },
  );

  const renderedPackGcWorkflow = DBOS.registerWorkflow(
    async (input: { batchSize: number }) => {
      const { logger, renderedPackRepository } = getDeps();
      const expired = await listExpiredRenderedStep(
        new Date(),
        input.batchSize,
      );

      if (expired.length === 0) {
        logger.info('maintenance: rendered pack GC — no expired packs');
        return { deleted: 0 };
      }

      const ids = expired.map((p) => p.id);
      const deleted = await renderedPackRepository.deleteMany(ids);

      logger.info({ deleted }, 'maintenance: rendered pack GC complete');
      return { deleted };
    },
    { name: 'maintenance.renderedPackGc' },
  );

  const renderedPackGcSchedulerWorkflow = DBOS.registerWorkflow(
    async (_scheduledTime: Date, _actualTime: Date): Promise<void> => {
      await DBOS.startWorkflow(renderedPackGcWorkflow)({ batchSize });
    },
    { name: 'maintenance.renderedPackGcScheduler' },
  );

  DBOS.registerScheduled(renderedPackGcSchedulerWorkflow, {
    name: 'maintenance.renderedPackGcScheduler',
    crontab: cron,
  });

  // ── Task Orphan Sweeper (#937) ──────────────────────────────
  // Detects tasks abandoned by a dead DBOS workflow process — the
  // in-workflow recv loop (#936) handles worker-stopped-heartbeating,
  // but if the workflow process itself dies before completion the row
  // stays stuck in dispatched/running until something else notices.
  // This sweeper observes claim_expires_at directly, which is updated
  // by every /heartbeat for exactly this purpose.
  const orphanGracePeriodSec =
    orphanSweeperConfig.TASK_ORPHAN_SWEEPER_GRACE_SEC;
  const orphanBatchSize = orphanSweeperConfig.TASK_ORPHAN_SWEEPER_BATCH_SIZE;
  const orphanCron = orphanSweeperConfig.TASK_ORPHAN_SWEEPER_CRON;

  const listOrphansStep = DBOS.registerStep(
    async (now: Date, gracePeriodSec: number, batchSize: number) => {
      const { taskRepository } = getDeps();
      const staleSince = new Date(now.getTime() - gracePeriodSec * 1000);
      return taskRepository.listOrphanedTasks(staleSince, batchSize);
    },
    { name: 'maintenance.taskOrphanSweeper.listOrphans' },
  );

  const tryResumeWorkflowStep = DBOS.registerStep(
    async (workflowId: string): Promise<{ resumed: boolean }> => {
      const { logger } = getDeps();
      try {
        await DBOS.resumeWorkflow(workflowId);
        return { resumed: true };
      } catch (err) {
        // Distinguish expected "not recoverable" outcomes (workflow
        // handle missing, already terminal/cancelled, invalid state
        // transition) from unexpected infrastructure failures (DB
        // connectivity, SDK bugs). Expected → fall through to row-level
        // force-release. Unexpected → re-throw so DBOS step retries
        // kick in instead of silently force-releasing every orphan in
        // the batch on a transient blip.
        const expected =
          err instanceof DBOSErrors.DBOSNonExistentWorkflowError ||
          err instanceof DBOSErrors.DBOSInvalidWorkflowTransitionError ||
          err instanceof DBOSErrors.DBOSWorkflowCancelledError;
        if (!expected) {
          logger.warn(
            { workflowId, err },
            'maintenance: task orphan — resume hit unexpected error, will retry',
          );
          throw err;
        }
        logger.debug(
          { workflowId, err },
          'maintenance: task orphan — resume failed (workflow not recoverable), will force-release',
        );
        return { resumed: false };
      }
    },
    { name: 'maintenance.taskOrphanSweeper.tryResume' },
  );

  const forceReleaseAttemptStep = DBOS.registerStep(
    async (input: {
      taskId: string;
      attemptN: number;
      claimedByAgentId: string;
    }): Promise<void> => {
      const { dataSource, taskRepository, relationshipWriter, logger } =
        getDeps();
      // Mirror the in-workflow timeout transaction shape: write the
      // attempt as timed_out + decide task fate based on retry budget.
      const now = new Date();
      const [attemptCount, maxAttempts] = await Promise.all([
        taskRepository.countAttempts(input.taskId),
        taskRepository.getMaxAttempts(input.taskId),
      ]);
      const canRetry = attemptCount < maxAttempts;

      // External terminal status guard — same defence the in-workflow
      // timeout branches use.
      const taskNow = await taskRepository.findById(input.taskId);
      const externalTerminal =
        taskNow !== null &&
        (taskNow.status === 'cancelled' ||
          taskNow.status === 'completed' ||
          taskNow.status === 'failed' ||
          taskNow.status === 'expired');

      await dataSource.runTransaction(
        async () => {
          await taskRepository.updateAttempt(input.taskId, input.attemptN, {
            status: 'timed_out',
            completedAt: now,
            error: {
              code: 'orphaned',
              message:
                'Workflow process did not resume; row force-released by orphan sweeper.',
            } as unknown,
          });
          if (!externalTerminal) {
            await taskRepository.updateStatus(
              input.taskId,
              canRetry ? 'queued' : 'failed',
              { claimAgentId: null, claimExpiresAt: null },
            );
          } else {
            await taskRepository.updateStatus(input.taskId, taskNow.status, {
              claimAgentId: null,
              claimExpiresAt: null,
            });
          }
        },
        { name: 'maintenance.taskOrphanSweeper.tx.forceRelease' },
      );

      await relationshipWriter
        .removeTaskClaimant(input.taskId, input.claimedByAgentId)
        .catch((err: unknown) => {
          logger.warn(
            {
              taskId: input.taskId,
              claimAgentId: input.claimedByAgentId,
              err,
            },
            'maintenance: task orphan — Keto cleanup failed (orphaned tuple is harmless)',
          );
        });
    },
    { name: 'maintenance.taskOrphanSweeper.forceRelease' },
  );

  const taskOrphanSweeperWorkflow = DBOS.registerWorkflow(
    async (input: {
      gracePeriodSec: number;
      batchSize: number;
    }): Promise<{
      examined: number;
      resumed: number;
      forceReleased: number;
    }> => {
      const { logger } = getDeps();
      const orphans = await listOrphansStep(
        new Date(),
        input.gracePeriodSec,
        input.batchSize,
      );

      if (orphans.length === 0) {
        return { examined: 0, resumed: 0, forceReleased: 0 };
      }

      let resumed = 0;
      let forceReleased = 0;
      // Backstop threshold: if the row has been orphaned for more than
      // twice the grace period, the previous sweep tick had a chance to
      // resume the workflow and the in-workflow recv loop had a chance
      // to fire its own deadline. If we still see the same row, treat
      // DBOS.resumeWorkflow's success as a false positive (issue #1077:
      // resume returns OK but the resumed workflow re-parks on a stale
      // recv) and force-release unconditionally.
      const backstopAgeMs = input.gracePeriodSec * 2 * 1000;
      for (const { task, attempt } of orphans) {
        // Recompute per-iteration: the loop awaits async I/O on every
        // step, and a stale `now` would understate claimAgeMs for tasks
        // processed late in a large batch.
        if (!task.claimExpiresAt) {
          // listOrphanedTasks' SQL filter (lt(claimExpiresAt, …))
          // never returns null rows today, but if that ever changes a
          // null expiry tells us nothing about age — don't pretend it's
          // past the backstop. Force-release with an honest log.
          logger.error(
            {
              taskId: task.id,
              attemptN: attempt.attemptN,
              workflowId: attempt.workflowId,
            },
            'maintenance: task orphan — claimExpiresAt is null, force-releasing (unexpected: listOrphanedTasks should have excluded this row)',
          );
        } else {
          const claimAgeMs = Date.now() - task.claimExpiresAt.getTime();
          const pastBackstop = claimAgeMs >= backstopAgeMs;

          if (!pastBackstop) {
            // First-pass: try to wake the original workflow. If DBOS still
            // has its event log, the recv loop will see the missed deadline
            // and transition naturally (lease_expired / running_total_exceeded).
            const { resumed: didResume } = await tryResumeWorkflowStep(
              attempt.workflowId,
            );
            if (didResume) {
              resumed += 1;
              continue;
            }
          } else {
            logger.warn(
              {
                taskId: task.id,
                attemptN: attempt.attemptN,
                workflowId: attempt.workflowId,
                claimAgeMs,
                backstopAgeMs,
              },
              'maintenance: task orphan — past backstop window, force-releasing without resume',
            );
          }
        }
        // Fall back to row-level force-release. Per-iteration try/catch:
        // if force-release on one orphan fails after step retries, we
        // still want to process the remaining batch and emit the
        // summary log. Otherwise the scheduler silently records a
        // workflow failure and every subsequent orphan in the batch
        // is skipped.
        try {
          await forceReleaseAttemptStep({
            taskId: task.id,
            attemptN: attempt.attemptN,
            claimedByAgentId: attempt.claimedByAgentId,
          });
          forceReleased += 1;
        } catch (err) {
          logger.error(
            {
              taskId: task.id,
              attemptN: attempt.attemptN,
              workflowId: attempt.workflowId,
              err,
            },
            'maintenance: task orphan — force-release failed; task remains stuck, will retry next sweep',
          );
        }
      }
      logger.info(
        { examined: orphans.length, resumed, forceReleased },
        'maintenance: task orphan sweep complete',
      );
      return { examined: orphans.length, resumed, forceReleased };
    },
    { name: 'maintenance.taskOrphanSweeper' },
  );

  const taskOrphanSweeperSchedulerWorkflow = DBOS.registerWorkflow(
    async (_scheduledTime: Date, _actualTime: Date): Promise<void> => {
      await DBOS.startWorkflow(taskOrphanSweeperWorkflow)({
        gracePeriodSec: orphanGracePeriodSec,
        batchSize: orphanBatchSize,
      });
    },
    { name: 'maintenance.taskOrphanSweeperScheduler' },
  );

  DBOS.registerScheduled(taskOrphanSweeperSchedulerWorkflow, {
    name: 'maintenance.taskOrphanSweeperScheduler',
    crontab: orphanCron,
  });
}
