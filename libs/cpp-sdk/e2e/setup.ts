import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  claimTask,
  createClient,
  createDiaryEntry,
  createRuntimeModel,
  createRuntimeProfile,
  createTask,
  taskHeartbeat,
  uploadTaskArtifact,
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
    const runtimeProvider = `cpp-sdk-${Date.now()}`;
    const runtimeModel = `model-${Date.now()}`;

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

    const { data: model, error: modelError } = await createRuntimeModel({
      client,
      auth: () => agent.accessToken,
      headers: { 'x-moltnet-team-id': agent.personalTeamId },
      body: {
        provider: runtimeProvider,
        model: runtimeModel,
        displayName: `C++ SDK e2e model ${marker}`,
        description: `Runtime model read-back fixture ${marker}`,
        capabilities: { test: true },
      },
    });

    if (modelError || !model) {
      throw new Error(
        `Failed to create e2e runtime model: ${JSON.stringify(modelError)}`,
      );
    }

    const { data: profile, error: profileError } = await createRuntimeProfile({
      client,
      auth: () => agent.accessToken,
      headers: { 'x-moltnet-team-id': agent.personalTeamId },
      body: {
        name: `cpp-sdk-e2e-profile-${marker}`,
        provider: runtimeProvider,
        model: runtimeModel,
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

    const { data: claim, error: claimError } = await claimTask({
      client,
      auth: () => agent.accessToken,
      path: { id: claimedTask.id },
      body: { leaseTtlSec: 60, profileId: profile.id },
    });

    if (claimError || !claim) {
      throw new Error(
        `Failed to claim e2e task: ${JSON.stringify(claimError)}`,
      );
    }

    const { error: heartbeatError } = await taskHeartbeat({
      client,
      auth: () => agent.accessToken,
      path: { id: claimedTask.id, n: claim.attempt.attemptN },
      body: { leaseTtlSec: 60 },
    });

    if (heartbeatError) {
      throw new Error(
        `Failed to heartbeat e2e task attempt: ${JSON.stringify(heartbeatError)}`,
      );
    }

    const artifactBody = JSON.stringify({
      artifacts: [
        {
          kind: 'issue_lifecycle_state',
          body: JSON.stringify({
            phase: 'pr_review',
            decision: 'review_passed',
            summary: `C++ SDK artifact fixture ${marker}`,
            prReviewKind: 'complexity',
            findings: [],
          }),
        },
      ],
      marker,
    });

    const { data: artifact, error: artifactError } = await uploadTaskArtifact({
      client,
      auth: () => agent.accessToken,
      headers: { 'x-moltnet-team-id': agent.personalTeamId },
      path: {
        taskId: claimedTask.id,
        attemptN: claim.attempt.attemptN,
      },
      query: {
        kind: 'freeform_output',
        title: `C++ SDK e2e artifact ${marker}`,
        contentType: 'application/json',
      },
      body: new Blob([artifactBody], { type: 'application/json' }),
    });

    if (artifactError || !artifact) {
      throw new Error(
        `Failed to upload e2e task artifact: ${JSON.stringify(artifactError)}`,
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
          runtimeModelId: model.id,
          runtimeProvider,
          runtimeModel,
          profileId: profile.id,
          profiledTaskId: profiledTask.id,
          agentIdentityId: agent.identityId,
          claimedTaskId: claimedTask.id,
          claimedByAgentId: agent.identityId,
          artifactTaskId: artifact.taskId,
          artifactAttemptN: String(artifact.attemptN),
          artifactCid: artifact.cid,
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
