/* eslint-disable @typescript-eslint/unbound-method */
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';

import { KetoNamespace } from '@moltnet/auth';
import type { RuntimeSession } from '@moltnet/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MissingRuntimeSessionObjectError,
  type RuntimeSessionStorage,
} from './runtime-session-storage.js';
import {
  createRuntimeSessionService,
  type RuntimeSessionServiceDeps,
} from './runtime-sessions.js';

const gzipAsync = promisify(gzip);

const TEAM_ID = 'bbbbbbbb-0000-0000-0000-000000000002';
const TASK_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const AGENT_ID = '11111111-0000-4000-8000-000000000001';
const PROFILE_ID = 'dddddddd-0000-0000-0000-000000000004';
const SLOT_ID = 'eeeeeeee-0000-0000-0000-000000000005';
const SESSION_ID = '99999999-0000-0000-0000-000000000006';

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
    objectKey: `teams/${TEAM_ID}/runtime-sessions/tasks/${TASK_ID}/attempts/1/test.jsonl.gz`,
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

async function readStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function createDeps() {
  const storage: RuntimeSessionStorage = {
    putObject: vi.fn(),
    getObject: vi.fn(),
    deleteObject: vi.fn(),
  };
  const deps = {
    logger: {
      warn: vi.fn(),
    },
    permissionChecker: {
      canAccessTeam: vi.fn().mockResolvedValue(true),
      canReportTask: vi.fn().mockResolvedValue(true),
      canViewTask: vi.fn().mockResolvedValue(true),
    },
    runtimeProfileRepository: {
      findById: vi.fn().mockResolvedValue({ id: PROFILE_ID, teamId: TEAM_ID }),
    },
    runtimeSessionMaxBytes: 1024 * 1024,
    runtimeSessionRepository: {
      findActiveByTaskAttempt: vi.fn().mockResolvedValue(null),
      findByIdInTeam: vi.fn().mockResolvedValue(null),
      upsertActive: vi.fn().mockResolvedValue(mockSession()),
    },
    runtimeSessionStorage: storage,
    runtimeSlotRepository: {
      findByIdInTeam: vi.fn().mockResolvedValue({
        id: SLOT_ID,
        teamId: TEAM_ID,
        runtimeProfileId: PROFILE_ID,
      }),
    },
    taskRepository: {
      findById: vi.fn().mockResolvedValue({ id: TASK_ID, teamId: TEAM_ID }),
      findAttempt: vi.fn().mockResolvedValue({
        attemptN: 1,
        claimedByAgentId: AGENT_ID,
        status: 'running',
        taskId: TASK_ID,
      }),
    },
  } as unknown as RuntimeSessionServiceDeps;

  return { deps, storage };
}

describe('createRuntimeSessionService', () => {
  let subject: ReturnType<typeof createRuntimeSessionService>;
  let deps: RuntimeSessionServiceDeps;
  let storage: RuntimeSessionStorage;

  beforeEach(() => {
    ({ deps, storage } = createDeps());
    subject = createRuntimeSessionService(deps);
  });

  it('streams uploads into gzip object storage and records active metadata', async () => {
    const content = '{"session":"one"}\n';
    vi.mocked(storage.putObject).mockImplementation(async (input) => {
      await readStream(input.body);
    });

    await subject.upload({
      attemptN: 1,
      body: Readable.from([content]),
      identityId: AGENT_ID,
      query: {
        sessionKind: 'root',
        sourceSlotId: SLOT_ID,
      },
      subjectNs: KetoNamespace.Agent,
      taskId: TASK_ID,
      teamId: TEAM_ID,
    });

    const uploaded = vi.mocked(storage.putObject).mock.calls[0]?.[0];
    expect(uploaded).toMatchObject({
      contentEncoding: 'gzip',
      contentType: 'application/x-ndjson',
    });
    expect(uploaded?.key).toContain(`/tasks/${TASK_ID}/attempts/1/`);
    expect(uploaded?.key).toMatch(/\.jsonl\.gz$/);
    expect(deps.runtimeSessionRepository.upsertActive).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptN: 1,
        checkpointKind: 'attempt_final',
        sessionKind: 'root',
        sourceRuntimeProfileId: PROFILE_ID,
        sourceSlotId: SLOT_ID,
        storageClass: 'runtime-session',
        taskId: TASK_ID,
        teamId: TEAM_ID,
      }),
    );
  });

  it('rejects upload by an agent that did not claim the attempt', async () => {
    vi.mocked(deps.taskRepository.findAttempt).mockResolvedValue({
      attemptN: 1,
      claimedByAgentId: '00000000-0000-4000-8000-000000000000',
      status: 'running',
      taskId: TASK_ID,
    } as Awaited<ReturnType<typeof deps.taskRepository.findAttempt>>);

    await expect(
      subject.upload({
        attemptN: 1,
        body: Readable.from(['{"session":"one"}\n']),
        identityId: AGENT_ID,
        query: { sessionKind: 'root' },
        subjectNs: KetoNamespace.Agent,
        taskId: TASK_ID,
        teamId: TEAM_ID,
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      statusCode: 403,
    });
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('decompresses stored gzip content when downloading', async () => {
    const content = '{"session":"download"}\n';
    vi.mocked(
      deps.runtimeSessionRepository.findActiveByTaskAttempt,
    ).mockResolvedValue(mockSession());
    vi.mocked(storage.getObject).mockResolvedValue({
      body: Readable.from([await gzipAsync(content)]),
      contentEncoding: undefined,
      contentType: 'application/x-ndjson',
    });

    const result = await subject.download({
      attemptN: 1,
      identityId: AGENT_ID,
      subjectNs: KetoNamespace.Agent,
      taskId: TASK_ID,
      teamId: TEAM_ID,
    });

    await expect(readStream(result.stream)).resolves.toEqual(
      Buffer.from(content),
    );
  });

  it('maps a missing remote object to a not-found problem with reason', async () => {
    const session = mockSession();
    vi.mocked(
      deps.runtimeSessionRepository.findActiveByTaskAttempt,
    ).mockResolvedValue(session);
    vi.mocked(storage.getObject).mockRejectedValue(
      new MissingRuntimeSessionObjectError(session.objectKey),
    );

    await expect(
      subject.download({
        attemptN: 1,
        identityId: AGENT_ID,
        subjectNs: KetoNamespace.Agent,
        taskId: TASK_ID,
        teamId: TEAM_ID,
      }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      extensions: { reason: 'missing_remote_session_object' },
      statusCode: 404,
    });
  });
});
