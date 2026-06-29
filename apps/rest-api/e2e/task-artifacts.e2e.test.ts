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
import {
  createRelationshipWriter,
  type RelationshipWriter,
} from '@moltnet/auth';
import { computeBytesCid } from '@moltnet/crypto-service';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('Task artifacts API', () => {
  let harness: TestHarness;
  let client: Client;
  let relationshipWriter: RelationshipWriter;
  let owner: TestAgent;
  let teammate: TestAgent;
  let outsider: TestAgent;
  let teamId: string;
  let diaryId: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });
    relationshipWriter = createRelationshipWriter(
      harness.oryClients.relationship,
    );

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

  it('allows active DB claimant to upload when Keto claimant tuple is missing', async () => {
    const { attemptN, taskId } = await createClaimedTask(
      'task artifact upload with missing Keto claimant tuple',
    );

    await relationshipWriter.removeTaskClaimant(taskId, teammate.identityId);

    const upload = await uploadTaskArtifact({
      client,
      auth: () => teammate.accessToken,
      body: new Blob(['claim lease wins'], {
        type: 'application/octet-stream',
      }),
      headers: {
        'content-type': 'application/octet-stream',
        'x-moltnet-team-id': teamId,
      },
      path: { attemptN, taskId },
      query: { contentType: 'text/plain', kind: 'text', title: 'lease' },
    });

    expect(upload.response.status).toBe(200);
    expect(upload.error).toBeUndefined();
  });

  it('handles duplicate CID uploads idempotently and rejects metadata conflicts', async () => {
    const { attemptN, taskId } = await createClaimedTask(
      'task artifact duplicate CID handling',
    );
    const content = 'same bytes';
    const expectedCid = await computeBytesCid(
      new TextEncoder().encode(content),
    );
    const uploadOptions = {
      client,
      auth: () => teammate.accessToken,
      headers: {
        'content-type': 'application/octet-stream',
        'x-moltnet-team-id': teamId,
      },
      path: { attemptN, taskId },
    };

    const first = await uploadTaskArtifact({
      ...uploadOptions,
      body: new Blob([content], { type: 'application/octet-stream' }),
      query: { contentType: 'text/plain', kind: 'text', title: 'same' },
    });
    expect(first.response.status).toBe(200);
    expect(first.data?.cid).toBe(expectedCid);

    const duplicate = await uploadTaskArtifact({
      ...uploadOptions,
      body: new Blob([content], { type: 'application/octet-stream' }),
      query: { contentType: 'text/plain', kind: 'text', title: 'same' },
    });
    expect(duplicate.response.status).toBe(200);
    expect(duplicate.data?.id).toBe(first.data?.id);

    const conflict = await uploadTaskArtifact({
      ...uploadOptions,
      body: new Blob([content], { type: 'application/octet-stream' }),
      query: { contentType: 'text/plain', kind: 'log', title: 'same' },
    });
    expect(conflict.response.status).toBe(409);
  });

  it('paginates task artifact metadata without duplicates or skips', async () => {
    const { attemptN, taskId } = await createClaimedTask(
      'task artifact pagination',
    );
    const cids: string[] = [];
    for (const name of ['a', 'b', 'c']) {
      const content = `page-${name}`;
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
        query: { contentType: 'text/plain', kind: 'text', title: name },
      });
      expect(upload.response.status).toBe(200);
      cids.push(expectedCid);
    }

    const firstPage = await listTaskArtifacts({
      client,
      auth: () => owner.accessToken,
      headers: { 'x-moltnet-team-id': teamId },
      path: { taskId },
      query: { limit: 2 },
    });
    expect(firstPage.response.status).toBe(200);
    expect(firstPage.data?.artifacts).toHaveLength(2);
    expect(firstPage.data?.nextCursor).toBeTruthy();

    const secondPage = await listTaskArtifacts({
      client,
      auth: () => owner.accessToken,
      headers: { 'x-moltnet-team-id': teamId },
      path: { taskId },
      query: { cursor: firstPage.data!.nextCursor!, limit: 2 },
    });
    expect(secondPage.response.status).toBe(200);
    expect(secondPage.data?.artifacts).toHaveLength(1);
    expect(secondPage.data?.nextCursor).toBeNull();
    const returnedCids = [
      ...firstPage.data!.artifacts.map((artifact) => artifact.cid),
      ...secondPage.data!.artifacts.map((artifact) => artifact.cid),
    ];
    expect(new Set(returnedCids)).toEqual(new Set(cids));
    expect(returnedCids).toHaveLength(cids.length);
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
    expect(outsiderList.response.status).toBe(404);

    const outsiderDownload = await downloadTaskArtifact({
      client,
      auth: () => outsider.accessToken,
      headers: { 'x-moltnet-team-id': teamId },
      path: { attemptN, cid: expectedCid, taskId },
    });
    expect(outsiderDownload.response.status).toBe(404);
  });
});
