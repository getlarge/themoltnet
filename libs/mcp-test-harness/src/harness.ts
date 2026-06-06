/* eslint-disable no-restricted-syntax -- e2e harness reads env directly, matching existing Docker-backed test setups */

import { createClient, createDiary } from '@moltnet/api-client';
import { createE2EAgentHarness, type GenesisAgent } from '@moltnet/bootstrap';

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

  // Delegate genesis-agent bootstrap + DB lifecycle to the shared lib.
  // The MCP harness layers on top: each `createAgent` call also creates
  // a public diary the test fixture relies on, and the harness exposes
  // an initial agent at construction time.
  const inner = await createE2EAgentHarness({
    restApiUrl: process.env.REST_API_URL,
    databaseUrl: process.env.DATABASE_URL,
    hydraPublicUrl: process.env.ORY_HYDRA_PUBLIC_URL,
    hydraAdminUrl: process.env.ORY_HYDRA_ADMIN_URL,
    ketoReadUrl: process.env.ORY_KETO_PUBLIC_URL,
    ketoWriteUrl: process.env.ORY_KETO_ADMIN_URL,
    kratosAdminUrl: process.env.ORY_KRATOS_ADMIN_URL,
    // eslint-disable-next-line no-console
    log: (message) => console.log(`[MCP E2E] ${message}`),
  });

  async function createAgent(name: string): Promise<HarnessAgent> {
    const agent = await inner.createAgent(name);
    const client = createClient({ baseUrl: inner.restApiUrl });
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
    await inner.teardown();
    throw error;
  }

  const { agent, privateDiaryId, publicDiaryId, personalTeamId } = initialAgent;

  // eslint-disable-next-line no-console
  console.log(
    `[MCP E2E] Test agent ready: ${agent.identityId} (${agent.keyPair.fingerprint}) — private diary ${privateDiaryId}, public diary ${publicDiaryId}`,
  );

  return {
    mcpBaseUrl: mcpServerUrl,
    restApiUrl: inner.restApiUrl,
    agent,
    privateDiaryId,
    publicDiaryId,
    personalTeamId,
    createAgent,
    async teardown() {
      await inner.teardown();
    },
  };
}
