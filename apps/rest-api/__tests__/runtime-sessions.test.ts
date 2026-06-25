import { gzipSync } from 'node:zlib';

import type { RuntimeSession } from '@moltnet/database';
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import { MissingRuntimeSessionObjectError } from '../src/services/runtime-session-storage.js';
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
const TEAM_HEADERS = {
  authorization: 'Bearer test-token',
  'x-moltnet-team-id': TEAM_ID,
};

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
    contentType: 'application/x-ndjson',
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
      id: TASK_ID,
      teamId: TEAM_ID,
    });
    mocks.taskRepository.findAttempt.mockResolvedValue({
      attemptN: 1,
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
      url: `/runtime-sessions/${TASK_ID}/1`,
      headers: TEAM_HEADERS,
      payload: {
        contentBase64: Buffer.from('{"session":"one"}\n').toString('base64'),
        sessionKind: 'root',
        sourceSlotId: SLOT_ID,
      },
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
      id: TASK_ID,
      teamId: OTHER_TEAM_ID,
    });

    const response = await app.inject({
      method: 'PUT',
      url: `/runtime-sessions/${TASK_ID}/1`,
      headers: TEAM_HEADERS,
      payload: {
        contentBase64: Buffer.from('{"session":"one"}\n').toString('base64'),
        sessionKind: 'root',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(mocks.runtimeSessionStorage.putObject).not.toHaveBeenCalled();
    expect(mocks.runtimeSessionRepository.upsertActive).not.toHaveBeenCalled();
  });

  it('requires task report permission for upload', async () => {
    mocks.permissionChecker.canReportTask.mockResolvedValue(false);

    const response = await app.inject({
      method: 'PUT',
      url: `/runtime-sessions/${TASK_ID}/1`,
      headers: TEAM_HEADERS,
      payload: {
        contentBase64: Buffer.from('{"session":"one"}\n').toString('base64'),
        sessionKind: 'root',
      },
    });

    expect(response.statusCode).toBe(403);
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
      url: `/runtime-sessions/${TASK_ID}/1`,
      headers: TEAM_HEADERS,
      payload: {
        contentBase64: Buffer.from('{"session":"one"}\n').toString('base64'),
        parentSessionId: '99999999-1111-4111-8111-999999999999',
        sessionKind: 'extend',
      },
    });

    expect(response.statusCode).toBe(404);
    expect(mocks.permissionChecker.canViewTask).toHaveBeenCalledWith(
      'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
      VALID_AUTH_CONTEXT.identityId,
      expect.any(String),
    );
    expect(mocks.runtimeSessionStorage.putObject).not.toHaveBeenCalled();
  });

  it('downloads and decompresses runtime session content', async () => {
    mocks.runtimeSessionRepository.findActiveByTaskAttempt.mockResolvedValue(
      mockSession(),
    );
    mocks.runtimeSessionStorage.getObject.mockResolvedValue({
      body: gzipSync(Buffer.from('{"session":"one"}\n')),
      contentEncoding: 'gzip',
      contentType: 'application/x-ndjson',
    });

    const response = await app.inject({
      method: 'GET',
      url: `/runtime-sessions/${TASK_ID}/1/content`,
      headers: TEAM_HEADERS,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      contentBase64: Buffer.from('{"session":"one"}\n').toString('base64'),
      session: {
        id: SESSION_ID,
        taskId: TASK_ID,
      },
    });
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
