import { NodeOperationError } from 'n8n-workflow';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MoltNet } from '../nodes/MoltNet/MoltNet.node.js';
import {
  createExecuteContext,
  defaultCredentials,
  FakeMoltNetApi,
} from './harness.js';

describe('MoltNet node', () => {
  afterEach(() => vi.unstubAllGlobals());

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

  it.each(['completed', 'failed', 'cancelled', 'expired'])(
    'waits through transitions and returns the %s snapshot',
    async (terminalStatus) => {
      const api = new FakeMoltNetApi({
        statuses: ['queued', 'running', terminalStatus],
        terminalStatus,
      });
      vi.stubGlobal('fetch', api.fetch);
      const context = createExecuteContext({
        parameters: {
          operation: 'wait',
          taskId: api.taskId,
          pollInterval: 0.001,
          timeout: 1,
        },
      });

      const [output] = await new MoltNet().execute.call(context);

      expect(output[0].json).toMatchObject({
        taskId: api.taskId,
        status: terminalStatus,
        terminal: true,
      });
      expect(output[0].json.attempts).toEqual([api.attempt]);
      expect(output[0].pairedItem).toEqual({ item: 0 });
    },
  );

  it('times out a non-terminal task', async () => {
    const api = new FakeMoltNetApi({ terminalStatus: 'running' });
    vi.stubGlobal('fetch', api.fetch);
    const context = createExecuteContext({
      parameters: {
        operation: 'wait',
        taskId: api.taskId,
        pollInterval: 0.001,
        timeout: 0.001,
      },
    });

    await expect(new MoltNet().execute.call(context)).rejects.toThrow(
      /Timed out waiting for task/,
    );
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

    expect(output[0].json.error).toBeTypeOf('string');
    expect(output[0].error).toBeDefined();
    expect(output[0].pairedItem).toEqual({ item: 0 });
  });
});
