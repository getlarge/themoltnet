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
  type TaskCleanupJobRepository,
  type TaskCleanupManifest,
  type TaskRepository,
  type TransactionRunner,
} from '@moltnet/database';
import type { RuntimeSessionStorage } from '@moltnet/runtime-session-service';
import type { TaskArtifactStorage } from '@moltnet/task-artifact-service';
import type { FastifyBaseLogger } from 'fastify';

import type { PackGcConfig, TaskOrphanSweeperConfig } from '../config.js';

// ── Types ──────────────────────────────────────────────────────

export interface MaintenanceDeps {
  nonceRepository: NonceRepository;
  contextPackRepository: ContextPackRepository;
  renderedPackRepository: RenderedPackRepository;
  taskRepository: TaskRepository;
  taskCleanupJobRepository: TaskCleanupJobRepository;
  runtimeSessionStorage: RuntimeSessionStorage;
  taskArtifactStorage: TaskArtifactStorage;
  dataSource: DataSource;
  transactionRunner: TransactionRunner;
  relationshipWriter: RelationshipWriter;
  logger: FastifyBaseLogger;
  notifyTaskStatusChanged?: (taskId: string) => Promise<void>;
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
  const expiredTaskBatchSize =
    orphanSweeperConfig.TASK_ORPHAN_SWEEPER_BATCH_SIZE;
  const expiredTaskCron = orphanSweeperConfig.TASK_ORPHAN_SWEEPER_CRON;
  const retentionBatchSize =
    orphanSweeperConfig.TASK_RETENTION_SWEEPER_BATCH_SIZE;
  const retentionCron = orphanSweeperConfig.TASK_RETENTION_SWEEPER_CRON;
  const retentionDays = {
    completed: orphanSweeperConfig.TASK_COMPLETED_RETENTION_DAYS,
    failed: orphanSweeperConfig.TASK_FAILED_RETENTION_DAYS,
    cancelled: orphanSweeperConfig.TASK_CANCELLED_RETENTION_DAYS,
    expired: orphanSweeperConfig.TASK_EXPIRED_RETENTION_DAYS,
  };

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
      const { transactionRunner, taskRepository, relationshipWriter, logger } =
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

      // DBOS rejects nested `runTransaction()` calls from inside a
      // registered step. Use a plain Drizzle transaction here instead:
      // repositories join it through AsyncLocalStorage, and the DBOS
      // step wrapper still gives us per-orphan retry semantics.
      await transactionRunner.runInTransaction(async () => {
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
      });

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
          await getDeps().notifyTaskStatusChanged?.(task.id);
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

  // ── Task Expiry Sweeper ──────────────────────────────────────
  // Retention cleanup applies only to terminal tasks. This sweeper
  // terminalizes waiting/queued tasks whose task-level lifetime elapsed,
  // so expiresAt cannot be used as a long-term retention bypass.
  const listExpiredTasksStep = DBOS.registerStep(
    async (now: Date, batchSize: number) => {
      const { taskRepository } = getDeps();
      return taskRepository.listExpiredNonTerminalTasks(now, batchSize);
    },
    { name: 'maintenance.taskExpirySweeper.listExpired' },
  );

  const expireTaskStep = DBOS.registerStep(
    async (taskId: string) => {
      const { taskRepository } = getDeps();
      return taskRepository.expireIfStillNonTerminal(taskId);
    },
    {
      name: 'maintenance.taskExpirySweeper.expireTask',
      retriesAllowed: true,
      maxAttempts: 3,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );

  const taskExpirySweeperWorkflow = DBOS.registerWorkflow(
    async (input: {
      batchSize: number;
    }): Promise<{ examined: number; expired: number }> => {
      const { logger, notifyTaskStatusChanged } = getDeps();
      const expiredCandidates = await listExpiredTasksStep(
        new Date(),
        input.batchSize,
      );

      let expired = 0;
      for (const task of expiredCandidates) {
        try {
          const updated = await expireTaskStep(task.id);
          if (!updated) continue;
          expired += 1;
          if (notifyTaskStatusChanged) {
            await notifyTaskStatusChanged(task.id);
          }
        } catch (err) {
          logger.error(
            { taskId: task.id, err },
            'maintenance: task expiry — expire failed',
          );
        }
      }

      if (expiredCandidates.length > 0) {
        logger.info(
          { examined: expiredCandidates.length, expired },
          'maintenance: task expiry complete',
        );
      }

      return { examined: expiredCandidates.length, expired };
    },
    { name: 'maintenance.taskExpirySweeper' },
  );

  const taskExpirySweeperSchedulerWorkflow = DBOS.registerWorkflow(
    async (_scheduledTime: Date, _actualTime: Date): Promise<void> => {
      await DBOS.startWorkflow(taskExpirySweeperWorkflow)({
        batchSize: expiredTaskBatchSize,
      });
    },
    { name: 'maintenance.taskExpirySweeperScheduler' },
  );

  DBOS.registerScheduled(taskExpirySweeperSchedulerWorkflow, {
    name: 'maintenance.taskExpirySweeperScheduler',
    crontab: expiredTaskCron,
  });

  // ── Task Retention Sweeper ───────────────────────────────────
  // Applies operator-owned retention policy to terminal task rows.
  // This is deliberately separate from the non-terminal expiry sweeper:
  // expiry terminalizes idle work, retention deletes old terminal rows.
  const listRetainedTasksStep = DBOS.registerStep(
    async (now: Date, policyDays: typeof retentionDays, batchSize: number) => {
      const { taskRepository } = getDeps();
      const cutoff = (days: number) =>
        new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      return taskRepository.listTerminalTasksPastRetention(
        {
          completedBefore: cutoff(policyDays.completed),
          failedBefore: cutoff(policyDays.failed),
          cancelledBefore: cutoff(policyDays.cancelled),
          expiredBefore: cutoff(policyDays.expired),
        },
        batchSize,
      );
    },
    { name: 'maintenance.taskRetentionSweeper.listRetained' },
  );

  const createTaskCleanupJobsStep = DBOS.registerStep(
    async (
      retainedTasks: Array<{
        id: string;
        teamId: string;
      }>,
    ): Promise<{ createdOrRevived: number; skippedProtected: number }> => {
      const { taskRepository, taskCleanupJobRepository } = getDeps();
      const ids = retainedTasks.map((task) => task.id);
      const sealedIds = new Set(await taskRepository.findSealedTaskIds(ids));
      const deletableTasks = retainedTasks.filter(
        (task) => !sealedIds.has(task.id),
      );
      if (deletableTasks.length === 0) {
        return { createdOrRevived: 0, skippedProtected: sealedIds.size };
      }

      const jobs =
        await taskCleanupJobRepository.createRetentionJobsForTasks(
          deletableTasks,
        );
      return {
        createdOrRevived: jobs.length,
        skippedProtected: sealedIds.size,
      };
    },
    {
      name: 'maintenance.taskRetentionSweeper.createCleanupJobs',
      retriesAllowed: true,
      maxAttempts: 3,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );

  const listPendingTaskCleanupJobsStep = DBOS.registerStep(
    async (limit: number): Promise<string[]> => {
      const { taskCleanupJobRepository } = getDeps();
      const jobs =
        await taskCleanupJobRepository.listPendingOrFailedRetentionJobs(limit);
      return jobs.map((job) => job.id);
    },
    {
      name: 'maintenance.taskRetentionSweeper.listPendingCleanupJobs',
      retriesAllowed: true,
      maxAttempts: 3,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );

  const startTaskCleanupJobStep = DBOS.registerStep(
    async (jobId: string): Promise<TaskCleanupManifest | null> => {
      const { taskCleanupJobRepository } = getDeps();
      await taskCleanupJobRepository.start(jobId);
      return taskCleanupJobRepository.getOrCreateManifest(jobId);
    },
    {
      name: 'maintenance.taskCleanup.startJob',
      retriesAllowed: true,
      maxAttempts: 3,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );

  const deleteTaskArtifactObjectsStep = DBOS.registerStep(
    async (manifest: TaskCleanupManifest): Promise<number> => {
      const { taskArtifactStorage } = getDeps();
      for (const artifact of manifest.taskArtifacts) {
        await taskArtifactStorage.deleteObject(artifact.objectKey);
      }
      return manifest.taskArtifacts.length;
    },
    {
      name: 'maintenance.taskCleanup.deleteTaskArtifactObjects',
      retriesAllowed: true,
      maxAttempts: 3,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );

  const deleteRuntimeSessionObjectsStep = DBOS.registerStep(
    async (manifest: TaskCleanupManifest): Promise<number> => {
      const { runtimeSessionStorage } = getDeps();
      for (const session of manifest.runtimeSessions) {
        await runtimeSessionStorage.deleteObject(session.objectKey);
      }
      return manifest.runtimeSessions.length;
    },
    {
      name: 'maintenance.taskCleanup.deleteRuntimeSessionObjects',
      retriesAllowed: true,
      maxAttempts: 3,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );

  const deleteTaskRowsStep = DBOS.registerStep(
    async (manifest: TaskCleanupManifest): Promise<number> => {
      const { taskCleanupJobRepository, taskRepository, transactionRunner } =
        getDeps();
      const sessionIds = manifest.runtimeSessions.map((session) => session.id);
      const deletedIds = await transactionRunner.runInTransaction(async () => {
        await taskCleanupJobRepository.detachRuntimeSessionChildren(sessionIds);
        return taskRepository.deleteMany([manifest.task.id]);
      });
      return deletedIds.length;
    },
    {
      name: 'maintenance.taskCleanup.deleteTaskRows',
      retriesAllowed: true,
      maxAttempts: 3,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );

  const removeTaskRelationsStep = DBOS.registerStep(
    async (manifest: TaskCleanupManifest): Promise<void> => {
      const { relationshipWriter } = getDeps();
      await relationshipWriter.removeTaskRelationsBatch([
        {
          id: manifest.task.id,
          diaryId: manifest.task.diaryId,
          claimAgentId: manifest.task.claimAgentId,
        },
      ]);
    },
    {
      name: 'maintenance.taskCleanup.removeTaskRelations',
      retriesAllowed: true,
      maxAttempts: 3,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );

  const completeTaskCleanupJobStep = DBOS.registerStep(
    async (jobId: string, deletedTaskCount: number): Promise<void> => {
      const { taskCleanupJobRepository } = getDeps();
      await taskCleanupJobRepository.complete(jobId, deletedTaskCount);
    },
    {
      name: 'maintenance.taskCleanup.completeJob',
      retriesAllowed: true,
      maxAttempts: 3,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );

  const failTaskCleanupJobStep = DBOS.registerStep(
    async (jobId: string, error: unknown): Promise<void> => {
      const { taskCleanupJobRepository } = getDeps();
      await taskCleanupJobRepository.fail(jobId, error);
    },
    {
      name: 'maintenance.taskCleanup.failJob',
      retriesAllowed: true,
      maxAttempts: 3,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );

  const taskCleanupWorkflow = DBOS.registerWorkflow(
    async (input: {
      jobId: string;
    }): Promise<{
      jobId: string;
      deletedTaskCount: number;
      deletedObjectCount: number;
    }> => {
      const { logger } = getDeps();
      try {
        const manifest = await startTaskCleanupJobStep(input.jobId);
        if (!manifest) {
          logger.warn(
            { jobId: input.jobId },
            'maintenance: task cleanup — job or task missing before manifest creation',
          );
          await completeTaskCleanupJobStep(input.jobId, 0);
          return {
            jobId: input.jobId,
            deletedTaskCount: 0,
            deletedObjectCount: 0,
          };
        }

        const deletedArtifactObjects =
          await deleteTaskArtifactObjectsStep(manifest);
        const deletedRuntimeSessionObjects =
          await deleteRuntimeSessionObjectsStep(manifest);
        const deletedTaskCount = await deleteTaskRowsStep(manifest);
        await removeTaskRelationsStep(manifest);
        await completeTaskCleanupJobStep(input.jobId, deletedTaskCount);

        const deletedObjectCount =
          deletedArtifactObjects + deletedRuntimeSessionObjects;
        logger.info(
          {
            jobId: input.jobId,
            taskId: manifest.task.id,
            deletedTaskCount,
            deletedObjectCount,
          },
          'maintenance: task cleanup complete',
        );
        return { jobId: input.jobId, deletedTaskCount, deletedObjectCount };
      } catch (err) {
        await failTaskCleanupJobStep(input.jobId, err);
        throw err;
      }
    },
    { name: 'maintenance.taskCleanup' },
  );

  const taskRetentionSweeperWorkflow = DBOS.registerWorkflow(
    async (input: {
      batchSize: number;
      policyDays: typeof retentionDays;
    }): Promise<{
      examined: number;
      cleanupJobsStarted: number;
      skippedProtected: number;
    }> => {
      const { logger } = getDeps();
      const retainedTasks = await listRetainedTasksStep(
        new Date(),
        input.policyDays,
        input.batchSize,
      );

      const created = retainedTasks.length
        ? await createTaskCleanupJobsStep(retainedTasks)
        : { createdOrRevived: 0, skippedProtected: 0 };
      const jobIds = await listPendingTaskCleanupJobsStep(input.batchSize);
      for (const jobId of jobIds) {
        await DBOS.startWorkflow(taskCleanupWorkflow, {
          workflowID: `task-cleanup-job:${jobId}`,
        })({ jobId });
      }
      logger.info(
        {
          examined: retainedTasks.length,
          cleanupJobsStarted: jobIds.length,
          cleanupJobsCreatedOrRevived: created.createdOrRevived,
          skippedProtected: created.skippedProtected,
        },
        'maintenance: task retention cleanup jobs started',
      );
      return {
        examined: retainedTasks.length,
        cleanupJobsStarted: jobIds.length,
        skippedProtected: created.skippedProtected,
      };
    },
    { name: 'maintenance.taskRetentionSweeper' },
  );

  const taskRetentionSweeperSchedulerWorkflow = DBOS.registerWorkflow(
    async (_scheduledTime: Date, _actualTime: Date): Promise<void> => {
      await DBOS.startWorkflow(taskRetentionSweeperWorkflow)({
        batchSize: retentionBatchSize,
        policyDays: retentionDays,
      });
    },
    { name: 'maintenance.taskRetentionSweeperScheduler' },
  );

  DBOS.registerScheduled(taskRetentionSweeperSchedulerWorkflow, {
    name: 'maintenance.taskRetentionSweeperScheduler',
    crontab: retentionCron,
  });
}
