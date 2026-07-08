import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  createClient,
  createDiaryEntry,
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
