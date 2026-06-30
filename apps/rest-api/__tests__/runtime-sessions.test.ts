import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';

import type { RuntimeSession } from '@moltnet/database';
import { MissingRuntimeSessionObjectError } from '@moltnet/runtime-session-service';
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createMockServices,
  createTestApp,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

const TEAM_ID = 'bbbbbbbb-0000-0000-0000-000000000002';
const OTHER_TEAM_ID = 'bbbbbbbb-0000-0000-0000-000000000099';
const TASK_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const PROFILE_ID = 'dddddddd-0000-0000-0000-000000000004';
const SLOT_ID = 'eeeeeeee-0000-0000-0000-000000000005';
const SESSION_ID = '99999999-0000-0000-0000-000000000006';
const ACTIVE_CLAIM_EXPIRES_AT = new Date(Date.now() + 300_000);
const TEAM_HEADERS = {
  authorization: 'Bearer test-token',
  'x-moltnet-team-id': TEAM_ID,
};
const gzipAsync = promisify(gzip);

function mockSession(overrides: Partial<RuntimeSession> = {}): RuntimeSession {
  return {
    id: SESSION_ID,
    teamId: TEAM_ID,
    taskId: TASK_ID,
    attemptN: 1,
    sourceSlotId: SLOT_ID,
    sourceRuntimeProfileId: PROFILE_ID,
    sessionKind: 'root',
    parentSessionId: null,
    objectKey:
      'teams/bbbbbbbb-0000-0000-0000-000000000002/runtime-sessions/tasks/aaaaaaaa-0000-0000-0000-000000000001/attempts/1/test.jsonl.gz',
    contentType: 'application/octet-stream',
    contentEncoding: 'gzip',
    sizeBytes: 24,
    sha256: 'a'.repeat(64),
    storageClass: 'runtime-session',
    checkpointKind: 'attempt_final',
    uploadedAt: new Date('2026-06-25T00:00:00.000Z'),
    createdAt: new Date('2026-06-25T00:00:00.000Z'),
    updatedAt: new Date('2026-06-25T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

describe('runtime session routes', () => {
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
    mocks.runtimeSlotRepository.findByIdInTeam.mockResolvedValue({
      id: SLOT_ID,
      teamId: TEAM_ID,
      runtimeProfileId: PROFILE_ID,
    });
    mocks.runtimeProfileRepository.findById.mockResolvedValue({
      id: PROFILE_ID,
      teamId: TEAM_ID,
    });
  });

  it('uploads a team-scoped runtime session and derives team from headers', async () => {
    mocks.runtimeSessionRepository.upsertActive.mockResolvedValue(
      mockSession(),
    );

    const response = await app.inject({
      method: 'PUT',
      url: `/runtime-sessions/${TASK_ID}/1/content?sessionKind=root&sourceSlotId=${SLOT_ID}`,
      headers: {
        ...TEAM_HEADERS,
        'content-type': 'application/octet-stream',
      },
      payload: Readable.from(['{"session":"one"}\n']),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: SESSION_ID,
      teamId: TEAM_ID,
      taskId: TASK_ID,
      attemptN: 1,
      sourceSlotId: SLOT_ID,
    });
    expect(mocks.runtimeSessionStorage.putObject).toHaveBeenCalledWith(
      expect.objectContaining({
        contentEncoding: 'gzip',
        contentType: 'application/x-ndjson',
        key: expect.stringContaining(`/tasks/${TASK_ID}/attempts/1/`),
      }),
    );
    expect(mocks.runtimeSessionRepository.upsertActive).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptN: 1,
        sessionKind: 'root',
        sourceRuntimeProfileId: PROFILE_ID,
        sourceSlotId: SLOT_ID,
        taskId: TASK_ID,
        teamId: TEAM_ID,
      }),
    );
  });

  it('rejects uploads when the task belongs to another team', async () => {
    mocks.taskRepository.findById.mockResolvedValue({
      claimAgentId: VALID_AUTH_CONTEXT.identityId,
      claimExpiresAt: ACTIVE_CLAIM_EXPIRES_AT,
      id: TASK_ID,
      teamId: OTHER_TEAM_ID,
    });

    const response = await app.inject({
      method: 'PUT',
      url: `/runtime-sessions/${TASK_ID}/1/content?sessionKind=root`,
      headers: {
        ...TEAM_HEADERS,
        'content-type': 'application/octet-stream',
      },
      payload: Readable.from(['{"session":"one"}\n']),
    });

    expect(response.statusCode).toBe(400);
    expect(mocks.runtimeSessionStorage.putObject).not.toHaveBeenCalled();
    expect(mocks.runtimeSessionRepository.upsertActive).not.toHaveBeenCalled();
  });

  it('rejects upload after the task claim lease expires', async () => {
    mocks.taskRepository.findById.mockResolvedValue({
      claimAgentId: VALID_AUTH_CONTEXT.identityId,
      claimExpiresAt: new Date(Date.now() - 1_000),
      id: TASK_ID,
      teamId: TEAM_ID,
    });

    const response = await app.inject({
      method: 'PUT',
      url: `/runtime-sessions/${TASK_ID}/1/content?sessionKind=root`,
      headers: {
        ...TEAM_HEADERS,
        'content-type': 'application/octet-stream',
      },
      payload: Readable.from(['{"session":"one"}\n']),
    });

    expect(response.statusCode).toBe(409);
    expect(mocks.runtimeSessionStorage.putObject).not.toHaveBeenCalled();
  });

  it('requires the claiming agent to upload an attempt checkpoint', async () => {
    mocks.taskRepository.findAttempt.mockResolvedValue({
      attemptN: 1,
      claimedByAgentId: '00000000-0000-4000-8000-000000000000',
      status: 'running',
      taskId: TASK_ID,
    });

    const response = await app.inject({
      method: 'PUT',
      url: `/runtime-sessions/${TASK_ID}/1/content?sessionKind=root`,
      headers: {
        ...TEAM_HEADERS,
        'content-type': 'application/octet-stream',
      },
      payload: Readable.from(['{"session":"one"}\n']),
    });

    expect(response.statusCode).toBe(403);
    expect(mocks.runtimeSessionStorage.putObject).not.toHaveBeenCalled();
  });

  it('rejects checkpoint upload before the attempt is running', async () => {
    mocks.taskRepository.findAttempt.mockResolvedValue({
      attemptN: 1,
      claimedByAgentId: VALID_AUTH_CONTEXT.identityId,
      status: 'claimed',
      taskId: TASK_ID,
    });

    const response = await app.inject({
      method: 'PUT',
      url: `/runtime-sessions/${TASK_ID}/1/content?sessionKind=root`,
      headers: {
        ...TEAM_HEADERS,
        'content-type': 'application/octet-stream',
      },
      payload: Readable.from(['{"session":"one"}\n']),
    });

    expect(response.statusCode).toBe(409);
    expect(mocks.runtimeSessionStorage.putObject).not.toHaveBeenCalled();
  });

  it('requires read access to the parent runtime session task on upload', async () => {
    mocks.runtimeSessionRepository.findByIdInTeam.mockResolvedValue(
      mockSession({
        id: '99999999-1111-4111-8111-999999999999',
        taskId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
      }),
    );
    mocks.permissionChecker.canViewTask.mockResolvedValue(false);

    const response = await app.inject({
      method: 'PUT',
      url:
        `/runtime-sessions/${TASK_ID}/1/content?sessionKind=extend` +
        '&parentSessionId=99999999-1111-4111-8111-999999999999',
      headers: {
        ...TEAM_HEADERS,
        'content-type': 'application/octet-stream',
      },
      payload: Readable.from(['{"session":"one"}\n']),
    });

    expect(response.statusCode).toBe(404);
    expect(mocks.permissionChecker.canViewTask).toHaveBeenCalledWith(
      'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
      VALID_AUTH_CONTEXT.identityId,
      expect.any(String),
    );
    expect(mocks.runtimeSessionStorage.putObject).not.toHaveBeenCalled();
  });

  it('downloads and streams runtime session content', async () => {
    const content = '{"session":"one"}\n';
    mocks.runtimeSessionRepository.findActiveByTaskAttempt.mockResolvedValue(
      mockSession(),
    );
    mocks.runtimeSessionStorage.getObject.mockResolvedValue({
      body: Readable.from([await gzipAsync(content)]),
      contentEncoding: null,
      contentType: 'application/octet-stream',
    });

    const response = await app.inject({
      method: 'GET',
      url: `/runtime-sessions/${TASK_ID}/1/content`,
      headers: TEAM_HEADERS,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-moltnet-runtime-session-id']).toBe(SESSION_ID);
    expect(response.body).toBe(content);
  });

  it('deletes the replaced object after a successful replacement', async () => {
    mocks.runtimeSessionRepository.findActiveByTaskAttempt.mockResolvedValue(
      mockSession({ objectKey: 'old-object.jsonl.gz' }),
    );
    mocks.runtimeSessionRepository.upsertActive.mockResolvedValue(
      mockSession({ objectKey: 'new-object.jsonl.gz' }),
    );

    const response = await app.inject({
      method: 'PUT',
      url: `/runtime-sessions/${TASK_ID}/1/content?sessionKind=root`,
      headers: {
        ...TEAM_HEADERS,
        'content-type': 'application/octet-stream',
      },
      payload: Readable.from(['{"session":"replacement"}\n']),
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.runtimeSessionStorage.deleteObject).toHaveBeenCalledWith(
      'old-object.jsonl.gz',
    );
  });

  it('reports missing remote object distinctly from missing metadata', async () => {
    const session = mockSession();
    mocks.runtimeSessionRepository.findActiveByTaskAttempt.mockResolvedValue(
      session,
    );
    mocks.runtimeSessionStorage.getObject.mockRejectedValue(
      new MissingRuntimeSessionObjectError(session.objectKey),
    );

    const response = await app.inject({
      method: 'GET',
      url: `/runtime-sessions/${TASK_ID}/1/content`,
      headers: TEAM_HEADERS,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      code: 'NOT_FOUND',
      reason: 'missing_remote_session_object',
    });
  });
});
