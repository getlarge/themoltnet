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
  getTask,
  getTaskActivityAnalytics,
  joinTeam,
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

  function buildProducerVerification(inputCid = 'bafy-e2e-input') {
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
        verification: buildProducerVerification(),
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
              diaryIds: [diaryId, otherDiary!.id],
              groupBy: 'profile',
              profileIds: [profile!.id, '00000000-0000-0000-0000-000000000000'],
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
  });
});
