/**
 * E2E: Task artifacts
 *
 * Exercises immutable CID-addressed task artifact upload/download against the
 * Docker stack, including the S3-compatible object store.
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
  downloadTaskArtifact,
  joinTeam,
  listTaskArtifacts,
  taskHeartbeat,
  uploadTaskArtifact,
} from '@moltnet/api-client';
import { computeBytesCid } from '@moltnet/crypto-service';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('Task artifacts API', () => {
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
      body: { name: `task-artifacts-e2e-${randomUUID()}` },
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
      body: { name: 'task-artifacts', visibility: 'moltnet' },
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

  it('uploads, lists, and downloads immutable artifact content by CID', async () => {
    const { attemptN, taskId } = await createClaimedTask(
      'task artifact upload/download',
    );
    const content = JSON.stringify({ ok: true, artifact: 'e2e' });
    const expectedCid = await computeBytesCid(
      new TextEncoder().encode(content),
    );

    const upload = await uploadTaskArtifact({
      client,
      auth: () => teammate.accessToken,
      body: new Blob([content], { type: 'application/octet-stream' }),
      headers: {
        'content-type': 'application/octet-stream',
        'x-moltnet-team-id': teamId,
      },
      path: { attemptN, taskId },
      query: {
        contentType: 'application/json',
        kind: 'json',
        title: 'result',
      },
    });

    expect(upload.response.status).toBe(200);
    expect(upload.error).toBeUndefined();
    expect(upload.data).toMatchObject({
      attemptN,
      cid: expectedCid,
      contentType: 'application/json',
      kind: 'json',
      taskId,
      teamId,
      title: 'result',
    });
    expect('objectKey' in upload.data!).toBe(false);

    const list = await listTaskArtifacts({
      client,
      auth: () => owner.accessToken,
      headers: { 'x-moltnet-team-id': teamId },
      path: { taskId },
    });
    expect(list.response.status).toBe(200);
    expect(list.error).toBeUndefined();
    expect(list.data!.artifacts.map((artifact) => artifact.cid)).toContain(
      expectedCid,
    );

    const download = await downloadTaskArtifact({
      client,
      auth: () => owner.accessToken,
      headers: { 'x-moltnet-team-id': teamId },
      path: { attemptN, cid: expectedCid, taskId },
    });
    expect(download.response.status).toBe(200);
    expect(download.error).toBeUndefined();
    expect(download.response.headers.get('x-moltnet-task-artifact-cid')).toBe(
      expectedCid,
    );
    expect(await download.data!.text()).toBe(content);
  });

  it('rejects artifact upload by a team member who did not claim the attempt', async () => {
    const { attemptN, taskId } = await createClaimedTask(
      'task artifact non-claimant upload denial',
    );

    const upload = await uploadTaskArtifact({
      client,
      auth: () => owner.accessToken,
      body: new Blob(['not claimant'], { type: 'application/octet-stream' }),
      headers: {
        'content-type': 'application/octet-stream',
        'x-moltnet-team-id': teamId,
      },
      path: { attemptN, taskId },
      query: { kind: 'text', title: 'not-claimant' },
    });

    expect(upload.response.status).toBe(403);
    expect(upload.error).toBeDefined();
  });

  it('rejects non-members reading another team task artifact', async () => {
    const { attemptN, taskId } = await createClaimedTask(
      'task artifact outsider denial',
    );
    const content = 'private artifact';
    const expectedCid = await computeBytesCid(
      new TextEncoder().encode(content),
    );
    const upload = await uploadTaskArtifact({
      client,
      auth: () => teammate.accessToken,
      body: new Blob([content], { type: 'application/octet-stream' }),
      headers: {
        'content-type': 'application/octet-stream',
        'x-moltnet-team-id': teamId,
      },
      path: { attemptN, taskId },
      query: { kind: 'text', title: 'private' },
    });
    expect(upload.response.status).toBe(200);

    const outsiderList = await listTaskArtifacts({
      client,
      auth: () => outsider.accessToken,
      headers: { 'x-moltnet-team-id': teamId },
      path: { taskId },
    });
    expect([403, 404]).toContain(outsiderList.response.status);

    const outsiderDownload = await downloadTaskArtifact({
      client,
      auth: () => outsider.accessToken,
      headers: { 'x-moltnet-team-id': teamId },
      path: { attemptN, cid: expectedCid, taskId },
    });
    expect([403, 404]).toContain(outsiderDownload.response.status);
  });
});
