/* eslint-disable @typescript-eslint/unbound-method */
import { Readable } from 'node:stream';

import { KetoNamespace } from '@moltnet/auth';
import { computeBytesCid } from '@moltnet/crypto-service';
import type { TaskArtifact } from '@moltnet/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskArtifactStorage } from './task-artifact-storage.js';
import {
  createTaskArtifactService,
  type TaskArtifactServiceDeps,
  TaskArtifactServiceError,
} from './task-artifacts.js';

const TEAM_ID = 'bbbbbbbb-0000-0000-0000-000000000002';
const TASK_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const AGENT_ID = '11111111-0000-4000-8000-000000000001';
const ARTIFACT_ID = '99999999-0000-0000-0000-000000000006';

function mockArtifact(overrides: Partial<TaskArtifact> = {}): TaskArtifact {
  return {
    id: ARTIFACT_ID,
    teamId: TEAM_ID,
    taskId: TASK_ID,
    attemptN: 1,
    kind: 'json',
    title: 'result',
    objectKey: 'teams/x/artifacts/bafy',
    contentType: 'application/json',
    contentEncoding: null,
    sizeBytes: 11,
    sha256: 'a'.repeat(64),
    cid: 'bafkreicid',
    createdByAgentId: AGENT_ID,
    expiresAt: null,
    createdAt: new Date('2026-06-27T00:00:00.000Z'),
    updatedAt: new Date('2026-06-27T00:00:00.000Z'),
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
  const storage: TaskArtifactStorage = {
    putObject: vi.fn(),
    getObject: vi.fn(),
    headObject: vi.fn().mockResolvedValue(null),
    deleteObject: vi.fn(),
  };
  const deps = {
    logger: {
      warn: vi.fn(),
    },
    objectStorage: storage,
    permissionChecker: {
      canAccessTeam: vi.fn().mockResolvedValue(true),
      canReportTask: vi.fn().mockResolvedValue(true),
      canViewTask: vi.fn().mockResolvedValue(true),
    },
    taskArtifactMaxBytes: 1024 * 1024,
    taskArtifactRepository: {
      createForAttempt: vi.fn().mockResolvedValue(mockArtifact()),
      findByCidForAttempt: vi.fn().mockResolvedValue(null),
      listForTask: vi.fn().mockResolvedValue([]),
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
  } as unknown as TaskArtifactServiceDeps;

  return { deps, storage };
}

describe('createTaskArtifactService', () => {
  let deps: TaskArtifactServiceDeps;
  let storage: TaskArtifactStorage;
  let subject: ReturnType<typeof createTaskArtifactService>;

  beforeEach(() => {
    ({ deps, storage } = createDeps());
    subject = createTaskArtifactService(deps);
  });

  it('uploads an artifact under a CID-addressed team object key', async () => {
    const body = Buffer.from('{"ok":true}');
    const expectedCid = await computeBytesCid(body);
    vi.mocked(storage.putObject).mockImplementation(async (input) => {
      await readStream(input.body);
    });

    await subject.upload({
      attemptN: 1,
      body: Readable.from([body]),
      contentType: 'application/json',
      identityId: AGENT_ID,
      kind: 'json',
      subjectNs: KetoNamespace.Agent,
      taskId: TASK_ID,
      teamId: TEAM_ID,
      title: 'result',
    });

    const uploaded = vi.mocked(storage.putObject).mock.calls[0]?.[0];
    expect(uploaded).toMatchObject({
      contentLength: body.byteLength,
      contentType: 'application/json',
      key: `teams/${TEAM_ID}/artifacts/${expectedCid}`,
    });
    expect(deps.taskArtifactRepository.createForAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptN: 1,
        cid: expectedCid,
        contentType: 'application/json',
        createdByAgentId: AGENT_ID,
        kind: 'json',
        objectKey: `teams/${TEAM_ID}/artifacts/${expectedCid}`,
        sizeBytes: body.byteLength,
        taskId: TASK_ID,
        teamId: TEAM_ID,
        title: 'result',
      }),
    );
  });

  it('does not re-upload an object when the CID key already exists', async () => {
    vi.mocked(storage.headObject).mockResolvedValue({
      contentLength: 11,
      contentType: 'application/json',
    });

    await subject.upload({
      attemptN: 1,
      body: Readable.from(['{"ok":true}']),
      contentType: 'application/json',
      identityId: AGENT_ID,
      kind: 'json',
      subjectNs: KetoNamespace.Agent,
      taskId: TASK_ID,
      teamId: TEAM_ID,
      title: 'result',
    });

    expect(storage.putObject).not.toHaveBeenCalled();
    expect(deps.taskArtifactRepository.createForAttempt).toHaveBeenCalledOnce();
  });

  it('rejects upload by an agent that did not claim the attempt', async () => {
    vi.mocked(deps.taskRepository.findAttempt).mockResolvedValue({
      attemptN: 1,
      claimedByAgentId: '00000000-0000-4000-8000-000000000000',
      status: 'running',
      taskId: TASK_ID,
    } as never);

    await expect(
      subject.upload({
        attemptN: 1,
        body: Readable.from(['{"ok":true}']),
        contentType: 'application/json',
        identityId: AGENT_ID,
        kind: 'json',
        subjectNs: KetoNamespace.Agent,
        taskId: TASK_ID,
        teamId: TEAM_ID,
        title: 'result',
      }),
    ).rejects.toBeInstanceOf(TaskArtifactServiceError);
  });

  it('lists artifacts for a task visible to the subject', async () => {
    vi.mocked(deps.taskArtifactRepository.listForTask).mockResolvedValue([
      mockArtifact(),
    ]);

    const artifacts = await subject.listForTask({
      identityId: AGENT_ID,
      subjectNs: KetoNamespace.Agent,
      taskId: TASK_ID,
      teamId: TEAM_ID,
    });

    expect(artifacts).toHaveLength(1);
    expect(deps.permissionChecker.canViewTask).toHaveBeenCalledWith(
      TASK_ID,
      AGENT_ID,
      KetoNamespace.Agent,
    );
    expect(deps.taskArtifactRepository.listForTask).toHaveBeenCalledWith({
      taskId: TASK_ID,
      teamId: TEAM_ID,
    });
  });

  it('downloads artifact content by CID for a visible attempt', async () => {
    const artifact = mockArtifact({
      cid: 'bafkreidownload',
      contentType: 'text/plain',
      objectKey: 'teams/team/artifacts/bafkreidownload',
    });
    vi.mocked(
      deps.taskArtifactRepository.findByCidForAttempt,
    ).mockResolvedValue(artifact);
    vi.mocked(storage.getObject).mockResolvedValue({
      body: Readable.from(['hello']),
      contentType: 'text/plain',
    });

    const result = await subject.download({
      attemptN: 1,
      cid: artifact.cid,
      identityId: AGENT_ID,
      subjectNs: KetoNamespace.Agent,
      taskId: TASK_ID,
      teamId: TEAM_ID,
    });

    expect(result.artifact).toBe(artifact);
    expect(await readStream(result.stream)).toEqual(Buffer.from('hello'));
    expect(storage.getObject).toHaveBeenCalledWith(artifact.objectKey);
  });
});
