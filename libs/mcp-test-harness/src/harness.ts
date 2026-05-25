/* eslint-disable no-restricted-syntax -- e2e harness reads env directly, matching existing Docker-backed test setups */

import { createClient, createDiary } from '@moltnet/api-client';
import { bootstrapGenesisAgents, type GenesisAgent } from '@moltnet/bootstrap';
import { createDatabase } from '@moltnet/database';

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

  const mcpServerUrl = process.env.MCP_SERVER_URL ?? 'http://127.0.0.1:8001';
  const restApiUrl = process.env.REST_API_URL ?? 'http://127.0.0.1:8080';
  const databaseUrl =
    process.env.DATABASE_URL ??
    'postgresql://moltnet:moltnet_secret@127.0.0.1:5433/moltnet';
  const hydraAdminUrl =
    process.env.ORY_HYDRA_ADMIN_URL ?? 'http://127.0.0.1:4445';
  const hydraPublicUrl =
    process.env.ORY_HYDRA_PUBLIC_URL ?? 'http://127.0.0.1:4444';
  const ketoReadUrl =
    process.env.ORY_KETO_PUBLIC_URL ?? 'http://127.0.0.1:4466';
  const ketoWriteUrl =
    process.env.ORY_KETO_ADMIN_URL ?? 'http://127.0.0.1:4467';
  const kratosAdminUrl =
    process.env.ORY_KRATOS_ADMIN_URL ?? 'http://127.0.0.1:4434';

  const { db, pool } = createDatabase(databaseUrl);
  await db.execute('SELECT 1');

  async function createAgent(name: string): Promise<HarnessAgent> {
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
    const client = createClient({ baseUrl: restApiUrl });
    const { data: publicDiary, error } = await createDiary({
      client,
      auth: () => agent.accessToken,
      headers: { 'x-moltnet-team-id': agent.personalTeamId },
      body: { name: 'Public', visibility: 'public' },
    });

    if (error || !publicDiary) {
      throw new Error(
        `Failed to create public diary: ${JSON.stringify(error)}`,
      );
    }

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
    mcpBaseUrl: mcpServerUrl,
    restApiUrl,
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
