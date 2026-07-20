/**
 * E2E: Task input artifacts (staged upload + create-time binding)
 *
 * Exercises the staging flow where bytes are uploaded ahead of a task
 * (`PUT /task-artifacts/staged`, no DB row) and then bound as a task input
 * artifact at `POST /tasks` via a `taskId: null` reference. Downloads go
 * through the by-CID endpoint that resolves input rows (attempt_n NULL).
 */

import { randomUUID } from 'node:crypto';

import {
  type Client,
  createClient,
  createDiary,
  createTask,
  createTeam,
  downloadTaskArtifactByCid,
  listTaskArtifacts,
  stageTaskArtifact,
} from '@moltnet/api-client';
import { computeBytesCid } from '@moltnet/crypto-service';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('Task input artifacts API', () => {
  let harness: TestHarness;
  let client: Client;
  let owner: TestAgent;
  let outsider: TestAgent;
  let teamId: string;
  let diaryId: string;

  const inputText = '# Input Brief\n\nContext staged before the task existed.';
  const inputBytes = new TextEncoder().encode(inputText);
  let inputCid: string;
  let taskId: string;

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

    const { data: team, error: teamError } = await createTeam({
      client,
      auth: () => owner.accessToken,
      body: { name: `task-input-artifacts-e2e-${randomUUID()}` },
    });
    expect(teamError).toBeUndefined();
    teamId = team!.id;

    const { data: diary, error: diaryError } = await createDiary({
      client,
      auth: () => owner.accessToken,
      headers: { 'x-moltnet-team-id': teamId },
      body: { name: 'task-input-artifacts', visibility: 'moltnet' },
    });
    expect(diaryError).toBeUndefined();
    diaryId = diary!.id;
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  it('stages bytes and returns the content-addressed CID', async () => {
    inputCid = await computeBytesCid(inputBytes);

    const staged = await stageTaskArtifact({
      client,
      auth: () => owner.accessToken,
      body: new Blob([inputBytes], { type: 'application/octet-stream' }),
      headers: {
        'content-type': 'application/octet-stream',
        'x-moltnet-team-id': teamId,
      },
      query: { contentType: 'text/markdown' },
    });

    expect(staged.response.status).toBe(200);
    expect(staged.error).toBeUndefined();
    expect(staged.data).toMatchObject({
      cid: inputCid,
      contentType: 'text/markdown',
      sizeBytes: inputBytes.byteLength,
    });
  });

  it('binds the staged object as a task input artifact on create', async () => {
    const { data, error, response } = await createTask({
      client,
      auth: () => owner.accessToken,
      headers: { 'x-moltnet-team-id': teamId },
      body: {
        taskType: 'curate_pack',
        diaryId,
        input: { diaryId, taskPrompt: 'input artifact binding' },
        references: [
          {
            // Canonical input-artifact reference: no outputCid — there is
            // no producing task output; artifact.cid is the only CID.
            taskId: null,
            role: 'context',
            artifact: {
              cid: inputCid,
              kind: 'brief',
              title: 'input.md',
              contentType: 'text/markdown',
            },
          },
        ],
      },
    });

    expect(error).toBeUndefined();
    expect(response.status).toBe(201);
    taskId = data!.id;

    const list = await listTaskArtifacts({
      client,
      auth: () => owner.accessToken,
      headers: { 'x-moltnet-team-id': teamId },
      path: { taskId },
    });
    expect(list.response.status).toBe(200);
    const bound = list.data!.artifacts.filter(
      (artifact) => artifact.cid === inputCid,
    );
    expect(bound).toHaveLength(1);
    expect(bound[0]).toMatchObject({
      attemptN: null,
      cid: inputCid,
      kind: 'brief',
      title: 'input.md',
    });
  });

  it('downloads the staged input bytes by CID', async () => {
    const download = await downloadTaskArtifactByCid({
      client,
      auth: () => owner.accessToken,
      headers: { 'x-moltnet-team-id': teamId },
      path: { cid: inputCid, taskId },
    });

    expect(download.response.status).toBe(200);
    expect(download.error).toBeUndefined();
    expect(download.response.headers.get('x-moltnet-task-artifact-cid')).toBe(
      inputCid,
    );
    expect(await download.data!.text()).toBe(inputText);
  });

  it('rejects an outsider downloading another team input artifact', async () => {
    const download = await downloadTaskArtifactByCid({
      client,
      auth: () => outsider.accessToken,
      headers: { 'x-moltnet-team-id': teamId },
      path: { cid: inputCid, taskId },
    });

    expect(download.response.status).toBe(404);
  });

  it('rejects create referencing a valid-format but never-staged CID', async () => {
    const unstagedBytes = new TextEncoder().encode('never staged bytes');
    const unstagedCid = await computeBytesCid(unstagedBytes);

    const { error, response } = await createTask({
      client,
      auth: () => owner.accessToken,
      headers: { 'x-moltnet-team-id': teamId },
      body: {
        taskType: 'curate_pack',
        diaryId,
        input: { diaryId, taskPrompt: 'unstaged input artifact' },
        references: [
          {
            taskId: null,
            outputCid: unstagedCid,
            role: 'context',
            artifact: { cid: unstagedCid },
          },
        ],
      },
    });

    expect(response.status).toBe(400);
    expect(error).toBeDefined();
  });
});
