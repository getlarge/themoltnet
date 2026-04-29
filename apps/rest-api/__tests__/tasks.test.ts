import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import { TaskServiceError } from '../src/services/task.service.js';
import {
  createMockServices,
  createTestApp,
  OWNER_ID,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

const TASK_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const TEAM_ID = 'bbbbbbbb-0000-0000-0000-000000000002';
const DIARY_ID = 'cccccccc-0000-0000-0000-000000000003';
const ATTEMPT_N = 1;

const MOCK_TASK = {
  id: TASK_ID,
  taskType: 'fulfill_brief',
  teamId: TEAM_ID,
  diaryId: DIARY_ID,
  outputKind: 'artifact' as const,
  input: { brief: 'Ship a task worker.' },
  inputSchemaCid: 'bafy1',
  inputCid: 'bafy2',
  criteriaCid: null,
  references: [],
  correlationId: null,
  imposedByAgentId: OWNER_ID,
  imposedByHumanId: null,
  acceptedAttemptN: null,
  requiredExecutorTrustLevel: 'selfDeclared' as const,
  status: 'queued' as const,
  queuedAt: new Date().toISOString(),
  completedAt: null,
  expiresAt: null,
  cancelledByAgentId: null,
  cancelledByHumanId: null,
  cancelReason: null,
  maxAttempts: 1,
  dispatchTimeoutSec: null,
  runningTimeoutSec: null,
};

const MOCK_ATTEMPT = {
  taskId: TASK_ID,
  attemptN: ATTEMPT_N,
  claimedByAgentId: OWNER_ID,
  runtimeId: null,
  claimedAt: new Date().toISOString(),
  startedAt: null,
  completedAt: null,
  status: 'running' as const,
  output: null,
  outputCid: null,
  claimedExecutorFingerprint: null,
  claimedExecutorManifest: null,
  completedExecutorFingerprint: null,
  completedExecutorManifest: null,
  error: null,
  usage: null,
  contentSignature: null,
  signedAt: null,
};

describe('POST /tasks', () => {
  let app: FastifyInstance;
  let mocks: ReturnType<typeof createMockServices>;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
    mocks.taskService.create.mockResolvedValue(MOCK_TASK);
  });

  it('returns 201 with created task', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: { authorization: 'Bearer test-token' },
      payload: {
        taskType: 'fulfill_brief',
        teamId: TEAM_ID,
        diaryId: DIARY_ID,
        input: { brief: 'Ship a task worker.' },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      id: TASK_ID,
      taskType: 'fulfill_brief',
    });
    expect(mocks.taskService.create).toHaveBeenCalledOnce();
  });

  it('returns 401 without auth', async () => {
    const appNoAuth = await createTestApp(mocks, null);
    const response = await appNoAuth.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        taskType: 'fulfill_brief',
        teamId: TEAM_ID,
        diaryId: DIARY_ID,
        input: {},
      },
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns 400 when taskType is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: { authorization: 'Bearer test-token' },
      payload: { teamId: TEAM_ID, input: {} },
    });
    expect(response.statusCode).toBe(400);
  });

  it('returns 400 when teamId is not a uuid', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: { authorization: 'Bearer test-token' },
      payload: {
        taskType: 'fulfill_brief',
        teamId: 'not-a-uuid',
        input: {},
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it('returns validation problem details for unknown task types', async () => {
    mocks.taskService.create.mockRejectedValue(
      new TaskServiceError('unknown_task_type', 'Unknown task type: nope'),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: {
        authorization: 'Bearer test-token',
        accept: 'application/problem+json',
      },
      payload: {
        taskType: 'nope',
        teamId: TEAM_ID,
        diaryId: DIARY_ID,
        input: {},
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: 'VALIDATION_FAILED',
      detail: 'Unknown task type: nope',
      errors: [{ field: 'taskType', message: 'Unknown task type: nope' }],
    });
  });
});

describe('GET /tasks', () => {
  let app: FastifyInstance;
  let mocks: ReturnType<typeof createMockServices>;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
    mocks.taskService.list.mockResolvedValue({ items: [MOCK_TASK], total: 1 });
  });

  it('returns 200 with task list', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/tasks?teamId=${TEAM_ID}`,
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ items: [{ id: TASK_ID }] });
    expect(mocks.taskService.list).toHaveBeenCalledOnce();
  });

  it('passes extended filters through to taskService.list', async () => {
    const response = await app.inject({
      method: 'GET',
      url:
        `/tasks?teamId=${TEAM_ID}` +
        `&diaryId=${DIARY_ID}` +
        `&imposedByAgentId=${OWNER_ID}` +
        `&imposedByHumanId=550e8400-e29b-41d4-a716-446655440099` +
        `&claimedByAgentId=${OWNER_ID}` +
        `&hasAttempts=true` +
        `&queuedAfter=2026-04-28T10:00:00.000Z` +
        `&queuedBefore=2026-04-29T10:00:00.000Z` +
        `&completedAfter=2026-04-28T12:00:00.000Z` +
        `&completedBefore=2026-04-29T12:00:00.000Z`,
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.taskService.list).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: TEAM_ID,
        diaryId: DIARY_ID,
        imposedByAgentId: OWNER_ID,
        imposedByHumanId: '550e8400-e29b-41d4-a716-446655440099',
        claimedByAgentId: OWNER_ID,
        hasAttempts: true,
        queuedAfter: '2026-04-28T10:00:00.000Z',
        queuedBefore: '2026-04-29T10:00:00.000Z',
        completedAfter: '2026-04-28T12:00:00.000Z',
        completedBefore: '2026-04-29T12:00:00.000Z',
      }),
    );
  });

  it('returns 400 when teamId is missing', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/tasks',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('GET /tasks/:id', () => {
  let app: FastifyInstance;
  let mocks: ReturnType<typeof createMockServices>;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
  });

  it('returns 200 with task', async () => {
    mocks.taskService.get.mockResolvedValue(MOCK_TASK);

    const response = await app.inject({
      method: 'GET',
      url: `/tasks/${TASK_ID}`,
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: TASK_ID });
  });

  it('returns 404 when task not found', async () => {
    mocks.taskService.get.mockRejectedValue(
      new TaskServiceError('not_found', 'Task not found'),
    );

    const response = await app.inject({
      method: 'GET',
      url: `/tasks/${TASK_ID}`,
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns 403 when caller is not authorized', async () => {
    mocks.taskService.get.mockRejectedValue(
      new TaskServiceError('forbidden', 'Not authorized'),
    );

    const response = await app.inject({
      method: 'GET',
      url: `/tasks/${TASK_ID}`,
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(403);
  });
});

describe('POST /tasks/:id/claim', () => {
  let app: FastifyInstance;
  let mocks: ReturnType<typeof createMockServices>;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
    mocks.taskService.claim.mockResolvedValue({
      task: MOCK_TASK,
      attempt: MOCK_ATTEMPT,
    });
  });

  it('returns 200 with task and attempt', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/tasks/${TASK_ID}/claim`,
      headers: { authorization: 'Bearer test-token' },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      task: { id: TASK_ID },
      attempt: { taskId: TASK_ID, attemptN: ATTEMPT_N },
    });
    expect(mocks.taskService.claim).toHaveBeenCalledOnce();
  });

  it('returns 409 when task is not in queued state', async () => {
    mocks.taskService.claim.mockRejectedValue(
      new TaskServiceError('conflict', 'Task cannot be claimed'),
    );

    const response = await app.inject({
      method: 'POST',
      url: `/tasks/${TASK_ID}/claim`,
      headers: { authorization: 'Bearer test-token' },
      payload: {},
    });

    expect(response.statusCode).toBe(409);
  });
});

describe('POST /tasks/:id/attempts/:n/heartbeat', () => {
  let app: FastifyInstance;
  let mocks: ReturnType<typeof createMockServices>;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
    mocks.taskService.heartbeat.mockResolvedValue({
      claimExpiresAt: new Date(Date.now() + 300_000).toISOString(),
      cancelled: false,
      cancelReason: null,
    });
  });

  it('returns 200 with updated claimExpiresAt', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/tasks/${TASK_ID}/attempts/${ATTEMPT_N}/heartbeat`,
      headers: { authorization: 'Bearer test-token' },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty('claimExpiresAt');
    expect(mocks.taskService.heartbeat).toHaveBeenCalledWith(
      TASK_ID,
      ATTEMPT_N,
      OWNER_ID,
      expect.any(String),
      undefined,
    );
  });
});

describe('POST /tasks/:id/attempts/:n/complete', () => {
  let app: FastifyInstance;
  let mocks: ReturnType<typeof createMockServices>;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
    mocks.taskService.complete.mockResolvedValue({
      ...MOCK_TASK,
      status: 'completed' as const,
    });
  });

  it('returns 200 with completed task', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/tasks/${TASK_ID}/attempts/${ATTEMPT_N}/complete`,
      headers: { authorization: 'Bearer test-token' },
      payload: {
        output: {
          branch: 'feat/tasks-api',
          commits: [],
          pullRequestUrl: null,
          diaryEntryIds: [],
          summary: 'Completed the task successfully.',
        },
        outputCid: 'bafy-output',
        usage: { inputTokens: 100, outputTokens: 50 },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: TASK_ID, status: 'completed' });
  });

  it('returns 400 when outputCid is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/tasks/${TASK_ID}/attempts/${ATTEMPT_N}/complete`,
      headers: { authorization: 'Bearer test-token' },
      payload: {
        output: {},
        usage: { inputTokens: 0, outputTokens: 0 },
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it('returns validation problem details when service rejects task output', async () => {
    mocks.taskService.complete.mockRejectedValue(
      new TaskServiceError(
        'invalid',
        'Task output failed validation for task type: fulfill_brief',
        [{ field: 'output/summary', message: 'Expected string' }],
      ),
    );

    const response = await app.inject({
      method: 'POST',
      url: `/tasks/${TASK_ID}/attempts/${ATTEMPT_N}/complete`,
      headers: {
        authorization: 'Bearer test-token',
        accept: 'application/problem+json',
      },
      payload: {
        output: {},
        outputCid: 'bafy-output',
        usage: { inputTokens: 0, outputTokens: 0 },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: 'VALIDATION_FAILED',
      detail: 'Task output failed validation for task type: fulfill_brief',
      errors: [{ field: 'output/summary', message: 'Expected string' }],
    });
  });
});

describe('POST /tasks/:id/attempts/:n/fail', () => {
  let app: FastifyInstance;
  let mocks: ReturnType<typeof createMockServices>;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
    mocks.taskService.fail.mockResolvedValue({
      ...MOCK_TASK,
      status: 'failed' as const,
    });
  });

  it('returns 200 with failed task', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/tasks/${TASK_ID}/attempts/${ATTEMPT_N}/fail`,
      headers: { authorization: 'Bearer test-token' },
      payload: {
        error: { code: 'TOOL_FAILURE', message: 'Tool call failed' },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: TASK_ID, status: 'failed' });
  });
});

describe('POST /tasks/:id/cancel', () => {
  let app: FastifyInstance;
  let mocks: ReturnType<typeof createMockServices>;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
    mocks.taskService.cancel.mockResolvedValue({
      ...MOCK_TASK,
      status: 'cancelled' as const,
    });
  });

  it('returns 200 with cancelled task', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/tasks/${TASK_ID}/cancel`,
      headers: { authorization: 'Bearer test-token' },
      payload: { reason: 'No longer needed' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: TASK_ID, status: 'cancelled' });
    expect(mocks.taskService.cancel).toHaveBeenCalledWith(
      TASK_ID,
      OWNER_ID,
      expect.any(String),
      'No longer needed',
    );
  });

  it('returns 400 when reason is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/tasks/${TASK_ID}/cancel`,
      headers: { authorization: 'Bearer test-token' },
      payload: {},
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('GET /tasks/:id/attempts', () => {
  let app: FastifyInstance;
  let mocks: ReturnType<typeof createMockServices>;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
    mocks.taskService.listAttempts.mockResolvedValue([MOCK_ATTEMPT]);
  });

  it('returns 200 with attempts array', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/tasks/${TASK_ID}/attempts`,
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject([
      { taskId: TASK_ID, attemptN: ATTEMPT_N },
    ]);
  });
});

describe('GET /tasks/:id/attempts/:n/messages', () => {
  let app: FastifyInstance;
  let mocks: ReturnType<typeof createMockServices>;

  const MOCK_MESSAGE = {
    taskId: TASK_ID,
    attemptN: ATTEMPT_N,
    seq: 0,
    timestamp: new Date().toISOString(),
    kind: 'text_delta',
    payload: { text: 'hello' },
  };

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
    mocks.taskService.listMessages.mockResolvedValue([MOCK_MESSAGE]);
  });

  it('returns 200 with messages array', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/tasks/${TASK_ID}/attempts/${ATTEMPT_N}/messages`,
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject([{ taskId: TASK_ID, seq: 0 }]);
    expect(mocks.taskService.listMessages).toHaveBeenCalledWith(
      TASK_ID,
      ATTEMPT_N,
      OWNER_ID,
      expect.any(String),
      expect.objectContaining({ afterSeq: undefined, limit: 200 }),
    );
  });
});

describe('POST /tasks/:id/attempts/:n/messages', () => {
  let app: FastifyInstance;
  let mocks: ReturnType<typeof createMockServices>;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
    mocks.taskService.appendMessages.mockResolvedValue({ count: 2 });
  });

  it('returns 200 with message count', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/tasks/${TASK_ID}/attempts/${ATTEMPT_N}/messages`,
      headers: { authorization: 'Bearer test-token' },
      payload: {
        messages: [
          { kind: 'text_delta', payload: { text: 'hello' } },
          { kind: 'turn_end', payload: {} },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ count: 2 });
  });

  it('returns 400 when messages is empty', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/tasks/${TASK_ID}/attempts/${ATTEMPT_N}/messages`,
      headers: { authorization: 'Bearer test-token' },
      payload: { messages: [] },
    });
    expect(response.statusCode).toBe(400);
  });
});
