/* eslint-disable no-console */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import {
  type BootstrapConfig,
  bootstrapGenesisAgents,
} from '@moltnet/bootstrap';
import { resolveRepoRoot } from '@moltnet/context-evals/pipeline-shared';
import { createDatabase } from '@moltnet/database';
import { setupGitIdentity } from '@themoltnet/github-agent';
import { connect, exportSSHKey, writeConfig } from '@themoltnet/sdk';

const { values } = parseArgs({
  options: {
    teardown: { type: 'boolean', default: false },
    'repo-root': { type: 'string' },
  },
  strict: false,
});

const repoRoot =
  typeof values['repo-root'] === 'string'
    ? values['repo-root']
    : await resolveRepoRoot();

// ── Ports matching docker-compose.e2e.yaml ────────────────────
const DB_URL = 'postgresql://moltnet:moltnet_secret@localhost:5433/moltnet';
const API_URL = 'http://localhost:8080';
const MCP_URL = 'http://localhost:8001/mcp';
const KRATOS_ADMIN = 'http://localhost:4434';
const HYDRA_ADMIN = 'http://localhost:4445';
const HYDRA_PUBLIC = API_URL;
const KETO_READ = 'http://localhost:4466';
const KETO_WRITE = 'http://localhost:4467';

const AGENT_NAME = 'eval-agent';
const SCOPES = 'diary:read diary:write crypto:sign agent:profile';

async function waitForHealth(url: string, maxWaitMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise<void>((r) => {
      setTimeout(r, 2000);
    });
  }
  throw new Error(`Health check timed out for ${url}`);
}

async function setup(): Promise<void> {
  console.log('[eval-setup] Waiting for e2e stack health...');
  await waitForHealth(API_URL);
  console.log('[eval-setup] REST API healthy');

  // 1. Bootstrap genesis agent
  const { db, pool } = createDatabase(DB_URL);
  const bootstrapConfig: BootstrapConfig = {
    databaseUrl: DB_URL,
    ory: {
      mode: 'split',
      kratosAdminUrl: KRATOS_ADMIN,
      hydraAdminUrl: HYDRA_ADMIN,
      hydraPublicUrl: HYDRA_PUBLIC,
      ketoReadUrl: KETO_READ,
      ketoWriteUrl: KETO_WRITE,
    },
  };

  const result = await bootstrapGenesisAgents({
    config: bootstrapConfig,
    db,
    names: [AGENT_NAME],
    scopes: SCOPES,
    log: (msg) => console.log(`[eval-setup] ${msg}`),
  });

  if (result.agents.length === 0) {
    const errorMsg = result.errors.map((e) => e.error).join('; ');
    throw new Error(`Bootstrap failed: ${errorMsg}`);
  }

  const agent = result.agents[0];
  console.log(
    `[eval-setup] Agent bootstrapped: ${agent.name} (${agent.keyPair.fingerprint})`,
  );

  // 2. Write .moltnet/eval-agent/ config
  const configDir = resolve(repoRoot, '.moltnet', AGENT_NAME);

  await writeConfig(
    {
      identity_id: agent.identityId,
      registered_at: new Date().toISOString(),
      oauth2: {
        client_id: agent.clientId,
        client_secret: agent.clientSecret,
      },
      keys: {
        public_key: agent.keyPair.publicKey,
        private_key: agent.keyPair.privateKey,
        fingerprint: agent.keyPair.fingerprint,
      },
      endpoints: {
        api: API_URL,
        mcp: MCP_URL,
      },
    },
    configDir,
  );

  // 3. Export SSH keys
  await exportSSHKey({ configDir });

  // 4. Write gitconfig via setupGitIdentity (handles allowed_signers + tag signing)
  const email = `${agent.identityId}+${AGENT_NAME}[bot]@users.noreply.github.com`;
  await setupGitIdentity({ configDir, name: AGENT_NAME, email });
  console.log('[eval-setup] Git identity configured');

  // 5. Create diary via SDK (token management + 429 retry)
  const sdk = await connect({
    clientId: agent.clientId,
    clientSecret: agent.clientSecret,
    apiUrl: API_URL,
  });

  // Resolve personal team ID from existing diaries (bootstrap creates a
  // private diary whose teamId is the personal team).
  const diaryList = await sdk.diaries.list();
  const existingDiary = diaryList.items[0] as
    | ((typeof diaryList.items)[0] & { teamId?: string })
    | undefined;
  const personalTeamId = existingDiary?.teamId;
  if (!personalTeamId) {
    throw new Error(
      'Cannot resolve personal team ID — no diary with teamId found',
    );
  }

  const diary = await sdk.diaries.create(
    { name: 'eval-workspace', visibility: 'moltnet' },
    { 'x-moltnet-team-id': personalTeamId },
  );
  console.log(`[eval-setup] Diary created: ${diary.id}`);

  // 6. Write .eval-env.json
  const evalEnv = {
    agentName: AGENT_NAME,
    clientId: agent.clientId,
    clientSecret: agent.clientSecret,
    diaryId: diary.id,
    fingerprint: agent.keyPair.fingerprint,
    apiUrl: API_URL,
    mcpUrl: MCP_URL,
    configDir,
  };
  await writeFile(
    resolve(repoRoot, '.eval-env.json'),
    JSON.stringify(evalEnv, null, 2),
    'utf8',
  );
  console.log('[eval-setup] Eval env written to .eval-env.json');

  await pool.end();
  console.log('[eval-setup] Done.');
}

async function teardown(): Promise<void> {
  console.log(
    '[eval-teardown] Nothing to clean — docker compose down handles it.',
  );
}

if (values['teardown'] === true) {
  teardown().catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  setup().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
