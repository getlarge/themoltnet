import { NodeOperationError } from 'n8n-workflow';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MoltNet } from '../nodes/MoltNet/MoltNet.node.js';
import {
  createExecuteContext,
  defaultCredentials,
  FakeMoltNetApi,
} from './harness.js';

describe('MoltNet node', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('uses the MoltNet task coordination color', () => {
    expect(new MoltNet().description.iconColor).toBe('azure');
  });

  it('creates a validated task with option and context precedence', async () => {
    const api = new FakeMoltNetApi();
    vi.stubGlobal('fetch', api.fetch);
    const context = createExecuteContext({
      parameters: {
        operation: 'create',
        taskType: 'freeform',
        input: '{"brief":"Review this change"}',
        options: {
          title: 'Review',
          tags: 'n8n, review',
          maxAttempts: 3,
          correlationId: '66666666-6666-4666-8666-666666666666',
          teamId: '77777777-7777-4777-8777-777777777777',
          diaryId: '88888888-8888-4888-8888-888888888888',
        },
      },
    });

    const [output] = await new MoltNet().execute.call(context);

    expect(output[0].pairedItem).toEqual({ item: 0 });
    expect(output[0].json.id).toBe(api.taskId);
    expect(api.createdBodies[0]).toMatchObject({
      taskType: 'freeform',
      input: { brief: 'Review this change' },
      title: 'Review',
      tags: ['n8n', 'review'],
      maxAttempts: 3,
      correlationId: '66666666-6666-4666-8666-666666666666',
      diaryId: '88888888-8888-4888-8888-888888888888',
    });
    const createRequest = api.requests.find(
      ({ method, url }) => method === 'POST' && url.endsWith('/tasks'),
    );
    expect(createRequest?.headers.get('x-moltnet-team-id')).toBe(
      '77777777-7777-4777-8777-777777777777',
    );
  });

  it('uses credential team and diary defaults', async () => {
    const api = new FakeMoltNetApi();
    vi.stubGlobal('fetch', api.fetch);
    const context = createExecuteContext({
      parameters: {
        operation: 'create',
        taskType: 'freeform',
        input: '{"brief":"Use defaults"}',
        options: {},
      },
    });

    await new MoltNet().execute.call(context);

    expect(api.createdBodies[0].diaryId).toBe(defaultCredentials.diaryId);
    const createRequest = api.requests.find(
      ({ method, url }) => method === 'POST' && url.endsWith('/tasks'),
    );
    expect(createRequest?.headers.get('x-moltnet-team-id')).toBe(
      defaultCredentials.teamId,
    );
  });

  it('uses the explicitly configured Wait team context', async () => {
    const overrideTeamId = '77777777-7777-4777-8777-777777777777';
    const api = new FakeMoltNetApi();
    vi.stubGlobal('fetch', api.fetch);
    const [created] = await new MoltNet().execute.call(
      createExecuteContext({
        parameters: {
          operation: 'create',
          taskType: 'freeform',
          input: '{"brief":"Keep team context"}',
          options: { teamId: overrideTeamId },
        },
      }),
    );

    await new MoltNet().execute.call(
      createExecuteContext({
        items: created,
        parameters: {
          operation: 'wait',
          taskId: api.taskId,
          teamId: overrideTeamId,
          pollInterval: 5,
          timeout: 30,
        },
      }),
    );

    const waitRequest = api.requests.find(({ url }) =>
      url.endsWith(`/tasks/${api.taskId}`),
    );
    expect(created[0].json.teamId).toBe(overrideTeamId);
    expect(waitRequest?.headers.get('x-moltnet-team-id')).toBe(overrideTeamId);
  });

  it('does not infer Wait team context from untrusted input JSON', async () => {
    const untrustedTeamId = '77777777-7777-4777-8777-777777777777';
    const api = new FakeMoltNetApi();
    vi.stubGlobal('fetch', api.fetch);

    await new MoltNet().execute.call(
      createExecuteContext({
        items: [{ json: { id: api.taskId, teamId: untrustedTeamId } }],
        parameters: {
          operation: 'wait',
          taskId: api.taskId,
          pollInterval: 5,
          timeout: 30,
        },
      }),
    );

    const waitRequest = api.requests.find(({ url }) =>
      url.endsWith(`/tasks/${api.taskId}`),
    );
    expect(waitRequest?.headers.get('x-moltnet-team-id')).toBe(
      defaultCredentials.teamId,
    );
  });

  it('surfaces builder validation as a node operation error', async () => {
    const api = new FakeMoltNetApi();
    vi.stubGlobal('fetch', api.fetch);
    const context = createExecuteContext({
      credentials: {
        ...defaultCredentials,
        teamId: '',
        diaryId: '',
      },
      parameters: {
        operation: 'create',
        taskType: 'freeform',
        input: '{"brief":"Missing context"}',
        options: {},
      },
    });

    await expect(new MoltNet().execute.call(context)).rejects.toBeInstanceOf(
      NodeOperationError,
    );
    expect(api.createdBodies).toHaveLength(0);
  });

  it.each([
    {
      terminalStatus: 'completed',
      acceptedAttemptN: 2,
      attempts: [
        {
          taskId: '33333333-3333-4333-8333-333333333333',
          attemptN: 2,
          status: 'completed',
          output: { answer: 99 },
          error: null,
        },
        {
          taskId: '33333333-3333-4333-8333-333333333333',
          attemptN: 1,
          status: 'failed',
          output: null,
          error: { code: 'EARLY_FAILURE', message: 'first attempt failed' },
        },
      ],
      expected: {
        accepted: true,
        attempt: { attemptN: 2 },
        state: { answer: 99 },
        error: null,
      },
    },
    {
      terminalStatus: 'failed',
      acceptedAttemptN: null,
      attempts: [
        {
          taskId: '33333333-3333-4333-8333-333333333333',
          attemptN: 1,
          status: 'failed',
          output: null,
          error: { code: 'MODEL_FAILED', message: 'provider unavailable' },
        },
        {
          taskId: '33333333-3333-4333-8333-333333333333',
          attemptN: 3,
          status: 'failed',
          output: null,
          error: {
            code: 'ATTEMPTS_EXHAUSTED',
            message: 'three attempts failed',
            retryable: false,
          },
        },
      ],
      expected: {
        accepted: false,
        attempt: { attemptN: 3 },
        state: null,
        error: {
          code: 'ATTEMPTS_EXHAUSTED',
          message: 'three attempts failed',
          retryable: false,
        },
      },
    },
    {
      terminalStatus: 'cancelled',
      acceptedAttemptN: null,
      attempts: [],
      expected: {
        accepted: false,
        attempt: null,
        state: null,
        error: null,
      },
    },
    {
      terminalStatus: 'expired',
      acceptedAttemptN: null,
      attempts: [
        {
          taskId: '33333333-3333-4333-8333-333333333333',
          attemptN: 2,
          status: 'timed_out',
          output: null,
          error: { code: 'RUN_TIMEOUT', message: 'execution expired' },
        },
      ],
      expected: {
        accepted: false,
        attempt: { attemptN: 2 },
        state: null,
        error: { code: 'RUN_TIMEOUT', message: 'execution expired' },
      },
    },
  ])(
    'waits through transitions and returns the $terminalStatus snapshot',
    async ({ terminalStatus, acceptedAttemptN, attempts, expected }) => {
      vi.useFakeTimers();
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const api = new FakeMoltNetApi({
        statuses: ['queued', 'running', terminalStatus],
        terminalStatus,
        acceptedAttemptN,
        attempts,
      });
      vi.stubGlobal('fetch', api.fetch);
      const context = createExecuteContext({
        parameters: {
          operation: 'wait',
          taskId: api.taskId,
          pollInterval: 5,
          timeout: 30,
        },
      });

      const execution = new MoltNet().execute.call(context);
      await vi.runAllTimersAsync();
      const [output] = await execution;

      expect(output[0].json).toMatchObject({
        taskId: api.taskId,
        status: terminalStatus,
        terminal: true,
        ...expected,
      });
      expect(output[0].json.attempts).toEqual(attempts);
      expect(output[0].pairedItem).toEqual({ item: 0 });
    },
  );

  it('times out a non-terminal task', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const api = new FakeMoltNetApi({ terminalStatus: 'running' });
    vi.stubGlobal('fetch', api.fetch);
    const context = createExecuteContext({
      parameters: {
        operation: 'wait',
        taskId: api.taskId,
        pollInterval: 5,
        timeout: 1,
      },
    });

    const execution = new MoltNet().execute.call(context);
    const rejection = execution.catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    const error = await rejection;

    expect(error).toMatchObject({
      message: expect.stringMatching(
        /Timed out waiting for task.*after 1\.0 seconds/,
      ),
      description:
        'Configured timeout: 1 seconds; polls: 1; last status: running.',
    });
  });

  it.each([
    { name: 'task read', taskReadResponses: ['hang' as const] },
    { name: 'attempt read', attemptReadResponses: ['hang' as const] },
  ])('aborts a hung $name at the configured deadline', async (apiOptions) => {
    vi.useFakeTimers();
    const api = new FakeMoltNetApi(apiOptions);
    vi.stubGlobal('fetch', api.fetch);
    const execution = new MoltNet().execute.call(
      createExecuteContext({
        parameters: {
          operation: 'wait',
          taskId: api.taskId,
          pollInterval: 5,
          timeout: 1,
        },
      }),
    );
    const rejection = execution.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(1_000);

    await expect(rejection).resolves.toMatchObject({
      message: expect.stringMatching(/Timed out waiting for task/),
    });
  });

  it('rejects unsafe polling intervals', async () => {
    const context = createExecuteContext({
      parameters: {
        operation: 'wait',
        taskId: '33333333-3333-4333-8333-333333333333',
        pollInterval: 0.01,
        timeout: 30,
      },
    });

    await expect(new MoltNet().execute.call(context)).rejects.toThrow(
      /Polling interval must be at least 5 seconds/,
    );
  });

  it.each([0, 1_801])(
    'rejects an invalid timeout of %s seconds',
    async (timeout) => {
      const context = createExecuteContext({
        parameters: {
          operation: 'wait',
          taskId: '33333333-3333-4333-8333-333333333333',
          pollInterval: 5,
          timeout,
        },
      });

      await expect(new MoltNet().execute.call(context)).rejects.toThrow(
        /Timeout must be between 1 and 1800 seconds/,
      );
    },
  );

  it.each([
    { name: 'network failure', response: 'network' as const },
    { name: 'rate limit', response: 429 },
    { name: 'server failure', response: 503 },
  ])('retries a transient $name while waiting', async ({ response }) => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const api = new FakeMoltNetApi({
      taskReadResponses: [response],
      terminalStatus: 'completed',
    });
    vi.stubGlobal('fetch', api.fetch);
    const execution = new MoltNet().execute.call(
      createExecuteContext({
        parameters: {
          operation: 'wait',
          taskId: api.taskId,
          pollInterval: 5,
          timeout: 30,
        },
      }),
    );

    await vi.runAllTimersAsync();
    const [output] = await execution;

    expect(output[0].json).toMatchObject({
      taskId: api.taskId,
      status: 'completed',
    });
    expect(
      api.requests.filter(({ url }) => url.endsWith(`/tasks/${api.taskId}`)),
    ).toHaveLength(2);
  });

  it('retries transient attempt reads after the task becomes terminal', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const api = new FakeMoltNetApi({ attemptReadResponses: [503] });
    vi.stubGlobal('fetch', api.fetch);
    const execution = new MoltNet().execute.call(
      createExecuteContext({
        parameters: {
          operation: 'wait',
          taskId: api.taskId,
          pollInterval: 5,
          timeout: 30,
        },
      }),
    );

    await vi.runAllTimersAsync();
    const [output] = await execution;

    expect(output[0].json.status).toBe('completed');
    expect(
      api.requests.filter(({ url }) =>
        url.endsWith(`/tasks/${api.taskId}/attempts`),
      ),
    ).toHaveLength(2);
  });

  it('fails immediately on a permanent task read error', async () => {
    const api = new FakeMoltNetApi({ taskReadResponses: [403] });
    vi.stubGlobal('fetch', api.fetch);

    await expect(
      new MoltNet().execute.call(
        createExecuteContext({
          parameters: {
            operation: 'wait',
            taskId: api.taskId,
            pollInterval: 5,
            timeout: 30,
          },
        }),
      ),
    ).rejects.toThrow(/403/);
    expect(
      api.requests.filter(({ url }) => url.endsWith(`/tasks/${api.taskId}`)),
    ).toHaveLength(1);
  });

  it('stops waiting when n8n cancels the execution', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const api = new FakeMoltNetApi({ terminalStatus: 'running' });
    vi.stubGlobal('fetch', api.fetch);
    const execution = new MoltNet().execute.call(
      createExecuteContext({
        cancelSignal: controller.signal,
        parameters: {
          operation: 'wait',
          taskId: api.taskId,
          pollInterval: 5,
          timeout: 30,
        },
      }),
    );
    await vi.advanceTimersByTimeAsync(0);

    controller.abort();

    await expect(execution).rejects.toThrow(/Execution was cancelled/);
    expect(
      api.requests.filter(({ url }) => url.endsWith(`/tasks/${api.taskId}`)),
    ).toHaveLength(1);
  });

  it('treats cancellation as terminal when Continue On Fail is enabled', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const api = new FakeMoltNetApi({ terminalStatus: 'running' });
    vi.stubGlobal('fetch', api.fetch);
    const execution = new MoltNet().execute.call(
      createExecuteContext({
        cancelSignal: controller.signal,
        continueOnFail: true,
        items: [{ json: {} }, { json: {} }],
        parameters: [
          {
            operation: 'wait',
            taskId: api.taskId,
            pollInterval: 5,
            timeout: 30,
          },
          {
            operation: 'create',
            taskType: 'freeform',
            input: '{"brief":"Must not be created"}',
            options: {},
          },
        ],
      }),
    );
    await vi.advanceTimersByTimeAsync(0);

    controller.abort();

    await expect(execution).rejects.toThrow(/Execution was cancelled/);
    expect(api.createdBodies).toHaveLength(0);
  });

  it('preserves SDK rate-limit retries for task creation', async () => {
    vi.useFakeTimers();
    const api = new FakeMoltNetApi({ createResponses: [429, 201] });
    vi.stubGlobal('fetch', api.fetch);
    const execution = new MoltNet().execute.call(
      createExecuteContext({
        parameters: {
          operation: 'create',
          taskType: 'freeform',
          input: '{"brief":"Retry after throttling"}',
          options: {},
        },
      }),
    );

    await vi.runAllTimersAsync();
    const [output] = await execution;

    expect(output[0].json.id).toBe(api.taskId);
    expect(
      api.requests.filter(
        ({ method, url }) => method === 'POST' && url.endsWith('/tasks'),
      ),
    ).toHaveLength(2);
    expect(
      api.requests.filter(({ url }) => url.endsWith('/oauth2/token')),
    ).toHaveLength(1);
  });

  it('processes every item and preserves paired item links', async () => {
    const api = new FakeMoltNetApi();
    vi.stubGlobal('fetch', api.fetch);
    const context = createExecuteContext({
      items: [{ json: { n: 1 } }, { json: { n: 2 } }],
      parameters: [
        {
          operation: 'create',
          taskType: 'freeform',
          input: '{"brief":"First"}',
          options: {},
        },
        {
          operation: 'create',
          taskType: 'freeform',
          input: '{"brief":"Second"}',
          options: {},
        },
      ],
    });

    const [output] = await new MoltNet().execute.call(context);

    expect(output.map(({ pairedItem }) => pairedItem)).toEqual([
      { item: 0 },
      { item: 1 },
    ]);
    expect(api.createdBodies).toHaveLength(2);
    expect(
      api.requests.filter(({ url }) => url.endsWith('/oauth2/token')),
    ).toHaveLength(1);
  });

  it('uses separately resolved credentials for each input item', async () => {
    const api = new FakeMoltNetApi();
    vi.stubGlobal('fetch', api.fetch);
    const agentKeyCredentials = (agentApiKey: string) => ({
      ...defaultCredentials,
      authentication: 'agentKey' as const,
      agentApiKey,
      clientId: '',
      clientSecret: '',
    });
    const context = createExecuteContext({
      credentials: [
        agentKeyCredentials('moltnet_agent_key_one'),
        agentKeyCredentials('moltnet_agent_key_two'),
      ],
      items: [{ json: { n: 1 } }, { json: { n: 2 } }],
      parameters: [
        {
          operation: 'create',
          taskType: 'freeform',
          input: '{"brief":"First identity"}',
          options: {},
        },
        {
          operation: 'create',
          taskType: 'freeform',
          input: '{"brief":"Second identity"}',
          options: {},
        },
      ],
    });

    await new MoltNet().execute.call(context);

    const authorization = api.requests
      .filter(({ method, url }) => method === 'POST' && url.endsWith('/tasks'))
      .map(({ headers }) => headers.get('authorization'));
    expect(authorization).toEqual([
      'Bearer moltnet_agent_key_one',
      'Bearer moltnet_agent_key_two',
    ]);
  });

  it('returns API failures when continueOnFail is enabled', async () => {
    const api = new FakeMoltNetApi({ createStatus: 500 });
    vi.stubGlobal('fetch', api.fetch);
    const context = createExecuteContext({
      continueOnFail: true,
      parameters: {
        operation: 'create',
        taskType: 'freeform',
        input: '{"brief":"Rejected"}',
        options: {},
      },
    });

    const [output] = await new MoltNet().execute.call(context);

    expect(output[0].json).toMatchObject({
      error: expect.any(String),
      code: 'about:blank',
      statusCode: 500,
      detail: 'The fake API rejected the task',
    });
    expect(output[0].error).toBeDefined();
    expect(output[0].error).toMatchObject({ httpCode: '500' });
    expect(output[0].pairedItem).toEqual({ item: 0 });
  });

  it('preserves field-level API validation errors', async () => {
    const api = new FakeMoltNetApi({
      createStatus: 400,
      createProblem: {
        type: 'VALIDATION_FAILED',
        title: 'Validation failed',
        status: 400,
        detail: 'Task input is invalid',
        errors: [
          { field: 'input.brief', message: 'must not be empty' },
          { field: 'maxAttempts', message: 'must be at least 1' },
        ],
      },
    });
    vi.stubGlobal('fetch', api.fetch);
    const [output] = await new MoltNet().execute.call(
      createExecuteContext({
        continueOnFail: true,
        parameters: {
          operation: 'create',
          taskType: 'freeform',
          input: '{"brief":"Rejected"}',
          options: {},
        },
      }),
    );

    expect(output[0].json).toMatchObject({
      code: 'VALIDATION_FAILED',
      statusCode: 400,
      detail: 'Task input is invalid',
      validationErrors: [
        { field: 'input.brief', message: 'must not be empty' },
        { field: 'maxAttempts', message: 'must be at least 1' },
      ],
    });
  });
});
