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
  type NonceRepository,
} from '@moltnet/database';
import type { FastifyBaseLogger } from 'fastify';

import type { PackGcConfig } from '../config.js';

// ── Types ──────────────────────────────────────────────────────

export interface MaintenanceDeps {
  nonceRepository: NonceRepository;
  contextPackRepository: ContextPackRepository;
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
export function initMaintenanceWorkflows(packGcConfig: PackGcConfig): void {
  if (_initialized) return;
  _initialized = true;

  // ── Nonce Cleanup ────────────────────────────────────────────
  DBOS.registerScheduled(
    async (_scheduledTime: Date, _actualTime: Date): Promise<void> => {
      const { nonceRepository, logger } = getDeps();
      await nonceRepository.cleanup();
      logger.info('maintenance: nonce cleanup complete');
    },
    { name: 'maintenance.nonceCleanup', crontab: '0 0 * * *' },
  );

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

  DBOS.registerScheduled(
    async (_scheduledTime: Date, _actualTime: Date): Promise<void> => {
      // Fire-and-forget: don't await getResult() to avoid blocking
      // the next cron tick if GC takes longer than expected.
      await DBOS.startWorkflow(packGcWorkflow)({ batchSize });
    },
    { name: 'maintenance.packGcScheduler', crontab: cron },
  );
}
