/**
 * Maintenance Workflows
 *
 * Scheduled DBOS workflows for routine housekeeping tasks.
 *
 * ## Initialization Order
 *
 * 1. Call `initMaintenanceWorkflows()` in `registerWorkflows` (after configureDBOS).
 * 2. Call `setMaintenanceDeps()` in `afterLaunch` (once nonceRepository is available).
 */

import { DBOS, type NonceRepository } from '@moltnet/database';

// ── Types ──────────────────────────────────────────────────────

export interface MaintenanceDeps {
  nonceRepository: NonceRepository;
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
 * Register the scheduled nonce cleanup workflow with DBOS.
 *
 * Must be called after configureDBOS() and before launchDBOS().
 * Idempotent — safe to call multiple times.
 */
export function initMaintenanceWorkflows(): void {
  if (_initialized) return;
  _initialized = true;

  DBOS.registerScheduled(
    async (_scheduledTime: Date, _actualTime: Date): Promise<void> => {
      const { nonceRepository } = getDeps();
      await nonceRepository.cleanup();
      DBOS.logger.info('maintenance: nonce cleanup complete');
    },
    { name: 'maintenance.nonceCleanup', crontab: '0 0 * * *' },
  );
}
