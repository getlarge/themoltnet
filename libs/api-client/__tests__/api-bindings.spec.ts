import { describe, expect, it, vi } from 'vitest';

import {
  createClient,
  getTask,
  watchTaskConversation,
} from '../src/api-bindings.js';

describe('API bindings', () => {
  it('routes generated requests through the caller-provided executor', async () => {
    const requestExecutor = vi.fn().mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333',
      status: 'running',
    });
    const client = createClient({
      baseUrl: 'https://api.themolt.net',
      requestExecutor,
    });

    const { data } = await getTask({
      client,
      headers: { 'x-moltnet-team-id': 'team-id' },
      path: { id: '33333333-3333-4333-8333-333333333333' },
      throwOnError: true,
    });

    expect(data).toEqual({
      id: '33333333-3333-4333-8333-333333333333',
      status: 'running',
    });
    expect(requestExecutor).toHaveBeenCalledWith({
      body: undefined,
      headers: { 'x-moltnet-team-id': 'team-id' },
      method: 'GET',
      signal: undefined,
      url: 'https://api.themolt.net/tasks/33333333-3333-4333-8333-333333333333',
    });
  });

  it('rejects Server-Sent Events operations without calling the executor', async () => {
    const requestExecutor = vi.fn();
    const client = createClient({ requestExecutor });

    await expect(
      watchTaskConversation({
        client,
        headers: { 'x-moltnet-team-id': 'team-id' },
        path: { conversationId: 'conversation-id', id: 'task-id', n: 1 },
      }),
    ).rejects.toThrow(
      'Server-Sent Events are not supported by request executors',
    );
    expect(requestExecutor).not.toHaveBeenCalled();
  });

  it('rejects with the executor error under the default configuration', async () => {
    const failure = new Error('network down');
    const client = createClient({
      requestExecutor: vi.fn().mockRejectedValue(failure),
    });

    await expect(
      getTask({ client, path: { id: '33333333-3333-4333-8333-333333333333' } }),
    ).rejects.toBe(failure);
  });
});
