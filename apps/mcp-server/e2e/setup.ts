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
import { createDatabase, createTeamRepository } from '@moltnet/database';

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
  personalTeamId: string;
}

// ── Test Harness ──

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

  // DB connection for bootstrap (inserts into agent_keys)
  const { db, pool } = createDatabase(DATABASE_URL);

  const teamRepository = createTeamRepository(db);

  async function createPersonalTeam(agent: GenesisAgent): Promise<string> {
    // Bootstrap doesn't create personal teams — create one directly in DB + Keto
    const team = await teamRepository.create({
      name: agent.keyPair.fingerprint,
      personal: true,
      createdBy: agent.identityId,
      status: 'active',
    });

    // Grant Keto owner tuple: Team:<teamId>#owners@Agent:<identityId>
    const ketoBody = {
      namespace: 'Team',
      object: team.id,
      relation: 'owners',
      subject_set: {
        namespace: 'Agent',
        object: agent.identityId,
        relation: '',
      },
    };
    const ketoRes = await fetch(`${KETO_WRITE_URL}/admin/relation-tuples`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ketoBody),
    });
    if (!ketoRes.ok) {
      const body = await ketoRes.text();
      throw new Error(
        `Failed to write Keto team owner tuple: ${ketoRes.status} ${body}`,
      );
    }

    return team.id;
  }

  async function createDiaryForAgent(
    agent: GenesisAgent,
    name: string,
    visibility: 'private' | 'public',
    teamId: string,
  ): Promise<string> {
    const response = await fetch(`${REST_API_URL}/diaries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${agent.accessToken}`,
        'x-moltnet-team-id': teamId,
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
    const personalTeamId = await createPersonalTeam(agent);
    const privateDiaryId = await createDiaryForAgent(
      agent,
      'Private',
      'private',
      personalTeamId,
    );
    const publicDiaryId = await createDiaryForAgent(
      agent,
      'Public',
      'public',
      personalTeamId,
    );

    return { agent, privateDiaryId, publicDiaryId, personalTeamId };
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
