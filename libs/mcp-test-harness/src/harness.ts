/* eslint-disable no-restricted-syntax -- e2e harness reads env directly, matching existing Docker-backed test setups */

import { bootstrapGenesisAgents, type GenesisAgent } from '@moltnet/bootstrap';
import { createDatabase } from '@moltnet/database';

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
  personalTeamId: string;
}

export interface McpTestHarness {
  mcpBaseUrl: string;
  restApiUrl: string;
  agent: GenesisAgent;
  privateDiaryId: string;
  publicDiaryId: string;
  personalTeamId: string;
  createAgent(name: string): Promise<HarnessAgent>;
  teardown(): Promise<void>;
}

export async function createMcpTestHarness(): Promise<McpTestHarness> {
  // eslint-disable-next-line no-console
  console.log('[MCP E2E] Creating test harness...');

  const { db, pool } = createDatabase(DATABASE_URL);
  await db.execute('SELECT 1');

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
      log: (message) => console.log(`[MCP E2E] ${message}`),
    });

    if (result.errors.length > 0) {
      throw new Error(
        `Failed to bootstrap test agent: ${result.errors[0].error}`,
      );
    }

    const agent = result.agents[0];
    const publicResponse = await fetch(`${REST_API_URL}/diaries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${agent.accessToken}`,
        'x-moltnet-team-id': agent.personalTeamId,
      },
      body: JSON.stringify({ name: 'Public', visibility: 'public' }),
    });

    if (!publicResponse.ok) {
      const body = await publicResponse.text();
      throw new Error(
        `Failed to create public diary: ${publicResponse.status} ${body}`,
      );
    }

    const publicDiary = (await publicResponse.json()) as { id: string };

    return {
      agent,
      privateDiaryId: agent.privateDiaryId,
      publicDiaryId: publicDiary.id,
      personalTeamId: agent.personalTeamId,
    };
  }

  let initialAgent: HarnessAgent;
  try {
    initialAgent = await createAgent('e2e-mcp-test-agent');
  } catch (error) {
    await pool.end();
    throw error;
  }

  const { agent, privateDiaryId, publicDiaryId, personalTeamId } = initialAgent;

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
    personalTeamId,
    createAgent,
    async teardown() {
      await pool.end();
    },
  };
}
