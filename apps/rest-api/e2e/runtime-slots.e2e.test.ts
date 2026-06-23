/**
 * E2E: Runtime slots
 *
 * Exercises the team-scoped runtime slot API through the generated client
 * against the Docker stack. These cases guard the task-attempt lock semantics
 * that keep stale daemon finishes from overwriting newer slot ownership.
 */

import { randomUUID } from 'node:crypto';

import {
  beginRuntimeSlot,
  claimTask,
  type Client,
  createClient,
  createDiary,
  createDiaryGrant,
  createTask,
  createTeam,
  createTeamInvite,
  findLatestRuntimeSlotForAttempt,
  finishRuntimeSlot,
  joinTeam,
} from '@moltnet/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('Runtime slots API', () => {
  let harness: TestHarness;
  let client: Client;
  let owner: TestAgent;
  let teammate: TestAgent;
  let outsider: TestAgent;
  let teamId: string;
  let diaryId: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });

    [owner, teammate, outsider] = await Promise.all([
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
      createAgent({
        baseUrl: harness.baseUrl,
        db: harness.db,
        bootstrapIdentityId: harness.bootstrapIdentityId,
      }),
    ]);

    const { data: team, error: teamError } = await createTeam({
      client,
      auth: () => owner.accessToken,
      body: { name: `runtime-slots-e2e-${randomUUID()}` },
    });
    expect(teamError).toBeUndefined();
    teamId = team!.id;

    const { data: invite, error: inviteError } = await createTeamInvite({
      client,
      auth: () => owner.accessToken,
      path: { id: teamId },
      body: { role: 'member', maxUses: 1, expiresInHours: 24 },
    });
    expect(inviteError).toBeUndefined();

    const { error: joinError } = await joinTeam({
      client,
      auth: () => teammate.accessToken,
      body: { code: invite!.code },
    });
    expect(joinError).toBeUndefined();

    const { data: diary, error: diaryError } = await createDiary({
      client,
      auth: () => owner.accessToken,
      headers: { 'x-moltnet-team-id': teamId },
      body: { name: 'runtime-slots', visibility: 'moltnet' },
    });
    expect(diaryError).toBeUndefined();
    diaryId = diary!.id;

    const { error: grantError } = await createDiaryGrant({
      client,
      auth: () => owner.accessToken,
      path: { id: diaryId },
      body: {
        role: 'writer',
        subjectId: teammate.identityId,
        subjectNs: 'Agent',
      },
    });
    expect(grantError).toBeUndefined();
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  async function createClaimedSlotTask(taskPrompt: string) {
    const { data, error } = await createTask({
      client,
      auth: () => owner.accessToken,
      body: {
        taskType: 'curate_pack',
        teamId,
        diaryId,
        input: { diaryId, taskPrompt },
      },
    });
    expect(error).toBeUndefined();
    const { data: claimed, error: claimError } = await claimTask({
      client,
      auth: () => teammate.accessToken,
      path: { id: data!.id },
      body: { leaseTtlSec: 60 },
    });
    expect(claimError).toBeUndefined();
    return { attemptN: claimed!.attempt.attemptN, taskId: data!.id };
  }

  async function createUnclaimedSlotTask(taskPrompt: string) {
    const { data, error } = await createTask({
      client,
      auth: () => owner.accessToken,
      body: {
        taskType: 'curate_pack',
        teamId,
        diaryId,
        input: { diaryId, taskPrompt },
      },
    });
    expect(error).toBeUndefined();
    return data!.id;
  }

  async function beginSlot(
    taskId: string,
    attemptN: number,
    sessionPath: string,
  ) {
    const { data, error, response } = await beginRuntimeSlot({
      client,
      auth: () => teammate.accessToken,
      headers: { 'x-moltnet-team-id': teamId },
      body: {
        agentName: 'legreffier',
        lastAttemptN: attemptN,
        lastTaskId: taskId,
        model: 'claude-sonnet-4-5',
        provider: 'anthropic',
        sessionDir: '/tmp/moltnet/e2e-sessions',
        sessionPath,
        slotKey: 'curate_pack:correlation:runtime-slots',
        taskType: 'curate_pack',
        workspaceId: 'workspace-e2e',
        workspaceKind: 'origin',
        worktreeBranch: 'issue-1414',
        worktreePath: '/tmp/moltnet/e2e-worktree',
      },
    });
    expect(error).toBeUndefined();
    expect(response.status).toBe(200);
    return data!;
  }

  it('lets another team member resolve a finished producer slot for the task attempt', async () => {
    const { attemptN, taskId } = await createClaimedSlotTask(
      'producer slot teammate access',
    );
    await beginSlot(
      taskId,
      attemptN,
      '/tmp/moltnet/e2e-sessions/producer.jsonl',
    );

    const { data: finished, error: finishError } = await finishRuntimeSlot({
      client,
      auth: () => teammate.accessToken,
      headers: { 'x-moltnet-team-id': teamId },
      body: {
        agentName: 'legreffier',
        attemptN,
        model: 'claude-sonnet-4-5',
        provider: 'anthropic',
        sessionPath: '/tmp/moltnet/e2e-sessions/producer-finished.jsonl',
        slotKey: 'curate_pack:correlation:runtime-slots',
        taskId,
      },
    });
    expect(finishError).toBeUndefined();
    expect(finished!.state).toBe('idle');

    const {
      data: resolved,
      error,
      response,
    } = await findLatestRuntimeSlotForAttempt({
      client,
      auth: () => owner.accessToken,
      headers: { 'x-moltnet-team-id': teamId },
      query: { attemptN, taskId },
    });

    expect(error).toBeUndefined();
    expect(response.status).toBe(200);
    expect(resolved!.slot.lastTaskId).toBe(taskId);
    expect(resolved!.slot.lastAttemptN).toBe(attemptN);
    expect(resolved!.slot.sessionPath).toBe(
      '/tmp/moltnet/e2e-sessions/producer-finished.jsonl',
    );
    expect(resolved!.workspace?.workspaceId).toBe('workspace-e2e');
  });

  it('rejects a stale finish after the same slot has moved to a newer task attempt', async () => {
    const first = await createClaimedSlotTask('stale finish first task');
    const second = await createClaimedSlotTask('stale finish second task');

    await beginSlot(
      first.taskId,
      first.attemptN,
      '/tmp/moltnet/e2e-sessions/stale-first.jsonl',
    );
    await beginSlot(
      second.taskId,
      second.attemptN,
      '/tmp/moltnet/e2e-sessions/stale-second.jsonl',
    );

    const staleFinish = await finishRuntimeSlot({
      client,
      auth: () => teammate.accessToken,
      headers: { 'x-moltnet-team-id': teamId },
      body: {
        agentName: 'legreffier',
        attemptN: first.attemptN,
        model: 'claude-sonnet-4-5',
        provider: 'anthropic',
        sessionPath: '/tmp/moltnet/e2e-sessions/stale-overwrite.jsonl',
        slotKey: 'curate_pack:correlation:runtime-slots',
        taskId: first.taskId,
      },
    });

    expect(staleFinish.response.status).toBe(409);

    const current = await findLatestRuntimeSlotForAttempt({
      client,
      auth: () => owner.accessToken,
      headers: { 'x-moltnet-team-id': teamId },
      query: { attemptN: second.attemptN, taskId: second.taskId },
    });

    expect(current.error).toBeUndefined();
    expect(current.data!.slot.lastTaskId).toBe(second.taskId);
    expect(current.data!.slot.state).toBe('active');
    expect(current.data!.slot.sessionPath).toBe(
      '/tmp/moltnet/e2e-sessions/stale-second.jsonl',
    );
  });

  it('rejects begin for an unclaimed task attempt before the database FK fires', async () => {
    const taskId = await createUnclaimedSlotTask('unclaimed attempt spoof');

    const response = await beginRuntimeSlot({
      client,
      auth: () => teammate.accessToken,
      headers: { 'x-moltnet-team-id': teamId },
      body: {
        agentName: 'legreffier',
        lastAttemptN: 1,
        lastTaskId: taskId,
        model: 'claude-sonnet-4-5',
        provider: 'anthropic',
        sessionDir: '/tmp/moltnet/e2e-sessions',
        sessionPath: '/tmp/moltnet/e2e-sessions/unclaimed.jsonl',
        slotKey: 'curate_pack:correlation:unclaimed',
        taskType: 'curate_pack',
      },
    });

    expect(response.response.status).toBe(400);
    expect(response.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      errors: [{ field: 'attemptN' }],
    });
  });

  it('rejects non-member spoofing without moving the victim slot', async () => {
    const { attemptN, taskId } = await createClaimedSlotTask(
      'non-member spoofing',
    );
    await beginSlot(
      taskId,
      attemptN,
      '/tmp/moltnet/e2e-sessions/non-member.jsonl',
    );

    const notMemberFind = await findLatestRuntimeSlotForAttempt({
      client,
      auth: () => outsider.accessToken,
      headers: { 'x-moltnet-team-id': teamId },
      query: { attemptN, taskId },
    });
    expect(notMemberFind.response.status).toBe(403);

    const notMemberFinish = await finishRuntimeSlot({
      client,
      auth: () => outsider.accessToken,
      headers: { 'x-moltnet-team-id': teamId },
      body: {
        agentName: 'legreffier',
        attemptN,
        model: 'claude-sonnet-4-5',
        provider: 'anthropic',
        sessionPath: '/tmp/moltnet/e2e-sessions/non-member-overwrite.jsonl',
        slotKey: 'curate_pack:correlation:runtime-slots',
        taskId,
      },
    });
    expect(notMemberFinish.response.status).toBe(403);

    const current = await findLatestRuntimeSlotForAttempt({
      client,
      auth: () => owner.accessToken,
      headers: { 'x-moltnet-team-id': teamId },
      query: { attemptN, taskId },
    });
    expect(current.error).toBeUndefined();
    expect(current.data!.slot.state).toBe('active');
    expect(current.data!.slot.sessionPath).toBe(
      '/tmp/moltnet/e2e-sessions/non-member.jsonl',
    );
  });

  it('rejects binding another team task into a caller-owned slot namespace', async () => {
    const { attemptN, taskId } =
      await createClaimedSlotTask('wrong-team binding');

    const response = await beginRuntimeSlot({
      client,
      auth: () => outsider.accessToken,
      headers: { 'x-moltnet-team-id': outsider.personalTeamId },
      body: {
        agentName: 'legreffier',
        lastAttemptN: attemptN,
        lastTaskId: taskId,
        model: 'claude-sonnet-4-5',
        provider: 'anthropic',
        sessionDir: '/tmp/moltnet/e2e-sessions',
        sessionPath: '/tmp/moltnet/e2e-sessions/wrong-team.jsonl',
        slotKey: 'curate_pack:correlation:wrong-team',
        taskType: 'curate_pack',
      },
    });

    expect(response.response.status).toBe(400);
    expect(response.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      errors: [{ field: 'taskId' }],
    });
  });
});
