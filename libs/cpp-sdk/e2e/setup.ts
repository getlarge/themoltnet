import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  claimTask,
  createClient,
  createDiaryEntry,
  createRuntimeProfile,
  createTask,
} from '@moltnet/api-client';
import { createE2EAgentHarness } from '@moltnet/bootstrap';
import { buildCuratePack } from '@themoltnet/sdk';

const outputPath =
  process.env.MOLTNET_CPP_E2E_CONFIG ??
  `${process.env.RUNNER_TEMP ?? process.env.TMPDIR ?? '/tmp'}/moltnet-cpp-sdk-e2e-config.json`;

async function main() {
  const harness = await createE2EAgentHarness({
    restApiUrl: process.env.REST_API_URL ?? process.env.SERVER_BASE_URL,
    databaseUrl: process.env.DATABASE_URL,
    hydraPublicUrl: process.env.ORY_HYDRA_PUBLIC_URL,
    hydraAdminUrl: process.env.ORY_HYDRA_ADMIN_URL,
    ketoReadUrl: process.env.ORY_KETO_PUBLIC_URL,
    ketoWriteUrl: process.env.ORY_KETO_ADMIN_URL,
    kratosAdminUrl: process.env.ORY_KRATOS_ADMIN_URL,
    log: (message) => console.log(`[C++ SDK E2E] ${message}`),
  });

  try {
    const agent = await harness.createAgent('cpp-sdk-e2e-agent');
    const client = createClient({ baseUrl: harness.restApiUrl });
    const marker = `cpp-sdk-e2e-${Date.now()}`;

    const { data: entry, error: entryError } = await createDiaryEntry({
      client,
      auth: () => agent.accessToken,
      path: { diaryId: agent.privateDiaryId },
      body: {
        content: `MoltNet C++ SDK e2e marker ${marker}`,
        entryType: 'semantic',
        title: `C++ SDK e2e ${marker}`,
        tags: ['cpp-sdk-e2e', marker],
      },
    });

    if (entryError || !entry) {
      throw new Error(
        `Failed to create e2e diary entry: ${JSON.stringify(entryError)}`,
      );
    }

    const builtTask = buildCuratePack({
      diaryId: agent.privateDiaryId,
      taskPrompt:
        `Read-back fixture for the MoltNet C++ SDK e2e test. ` +
        `Marker: ${marker}`,
    })
      .team(agent.personalTeamId)
      .diary(agent.privateDiaryId)
      .title(`C++ SDK e2e ${marker}`)
      .tags('cpp-sdk-e2e', marker)
      .maxAttempts(1)
      .build();

    const { data: task, error: taskError } = await createTask({
      client,
      auth: () => agent.accessToken,
      headers: { 'x-moltnet-team-id': builtTask.teamId },
      body: builtTask.body,
    });

    if (taskError || !task) {
      throw new Error(
        `Failed to create e2e task: ${JSON.stringify(taskError)}`,
      );
    }

    const { data: profile, error: profileError } = await createRuntimeProfile({
      client,
      auth: () => agent.accessToken,
      headers: { 'x-moltnet-team-id': agent.personalTeamId },
      body: {
        name: `cpp-sdk-e2e-profile-${marker}`,
        provider: 'openai',
        model: 'gpt-5-mini',
        runtimeKind: 'gondolin_pi',
        defaultWorkspaceMode: 'none',
        allowedWorkspaceModes: ['none'],
        sandbox: {},
      },
    });

    if (profileError || !profile) {
      throw new Error(
        `Failed to create e2e runtime profile: ${JSON.stringify(profileError)}`,
      );
    }

    const profiledTaskBody = buildCuratePack({
      diaryId: agent.privateDiaryId,
      taskPrompt:
        `Profile-filter fixture for the MoltNet C++ SDK e2e test. ` +
        `Marker: ${marker}`,
    })
      .team(agent.personalTeamId)
      .diary(agent.privateDiaryId)
      .title(`C++ SDK e2e profiled ${marker}`)
      .tags('cpp-sdk-e2e', marker, 'profile-filter')
      .maxAttempts(1)
      .allowProfiles({ profileId: profile.id })
      .build();

    const { data: profiledTask, error: profiledTaskError } = await createTask({
      client,
      auth: () => agent.accessToken,
      headers: { 'x-moltnet-team-id': profiledTaskBody.teamId },
      body: profiledTaskBody.body,
    });

    if (profiledTaskError || !profiledTask) {
      throw new Error(
        `Failed to create e2e profiled task: ${JSON.stringify(profiledTaskError)}`,
      );
    }

    const claimedTaskBody = buildCuratePack({
      diaryId: agent.privateDiaryId,
      taskPrompt:
        `Claimant-filter fixture for the MoltNet C++ SDK e2e test. ` +
        `Marker: ${marker}`,
    })
      .team(agent.personalTeamId)
      .diary(agent.privateDiaryId)
      .title(`C++ SDK e2e claimed ${marker}`)
      .tags('cpp-sdk-e2e', marker, 'claimant-filter')
      .maxAttempts(1)
      .allowProfiles({ profileId: profile.id })
      .build();

    const { data: claimedTask, error: claimedTaskCreateError } =
      await createTask({
        client,
        auth: () => agent.accessToken,
        headers: { 'x-moltnet-team-id': claimedTaskBody.teamId },
        body: claimedTaskBody.body,
      });

    if (claimedTaskCreateError || !claimedTask) {
      throw new Error(
        `Failed to create e2e claimed task: ${JSON.stringify(claimedTaskCreateError)}`,
      );
    }

    const { error: claimError } = await claimTask({
      client,
      auth: () => agent.accessToken,
      path: { id: claimedTask.id },
      body: { leaseTtlSec: 60, profileId: profile.id },
    });

    if (claimError) {
      throw new Error(
        `Failed to claim e2e task: ${JSON.stringify(claimError)}`,
      );
    }

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(
      outputPath,
      JSON.stringify(
        {
          apiUrl: harness.restApiUrl,
          clientId: agent.clientId,
          clientSecret: agent.clientSecret,
          teamId: agent.personalTeamId,
          diaryId: agent.privateDiaryId,
          entryId: entry.id,
          taskId: task.id,
          profileId: profile.id,
          profiledTaskId: profiledTask.id,
          claimedTaskId: claimedTask.id,
          claimedByAgentId: agent.identityId,
          marker,
        },
        null,
        2,
      ),
    );

    console.log(`[C++ SDK E2E] Wrote fixture config to ${outputPath}`);
  } finally {
    await harness.teardown();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
