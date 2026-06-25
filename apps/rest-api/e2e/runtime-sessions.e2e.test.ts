/**
 * E2E: Runtime sessions
 *
 * Exercises durable runtime-session upload/download through the generated
 * client against the Docker stack, including the S3-compatible object store.
 */

import { randomUUID } from 'node:crypto';

import {
  claimTask,
  type Client,
  createClient,
  createDiary,
  createDiaryGrant,
  createTask,
  createTeam,
  createTeamInvite,
  downloadRuntimeSession,
  getRuntimeSession,
  joinTeam,
  uploadRuntimeSession,
} from '@moltnet/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('Runtime sessions API', () => {
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
      body: { name: `runtime-sessions-e2e-${randomUUID()}` },
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
      body: { name: 'runtime-sessions', visibility: 'moltnet' },
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

  async function createClaimedTask(taskPrompt: string) {
    const { data, error } = await createTask({
      client,
      auth: () => owner.accessToken,
      headers: { 'x-moltnet-team-id': teamId },
      body: {
        taskType: 'curate_pack',
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

  it('uploads, reads metadata, and downloads session content for a task attempt', async () => {
    const { attemptN, taskId } = await createClaimedTask(
      'runtime session upload/download',
    );
    const content = [
      '{"role":"system","content":"runtime session e2e"}',
      '{"role":"assistant","content":"done"}',
      '',
    ].join('\n');

    const uploaded = await uploadRuntimeSession({
      client,
      auth: () => teammate.accessToken,
      headers: { 'x-moltnet-team-id': teamId },
      path: { attemptN, taskId },
      body: {
        contentBase64: Buffer.from(content, 'utf8').toString('base64'),
        sessionKind: 'root',
      },
    });
    expect(uploaded.response.status).toBe(200);
    expect(uploaded.error).toBeUndefined();
    expect(uploaded.data).toMatchObject({
      attemptN,
      checkpointKind: 'attempt_final',
      contentEncoding: 'gzip',
      contentType: 'application/x-ndjson',
      sessionKind: 'root',
      taskId,
      teamId,
    });
    expect(uploaded.data!.objectKey).toContain(
      `teams/${teamId}/runtime-sessions/tasks/${taskId}/attempts/${attemptN}/`,
    );

    const metadata = await getRuntimeSession({
      client,
      auth: () => owner.accessToken,
      headers: { 'x-moltnet-team-id': teamId },
      path: { attemptN, taskId },
    });
    expect(metadata.response.status).toBe(200);
    expect(metadata.error).toBeUndefined();
    expect(metadata.data!.id).toBe(uploaded.data!.id);

    const downloaded = await downloadRuntimeSession({
      client,
      auth: () => owner.accessToken,
      headers: { 'x-moltnet-team-id': teamId },
      path: { attemptN, taskId },
    });
    expect(downloaded.response.status).toBe(200);
    expect(downloaded.error).toBeUndefined();
    expect(
      Buffer.from(downloaded.data!.contentBase64, 'base64').toString('utf8'),
    ).toBe(content);
    expect(downloaded.data!.session.id).toBe(uploaded.data!.id);
  });

  it('rejects non-members reading another team runtime session', async () => {
    const { attemptN, taskId } = await createClaimedTask(
      'runtime session outsider denial',
    );
    const upload = await uploadRuntimeSession({
      client,
      auth: () => teammate.accessToken,
      headers: { 'x-moltnet-team-id': teamId },
      path: { attemptN, taskId },
      body: {
        contentBase64: Buffer.from('{"role":"system"}\n').toString('base64'),
        sessionKind: 'root',
      },
    });
    expect(upload.response.status).toBe(200);

    const outsiderRead = await getRuntimeSession({
      client,
      auth: () => outsider.accessToken,
      headers: { 'x-moltnet-team-id': teamId },
      path: { attemptN, taskId },
    });
    expect([403, 404]).toContain(outsiderRead.response.status);
  });
});
