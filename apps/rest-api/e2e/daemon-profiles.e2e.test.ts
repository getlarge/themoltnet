/**
 * E2E: Daemon Profiles API
 *
 * Covers team-scoped daemon profile CRUD and the task allowedProfiles
 * routing filter against a real REST API, database, and Keto stack.
 */

import {
  claimTask,
  type Client,
  createClient,
  createDaemonProfile,
  createTask,
  deleteDaemonProfile,
  getDaemonProfile,
  listDaemonProfiles,
  listTasks,
  updateDaemonProfile,
} from '@moltnet/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('Daemon Profiles API', () => {
  let harness: TestHarness;
  let client: Client;
  let owner: TestAgent;
  let outsider: TestAgent;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });

    [owner, outsider] = await Promise.all([
      createAgent({
        baseUrl: harness.baseUrl,
        db: harness.db,
        bootstrapIdentityId: harness.bootstrapIdentityId,
      }),
      createAgent({
        baseUrl: harness.baseUrl,
        db: harness.db,
        bootstrapIdentityId: harness.bootstrapIdentityId,
      }),
    ]);
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  function profileBody(name: string) {
    return {
      name,
      description: `${name} profile for e2e`,
      provider: 'Anthropic',
      model: 'Claude-Sonnet-4-5',
      sandbox: {
        resumeCommands: [
          {
            run: 'linear issue view "$LINEAR_ISSUE_ID"',
            when: { workspaceMode: ['dedicated_worktree' as const] },
            retries: 1,
          },
        ],
        hostExec: { autoApprove: false as const },
        resources: { cpus: 2, memory: '2G' },
      },
      requiredEnv: ['LINEAR_API_KEY', 'GITHUB_TOKEN'],
      requiredTools: ['linear.issue.get', 'github.pr.create'],
      context: [
        {
          slug: `${name}-workflow`,
          binding: 'skill' as const,
          content: 'Use Linear for brief intake and GitHub for delivery.',
        },
      ],
    };
  }

  function createProfile(name: string) {
    return createDaemonProfile({
      client,
      auth: () => owner.accessToken,
      path: { id: owner.personalTeamId },
      body: profileBody(name),
    });
  }

  function createFulfillBriefTask(
    title: string,
    allowedProfiles?: { profileId: string }[],
  ) {
    return createTask({
      client,
      auth: () => owner.accessToken,
      body: {
        taskType: 'fulfill_brief',
        title,
        teamId: owner.personalTeamId,
        diaryId: owner.privateDiaryId,
        allowedProfiles,
        input: { brief: title },
      },
    });
  }

  it('creates, lists, gets, updates, and deletes a daemon profile', async () => {
    const name = `linear-github-${Date.now()}`;
    const {
      data: created,
      error: createError,
      response: createResponse,
    } = await createProfile(name);

    expect(createResponse.status).toBe(201);
    expect(createError).toBeUndefined();
    expect(created).toMatchObject({
      name,
      teamId: owner.personalTeamId,
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      runtimeKind: 'gondolin_pi',
      sessionStorageMode: 'local',
      workspaceStorageMode: 'local',
      revision: 1,
    });
    expect(created!.definitionCid).toMatch(/^ba/);
    expect(created!.requiredEnv).toEqual(['LINEAR_API_KEY', 'GITHUB_TOKEN']);

    const { data: listed, error: listError } = await listDaemonProfiles({
      client,
      auth: () => owner.accessToken,
      path: { id: owner.personalTeamId },
    });
    expect(listError).toBeUndefined();
    expect(listed!.items.map((item) => item.id)).toContain(created!.id);

    const { data: fetched, error: getError } = await getDaemonProfile({
      client,
      auth: () => owner.accessToken,
      path: { profileId: created!.id },
    });
    expect(getError).toBeUndefined();
    expect(fetched!.id).toBe(created!.id);

    const { data: updated, error: updateError } = await updateDaemonProfile({
      client,
      auth: () => owner.accessToken,
      path: { profileId: created!.id },
      body: {
        model: 'Claude-Opus-4-1',
        sessionTtlSec: 3600,
      },
    });
    expect(updateError).toBeUndefined();
    expect(updated).toMatchObject({
      id: created!.id,
      model: 'claude-opus-4-1',
      sessionTtlSec: 3600,
      revision: 2,
    });
    expect(updated!.definitionCid).not.toBe(created!.definitionCid);

    const { response: deleteResponse, error: deleteError } =
      await deleteDaemonProfile({
        client,
        auth: () => owner.accessToken,
        path: { profileId: created!.id },
      });
    expect(deleteError).toBeUndefined();
    expect(deleteResponse.status).toBe(204);

    const { response: getDeletedResponse } = await getDaemonProfile({
      client,
      auth: () => owner.accessToken,
      path: { profileId: created!.id },
    });
    expect(getDeletedResponse.status).toBe(404);
  });

  it('does not leak profiles across team boundaries', async () => {
    const { data: profile } = await createProfile(
      `private-profile-${Date.now()}`,
    );
    expect(profile).toBeDefined();

    const { response: listResponse } = await listDaemonProfiles({
      client,
      auth: () => outsider.accessToken,
      path: { id: owner.personalTeamId },
    });
    expect(listResponse.status).toBe(404);

    const { response: getResponse } = await getDaemonProfile({
      client,
      auth: () => outsider.accessToken,
      path: { profileId: profile!.id },
    });
    expect(getResponse.status).toBe(404);

    const { response: createResponse } = await createDaemonProfile({
      client,
      auth: () => outsider.accessToken,
      path: { id: owner.personalTeamId },
      body: profileBody(`outsider-profile-${Date.now()}`),
    });
    expect(createResponse.status).toBe(403);
  });

  it('routes task listing by allowedProfiles while keeping unrestricted tasks visible', async () => {
    const { data: linearProfile } = await createProfile(
      `linear-profile-${Date.now()}`,
    );
    const { data: githubProfile } = await createProfile(
      `github-profile-${Date.now()}`,
    );
    expect(linearProfile).toBeDefined();
    expect(githubProfile).toBeDefined();

    const { data: unrestricted } = await createFulfillBriefTask(
      `unrestricted profile routing ${Date.now()}`,
    );
    const { data: linearOnly } = await createFulfillBriefTask(
      `linear profile routing ${Date.now()}`,
      [{ profileId: linearProfile!.id }],
    );
    const { data: githubOnly } = await createFulfillBriefTask(
      `github profile routing ${Date.now()}`,
      [{ profileId: githubProfile!.id }],
    );
    expect(unrestricted).toBeDefined();
    expect(linearOnly).toBeDefined();
    expect(githubOnly).toBeDefined();
    expect(linearOnly!.allowedProfiles).toEqual([
      { profileId: linearProfile!.id },
    ]);

    const { data: linearVisible, error: linearListError } = await listTasks({
      client,
      auth: () => owner.accessToken,
      query: {
        teamId: owner.personalTeamId,
        profileId: linearProfile!.id,
        limit: 100,
      },
    });
    expect(linearListError).toBeUndefined();
    const linearIds = linearVisible!.items.map((item) => item.id);
    expect(linearIds).toContain(unrestricted!.id);
    expect(linearIds).toContain(linearOnly!.id);
    expect(linearIds).not.toContain(githubOnly!.id);

    const { response: unknownProfileResponse } = await createFulfillBriefTask(
      `unknown profile routing ${Date.now()}`,
      [{ profileId: '00000000-0000-0000-0000-000000000000' }],
    );
    expect(unknownProfileResponse.status).toBe(400);
  });

  it('enforces allowedProfiles when claiming tasks', async () => {
    const { data: allowedProfile } = await createProfile(
      `claim-allowed-${Date.now()}`,
    );
    const { data: otherProfile } = await createProfile(
      `claim-other-${Date.now()}`,
    );
    expect(allowedProfile).toBeDefined();
    expect(otherProfile).toBeDefined();

    const { data: task } = await createFulfillBriefTask(
      `profile claim enforcement ${Date.now()}`,
      [{ profileId: allowedProfile!.id }],
    );
    expect(task).toBeDefined();

    const missingProfileClaim = await claimTask({
      client,
      auth: () => owner.accessToken,
      path: { id: task!.id },
      body: { leaseTtlSec: 30 },
    });
    expect(missingProfileClaim.response.status).toBe(403);

    const wrongProfileClaim = await claimTask({
      client,
      auth: () => owner.accessToken,
      path: { id: task!.id },
      body: { leaseTtlSec: 30, profileId: otherProfile!.id },
    });
    expect(wrongProfileClaim.response.status).toBe(403);

    const allowedProfileClaim = await claimTask({
      client,
      auth: () => owner.accessToken,
      path: { id: task!.id },
      body: { leaseTtlSec: 30, profileId: allowedProfile!.id },
    });
    expect(allowedProfileClaim.error).toBeUndefined();
    expect(allowedProfileClaim.response.status).toBe(200);
    expect(allowedProfileClaim.data!.task.id).toBe(task!.id);
  });

  it('rejects sandbox configs that request host exec auto-approval', async () => {
    const { response } = await createDaemonProfile({
      client,
      auth: () => owner.accessToken,
      path: { id: owner.personalTeamId },
      body: {
        name: `unsafe-profile-${Date.now()}`,
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        sandbox: {
          // @ts-expect-error exercising runtime validation for an unsafe config
          hostExec: { autoApprove: true },
        },
      },
    });

    expect(response.status).toBe(400);
  });
});
