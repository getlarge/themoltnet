import { Readable } from 'node:stream';

import { computeBytesCid } from '@moltnet/crypto-service';
import type { TaskArtifact } from '@moltnet/database';
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createMockServices,
  createTestApp,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

const TEAM_ID = 'bbbbbbbb-0000-0000-0000-000000000002';
const TASK_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const ARTIFACT_ID = '99999999-0000-0000-0000-000000000006';
const ACTIVE_CLAIM_EXPIRES_AT = new Date(Date.now() + 300_000);
const TEAM_HEADERS = {
  authorization: 'Bearer test-token',
  'x-moltnet-team-id': TEAM_ID,
};

function mockArtifact(overrides: Partial<TaskArtifact> = {}): TaskArtifact {
  return {
    id: ARTIFACT_ID,
    teamId: TEAM_ID,
    taskId: TASK_ID,
    attemptN: 1,
    kind: 'json',
    title: 'result',
    objectKey: 'teams/team/artifacts/bafkrei',
    contentType: 'application/json',
    contentEncoding: null,
    sizeBytes: 11,
    sha256: 'a'.repeat(64),
    cid: 'bafkreicid',
    createdByAgentId: VALID_AUTH_CONTEXT.identityId,
    expiresAt: null,
    createdAt: new Date('2026-06-27T00:00:00.000Z'),
    updatedAt: new Date('2026-06-27T00:00:00.000Z'),
    ...overrides,
  };
}

describe('task artifact routes', () => {
  let app: FastifyInstance;
  let mocks: ReturnType<typeof createMockServices>;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
    mocks.permissionChecker.canAccessTeam.mockResolvedValue(true);
    mocks.permissionChecker.canReportTask.mockResolvedValue(true);
    mocks.permissionChecker.canViewTask.mockResolvedValue(true);
    mocks.taskRepository.findById.mockResolvedValue({
      claimAgentId: VALID_AUTH_CONTEXT.identityId,
      claimExpiresAt: ACTIVE_CLAIM_EXPIRES_AT,
      id: TASK_ID,
      teamId: TEAM_ID,
    });
    mocks.taskRepository.findAttempt.mockResolvedValue({
      attemptN: 1,
      claimedByAgentId: VALID_AUTH_CONTEXT.identityId,
      status: 'running',
      taskId: TASK_ID,
    });
    mocks.taskArtifactStorage.headObject.mockResolvedValue(null);
  });

  it('uploads artifact content under a CID-addressed object key', async () => {
    const body = Buffer.from('{"ok":true}');
    const cid = await computeBytesCid(body);
    mocks.taskArtifactRepository.createForAttempt.mockImplementation(
      async (input: Partial<TaskArtifact>) =>
        ({
          artifact: mockArtifact({
            ...input,
            id: ARTIFACT_ID,
            createdAt: new Date('2026-06-27T00:00:00.000Z'),
            updatedAt: new Date('2026-06-27T00:00:00.000Z'),
          }),
          created: true,
        }) as never,
    );

    const response = await app.inject({
      method: 'PUT',
      url:
        `/tasks/${TASK_ID}/attempts/1/artifacts` +
        '?kind=json&title=result&contentType=application%2Fjson',
      headers: {
        ...TEAM_HEADERS,
        'content-type': 'application/octet-stream',
      },
      payload: Readable.from([body]),
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json).toMatchObject({
      cid,
      contentType: 'application/json',
      id: ARTIFACT_ID,
      kind: 'json',
      taskId: TASK_ID,
      teamId: TEAM_ID,
      title: 'result',
    });
    expect(json).not.toHaveProperty('sha256');
    expect(mocks.taskArtifactStorage.putObject).toHaveBeenCalledWith(
      expect.objectContaining({
        contentLength: body.byteLength,
        contentType: 'application/json',
        key: `teams/${TEAM_ID}/artifacts/${cid}`,
      }),
    );
    expect(mocks.taskArtifactRepository.createForAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        cid,
        objectKey: `teams/${TEAM_ID}/artifacts/${cid}`,
        taskId: TASK_ID,
        teamId: TEAM_ID,
      }),
    );
  });

  it('lists task artifact metadata', async () => {
    mocks.taskArtifactRepository.listForTask.mockResolvedValue({
      artifacts: [mockArtifact({ cid: 'bafkreilist' })],
      nextCursor: 'cursor-2',
    });

    const response = await app.inject({
      method: 'GET',
      url: `/tasks/${TASK_ID}/artifacts`,
      headers: TEAM_HEADERS,
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json).toMatchObject({
      artifacts: [{ cid: 'bafkreilist', taskId: TASK_ID }],
      nextCursor: 'cursor-2',
    });
    expect(json.artifacts[0]).not.toHaveProperty('sha256');
    expect(mocks.permissionChecker.canViewTask).toHaveBeenCalledWith(
      TASK_ID,
      VALID_AUTH_CONTEXT.identityId,
      expect.any(String),
    );
  });

  it('returns 409 when uploading a duplicate CID with conflicting metadata', async () => {
    const body = Buffer.from('{"ok":true}');
    const cid = await computeBytesCid(body);
    mocks.taskArtifactRepository.findExistingForAttempt.mockResolvedValue(
      mockArtifact({
        cid,
        kind: 'log',
        objectKey: `teams/${TEAM_ID}/artifacts/${cid}`,
        sizeBytes: body.byteLength,
      }),
    );

    const response = await app.inject({
      method: 'PUT',
      url:
        `/tasks/${TASK_ID}/attempts/1/artifacts` +
        '?kind=json&title=result&contentType=application%2Fjson',
      headers: {
        ...TEAM_HEADERS,
        'content-type': 'application/octet-stream',
      },
      payload: Readable.from([body]),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: 'CONFLICT',
      conflict: {},
      status: 409,
    });
    expect(mocks.taskArtifactStorage.putObject).not.toHaveBeenCalled();
    expect(
      mocks.taskArtifactRepository.createForAttempt,
    ).not.toHaveBeenCalled();
  });

  it('downloads task artifact content by CID', async () => {
    const artifact = mockArtifact({
      cid: 'bafkreidownload',
      contentEncoding: 'br',
      contentType: 'text/plain',
      objectKey: 'teams/team/artifacts/bafkreidownload',
      sha256: 'b'.repeat(64),
    });
    mocks.taskArtifactRepository.findByCidForAttempt.mockResolvedValue(
      artifact,
    );
    mocks.taskArtifactStorage.getObject.mockResolvedValue({
      body: Readable.from(['hello']),
      contentEncoding: 'gzip',
      contentType: 'text/plain',
    });

    const response = await app.inject({
      method: 'GET',
      url: `/tasks/${TASK_ID}/attempts/1/artifacts/${artifact.cid}/content`,
      headers: TEAM_HEADERS,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-moltnet-task-artifact-cid']).toBe(artifact.cid);
    expect(response.headers['x-moltnet-task-artifact-sha256']).toBeUndefined();
    expect(response.headers['x-moltnet-task-artifact-content-type']).toBe(
      'text/plain',
    );
    expect(response.headers['x-moltnet-task-artifact-content-encoding']).toBe(
      'br',
    );
    expect(response.body).toBe('hello');
  });
});
