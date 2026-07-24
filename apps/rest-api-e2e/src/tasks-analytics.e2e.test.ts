/**
 * E2E: Task analytics API
 *
 * Exercises product-metric reporting against a real Docker Compose stack:
 * team + diary permissions, runtime profile/session linkage, attempt
 * telemetry, token usage, and multi-value filters.
 */

import { randomUUID } from 'node:crypto';

import {
  appendTaskMessages,
  beginRuntimeSlot,
  claimTask,
  type Client,
  completeTask,
  createClient,
  createDiary,
  createDiaryGrant,
  createRuntimeProfile,
  createTask,
  createTeam,
  createTeamInvite,
  failTaskAttempt,
  getTask,
  getTaskActivityAnalytics,
  joinTeam,
  listTaskAttempts,
  taskHeartbeat,
} from '@moltnet/api-client';
import { computeJsonCid } from '@moltnet/crypto-service';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, pollUntil, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('Task Analytics API', () => {
  let harness: TestHarness;
  let client: Client;
  let proposer: TestAgent;
  let claimer: TestAgent;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });

    [proposer, claimer] = await Promise.all([
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

  function buildProducerVerification(inputCid: string) {
    return {
      inputCid,
      results: [
        {
          id: 'submit-output',
          kind: 'gate' as const,
          status: 'pass' as const,
          detail: 'submit tool criterion satisfied in e2e fixture',
        },
      ],
      passed: true,
    };
  }

  async function createAnalyticsTeamContext(name: string) {
    const { data: team, error: teamError } = await createTeam({
      client,
      auth: () => proposer.accessToken,
      body: { name: `${name}-${randomUUID()}` },
    });
    expect(teamError).toBeUndefined();
    const teamId = team!.id;

    const { data: invite, error: inviteError } = await createTeamInvite({
      client,
      auth: () => proposer.accessToken,
      path: { id: teamId },
      body: { role: 'manager', maxUses: 1, expiresInHours: 24 },
    });
    expect(inviteError).toBeUndefined();

    const joined = await joinTeam({
      client,
      auth: () => claimer.accessToken,
      body: { code: invite!.code },
    });
    expect(joined.error).toBeUndefined();

    const { data: diary, error: diaryError } = await createDiary({
      client,
      auth: () => proposer.accessToken,
      headers: { 'x-moltnet-team-id': teamId },
      body: { name: `${name}-diary-${randomUUID()}`, visibility: 'moltnet' },
    });
    expect(diaryError).toBeUndefined();
    const diaryId = diary!.id;

    const grant = await createDiaryGrant({
      client,
      auth: () => proposer.accessToken,
      path: { id: diaryId },
      body: {
        subjectId: claimer.identityId,
        subjectNs: 'Agent',
        role: 'writer',
      },
    });
    expect(grant.error).toBeUndefined();

    return { diaryId, teamId };
  }

  async function completeAnalyticsTask(input: {
    teamId: string;
    diaryId: string;
    tag: string;
    inputTokens: number;
    outputTokens: number;
  }) {
    const { data: task, error: createError } = await createTask({
      client,
      auth: () => proposer.accessToken,
      headers: { 'x-moltnet-team-id': input.teamId },
      body: {
        taskType: 'curate_pack',
        diaryId: input.diaryId,
        tags: [input.tag],
        input: {
          diaryId: input.diaryId,
          taskPrompt: 'measure team-scoped diary analytics',
        },
      },
    });
    expect(createError).toBeUndefined();

    const { data: claimed, error: claimError } = await claimTask({
      client,
      auth: () => claimer.accessToken,
      path: { id: task!.id },
      body: { leaseTtlSec: 60 },
    });
    expect(claimError).toBeUndefined();
    const attemptN = claimed!.attempt.attemptN;

    const heartbeat = await taskHeartbeat({
      client,
      auth: () => claimer.accessToken,
      path: { id: task!.id, n: attemptN },
      body: { leaseTtlSec: 60 },
    });
    expect(heartbeat.error).toBeUndefined();

    const output = {
      packId: '77777777-7777-4777-8777-777777777777',
      packCid: `bafyteamanalytics${input.teamId.replaceAll('-', '').slice(0, 8)}`,
      entries: [
        {
          entryId: '88888888-8888-4888-8888-888888888888',
          rank: 1,
          rationale: 'Relevant entry selected for team analytics scope.',
        },
      ],
      recipeParams: { recipe: 'analytics-team-scope-e2e' },
      summary: 'Created a pack receipt for team analytics scope.',
      verification: buildProducerVerification(task!.inputCid),
    };
    const outputCid = await computeJsonCid(output);

    const complete = await completeTask({
      client,
      auth: () => claimer.accessToken,
      path: { id: task!.id, n: attemptN },
      body: {
        output,
        outputCid,
        usage: {
          inputTokens: input.inputTokens,
          model: 'claude-sonnet-4-5',
          outputTokens: input.outputTokens,
          provider: 'anthropic',
        },
      },
    });
    expect(complete.error).toBeUndefined();

    await pollUntil(
      () =>
        getTask({
          client,
          auth: () => proposer.accessToken,
          path: { id: task!.id },
        }).then((r) => r.data!),
      (current) => current.status === 'completed',
      {
        label: 'task.analytics.team-scope.completed',
        maxAttempts: 30,
        intervalMs: 500,
      },
    );
  }

  describe('GET /tasks/analytics/activity', () => {
    it('reports product metrics from completed attempts and filters by multiple profiles and diaries', async () => {
      const completedAfter = new Date(Date.now() - 60_000).toISOString();
      const { data: team, error: teamError } = await createTeam({
        client,
        auth: () => proposer.accessToken,
        body: { name: `task-analytics-${randomUUID()}` },
      });
      expect(teamError).toBeUndefined();
      const teamId = team!.id;

      const { data: invite, error: inviteError } = await createTeamInvite({
        client,
        auth: () => proposer.accessToken,
        path: { id: teamId },
        body: { role: 'manager', maxUses: 1, expiresInHours: 24 },
      });
      expect(inviteError).toBeUndefined();

      const joined = await joinTeam({
        client,
        auth: () => claimer.accessToken,
        body: { code: invite!.code },
      });
      expect(joined.error).toBeUndefined();

      const { data: diary, error: diaryError } = await createDiary({
        client,
        auth: () => proposer.accessToken,
        headers: { 'x-moltnet-team-id': teamId },
        body: { name: `task-analytics-${randomUUID()}`, visibility: 'moltnet' },
      });
      expect(diaryError).toBeUndefined();
      const diaryId = diary!.id;

      const grant = await createDiaryGrant({
        client,
        auth: () => proposer.accessToken,
        path: { id: diaryId },
        body: {
          subjectId: claimer.identityId,
          subjectNs: 'Agent',
          role: 'writer',
        },
      });
      expect(grant.error).toBeUndefined();

      const { data: profile, error: profileError } = await createRuntimeProfile(
        {
          client,
          auth: () => proposer.accessToken,
          headers: { 'x-moltnet-team-id': teamId },
          body: {
            name: `task-analytics-${randomUUID()}`,
            description: 'Task analytics e2e profile',
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
            sandbox: {
              hostExec: { autoApprove: false },
              resources: { cpus: 2, memory: '2G' },
            },
          },
        },
      );
      expect(profileError).toBeUndefined();

      const { data: otherDiary, error: otherDiaryError } = await createDiary({
        client,
        auth: () => proposer.accessToken,
        headers: { 'x-moltnet-team-id': teamId },
        body: { name: `task-analytics-${randomUUID()}`, visibility: 'moltnet' },
      });
      expect(otherDiaryError).toBeUndefined();

      const { data: task, error: createError } = await createTask({
        client,
        auth: () => proposer.accessToken,
        headers: { 'x-moltnet-team-id': teamId },
        body: {
          taskType: 'curate_pack',
          diaryId,
          tags: ['analytics-e2e', 'roi'],
          allowedProfiles: [{ profileId: profile!.id }],
          input: {
            diaryId,
            taskPrompt: 'measure task analytics e2e',
          },
        },
      });
      expect(createError).toBeUndefined();

      const { data: claimed, error: claimError } = await claimTask({
        client,
        auth: () => claimer.accessToken,
        path: { id: task!.id },
        body: { leaseTtlSec: 60, profileId: profile!.id },
      });
      expect(claimError).toBeUndefined();
      const attemptN = claimed!.attempt.attemptN;

      const slot = await beginRuntimeSlot({
        client,
        auth: () => claimer.accessToken,
        headers: { 'x-moltnet-team-id': teamId },
        body: {
          agentName: 'legreffier',
          runtimeProfileId: profile!.id,
          lastAttemptN: attemptN,
          lastTaskId: task!.id,
          model: 'claude-sonnet-4-5',
          provider: 'anthropic',
          sessionDir: '/tmp/moltnet/e2e-sessions',
          sessionPath: `/tmp/moltnet/e2e-sessions/${task!.id}.jsonl`,
          slotKey: `curate_pack:analytics:${task!.id}`,
          taskType: 'curate_pack',
          workspaceId: 'workspace-e2e',
          workspaceKind: 'origin',
          worktreeBranch: 'task-analytics-e2e',
          worktreePath: '/tmp/moltnet/e2e-worktree',
        },
      });
      expect(slot.error).toBeUndefined();

      const heartbeat = await taskHeartbeat({
        client,
        auth: () => claimer.accessToken,
        path: { id: task!.id, n: attemptN },
        body: { leaseTtlSec: 60 },
      });
      expect(heartbeat.error).toBeUndefined();

      const append = await appendTaskMessages({
        client,
        auth: () => claimer.accessToken,
        path: { id: task!.id, n: attemptN },
        body: {
          messages: [
            { kind: 'turn_end', payload: { turn: 1 } },
            {
              kind: 'tool_call_start',
              payload: { tool_name: 'diary_entry_search' },
            },
            {
              kind: 'tool_call_end',
              payload: { is_error: true, message: 'search failed once' },
            },
            { kind: 'tool_call_start', payload: { tool_name: 'pack_get' } },
            { kind: 'tool_call_end', payload: { is_error: false } },
            { kind: 'turn_end', payload: { turn: 2 } },
          ],
        },
      });
      expect(append.error).toBeUndefined();

      const output = {
        packId: '11111111-1111-4111-8111-111111111111',
        packCid: 'bafycurateanalyticsreceipt',
        entries: [
          {
            entryId: '22222222-2222-4222-8222-222222222222',
            rank: 1,
            rationale: 'Relevant entry selected for analytics e2e.',
          },
        ],
        recipeParams: { recipe: 'analytics-e2e' },
        summary: 'Created a pack receipt for analytics e2e.',
        verification: buildProducerVerification(task!.inputCid),
      };
      const outputCid = await computeJsonCid(output);

      const complete = await completeTask({
        client,
        auth: () => claimer.accessToken,
        path: { id: task!.id, n: attemptN },
        body: {
          output,
          outputCid,
          usage: {
            inputTokens: 120,
            model: 'claude-sonnet-4-5',
            outputTokens: 80,
            provider: 'anthropic',
          },
        },
      });
      expect(complete.error).toBeUndefined();

      await pollUntil(
        () =>
          getTask({
            client,
            auth: () => proposer.accessToken,
            path: { id: task!.id },
          }).then((r) => r.data!),
        (current) => current.status === 'completed',
        { label: 'task.analytics.completed', maxAttempts: 30, intervalMs: 500 },
      );

      const completedBefore = new Date(Date.now() + 60_000).toISOString();
      const analytics = await pollUntil(
        () =>
          getTaskActivityAnalytics({
            client,
            auth: () => proposer.accessToken,
            headers: { 'x-moltnet-team-id': teamId },
            query: {
              claimedByAgentIds: [claimer.identityId],
              completedAfter,
              completedBefore,
              diaryIds: [diaryId, diaryId, otherDiary!.id],
              groupBy: 'profile',
              profileIds: [
                profile!.id,
                profile!.id,
                '00000000-0000-0000-0000-000000000000',
              ],
              tags: ['analytics-e2e'],
              taskTypes: ['curate_pack'],
            },
          }).then((r) => {
            expect(r.error).toBeUndefined();
            return r.data!;
          }),
        (data) =>
          data.statsComplete &&
          data.overall.raw.toolCallCount === 2 &&
          data.groups.length === 1,
        { label: 'task.analytics.stats', maxAttempts: 20, intervalMs: 250 },
      );

      expect(analytics.overall.success.taskCount).toBe(1);
      expect(analytics.overall.success.acceptedTaskCount).toBe(1);
      expect(analytics.overall.success.acceptedOutputRate).toBe(1);
      expect(analytics.overall.success.firstAttemptAcceptedRate).toBe(1);
      expect(analytics.overall.productivity.attemptCount).toBe(1);
      expect(analytics.overall.productivity.medianTurnsPerAttempt).toBe(2);
      expect(analytics.overall.productivity.medianToolCallsPerAttempt).toBe(2);
      expect(analytics.overall.roi.totalInputTokens).toBe(120);
      expect(analytics.overall.roi.totalOutputTokens).toBe(80);
      expect(analytics.overall.roi.totalTokens).toBe(200);
      expect(analytics.overall.roi.tokensPerAcceptedTask).toBe(200);
      expect(analytics.overall.roi.acceptedTasksPerThousandTokens).toBe(5);
      expect(analytics.overall.hurdles.failedToolCallCount).toBe(1);
      expect(analytics.overall.hurdles.failedToolCallRate).toBe(0.5);
      expect(analytics.overall.knowledge.knowledgeToolCallCount).toBe(2);
      expect(analytics.overall.knowledge.entrySearchCount).toBe(1);
      expect(analytics.overall.knowledge.packGetCount).toBe(1);
      expect(analytics.groups[0].key).toBe(profile!.id);
      expect(analytics.groups[0].metrics.success.acceptedTaskCount).toBe(1);
    });

    it('attributes accepted tasks only to the profile that completed the accepted attempt', async () => {
      const completedAfter = new Date(Date.now() - 60_000).toISOString();
      const tag = `analytics-retry-${randomUUID()}`;
      const { data: team, error: teamError } = await createTeam({
        client,
        auth: () => proposer.accessToken,
        body: { name: `task-analytics-retry-${randomUUID()}` },
      });
      expect(teamError).toBeUndefined();
      const teamId = team!.id;

      const { data: invite, error: inviteError } = await createTeamInvite({
        client,
        auth: () => proposer.accessToken,
        path: { id: teamId },
        body: { role: 'manager', maxUses: 1, expiresInHours: 24 },
      });
      expect(inviteError).toBeUndefined();

      const joined = await joinTeam({
        client,
        auth: () => claimer.accessToken,
        body: { code: invite!.code },
      });
      expect(joined.error).toBeUndefined();

      const { data: diary, error: diaryError } = await createDiary({
        client,
        auth: () => proposer.accessToken,
        headers: { 'x-moltnet-team-id': teamId },
        body: {
          name: `task-analytics-retry-${randomUUID()}`,
          visibility: 'moltnet',
        },
      });
      expect(diaryError).toBeUndefined();
      const diaryId = diary!.id;

      const grant = await createDiaryGrant({
        client,
        auth: () => proposer.accessToken,
        path: { id: diaryId },
        body: {
          subjectId: claimer.identityId,
          subjectNs: 'Agent',
          role: 'writer',
        },
      });
      expect(grant.error).toBeUndefined();

      const failedProfile = await createRuntimeProfile({
        client,
        auth: () => proposer.accessToken,
        headers: { 'x-moltnet-team-id': teamId },
        body: {
          name: `task-analytics-failed-${randomUUID()}`,
          description: 'Task analytics failed-attempt profile',
          provider: 'anthropic',
          model: 'claude-haiku-3-5',
          sandbox: {
            hostExec: { autoApprove: false },
            resources: { cpus: 1, memory: '1G' },
          },
        },
      });
      expect(failedProfile.error).toBeUndefined();

      const acceptedProfile = await createRuntimeProfile({
        client,
        auth: () => proposer.accessToken,
        headers: { 'x-moltnet-team-id': teamId },
        body: {
          name: `task-analytics-accepted-${randomUUID()}`,
          description: 'Task analytics accepted-attempt profile',
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          sandbox: {
            hostExec: { autoApprove: false },
            resources: { cpus: 2, memory: '2G' },
          },
        },
      });
      expect(acceptedProfile.error).toBeUndefined();

      const { data: task, error: createError } = await createTask({
        client,
        auth: () => proposer.accessToken,
        headers: { 'x-moltnet-team-id': teamId },
        body: {
          taskType: 'curate_pack',
          diaryId,
          tags: [tag],
          maxAttempts: 2,
          allowedProfiles: [
            { profileId: failedProfile.data!.id },
            { profileId: acceptedProfile.data!.id },
          ],
          input: {
            diaryId,
            taskPrompt: 'measure retry attribution by runtime profile',
          },
        },
      });
      expect(createError).toBeUndefined();

      const firstClaim = await claimTask({
        client,
        auth: () => claimer.accessToken,
        path: { id: task!.id },
        body: { leaseTtlSec: 60, profileId: failedProfile.data!.id },
      });
      expect(firstClaim.error).toBeUndefined();
      const firstAttemptN = firstClaim.data!.attempt.attemptN;

      const firstSlot = await beginRuntimeSlot({
        client,
        auth: () => claimer.accessToken,
        headers: { 'x-moltnet-team-id': teamId },
        body: {
          agentName: 'legreffier',
          runtimeProfileId: failedProfile.data!.id,
          lastAttemptN: firstAttemptN,
          lastTaskId: task!.id,
          model: 'claude-haiku-3-5',
          provider: 'anthropic',
          sessionDir: '/tmp/moltnet/e2e-sessions',
          sessionPath: `/tmp/moltnet/e2e-sessions/${task!.id}-1.jsonl`,
          slotKey: `curate_pack:analytics-retry:${task!.id}:1`,
          taskType: 'curate_pack',
          workspaceId: 'workspace-e2e',
          workspaceKind: 'origin',
          worktreeBranch: 'task-analytics-retry-e2e',
          worktreePath: '/tmp/moltnet/e2e-worktree',
        },
      });
      expect(firstSlot.error).toBeUndefined();

      const firstHeartbeat = await taskHeartbeat({
        client,
        auth: () => claimer.accessToken,
        path: { id: task!.id, n: firstAttemptN },
        body: { leaseTtlSec: 60 },
      });
      expect(firstHeartbeat.error).toBeUndefined();

      const firstAppend = await appendTaskMessages({
        client,
        auth: () => claimer.accessToken,
        path: { id: task!.id, n: firstAttemptN },
        body: {
          messages: [
            { kind: 'turn_end', payload: { turn: 1 } },
            {
              kind: 'tool_call_start',
              payload: { tool_name: 'diary_entry_search' },
            },
            {
              kind: 'tool_call_end',
              payload: { is_error: true, message: 'profile failed' },
            },
          ],
        },
      });
      expect(firstAppend.error).toBeUndefined();

      const failed = await failTaskAttempt({
        client,
        auth: () => claimer.accessToken,
        path: { id: task!.id, n: firstAttemptN },
        body: {
          error: {
            code: 'transient',
            message: 'first profile failed before acceptance',
            retryable: true,
          },
        },
      });
      expect(failed.error).toBeUndefined();

      await pollUntil(
        () =>
          getTask({
            client,
            auth: () => proposer.accessToken,
            path: { id: task!.id },
          }).then((r) => r.data!),
        (current) => current.status === 'queued',
        {
          label: 'task.analytics.retry.requeued',
          maxAttempts: 20,
          intervalMs: 250,
        },
      );

      const secondClaim = await claimTask({
        client,
        auth: () => claimer.accessToken,
        path: { id: task!.id },
        body: { leaseTtlSec: 60, profileId: acceptedProfile.data!.id },
      });
      expect(secondClaim.error).toBeUndefined();
      const secondAttemptN = secondClaim.data!.attempt.attemptN;
      expect(secondAttemptN).toBe(2);

      const secondSlot = await beginRuntimeSlot({
        client,
        auth: () => claimer.accessToken,
        headers: { 'x-moltnet-team-id': teamId },
        body: {
          agentName: 'legreffier',
          runtimeProfileId: acceptedProfile.data!.id,
          lastAttemptN: secondAttemptN,
          lastTaskId: task!.id,
          model: 'claude-sonnet-4-5',
          provider: 'anthropic',
          sessionDir: '/tmp/moltnet/e2e-sessions',
          sessionPath: `/tmp/moltnet/e2e-sessions/${task!.id}-2.jsonl`,
          slotKey: `curate_pack:analytics-retry:${task!.id}:2`,
          taskType: 'curate_pack',
          workspaceId: 'workspace-e2e',
          workspaceKind: 'origin',
          worktreeBranch: 'task-analytics-retry-e2e',
          worktreePath: '/tmp/moltnet/e2e-worktree',
        },
      });
      expect(secondSlot.error).toBeUndefined();

      const secondHeartbeat = await taskHeartbeat({
        client,
        auth: () => claimer.accessToken,
        path: { id: task!.id, n: secondAttemptN },
        body: { leaseTtlSec: 60 },
      });
      expect(secondHeartbeat.error).toBeUndefined();

      const secondAppend = await appendTaskMessages({
        client,
        auth: () => claimer.accessToken,
        path: { id: task!.id, n: secondAttemptN },
        body: {
          messages: [
            { kind: 'turn_end', payload: { turn: 1 } },
            { kind: 'tool_call_start', payload: { tool_name: 'pack_get' } },
            { kind: 'tool_call_end', payload: { is_error: false } },
          ],
        },
      });
      expect(secondAppend.error).toBeUndefined();

      const output = {
        packId: '55555555-5555-4555-8555-555555555555',
        packCid: 'bafyretryanalyticsreceipt',
        entries: [
          {
            entryId: '66666666-6666-4666-8666-666666666666',
            rank: 1,
            rationale: 'Relevant entry selected after retry.',
          },
        ],
        recipeParams: { recipe: 'analytics-retry-e2e' },
        summary: 'Created a pack receipt after retry.',
        verification: buildProducerVerification(task!.inputCid),
      };
      const outputCid = await computeJsonCid(output);

      const complete = await completeTask({
        client,
        auth: () => claimer.accessToken,
        path: { id: task!.id, n: secondAttemptN },
        body: {
          output,
          outputCid,
          usage: {
            inputTokens: 300,
            model: 'claude-sonnet-4-5',
            outputTokens: 100,
            provider: 'anthropic',
          },
        },
      });
      expect(complete.error).toBeUndefined();

      await pollUntil(
        () =>
          getTask({
            client,
            auth: () => proposer.accessToken,
            path: { id: task!.id },
          }).then((r) => r.data!),
        (current) => current.status === 'completed',
        {
          label: 'task.analytics.retry.completed',
          maxAttempts: 30,
          intervalMs: 500,
        },
      );

      const completedBefore = new Date(Date.now() + 60_000).toISOString();
      const grouped = await pollUntil(
        () =>
          getTaskActivityAnalytics({
            client,
            auth: () => proposer.accessToken,
            headers: { 'x-moltnet-team-id': teamId },
            query: {
              completedAfter,
              completedBefore,
              diaryIds: [diaryId],
              groupBy: 'profile',
              tags: [tag],
            },
          }).then((r) => {
            expect(r.error).toBeUndefined();
            return r.data!;
          }),
        (data) => data.statsComplete && data.groups.length === 2,
        {
          label: 'task.analytics.retry.grouped',
          maxAttempts: 20,
          intervalMs: 250,
        },
      );

      const failedGroup = grouped.groups.find(
        (group) => group.key === failedProfile.data!.id,
      );
      const acceptedGroup = grouped.groups.find(
        (group) => group.key === acceptedProfile.data!.id,
      );
      expect(failedGroup).toBeDefined();
      expect(acceptedGroup).toBeDefined();
      expect(grouped.overall.success.taskCount).toBe(1);
      expect(grouped.overall.success.acceptedTaskCount).toBe(1);
      expect(grouped.overall.success.retryRecoveredTaskCount).toBe(1);
      expect(grouped.overall.productivity.attemptCount).toBe(2);
      expect(grouped.overall.roi.tokensPerAcceptedTask).toBe(400);
      expect(failedGroup!.metrics.success.taskCount).toBe(1);
      expect(failedGroup!.metrics.success.acceptedTaskCount).toBe(0);
      expect(failedGroup!.metrics.success.retryRecoveredTaskCount).toBe(0);
      expect(failedGroup!.metrics.roi.tokensPerAcceptedTask).toBeNull();
      expect(acceptedGroup!.metrics.success.taskCount).toBe(1);
      expect(acceptedGroup!.metrics.success.acceptedTaskCount).toBe(1);
      expect(acceptedGroup!.metrics.success.retryRecoveredTaskCount).toBe(1);
      expect(acceptedGroup!.metrics.roi.tokensPerAcceptedTask).toBe(400);

      const failedProfileOnly = await getTaskActivityAnalytics({
        client,
        auth: () => proposer.accessToken,
        headers: { 'x-moltnet-team-id': teamId },
        query: {
          completedAfter,
          completedBefore,
          diaryIds: [diaryId],
          profileIds: [failedProfile.data!.id],
          tags: [tag],
        },
      });
      expect(failedProfileOnly.error).toBeUndefined();
      expect(failedProfileOnly.data!.overall.success.taskCount).toBe(1);
      expect(failedProfileOnly.data!.overall.success.acceptedTaskCount).toBe(0);
      expect(failedProfileOnly.data!.overall.success.acceptedOutputRate).toBe(
        0,
      );
      expect(
        failedProfileOnly.data!.overall.roi.tokensPerAcceptedTask,
      ).toBeNull();

      const acceptedProfileOnly = await getTaskActivityAnalytics({
        client,
        auth: () => proposer.accessToken,
        headers: { 'x-moltnet-team-id': teamId },
        query: {
          completedAfter,
          completedBefore,
          diaryIds: [diaryId],
          profileIds: [acceptedProfile.data!.id],
          tags: [tag],
        },
      });
      expect(acceptedProfileOnly.error).toBeUndefined();
      expect(acceptedProfileOnly.data!.overall.success.taskCount).toBe(1);
      expect(acceptedProfileOnly.data!.overall.success.acceptedTaskCount).toBe(
        1,
      );
      expect(
        acceptedProfileOnly.data!.overall.success.retryRecoveredTaskCount,
      ).toBe(1);
    });

    it('includes timed-out attempts in activity stats and hurdle metrics', async () => {
      const completedAfter = new Date(Date.now() - 60_000).toISOString();
      const tag = `analytics-timeout-${randomUUID()}`;
      const { diaryId, teamId } = await createAnalyticsTeamContext(
        'task-analytics-timeout',
      );

      const { data: task, error: createError } = await createTask({
        client,
        auth: () => proposer.accessToken,
        headers: { 'x-moltnet-team-id': teamId },
        body: {
          taskType: 'curate_pack',
          diaryId,
          tags: [tag],
          maxAttempts: 1,
          dispatchTimeoutSec: 2,
          input: {
            diaryId,
            taskPrompt: 'measure timeout attempt analytics',
          },
        },
      });
      expect(createError).toBeUndefined();

      const claimed = await claimTask({
        client,
        auth: () => claimer.accessToken,
        path: { id: task!.id },
        body: { leaseTtlSec: 60 },
      });
      expect(claimed.error).toBeUndefined();
      const attemptN = claimed.data!.attempt.attemptN;

      const final = await pollUntil(
        () =>
          getTask({
            client,
            auth: () => proposer.accessToken,
            path: { id: task!.id },
          }).then((r) => r.data!),
        (current) => current.status === 'failed',
        {
          label: 'task.analytics.timeout.failed',
          maxAttempts: 30,
          intervalMs: 500,
        },
      );
      expect(final.status).toBe('failed');

      const attempts = await listTaskAttempts({
        client,
        auth: () => proposer.accessToken,
        path: { id: task!.id },
      });
      expect(attempts.error).toBeUndefined();
      expect(attempts.data).toHaveLength(1);
      expect(attempts.data![0].attemptN).toBe(attemptN);
      expect(attempts.data![0].status).toBe('timed_out');
      expect(attempts.data![0].error?.code).toBe('dispatch_expired');

      const completedBefore = new Date(Date.now() + 60_000).toISOString();
      const analytics = await pollUntil(
        () =>
          getTaskActivityAnalytics({
            client,
            auth: () => proposer.accessToken,
            headers: { 'x-moltnet-team-id': teamId },
            query: {
              completedAfter,
              completedBefore,
              diaryIds: [diaryId],
              tags: [tag],
              taskTypes: ['curate_pack'],
            },
          }).then((r) => {
            expect(r.error).toBeUndefined();
            return r.data!;
          }),
        (data) =>
          data.statsComplete && data.overall.productivity.attemptCount === 1,
        {
          label: 'task.analytics.timeout.stats',
          maxAttempts: 20,
          intervalMs: 250,
        },
      );

      expect(analytics.overall.success.taskCount).toBe(1);
      expect(analytics.overall.success.acceptedTaskCount).toBe(0);
      expect(analytics.overall.success.terminalFailureTaskCount).toBe(1);
      expect(analytics.overall.success.acceptedOutputRate).toBe(0);
      expect(analytics.overall.productivity.attemptCount).toBe(1);
      expect(analytics.overall.hurdles.timeoutAttemptCount).toBe(1);
      expect(analytics.overall.roi.totalTokens).toBe(0);
      expect(analytics.overall.roi.tokensPerAcceptedTask).toBeNull();
      expect(analytics.overall.roi.acceptedTasksPerThousandTokens).toBeNull();
    });

    it('keeps diaryIds constrained to the requested team', async () => {
      const completedAfter = new Date(Date.now() - 60_000).toISOString();
      const tag = `analytics-team-scope-${randomUUID()}`;
      const teamA = await createAnalyticsTeamContext('task-analytics-team-a');
      const teamB = await createAnalyticsTeamContext('task-analytics-team-b');

      await completeAnalyticsTask({
        ...teamA,
        tag,
        inputTokens: 70,
        outputTokens: 30,
      });
      await completeAnalyticsTask({
        ...teamB,
        tag,
        inputTokens: 700,
        outputTokens: 300,
      });

      const completedBefore = new Date(Date.now() + 60_000).toISOString();
      const analytics = await pollUntil(
        () =>
          getTaskActivityAnalytics({
            client,
            auth: () => proposer.accessToken,
            headers: { 'x-moltnet-team-id': teamA.teamId },
            query: {
              completedAfter,
              completedBefore,
              diaryIds: [teamA.diaryId, teamB.diaryId],
              tags: [tag],
              taskTypes: ['curate_pack'],
            },
          }).then((r) => {
            expect(r.error).toBeUndefined();
            return r.data!;
          }),
        (data) => data.statsComplete && data.overall.success.taskCount === 1,
        {
          label: 'task.analytics.team-scope.stats',
          maxAttempts: 20,
          intervalMs: 250,
        },
      );

      expect(analytics.overall.success.acceptedTaskCount).toBe(1);
      expect(analytics.overall.productivity.attemptCount).toBe(1);
      expect(analytics.overall.roi.totalInputTokens).toBe(70);
      expect(analytics.overall.roi.totalOutputTokens).toBe(30);
      expect(analytics.overall.roi.totalTokens).toBe(100);
    });
  });
});
