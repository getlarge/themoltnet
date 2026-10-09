import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';

import type { RuntimeSession } from '@moltnet/database';
import { MissingRuntimeSessionObjectError } from '@moltnet/runtime-session-service';
import type { FastifyInstance } from 'fastify';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import {
  createMockServices,
  createTestApp,
  resetMockServices,
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

  beforeAll(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetMockServices(mocks);
    mocks.permissionChecker.canAccessTeam.mockResolvedValue(true);
    mocks.permissionChecker.canReportTask.mockResolvedValue(true);
    mocks.permissionChecker.canViewTask.mockResolvedValue(true);
    mocks.taskRepository.findById.mockResolvedValue({
      claimAgentId: VALID_AUTH_CONTEXT.agentId,
      claimExpiresAt: ACTIVE_CLAIM_EXPIRES_AT,
      id: TASK_ID,
      teamId: TEAM_ID,
    });
    mocks.taskRepository.findAttempt.mockResolvedValue({
      attemptN: 1,
      claimedByAgentId: VALID_AUTH_CONTEXT.agentId,
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
      claimAgentId: VALID_AUTH_CONTEXT.agentId,
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
      claimAgentId: VALID_AUTH_CONTEXT.agentId,
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
      claimedByAgentId: VALID_AUTH_CONTEXT.agentId,
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
      VALID_AUTH_CONTEXT.agentId,
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

describe('incremental runtime sessions', () => {
  let app: FastifyInstance;
  let mocks: ReturnType<typeof createMockServices>;

  beforeEach(async () => {
    mocks = createMockServices();
    mocks.permissionChecker.canAccessTeam.mockResolvedValue(true);
    mocks.permissionChecker.canViewTask.mockResolvedValue(true);
    mocks.runtimeSessionRepository.durable.findAttempt.mockResolvedValue({
      storeId: SESSION_ID,
      taskId: TASK_ID,
      attemptN: 1,
      teamId: TEAM_ID,
    });
    mocks.runtimeSessionRepository.durable.get.mockResolvedValue({
      id: SESSION_ID,
      format: 'pi-durable.v1',
      headSeq: 3,
    });
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
  });

  afterEach(async () => {
    await app.close();
  });

  it('resolves Durable state through runtime sessions with team and task authorization', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/runtime-sessions/durable/attempt?taskId=${TASK_ID}&attemptN=1`,
      headers: TEAM_HEADERS,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      storeId: SESSION_ID,
      format: 'pi-durable.v1',
      headSeq: 3,
    });
    expect(
      mocks.runtimeSessionRepository.durable.findAttempt,
    ).toHaveBeenCalledWith(TEAM_ID, TASK_ID, 1);
    expect(mocks.permissionChecker.canViewTask).toHaveBeenCalledWith(
      TASK_ID,
      VALID_AUTH_CONTEXT.agentId,
      expect.any(String),
    );
  });

  it('persists ordered commits through the existing storage hook and fences released writers', async () => {
    const repo = mocks.runtimeSessionRepository.durable;
    const row = {
      id: SESSION_ID,
      teamId: TEAM_ID,
      format: 'pi-durable.v1',
      headSeq: 0,
      nextId: 2,
      writerToken: null,
      writerExpiresAt: null,
    };
    const receipts: Array<Record<string, unknown>> = [];
    let bytes = Buffer.alloc(0);
    repo.lockAuthority.mockResolvedValue({
      task: { input: {}, claimExpiresAt: new Date(Date.now() + 300_000) },
    });
    repo.lock.mockImplementation(async () => ({ ...row }));
    repo.get.mockImplementation(async () => ({ ...row }));
    repo.update.mockImplementation(async (_id, patch) => {
      Object.assign(row, patch);
    });
    repo.findCommit.mockImplementation(async (_id, commitId) =>
      receipts.find((receipt) => receipt.commitId === commitId),
    );
    repo.append.mockImplementation(async (receipt) => {
      receipts.push(receipt);
      row.headSeq = receipt.seq;
    });
    repo.listAttempts.mockResolvedValue([{ taskId: TASK_ID, attemptN: 1 }]);
    repo.listCommits.mockImplementation(async (_id, afterSeq) =>
      receipts.filter((receipt) => Number(receipt.seq) > afterSeq),
    );
    mocks.runtimeSessionStorage.putObject.mockImplementation(
      async ({ body }) => {
        const chunks: Buffer[] = [];
        for await (const chunk of body) chunks.push(Buffer.from(chunk));
        bytes = Buffer.concat(chunks);
      },
    );
    mocks.runtimeSessionStorage.getObject.mockImplementation(async () => ({
      body: Readable.from([bytes]),
    }));
    const authority = {
      taskId: TASK_ID,
      attemptN: 1,
      leaseId: SLOT_ID,
      executorFingerprint: 'executor',
    };
    const opened = await app.inject({
      method: 'POST',
      url: '/runtime-sessions/durable/open',
      headers: TEAM_HEADERS,
      payload: authority,
    });
    expect(opened.statusCode).toBe(200);
    const writer = { ...authority, writerToken: opened.json().writerToken };
    const commit = {
      ...writer,
      commitId: PROFILE_ID,
      expectedSeq: 0,
      writes: [
        { type: 'entry', value: { id: 2, conversationId: 1, kind: 'message' } },
      ],
    };
    const url = `/runtime-sessions/durable/${SESSION_ID}/commits`;
    for (let retry = 0; retry < 2; retry++) {
      const response = await app.inject({
        method: 'POST',
        url,
        headers: TEAM_HEADERS,
        payload: commit,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ seq: 1 });
    }
    expect(repo.append).toHaveBeenCalledTimes(1);
    expect(mocks.taskRepository.appendMessages).not.toHaveBeenCalled();
    expect(mocks.runtimeSessionStorage.putObject).toHaveBeenCalled();
    const read = await app.inject({
      method: 'GET',
      url: `${url}?afterSeq=0`,
      headers: TEAM_HEADERS,
    });
    expect(read.statusCode).toBe(200);
    expect(read.headers['content-type']).toContain('application/x-ndjson');
    expect(
      read.body
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
    ).toMatchObject([
      { headSeq: 1, count: 1 },
      { seq: 1, writes: commit.writes },
    ]);
    expect(read.body).not.toContain('objectKey');
    const released = await app.inject({
      method: 'POST',
      url: `/runtime-sessions/durable/${SESSION_ID}/release`,
      headers: TEAM_HEADERS,
      payload: writer,
    });
    expect(released.statusCode).toBe(204);
    const stale = await app.inject({
      method: 'POST',
      url,
      headers: TEAM_HEADERS,
      payload: commit,
    });
    expect(stale.statusCode).toBe(409);
  });

  it('does not reveal session state without source-task access', async () => {
    mocks.permissionChecker.canViewTask.mockResolvedValue(false);
    const response = await app.inject({
      method: 'GET',
      url: `/runtime-sessions/durable/attempt?taskId=${TASK_ID}&attemptN=1`,
      headers: TEAM_HEADERS,
    });
    expect(response.statusCode).toBe(404);
    expect(
      mocks.runtimeSessionRepository.durable.findAttempt,
    ).not.toHaveBeenCalled();
  });

  it('does not expose the superseded pilot API', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/runtime-stores/open',
      headers: TEAM_HEADERS,
      payload: {},
    });
    expect(response.statusCode).toBe(404);
  });
});
