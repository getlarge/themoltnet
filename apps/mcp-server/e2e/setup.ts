/**
 * E2E Test Setup — MCP Server
 *
 * All services run in Docker containers via docker-compose.e2e.yaml.
 * This setup bootstraps a genesis agent via Ory admin APIs and the
 * database. The agent's OAuth2 client credentials (client_id + client_secret)
 * are passed to the MCP SDK client via X-Client-Id / X-Client-Secret headers.
 *
 * Flow:
 *   1. Bootstrap a genesis agent (Kratos identity + agent_keys + Keto + OAuth2 client)
 *   2. Tests connect to the containerized MCP server with client credentials headers
 *   3. @moltnet/mcp-auth-proxy exchanges credentials for a Bearer token via Hydra
 *   4. @getlarge/fastify-mcp validates the token, populates authContext
 *   5. Tool handlers use authContext.sessionBoundToken to call REST API
 */

import { bootstrapGenesisAgents, type GenesisAgent } from '@moltnet/bootstrap';
import { createDatabase } from '@moltnet/database';

// ── Infrastructure URLs (Docker Compose e2e — localhost mappings) ──

const MCP_SERVER_URL = process.env.MCP_SERVER_URL ?? 'http://localhost:8001';
const REST_API_URL = process.env.REST_API_URL ?? 'http://localhost:8080';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://moltnet:moltnet_secret@localhost:5433/moltnet';

const HYDRA_ADMIN_URL =
  process.env.ORY_HYDRA_ADMIN_URL ?? 'http://localhost:4445';
const HYDRA_PUBLIC_URL =
  process.env.ORY_HYDRA_PUBLIC_URL ?? 'http://localhost:4444';
const KETO_READ_URL =
  process.env.ORY_KETO_PUBLIC_URL ?? 'http://localhost:4466';
const KETO_WRITE_URL =
  process.env.ORY_KETO_ADMIN_URL ?? 'http://localhost:4467';
const KRATOS_ADMIN_URL =
  process.env.ORY_KRATOS_ADMIN_URL ?? 'http://localhost:4434';

const DEFAULT_SCOPES = 'diary:read diary:write crypto:sign agent:profile';

interface HarnessAgent {
  agent: GenesisAgent;
  privateDiaryId: string;
  publicDiaryId: string;
}

// ── Test Harness ──

export interface McpTestHarness {
  mcpBaseUrl: string;
  restApiUrl: string;
  agent: GenesisAgent;
  privateDiaryId: string;
  publicDiaryId: string;
  createAgent(name: string): Promise<HarnessAgent>;
  teardown(): Promise<void>;
}

export async function createMcpTestHarness(): Promise<McpTestHarness> {
  // eslint-disable-next-line no-console
  console.log('[MCP E2E] Creating test harness...');

  // DB connection for bootstrap (inserts into agent_keys)
  const { db, pool } = createDatabase(DATABASE_URL);

  async function createDiaryForAgent(
    agent: GenesisAgent,
    name: string,
    visibility: 'private' | 'public',
  ): Promise<string> {
    const response = await fetch(`${REST_API_URL}/diaries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${agent.accessToken}`,
      },
      body: JSON.stringify({ name, visibility }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Failed to create ${visibility} diary: ${response.status} ${body}`,
      );
    }

    const data = (await response.json()) as { id: string };
    return data.id;
  }

  async function createAgent(name: string): Promise<HarnessAgent> {
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
      names: [name],
      scopes: DEFAULT_SCOPES,
      // eslint-disable-next-line no-console
      log: (msg) => console.log(`[MCP E2E] ${msg}`),
    });

    if (result.errors.length > 0) {
      throw new Error(
        `Failed to bootstrap test agent: ${result.errors[0].error}`,
      );
    }

    const agent = result.agents[0];
    const privateDiaryId = await createDiaryForAgent(
      agent,
      'Private',
      'private',
    );
    const publicDiaryId = await createDiaryForAgent(agent, 'Public', 'public');

    return { agent, privateDiaryId, publicDiaryId };
  }

  let initialAgent: HarnessAgent;
  try {
    initialAgent = await createAgent('e2e-mcp-test-agent');
  } catch (error) {
    await pool.end();
    throw error;
  }

  const { agent, privateDiaryId, publicDiaryId } = initialAgent;

  // eslint-disable-next-line no-console
  console.log(
    `[MCP E2E] Test agent ready: ${agent.identityId} (${agent.keyPair.fingerprint}) — private diary ${privateDiaryId}, public diary ${publicDiaryId}`,
  );

  return {
    mcpBaseUrl: MCP_SERVER_URL,
    restApiUrl: REST_API_URL,
    agent,
    privateDiaryId,
    publicDiaryId,
    createAgent,
    async teardown() {
      await pool.end();
    },
  };
}
