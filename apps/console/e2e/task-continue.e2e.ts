import { randomBytes, randomUUID } from 'node:crypto';

import {
  createDaemonProfile,
  createDiary,
  createDiaryGrant,
  createTeam,
  getTask,
  listTasks,
  listTeams,
} from '@moltnet/api-client';
import { Configuration, FrontendApi } from '@ory/client-fetch';
import { expect, type Page, test } from '@playwright/test';

import {
  type ConnectedAgent,
  provisionAgent,
  seedCompletedFreeformAttempt,
} from './helpers/agent-seed.js';
import {
  CONSOLE_URL,
  createNativeSessionToken,
  createTestUser,
  createTokenSessionApiClient,
  KRATOS_PUBLIC_URL,
  loginViaBrowser,
  registerViaBrowser,
} from './helpers/index.js';

// task-continue.e2e — covers the "Continue this task" affordance on
// TaskAttemptPage (#1303). The button + Resumable badge render only when:
//   1. parent task type is `freeform`
//   2. attempt status is `completed`
//   3. attempt.daemonState.slotResumableUntil is set and in the future
//
// (3) is daemon-only state. The test bootstraps a fresh genesis agent
// and a shared team (human as owner, agent as member — personal teams
// reject membership changes), then drives a real claim → heartbeat →
// complete cycle with a synthesized daemonState so the human's console
// sees a warm-resumable attempt.

test.describe.serial('Continue task from console', () => {
  const user = createTestUser({ prefix: 'task-continue-e2e' });
  const nonce = randomBytes(3).toString('hex');
  const sourceTitle = `Source ${nonce}`;
  const correlationId = randomUUID();

  let sessionToken: string;
  let sharedTeamId: string;
  let humanDiaryId: string;
  let agentCtx: ConnectedAgent;
  let sourceTaskId: string;
  let sourceAttemptN: number;
  let allowedProfileId: string;

  test.afterAll(async () => {
    await agentCtx?.teardown();
  });

  test('registers a human + provisions an agent in a shared team', async ({
    page,
  }) => {
    await registerViaBrowser(page, user);
    await page.goto(CONSOLE_URL);
    await expect(page.getByText('Welcome')).toBeVisible();

    sessionToken = await createNativeSessionToken(user);
    const humanClient = createTokenSessionApiClient(sessionToken);

    // Verify the human has a personal team (registration triggered the
    // welcome flow), then resolve the human's Kratos identity id — that
    // is the subjectId needed when listing them as a founding member of
    // the shared team below.
    const personal = (
      await listTeams({ client: humanClient })
    ).data?.items.find((t) => t.personal);
    if (!personal) throw new Error('expected a personal team');
    const kratos = new FrontendApi(
      new Configuration({ basePath: KRATOS_PUBLIC_URL }),
    );
    const session = await kratos.toSession({
      xSessionToken: sessionToken,
    });
    const humanSubjectId = session.identity?.id;
    if (!humanSubjectId) {
      throw new Error('Kratos session missing identity id');
    }

    agentCtx = await provisionAgent('task-continue-e2e');

    // Create a shared team with both human (owner) and agent (member)
    // as founding members. Personal teams reject invites
    // (TEAM_PERSONAL_IMMUTABLE), so we need a fresh non-personal team to
    // hold the cross-principal handshake.
    const created = await createTeam({
      client: humanClient,
      body: {
        name: `task-continue-shared-${nonce}`,
        foundingMembers: [
          { subjectId: humanSubjectId, subjectNs: 'Human', role: 'owner' },
          {
            subjectId: agentCtx.genesis.identityId,
            subjectNs: 'Agent',
            role: 'member',
          },
        ],
      },
    });
    if (!created.data?.id) {
      throw new Error(`createTeam failed: ${JSON.stringify(created.error)}`);
    }
    sharedTeamId = created.data.id;

    const profile = await createDaemonProfile({
      client: humanClient,
      path: { id: sharedTeamId },
      body: {
        name: `task-continue-profile-${nonce}`,
        runtimeKind: 'gondolin_pi',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        sandbox: {
          image: 'ghcr.io/getlarge/themoltnet/agent-runtime:e2e',
        },
      },
    });
    if (!profile.data?.id) {
      throw new Error(
        `createDaemonProfile failed: ${JSON.stringify(profile.error)}`,
      );
    }
    allowedProfileId = profile.data.id;

    // Create a diary inside the shared team so both the human (owner)
    // and the agent (member) can read tasks against it. The agent's
    // bootstrap-time private diary belongs to the agent's personal team
    // and isn't visible to the human — task auth checks diary access,
    // not team membership, so the seed must use a team-scoped diary.
    const diary = await createDiary({
      client: humanClient,
      headers: { 'x-moltnet-team-id': sharedTeamId },
      body: { name: `task-continue-diary-${nonce}`, visibility: 'private' },
    });
    if (!diary.data?.id) {
      throw new Error(`createDiary failed: ${JSON.stringify(diary.error)}`);
    }
    humanDiaryId = diary.data.id;

    // Grant the agent writer access on the human's diary so the agent
    // can propose tasks. Team membership alone is not enough for
    // diary-scoped actions; the diary owner has to explicitly grant.
    const grant = await createDiaryGrant({
      client: humanClient,
      path: { id: humanDiaryId },
      body: {
        subjectId: agentCtx.genesis.identityId,
        subjectNs: 'Agent',
        role: 'writer',
      },
    });
    if (grant.error || !grant.data) {
      throw new Error(
        `createDiaryGrant failed: ${JSON.stringify(grant.error)}`,
      );
    }
  });

  test('seeds a completed freeform parent with future slotResumableUntil', async () => {
    // Pin the source profile so the continuation-inherits-pinning
    // assertion later has concrete values to compare against. The
    // agent doesn't actually need to match this allowlist to claim the
    // source — we never run the continuation; we only assert the
    // create payload the console submitted carries the inheritance.
    const seeded = await seedCompletedFreeformAttempt({
      agent: agentCtx.agent,
      teamId: sharedTeamId,
      diaryId: humanDiaryId,
      brief: `Parent investigation ${nonce}`,
      title: sourceTitle,
      correlationId,
      allowedProfiles: [{ profileId: allowedProfileId }],
      requiredExecutorTrustLevel: 'selfDeclared',
    });
    sourceTaskId = seeded.taskId;
    sourceAttemptN = seeded.attemptN;
  });

  async function openSourceAttempt(page: Page): Promise<void> {
    await loginViaBrowser(page, user);
    await page.goto(
      `${CONSOLE_URL}/tasks/${sourceTaskId}/attempts/${sourceAttemptN}`,
    );
  }

  test('shows Resumable badge + Continue button on completed freeform', async ({
    page,
  }) => {
    await openSourceAttempt(page);
    await expect(page.getByText(/Resumable until/i)).toBeVisible();
    await expect(
      page.getByRole('button', { name: /^continue$/i }),
    ).toBeVisible();
  });

  test('Continue opens dialog pre-populated, submits a continuation', async ({
    page,
  }) => {
    await openSourceAttempt(page);

    await page.getByRole('button', { name: /^continue$/i }).click();
    await expect(page.getByLabel(/title/i)).toHaveValue(sourceTitle);
    await expect(
      page.getByRole('button', { name: /continue task/i }),
    ).toBeVisible();
    // Workspace + depends-on hidden in continuation mode.
    await expect(page.getByLabel(/workspace/i)).toHaveCount(0);

    const briefText = `Continuation brief ${nonce}`;
    await page.getByLabel(/brief/i).fill(briefText);
    await page.getByRole('button', { name: /continue task/i }).click();

    const humanClient = createTokenSessionApiClient(sessionToken);
    let newTaskId: string | undefined;
    await expect
      .poll(
        async () => {
          const tasks = (
            await listTasks({
              client: humanClient,
              query: { teamId: sharedTeamId },
            })
          ).data?.items;
          const match = tasks?.find(
            (t) =>
              typeof t.input === 'object' &&
              t.input !== null &&
              (t.input as { brief?: unknown }).brief === briefText,
          );
          newTaskId = match?.id;
          return Boolean(match);
        },
        { timeout: 20_000 },
      )
      .toBe(true);
    if (!newTaskId) throw new Error('continuation task not found');

    const newTask = (
      await getTask({ client: humanClient, path: { id: newTaskId } })
    ).data;
    expect(newTask?.taskType).toBe('freeform');
    const input = newTask?.input as {
      continueFrom?: { taskId?: string; attemptN?: number };
    };
    expect(input.continueFrom?.taskId).toBe(sourceTaskId);
    expect(input.continueFrom?.attemptN).toBe(sourceAttemptN);
    const claim = newTask?.claimCondition as
      | { op?: string; taskId?: string; statuses?: string[] }
      | undefined;
    expect(claim?.op).toBe('task_status');
    expect(claim?.taskId).toBe(sourceTaskId);
    expect(claim?.statuses).toEqual(['completed']);

    // Profile pinning must flow through — dropping it would let the
    // continuation be claimed by a profile the parent's proposer
    // explicitly excluded. Mirrors the MCP tasks_continue + Go CLI
    // task continue wire contracts.
    expect(newTask?.allowedProfiles).toEqual([{ profileId: allowedProfileId }]);
    expect(newTask?.requiredExecutorTrustLevel).toBe('selfDeclared');
  });
});
