/**
 * Reusable e2e harness for tests that need a freshly provisioned MoltNet
 * agent against the e2e Docker stack (rest-api + Ory split deployment).
 *
 * Originally duplicated across apps/agent-daemon/e2e/setup.ts and
 * apps/mcp-server/e2e/setup.ts; lifted here once a third consumer (the
 * console e2e suite added in #1303) needed the same provisioning logic.
 * Existing duplicates can migrate in a follow-up PR.
 *
 * The harness is intentionally Ory-split-mode only. Managed-mode tests
 * would use a different shape (single project URL, API key, no admin
 * port exposure); when that becomes a real need, add a second factory
 * here rather than overloading this one.
 */

import { createDatabase } from '@moltnet/database';

import { bootstrapGenesisAgents, type GenesisAgent } from './bootstrap.js';

/**
 * Default URLs that match the standard `docker-compose.e2e.yaml` port
 * mappings. Use `defaultE2EHarnessUrls()` if you want them with env-var
 * overrides — callers that read env must do so themselves; this module
 * stays config-source agnostic.
 */
export const DEFAULT_E2E_REST_API_URL = 'http://localhost:8080';
export const DEFAULT_E2E_DATABASE_URL =
  'postgresql://moltnet:moltnet_secret@localhost:5433/moltnet';
export const DEFAULT_E2E_HYDRA_PUBLIC_URL = 'http://localhost:4444';
export const DEFAULT_E2E_HYDRA_ADMIN_URL = 'http://localhost:4445';
export const DEFAULT_E2E_KETO_READ_URL = 'http://localhost:4466';
export const DEFAULT_E2E_KETO_WRITE_URL = 'http://localhost:4467';
export const DEFAULT_E2E_KRATOS_ADMIN_URL = 'http://localhost:4434';
export const DEFAULT_E2E_AGENT_SCOPES =
  'diary:read diary:write crypto:sign agent:profile';

export interface E2EHarnessOptions {
  /** OAuth scopes granted to the bootstrapped agent. */
  scopes?: string;
  /** Override per-env; default points at standard docker-compose.e2e ports. */
  restApiUrl?: string;
  databaseUrl?: string;
  hydraPublicUrl?: string;
  hydraAdminUrl?: string;
  ketoReadUrl?: string;
  ketoWriteUrl?: string;
  kratosAdminUrl?: string;
  /** Optional log sink. Defaults to noop so test output stays quiet. */
  log?: (msg: string) => void;
}

export interface E2EAgentHarness {
  restApiUrl: string;
  /**
   * Provision a fresh agent. `name` is suffixed with timestamp + counter so
   * repeated invocations against the same DB don't collide.
   */
  createAgent(name: string): Promise<GenesisAgent>;
  /** Close pooled DB connections. Call in afterAll/teardown. */
  teardown(): Promise<void>;
}

export async function createE2EAgentHarness(
  options: E2EHarnessOptions = {},
): Promise<E2EAgentHarness> {
  const restApiUrl = options.restApiUrl ?? DEFAULT_E2E_REST_API_URL;
  const databaseUrl = options.databaseUrl ?? DEFAULT_E2E_DATABASE_URL;
  const hydraPublicUrl = options.hydraPublicUrl ?? DEFAULT_E2E_HYDRA_PUBLIC_URL;
  const hydraAdminUrl = options.hydraAdminUrl ?? DEFAULT_E2E_HYDRA_ADMIN_URL;
  const ketoReadUrl = options.ketoReadUrl ?? DEFAULT_E2E_KETO_READ_URL;
  const ketoWriteUrl = options.ketoWriteUrl ?? DEFAULT_E2E_KETO_WRITE_URL;
  const kratosAdminUrl = options.kratosAdminUrl ?? DEFAULT_E2E_KRATOS_ADMIN_URL;
  const scopes = options.scopes ?? DEFAULT_E2E_AGENT_SCOPES;
  const log = options.log ?? (() => {});

  const { db, pool } = createDatabase(databaseUrl);
  await db.execute('SELECT 1');

  let agentCounter = 0;
  async function createAgent(name: string): Promise<GenesisAgent> {
    agentCounter += 1;
    const uniqueName = `${name}-${Date.now()}-${agentCounter}`;
    const result = await bootstrapGenesisAgents({
      config: {
        databaseUrl,
        ory: {
          mode: 'split',
          kratosAdminUrl,
          hydraAdminUrl,
          hydraPublicUrl,
          ketoReadUrl,
          ketoWriteUrl,
        },
      },
      db,
      names: [uniqueName],
      scopes,
      log,
    });
    if (result.errors.length > 0) {
      throw new Error(
        `Failed to bootstrap test agent ${uniqueName}: ${result.errors[0].error}`,
      );
    }
    return result.agents[0];
  }

  return {
    restApiUrl,
    createAgent,
    async teardown() {
      await pool.end();
    },
  };
}
