/**
 * E2E Test Setup — Agent Daemon
 *
 * Thin wrapper around the shared `createE2EAgentHarness` from
 * `@moltnet/bootstrap`. The harness handles bootstrap of genesis agents
 * + DB connection + teardown; this file just reads the daemon-specific
 * env vars at the call site (the lib stays config-agnostic per #1311)
 * and re-exports a daemon-flavored alias on the result type for the
 * existing call sites in daemon.e2e.test.ts.
 */

import {
  createE2EAgentHarness,
  type E2EAgentHarness,
} from '@moltnet/bootstrap';

/** Daemon-specific alias of the shared {@link E2EAgentHarness}. */
export type DaemonTestHarness = E2EAgentHarness;

export async function createDaemonTestHarness(): Promise<DaemonTestHarness> {
  // eslint-disable-next-line no-console
  console.log('[Daemon E2E] Creating test harness...');

  return createE2EAgentHarness({
    restApiUrl: process.env.REST_API_URL,
    databaseUrl: process.env.DATABASE_URL,
    hydraPublicUrl: process.env.ORY_HYDRA_PUBLIC_URL,
    hydraAdminUrl: process.env.ORY_HYDRA_ADMIN_URL,
    ketoReadUrl: process.env.ORY_KETO_PUBLIC_URL,
    ketoWriteUrl: process.env.ORY_KETO_ADMIN_URL,
    kratosAdminUrl: process.env.ORY_KRATOS_ADMIN_URL,
    // eslint-disable-next-line no-console
    log: (msg) => console.log(`[Daemon E2E] ${msg}`),
  });
}
