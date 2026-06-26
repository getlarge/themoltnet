/**
 * E2E: Runtime sessions
 *
 * Exercises durable runtime-session upload/download against the Docker stack,
 * including the S3-compatible object store.
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
  taskHeartbeat,
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
  let otherTeamId: string;
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

    const { data: otherTeam, error: otherTeamError } = await createTeam({
      client,
      auth: () => teammate.accessToken,
      body: { name: `runtime-sessions-other-${randomUUID()}` },
    });
    expect(otherTeamError).toBeUndefined();
    otherTeamId = otherTeam!.id;

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
    const { error: heartbeatError } = await taskHeartbeat({
      client,
      auth: () => teammate.accessToken,
      path: { id: data!.id, n: claimed!.attempt.attemptN },
      body: { leaseTtlSec: 60 },
    });
    expect(heartbeatError).toBeUndefined();
    return { attemptN: claimed!.attempt.attemptN, taskId: data!.id };
  }

  async function uploadRuntimeSessionContent(input: {
    accessToken: string;
    attemptN: number;
    content: string;
    taskId: string;
    teamId?: string;
  }) {
    return uploadRuntimeSession({
      client,
      auth: () => input.accessToken,
      body: new Blob([input.content], { type: 'application/x-ndjson' }),
      headers: {
        'content-type': 'application/x-ndjson',
        'x-moltnet-team-id': input.teamId ?? teamId,
      },
      path: { attemptN: input.attemptN, taskId: input.taskId },
      query: { sessionKind: 'root' },
    });
  }

  async function downloadRuntimeSessionContent(input: {
    accessToken: string;
    attemptN: number;
    taskId: string;
    teamId?: string;
  }) {
    return downloadRuntimeSession({
      client,
      auth: () => input.accessToken,
      headers: {
        'x-moltnet-team-id': input.teamId ?? teamId,
      },
      path: { attemptN: input.attemptN, taskId: input.taskId },
    });
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

    const upload = await uploadRuntimeSessionContent({
      accessToken: teammate.accessToken,
      attemptN,
      content,
      taskId,
    });
    expect(upload.response.status).toBe(200);
    expect(upload.error).toBeUndefined();
    const uploaded = upload.data!;
    expect(uploaded).toMatchObject({
      attemptN,
      checkpointKind: 'attempt_final',
      contentEncoding: 'gzip',
      contentType: 'application/x-ndjson',
      sessionKind: 'root',
      taskId,
      teamId,
    });
    expect('objectKey' in uploaded).toBe(false);

    const metadata = await getRuntimeSession({
      client,
      auth: () => owner.accessToken,
      headers: { 'x-moltnet-team-id': teamId },
      path: { attemptN, taskId },
    });
    expect(metadata.response.status).toBe(200);
    expect(metadata.error).toBeUndefined();
    expect(metadata.data!.id).toBe(uploaded.id);

    const downloaded = await downloadRuntimeSessionContent({
      accessToken: owner.accessToken,
      attemptN,
      taskId,
    });
    expect(downloaded.response.status).toBe(200);
    expect(downloaded.error).toBeUndefined();
    expect(
      downloaded.response.headers.get('x-moltnet-runtime-session-id'),
    ).toBe(uploaded.id);
    expect(await downloaded.data!.text()).toBe(content);

    const teammateDownload = await downloadRuntimeSessionContent({
      accessToken: teammate.accessToken,
      attemptN,
      taskId,
    });
    expect(teammateDownload.response.status).toBe(200);
    expect(teammateDownload.error).toBeUndefined();
    expect(await teammateDownload.data!.text()).toBe(content);
  });

  it('rejects runtime session upload by a team member who did not claim the attempt', async () => {
    const { attemptN, taskId } = await createClaimedTask(
      'runtime session non-claimant upload denial',
    );

    const upload = await uploadRuntimeSessionContent({
      accessToken: owner.accessToken,
      attemptN,
      content: '{"role":"system","content":"not claimant"}\n',
      taskId,
    });

    expect(upload.response.status).toBe(403);
  });

  it('rejects runtime session upload when the team header does not own the task', async () => {
    const { attemptN, taskId } = await createClaimedTask(
      'runtime session wrong team upload denial',
    );

    const upload = await uploadRuntimeSessionContent({
      accessToken: teammate.accessToken,
      attemptN,
      content: '{"role":"system","content":"wrong team"}\n',
      taskId,
      teamId: otherTeamId,
    });

    expect(upload.response.status).toBe(400);
    expect(upload.error).toBeDefined();
  });

  it('rejects non-members reading or uploading another team runtime session', async () => {
    const { attemptN, taskId } = await createClaimedTask(
      'runtime session outsider denial',
    );
    const upload = await uploadRuntimeSessionContent({
      accessToken: teammate.accessToken,
      attemptN,
      content: '{"role":"system"}\n',
      taskId,
    });
    expect(upload.response.status).toBe(200);
    expect(upload.error).toBeUndefined();

    const outsiderRead = await getRuntimeSession({
      client,
      auth: () => outsider.accessToken,
      headers: { 'x-moltnet-team-id': teamId },
      path: { attemptN, taskId },
    });
    expect([403, 404]).toContain(outsiderRead.response.status);

    const outsiderDownload = await downloadRuntimeSessionContent({
      accessToken: outsider.accessToken,
      attemptN,
      taskId,
    });
    expect([403, 404]).toContain(outsiderDownload.response.status);

    const outsiderUpload = await uploadRuntimeSessionContent({
      accessToken: outsider.accessToken,
      attemptN,
      content: '{"role":"system","content":"overwrite"}\n',
      taskId,
    });
    expect([403, 404]).toContain(outsiderUpload.response.status);
  });
});
