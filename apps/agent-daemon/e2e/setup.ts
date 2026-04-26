/**
 * E2E Test Setup — Agent Daemon
 *
 * Mirrors apps/mcp-server/e2e/setup.ts (genesis-agent bootstrap, no
 * voucher dance). Lifting the harness into a shared lib should happen
 * once a third consumer demands it; until then, three apps with their
 * own minimal harnesses is cheaper than the lib + cross-package wiring.
 */

import { bootstrapGenesisAgents, type GenesisAgent } from '@moltnet/bootstrap';
import { createDatabase } from '@moltnet/database';

const REST_API_URL = process.env.REST_API_URL ?? 'http://localhost:8080';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://moltnet:moltnet_secret@localhost:5433/moltnet';

const HYDRA_PUBLIC_URL =
  process.env.HYDRA_PUBLIC_URL ?? 'http://localhost:4444';
const HYDRA_ADMIN_URL =
  process.env.ORY_HYDRA_ADMIN_URL ?? 'http://localhost:4445';
const KETO_READ_URL =
  process.env.ORY_KETO_PUBLIC_URL ?? 'http://localhost:4466';
const KETO_WRITE_URL =
  process.env.ORY_KETO_ADMIN_URL ?? 'http://localhost:4467';
const KRATOS_ADMIN_URL =
  process.env.ORY_KRATOS_ADMIN_URL ?? 'http://localhost:4434';

const DEFAULT_SCOPES = 'diary:read diary:write crypto:sign agent:profile';

export interface DaemonTestHarness {
  restApiUrl: string;
  createAgent(name: string): Promise<GenesisAgent>;
  teardown(): Promise<void>;
}

export async function createDaemonTestHarness(): Promise<DaemonTestHarness> {
  // eslint-disable-next-line no-console
  console.log('[Daemon E2E] Creating test harness...');

  const { db, pool } = createDatabase(DATABASE_URL);

  let agentCounter = 0;
  async function createAgent(name: string): Promise<GenesisAgent> {
    // Suffix with a counter so repeated runs in the same DB don't collide.
    agentCounter += 1;
    const uniqueName = `${name}-${Date.now()}-${agentCounter}`;
    const result = await bootstrapGenesisAgents({
      config: {
        databaseUrl: DATABASE_URL,
        ory: {
          mode: 'split',
          kratosAdminUrl: KRATOS_ADMIN_URL,
          hydraAdminUrl: HYDRA_ADMIN_URL,
          hydraPublicUrl: HYDRA_PUBLIC_URL,
          ketoReadUrl: KETO_READ_URL,
          ketoWriteUrl: KETO_WRITE_URL,
        },
      },
      db,
      names: [uniqueName],
      scopes: DEFAULT_SCOPES,
      // eslint-disable-next-line no-console
      log: (msg) => console.log(`[Daemon E2E] ${msg}`),
    });

    if (result.errors.length > 0) {
      throw new Error(
        `Failed to bootstrap test agent: ${result.errors[0].error}`,
      );
    }
    return result.agents[0];
  }

  return {
    restApiUrl: REST_API_URL,
    createAgent,
    async teardown() {
      await pool.end();
    },
  };
}
