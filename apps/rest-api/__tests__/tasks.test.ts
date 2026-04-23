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
  task_type: 'fulfill_brief',
  team_id: TEAM_ID,
  diary_id: DIARY_ID,
  output_kind: 'artifact' as const,
  input: { brief: 'Ship a task worker.' },
  input_schema_cid: 'bafy1',
  input_cid: 'bafy2',
  criteria_cid: null,
  references: [],
  correlation_id: null,
  imposed_by_agent_id: OWNER_ID,
  imposed_by_human_id: null,
  accepted_attempt_n: null,
  status: 'queued' as const,
  queued_at: new Date().toISOString(),
  completed_at: null,
  expires_at: null,
  cancelled_by_agent_id: null,
  cancelled_by_human_id: null,
  cancel_reason: null,
  max_attempts: 1,
};

const MOCK_ATTEMPT = {
  task_id: TASK_ID,
  attempt_n: ATTEMPT_N,
  claimed_by_agent_id: OWNER_ID,
  runtime_id: null,
  claimed_at: new Date().toISOString(),
  started_at: null,
  completed_at: null,
  status: 'running' as const,
  output: null,
  output_cid: null,
  error: null,
  usage: null,
  content_signature: null,
  signed_at: null,
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
        task_type: 'fulfill_brief',
        team_id: TEAM_ID,
        diary_id: DIARY_ID,
        input: { brief: 'Ship a task worker.' },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      id: TASK_ID,
      task_type: 'fulfill_brief',
    });
    expect(mocks.taskService.create).toHaveBeenCalledOnce();
  });

  it('returns 401 without auth', async () => {
    const appNoAuth = await createTestApp(mocks, null);
    const response = await appNoAuth.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        task_type: 'fulfill_brief',
        team_id: TEAM_ID,
        diary_id: DIARY_ID,
        input: {},
      },
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns 400 when task_type is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: { authorization: 'Bearer test-token' },
      payload: { team_id: TEAM_ID, input: {} },
    });
    expect(response.statusCode).toBe(400);
  });

  it('returns 400 when team_id is not a uuid', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: { authorization: 'Bearer test-token' },
      payload: {
        task_type: 'fulfill_brief',
        team_id: 'not-a-uuid',
        input: {},
      },
    });
    expect(response.statusCode).toBe(400);
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
      url: `/tasks?team_id=${TEAM_ID}`,
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ items: [{ id: TASK_ID }] });
    expect(mocks.taskService.list).toHaveBeenCalledOnce();
  });

  it('returns 400 when team_id is missing', async () => {
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
      attempt: { task_id: TASK_ID, attempt_n: ATTEMPT_N },
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
      claim_expires_at: new Date(Date.now() + 300_000).toISOString(),
    });
  });

  it('returns 200 with updated claim_expires_at', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/tasks/${TASK_ID}/attempts/${ATTEMPT_N}/heartbeat`,
      headers: { authorization: 'Bearer test-token' },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty('claim_expires_at');
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
          pull_request_url: null,
          diary_entry_ids: [],
          summary: 'Completed the task successfully.',
        },
        output_cid: 'bafy-output',
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: TASK_ID, status: 'completed' });
  });

  it('returns 400 when output_cid is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/tasks/${TASK_ID}/attempts/${ATTEMPT_N}/complete`,
      headers: { authorization: 'Bearer test-token' },
      payload: {
        output: {},
        usage: { input_tokens: 0, output_tokens: 0 },
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
        output_cid: 'bafy-output',
        usage: { input_tokens: 0, output_tokens: 0 },
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
      { task_id: TASK_ID, attempt_n: ATTEMPT_N },
    ]);
  });
});

describe('GET /tasks/:id/attempts/:n/messages', () => {
  let app: FastifyInstance;
  let mocks: ReturnType<typeof createMockServices>;

  const MOCK_MESSAGE = {
    task_id: TASK_ID,
    attempt_n: ATTEMPT_N,
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
    expect(response.json()).toMatchObject([{ task_id: TASK_ID, seq: 0 }]);
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
