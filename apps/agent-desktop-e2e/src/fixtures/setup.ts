import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createE2EAgentHarness } from '@moltnet/bootstrap';
import { AGENT_CREDENTIAL_SCOPES } from '@moltnet/models';
import { connect } from '@themoltnet/sdk';

import type { DesktopDockerJourney } from './journey.js';

const root = process.env.MOLTNET_DESKTOP_E2E_FIXTURE_ROOT;
const home = process.env.MOLTNET_HOME;
if (!root || home !== join(root, 'store'))
  throw new Error('Use the isolated Desktop Docker launcher');
const harness = await createE2EAgentHarness({
  restApiUrl: process.env.REST_API_URL,
  databaseUrl: process.env.DATABASE_URL,
  hydraPublicUrl: process.env.ORY_HYDRA_PUBLIC_URL,
  hydraAdminUrl: process.env.ORY_HYDRA_ADMIN_URL,
  ketoReadUrl: process.env.ORY_KETO_PUBLIC_URL,
  ketoWriteUrl: process.env.ORY_KETO_ADMIN_URL,
  kratosAdminUrl: process.env.ORY_KRATOS_ADMIN_URL,
});
try {
  const owner = await harness.createAgent('desktop-personal-journey');
  const agent = await connect({
    apiUrl: harness.restApiUrl,
    clientId: owner.clientId,
    clientSecret: owner.clientSecret,
  });
  const issued = await agent.agentKeys.create(
    {
      agentId: owner.agentId,
      name: 'Desktop personal acceptance',
      scopes: [...AGENT_CREDENTIAL_SCOPES],
      ttlDays: 1,
    },
    { teamId: owner.personalTeamId, idempotencyKey: randomUUID() },
  );
  const project = await agent.projects.create(
    { name: 'Personal Desktop project', defaultDiaryId: owner.privateDiaryId },
    { teamId: owner.personalTeamId },
  );
  const profile = await agent.runtimeProfiles.create(
    {
      name: 'desktop-deterministic-worker',
      runtimeKind: 'desktop_e2e',
      provider: 'ollama',
      model: 'desktop-fixture',
      sandbox: {},
      defaultWorkspaceMode: 'none',
    },
    { teamId: owner.personalTeamId },
  );
  const journey: DesktopDockerJourney = {
    identity: {
      subjectId: owner.agentId,
      ...owner.keyPair,
      agentKey: issued.secret,
    },
    apiUrl: harness.restApiUrl,
    clientId: owner.clientId,
    clientSecret: owner.clientSecret,
    teamId: owner.personalTeamId,
    diaryId: owner.privateDiaryId,
    projectId: project.id,
    profileId: profile.id,
  };
  writeFileSync(join(root, 'docker-journey.json'), JSON.stringify(journey), {
    mode: 0o600,
  });
} finally {
  await harness.teardown();
}
